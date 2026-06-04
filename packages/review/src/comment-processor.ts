

import type { PrismaClient } from '@repo/db';
import type { GitHubAppClient } from '@repo/github';
import { replyToPRComment } from '@repo/github';
import type { Logger } from '@repo/observability';
import type { EmbeddingProvider } from '@repo/embeddings';
import { createReviewLLMClient } from './llm-client.js';
import type { LLMProvider } from '@repo/llm';

export interface ProcessDevCommentDeps {
  prisma: PrismaClient;
  github: GitHubAppClient;
  llm: LLMProvider;
  embedding: EmbeddingProvider;
  logger: Logger;
}

export interface ProcessDevCommentInput {
  repositoryId: string;
  installationId: string;
  pullRequestNumber: number;
  githubCommentId: number;
  commentBody: string;
  commenterLogin: string;
  filePath?: string;
  line?: number;
  inReplyToCommentId?: number;
  commentUrl?: string;
}

export async function processDevComment(
  deps: ProcessDevCommentDeps,
  input: ProcessDevCommentInput,
): Promise<void> {
  const { prisma, github, llm, embedding, logger } = deps;
  const log = logger.child({
    component: 'comment-processor',
    repositoryId: input.repositoryId,
    prNumber: input.pullRequestNumber,
    githubCommentId: input.githubCommentId,
  });

  // ---- 1. Find the AiReviewComment this dev comment relates to ----
  const aiComment = await findRelatedAiComment(prisma, input);

  if (!aiComment) {
    log.debug('no matching AiReviewComment found — extracting repo knowledge only');
    // Still extract knowledge even if we can't link it to a specific comment.
    await maybeExtractAndStoreKnowledge(
      { prisma, llm, embedding, log },
      { input, aiCommentBody: undefined },
    );
    return;
  }

  log.debug({ aiReviewCommentId: aiComment.id }, 'matched AiReviewComment');

  const llmClient = createReviewLLMClient(llm, logger);

  // ---- 2. Classify developer intent ----
  const classification = await llmClient.classifyDevComment({
    aiComment: aiComment.body,
    developerComment: input.commentBody,
  });

  log.info(
    { intent: classification.intent, confidence: classification.confidence },
    'dev comment classified',
  );

  // ---- 3. Route by intent ----

  // QUESTION → explain and reply (most latency-sensitive, do first)
  if (classification.intent === 'QUESTION') {
    await handleQuestion({ prisma, github, llmClient, log }, input, aiComment);
  }

  // CODEBASE_KNOWLEDGE → extract and store (also handles DISMISSED with context)
  if (
    classification.intent === 'CODEBASE_KNOWLEDGE' ||
    (classification.intent === 'DISMISSED' && input.commentBody.length > 30)
  ) {
    await maybeExtractAndStoreKnowledge(
      { prisma, llm, embedding, log },
      { input, aiCommentBody: aiComment.body },
    );
  }

  // ACCEPTED / DISMISSED → update ReviewMemory outcome
  if (classification.intent === 'ACCEPTED' || classification.intent === 'DISMISSED') {
    const newOutcome = classification.intent === 'ACCEPTED' ? 'ACCEPTED' : 'DISMISSED';
    await prisma.reviewMemory.updateMany({
      where: { aiReviewCommentId: aiComment.id },
      data: { outcome: newOutcome, outcomeAt: new Date() },
    });
    log.info({ outcome: newOutcome }, 'ReviewMemory outcome updated');
  }

  // Log conversation regardless of intent (except UNRELATED)
  if (classification.intent !== 'UNRELATED') {
    await prisma.reviewConversation.create({
      data: {
        repositoryId: input.repositoryId,
        aiReviewCommentId: aiComment.id,
        developerLogin: input.commenterLogin,
        developerCommentId: BigInt(input.githubCommentId),
        developerQuestion: input.commentBody,
      },
    }).catch(() => { /* non-critical */ });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findRelatedAiComment(
  prisma: PrismaClient,
  input: ProcessDevCommentInput,
) {
  const include = { review: { select: { repositoryId: true } } } as const;

  // Priority 1: direct reply by GitHub comment ID (most reliable).
  if (input.inReplyToCommentId) {
    const byGithubId = await prisma.aiReviewComment.findFirst({
      where: { githubCommentId: BigInt(input.inReplyToCommentId) },
      include,
    });
    if (byGithubId) return byGithubId;
  }

  // Priority 2: same file + line within an active review on this PR.
  if (input.filePath && input.line) {
    const byFileLine = await prisma.aiReviewComment.findFirst({
      where: {
        filePath: input.filePath,
        line: input.line,
        review: {
          repositoryId: input.repositoryId,
          pullRequestNumber: input.pullRequestNumber,
          status: 'COMPLETED',
        },
      },
      orderBy: { createdAt: 'desc' },
      include,
    });
    if (byFileLine) return byFileLine;
  }

  return null;
}

async function handleQuestion(
  ctx: {
    prisma: PrismaClient;
    github: GitHubAppClient;
    llmClient: ReturnType<typeof createReviewLLMClient>;
    log: Logger;
  },
  input: ProcessDevCommentInput,
  aiComment: { id: string; body: string; filePath: string; line: number },
) {
  const { prisma, github, llmClient, log } = ctx;

  // Load repo to get owner/name/installationGithubId.
  const repo = await prisma.repository.findUnique({
    where: { id: input.repositoryId },
    include: { installation: true },
  });
  if (!repo) return;

  const explanation = await llmClient.explainComment({
    filePath: aiComment.filePath,
    line: aiComment.line,
    diffChunk: aiComment.body, 
    originalComment: aiComment.body,
    developerQuestion: input.commentBody,
  });

  if (!explanation || explanation.trim().length < 5) return;

  // Post a reply to the developer's comment thread on GitHub.
  if (input.inReplyToCommentId) {
    try {
      await replyToPRComment(github, repo.installation.githubId, {
        owner: repo.owner,
        repo: repo.name,
        pullNumber: input.pullRequestNumber,
        inReplyToCommentId: input.inReplyToCommentId,
        body: `> ${input.commentBody}\n\n${explanation}`,
      });
      log.info('explanation reply posted to GitHub');
    } catch (err) {
      log.warn({ err }, 'failed to post explanation reply to GitHub');
    }
  }

  // Persist the conversation.
  await prisma.reviewConversation.updateMany({
    where: {
      aiReviewCommentId: aiComment.id,
      developerCommentId: BigInt(input.githubCommentId),
    },
    data: { aiReply: explanation, repliedAt: new Date() },
  });
}

async function maybeExtractAndStoreKnowledge(
  ctx: {
    prisma: PrismaClient;
    llm: LLMProvider;
    embedding: EmbeddingProvider;
    log: Logger;
  },
  opts: {
    input: ProcessDevCommentInput;
    aiCommentBody: string | undefined;
  },
) {
  const { prisma, llm, embedding, log } = ctx;
  const { input } = opts;

  const llmClient = createReviewLLMClient(llm, log as never);
  const extracted = await llmClient.extractKnowledge({
    developerComment: input.commentBody,
    filePath: input.filePath,
  });

  if (!extracted.isUseful || !extracted.content.trim()) {
    log.debug('no useful knowledge extracted from dev comment');
    return;
  }

  // Embed the knowledge statement.
  let vector: number[];
  try {
    vector = await embedding.embed(extracted.content);
  } catch (err) {
    log.warn({ err }, 'failed to embed knowledge — storing without embedding');
    vector = [];
  }

  const knowledge = await prisma.repoKnowledge.create({
    data: {
      repositoryId: input.repositoryId,
      content: extracted.content,
      kind: extracted.kind as never,
      sourcePrNumber: input.pullRequestNumber,
      sourceCommentUrl: input.commentUrl ?? null,
    },
  });

  if (vector.length > 0) {
    const vectorStr = `[${vector.join(',')}]`;
    await prisma.$executeRaw`
      INSERT INTO "RepoKnowledgeEmbedding" (id, "repoKnowledgeId", model, "modelVersion", embedding)
      VALUES (
        gen_random_uuid()::text,
        ${knowledge.id},
        'openai',
        'text-embedding-3-large',
        ${vectorStr}::vector
      )
      ON CONFLICT ("repoKnowledgeId") DO NOTHING
    `;
  }

  log.info({ kind: extracted.kind, content: extracted.content.slice(0, 80) }, 'repo knowledge stored');
}
