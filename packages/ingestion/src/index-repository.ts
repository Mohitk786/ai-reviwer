/**
 * IndexRepository job handler — Layer 1 codebase indexing.
 *
 * On first enable (or manual re-index), fetches the entire repo file tree,
 * chunks each code file with Tree-sitter AST parsing, embeds the chunks, and
 * stores them in Chunk + ChunkEmbedding for similarity search at review time.
 *
 * Files are processed in batches to stay within GitHub rate limits and memory.
 * Each batch fetches file contents, chunks, and embeds in one OpenAI batch call.
 */

import { createHash, randomUUID } from 'crypto';
import type { PrismaClient } from '@repo/db';
import type { GitHubAppClient } from '@repo/github';
import type { EmbeddingProvider } from '@repo/embeddings';
import type { Logger } from '@repo/observability';
import { JobNames, jobSchemas } from '@repo/jobs';
import { chunkFile, isSupportedFile } from '@repo/chunking';

export interface IndexRepositoryDeps {
  prisma: PrismaClient;
  github: GitHubAppClient;
  embedding: EmbeddingProvider;
  logger: Logger;
}

/** Max file size to index. Files larger than this are skipped. */
const MAX_FILE_BYTES = 150_000;
/** Max files to index per repo. Prevents runaway indexing on massive monorepos. */
const MAX_FILES = 500;
/** Files to fetch and process concurrently within one batch iteration. */
const BATCH_SIZE = 15;

export function createIndexRepositoryHandler(deps: IndexRepositoryDeps) {
  return async function handleIndexRepository(job: { data: unknown }): Promise<void> {
    const payload = jobSchemas[JobNames.IndexRepository].parse(job.data);
    const { prisma, github, embedding, logger } = deps;

    const log = logger.child({ repositoryId: payload.repositoryId, job: 'index.repository' });

    const repo = await prisma.repository.findUniqueOrThrow({
      where: { id: payload.repositoryId },
      include: { installation: true },
    });

    if (!repo.enabled) {
      log.info('repository disabled — skipping index');
      return;
    }

    await prisma.repository.update({
      where: { id: repo.id },
      data: { ingestionState: 'DISCOVERING' },
    });

    const octokit = github.forInstallation(repo.installation.githubId);

    // Resolve HEAD of default branch to a stable tree SHA.
    const { data: refData } = await octokit.rest.git.getRef({
      owner: repo.owner,
      repo: repo.name,
      ref: `heads/${repo.defaultBranch}`,
    });
    const headSha = refData.object.sha;

    // Fetch full recursive file tree (GitHub truncates at ~100k entries or 7 MB).
    const { data: treeData } = await octokit.rest.git.getTree({
      owner: repo.owner,
      repo: repo.name,
      tree_sha: headSha,
      recursive: '1',
    });

    const codeFiles = (treeData.tree ?? [])
      .filter((f) => f.type === 'blob' && f.path && isSupportedFile(f.path))
      .filter((f) => (f.size ?? 0) <= MAX_FILE_BYTES)
      .slice(0, MAX_FILES);

    log.info(
      { treeSize: treeData.tree?.length ?? 0, codeFiles: codeFiles.length },
      'file tree discovered',
    );

    await prisma.repository.update({
      where: { id: repo.id },
      data: { ingestionState: 'CHUNKING' },
    });

    let indexed = 0;
    for (let i = 0; i < codeFiles.length; i += BATCH_SIZE) {
      const batch = codeFiles.slice(i, i + BATCH_SIZE);
      await indexFileBatch({
        files: batch.map((f) => ({ path: f.path!, sha: headSha })),
        repo,
        octokit,
        prisma,
        embedding,
        log,
      });
      indexed += batch.length;
      log.debug({ indexed, total: codeFiles.length }, 'batch indexed');
    }

    await prisma.repository.update({
      where: { id: repo.id },
      data: { ingestionState: 'ACTIVE', ingestedThrough: new Date() },
    });

    log.info({ indexed }, 'repository fully indexed');
  };
}

// ---------------------------------------------------------------------------
// Shared helpers used by both IndexRepository and IndexFile handlers
// ---------------------------------------------------------------------------

export interface IndexFileBatchInput {
  files: Array<{ path: string; sha: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  repo: { id: string; owner: string; name: string; installation: { githubId: number } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any;
  prisma: PrismaClient;
  embedding: EmbeddingProvider;
  log: Logger;
}

export async function indexFileBatch(input: IndexFileBatchInput): Promise<void> {
  const { files, repo, octokit, prisma, embedding, log } = input;

  for (const file of files) {
    try {
      await indexSingleFile({ filePath: file.path, ref: file.sha, repo, octokit, prisma, embedding, log });
    } catch (err) {
      log.warn({ err, filePath: file.path }, 'failed to index file — skipping');
    }
  }
}

export interface IndexSingleFileInput {
  filePath: string;
  ref: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  repo: { id: string; owner: string; name: string; installation: { githubId: number } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any;
  prisma: PrismaClient;
  embedding: EmbeddingProvider;
  log: Logger;
}

export async function indexSingleFile(input: IndexSingleFileInput): Promise<void> {
  const { filePath, ref, repo, octokit, prisma, embedding, log } = input;

  const { data } = await octokit.rest.repos.getContent({
    owner: repo.owner,
    repo: repo.name,
    path: filePath,
    ref,
  });

  // getContent returns an array for directories — skip those.
  if (Array.isArray(data) || data.type !== 'file' || !data.content) return;

  // GitHub file content base64 encoded bhejta hai (binary-safe format). Isse normal readable string mein convert karo.
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  const chunks = chunkFile(content, filePath);
  if (chunks.length === 0) return;

  // Embed all chunks in one batch call (OpenAI allows up to 2048 inputs).
  const vectors = await embedding.embedBatch(chunks.map((c) => c.content));

  const narrativeKey = `file:${repo.id}:${filePath}`;
  const now = new Date();

  // Delete stale chunks for this file before inserting fresh ones (idempotent re-index).
  await prisma.chunk.deleteMany({
    where: { repositoryId: repo.id, narrativeKey },
  });

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx]!;
    const vector = vectors[idx]!;

    const contentHash = createHash('sha256').update(chunk.content).digest('hex');

    const created = await prisma.chunk.create({
      data: {
        repositoryId: repo.id,
        sourceKind: 'CODE_FILE',
        sourceId: filePath,
        narrativeKey,
        ordinal: idx,
        content: chunk.content,
        contentHash,
        // Approximate token count: 1 token ≈ 4 chars for code.
        tokens: Math.ceil(chunk.content.length / 4),
        filesTouched: [filePath],
        artifactCreatedAt: now,
        artifactUpdatedAt: now,
        metadata: {
          functionName: chunk.functionName,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          language: chunk.language,
        },
      },
      select: { id: true },
    });

    // ChunkEmbedding.embedding is an Unsupported pgvector type — must use raw SQL.
    const vectorStr = `[${vector.join(',')}]`;
    await prisma.$executeRaw`
      INSERT INTO "ChunkEmbedding" (id, "chunkId", model, "modelVersion", embedding, "createdAt")
      VALUES (
        ${randomUUID()},
        ${created.id},
        ${embedding.kind},
        ${embedding.model},
        ${vectorStr}::vector,
        NOW()
      )
      ON CONFLICT ("chunkId", model, "modelVersion")
      DO UPDATE SET embedding = EXCLUDED.embedding
    `;
  }

  log.debug({ filePath, chunks: chunks.length }, 'file indexed');
}
