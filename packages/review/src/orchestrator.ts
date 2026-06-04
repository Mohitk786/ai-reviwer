import type { PrismaClient } from '@repo/db';
import type { GitHubAppClient } from '@repo/github';
import { listPRFiles, createPRReview, getPRMetadata } from '@repo/github';
import type { Logger } from '@repo/observability';
import type { LLMProvider } from '@repo/llm';
import type { EmbeddingProvider } from '@repo/embeddings';
import { parsePatch, isCommentableLine } from '@repo/diff-parser';
import { jobSchemas, JobNames } from '@repo/jobs';
import { minimatch } from 'minimatch';
import type Boss from 'pg-boss';

import { createReviewLLMClient } from './llm-client.js';
import type { FileReviewComment } from './schemas.js';
import { searchSimilarCode } from './code-search.js';
import { searchSimilarReviews, searchRepoKnowledge } from './memory-search.js';
import { buildPastReviewsContext, buildRepoKnowledgeContext } from './prompts.js';
import { z } from 'zod';

export interface ReviewPrDeps {
  prisma: PrismaClient;
  github: GitHubAppClient;
  logger: Logger;
  llm: LLMProvider;
  boss: Boss;
  /** Optional — when provided, similar codebase chunks are retrieved and injected into the review prompt. */
  embedding?: EmbeddingProvider;
}

export function createReviewPrHandler(deps: ReviewPrDeps) {
  const { prisma, github, logger, llm, embedding, boss } = deps;

  return async function handleReviewPr(job: { data: z.infer<typeof jobSchemas[typeof JobNames.ReviewPr]> }): Promise<void> {
    const payload = job.data;
    const log = logger.child({
      aiReviewId: payload.aiReviewId,
      prNumber: payload.pullRequestNumber,
      repositoryId: payload.repositoryId,
      correlationId: payload.correlationId,
    });

    // ---- 1. Load AiReview — must be PENDING ----
    const aiReview = await prisma.aiReview.findUnique({
      where: { id: payload.aiReviewId },
    });

    if (!aiReview) {
      log.error('AiReview not found — aborting');
      return;
    }

    if (aiReview.status !== 'PENDING') {
      log.info({ status: aiReview.status }, 'AiReview not PENDING — skipping (idempotent)');
      return;
    }

    // ---- 2. Mark RUNNING ----
    await prisma.aiReview.update({
      where: { id: payload.aiReviewId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    try {
      await runReview({ payload, log, prisma, github, llm, embedding, boss });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'review failed — marking FAILED');
      await prisma.aiReview.update({
        where: { id: payload.aiReviewId },
        data: { status: 'FAILED', error: message, completedAt: new Date() },
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Core review logic (separated for cleaner error boundary in the handler)
// ---------------------------------------------------------------------------

async function runReview(ctx: {
  payload: ReturnType<typeof jobSchemas[typeof JobNames.ReviewPr]['parse']>;
  log: Logger;
  prisma: PrismaClient;
  github: GitHubAppClient;
  llm: LLMProvider;
  embedding?: EmbeddingProvider;
  boss: Boss;
}): Promise<void> {
  const { payload, log, prisma, github, llm, embedding, boss } = ctx;

  // ---- 3. Load repo + installation + config ----
  const repo = await prisma.repository.findUniqueOrThrow({
    where: { id: payload.repositoryId },
    include: { installation: true },
  });

  const config = await prisma.reviewConfiguration.findFirst({
    where: {
      OR: [
        { repositoryId: payload.repositoryId },
        { installationId: payload.installationId, repositoryId: null },
      ],
    },
    orderBy: { repositoryId: 'desc' }, // repo-specific config wins over installation default
  });

  if (config && !config.enabled) {
    log.info('ReviewConfiguration disabled — marking SKIPPED');
    await prisma.aiReview.update({
      where: { id: payload.aiReviewId },
      data: { status: 'SKIPPED', completedAt: new Date() },
    });
    return;
  }

  const maxFiles = config?.maxFilesPerPr ?? 20;
  const ignorePaths: string[] = config?.ignorePaths ?? [];
  const ignoreAuthors: string[] = config?.ignoreAuthors ?? [];

  // ---- 4. Fetch PR metadata + files ----
  const githubInstallationId = repo.installation.githubId;

  const prMeta = await getPRMetadata(
    github,
    githubInstallationId,
    repo.owner,
    repo.name,
    payload.pullRequestNumber,
  );

  if (ignoreAuthors.includes(prMeta.authorLogin ?? '')) {
    log.info({ author: prMeta.authorLogin }, 'PR author on ignore list — marking SKIPPED');
    await prisma.aiReview.update({
      where: { id: payload.aiReviewId },
      data: { status: 'SKIPPED', completedAt: new Date() },
    });
    return;
  }

  const allFiles = await listPRFiles(
    github,
    githubInstallationId,
    repo.owner,
    repo.name,
    payload.pullRequestNumber,
  );

  // ---- 5. Filter files ----
  const reviewableFiles = allFiles
    .filter((f) => f.status !== 'removed')
    .filter((f) => !!f.patch)
    .filter((f) => !ignorePaths.some((pattern) => minimatch(f.filename, pattern, { dot: true })))
    .slice(0, maxFiles);

  log.info(
    { total: allFiles.length, reviewable: reviewableFiles.length, maxFiles },
    'files filtered',
  );

  // ---- 6. LLM setup ----
  const llmClient = createReviewLLMClient(llm, log);

  // ---- 7. Per-file review ----
  type CollectedComment = FileReviewComment & { filePath: string };
  const collectedComments: CollectedComment[] = [];
  const fileSummaries: Array<{ path: string; summary: string; commentCount: number }> = [];

  for (const file of reviewableFiles) {
    const patch = file.patch!; // filtered above
    const parsed = parsePatch(patch);

    if (parsed.commentableLines.size === 0) {
      log.debug({ filePath: file.filename }, 'no commentable lines — skipping file');
      continue;
    }

    const queryText = patch.slice(0, 3000);

    // Layer 1: retrieve similar existing functions from the indexed codebase.
    let similarCode: Awaited<ReturnType<typeof searchSimilarCode>> = [];
    // Layer 2: retrieve past review decisions + repo knowledge (run in parallel with Layer 1).
    let pastReviewsContext = '';
    let repoKnowledgeContext = '';

    if (embedding) {
      const vector = await embedding.embed(queryText);
      const vectorStr = `[${vector.join(',')}]`;
      try {
        const [layer1, layer2Reviews, layer2Knowledge] = await Promise.all([
          searchSimilarCode(prisma, {
            repositoryId: payload.repositoryId,
            vectorStr,
            topK: 5,
          }),
          searchSimilarReviews(prisma, {
            repositoryId: payload.repositoryId,
            vectorStr,
            topK: 3,
          }),
          searchRepoKnowledge(prisma, {
            repositoryId: payload.repositoryId,
            vectorStr,
            topK: 3,
          }),
        ]);

        similarCode = layer1;
        pastReviewsContext = buildPastReviewsContext(layer2Reviews);
        repoKnowledgeContext = buildRepoKnowledgeContext(layer2Knowledge);

        log.debug(
          { filePath: file.filename, codeHits: layer1.length, reviewHits: layer2Reviews.length, knowledgeHits: layer2Knowledge.length },
          'context retrieved',
        );
      } catch (err) {
        log.warn({ err, filePath: file.filename }, 'context retrieval failed — continuing without Layer 2');
      }
    }

    log.debug({ filePath: file.filename }, 'calling LLM for file review');
    const output = await llmClient.reviewFile({
      prTitle: prMeta.title,
      prBody: prMeta.body ?? undefined,
      filePath: file.filename,
      patch,
      similarCode: similarCode.map((r) => ({
        filePath: r.filePath,
        functionName: r.metadata?.functionName ?? null,
        startLine: r.metadata?.startLine ?? 1,
        endLine: r.metadata?.endLine ?? 1,
        content: r.content,
      })),
      pastReviewsContext,
      repoKnowledgeContext,
    });

    // Validate that each comment references a line that actually exists in the diff.
    const validComments = output.comments.filter((c) => {
      if (!isCommentableLine(parsed, c.line)) {
        log.debug(
          { filePath: file.filename, line: c.line },
          'LLM comment on non-commentable line — dropped',
        );
        return false;
      }
      return true;
    });

    if (validComments.length > 0) {
      collectedComments.push(...validComments.map((c) => ({ ...c, filePath: file.filename })));
    }

    if (output.fileSummary || validComments.length > 0) {
      fileSummaries.push({
        path: file.filename,
        summary: output.fileSummary ?? `${validComments.length} issue${validComments.length !== 1 ? 's' : ''} found`,
        commentCount: validComments.length,
      });
    }
  }

  // ---- 8. PR summary ----
  const prSummary = await llmClient.summarizePr({
    prTitle: prMeta.title,
    fileSummaries,
    totalComments: collectedComments.length,
  });

  // ---- 9. Persist AiReviewComment rows ----
  if (collectedComments.length > 0) {
    await prisma.aiReviewComment.createMany({
      data: collectedComments.map((c) => ({
        reviewId: payload.aiReviewId,
        filePath: c.filePath,
        line: c.line,
        side: c.side,
        body: c.body,
        severity: c.severity,
        suggestion: c.suggestion ?? null,
      })),
    });
  }

  // ---- 10. Post GitHub review ----
  const githubComments = collectedComments.map((c) => ({
    path: c.filePath,
    line: c.line,
    side: c.side,
    body: formatCommentBody(c),
  }));

  const { reviewId: githubReviewId } = await createPRReview(
    github,
    githubInstallationId,
    {
      owner: repo.owner,
      repo: repo.name,
      pullNumber: payload.pullRequestNumber,
      commitId: payload.commitSha,
      body: prSummary.summary,
      event: 'COMMENT',
      comments: githubComments,
    },
  );

  // ---- 11. Mark COMPLETED ----
  await prisma.aiReview.update({
    where: { id: payload.aiReviewId },
    data: {
      status: 'COMPLETED',
      summary: prSummary.summary,
      githubReviewId: BigInt(githubReviewId),
      totalComments: collectedComments.length,
      completedAt: new Date(),
    },
  });

  // ---- 12. Enqueue Layer 2 memory storage (best-effort, non-blocking) ----
  // Runs in a separate job so it never delays the review completion response.
  if (collectedComments.length > 0) {
    await boss.send(JobNames.StoreReviewMemory, {
      repositoryId: payload.repositoryId,
      aiReviewId: payload.aiReviewId,
    }).catch((err: unknown) => {
      log.warn({ err }, 'failed to enqueue StoreReviewMemory — memory will not be stored for this review');
    });
  }

  log.info(
    { githubReviewId, totalComments: collectedComments.length },
    'review completed and posted',
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCommentBody(c: FileReviewComment): string {
  const severityBadge: Record<string, string> = {
    INFO: '💡 **Info**',
    WARNING: '⚠️ **Warning**',
    ERROR: '🔴 **Error**',
    CRITICAL: '🚨 **Critical**',
  };

  const badge = severityBadge[c.severity] ?? `**${c.severity}**`;
  const body = `${badge}\n\n${c.body}`;

  if (c.suggestion) {
    return `${body}\n\n**Suggestion:**\n\`\`\`suggestion\n${c.suggestion}\n\`\`\``;
  }

  return body;
}
