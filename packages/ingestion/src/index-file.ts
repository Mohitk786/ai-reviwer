/**
 * IndexFile job handler — incremental re-index on push.
 *
 * Called when a push webhook reports changed files. Re-indexes just those files
 * rather than the full repo so the codebase context stays fresh without a full
 * re-index on every commit.
 */

import type { PrismaClient } from '@repo/db';
import type { GitHubAppClient } from '@repo/github';
import type { EmbeddingProvider } from '@repo/embeddings';
import type { Logger } from '@repo/observability';
import { JobNames, jobSchemas } from '@repo/jobs';
import { isSupportedFile } from '@repo/chunking';
import { indexSingleFile } from './index-repository.js';

export interface IndexFileDeps {
  prisma: PrismaClient;
  github: GitHubAppClient;
  embedding: EmbeddingProvider;
  logger: Logger;
}

export function createIndexFileHandler(deps: IndexFileDeps) {
  return async function handleIndexFile(job: { data: unknown }): Promise<void> {
    const payload = jobSchemas[JobNames.IndexFile].parse(job.data);
    const { prisma, github, embedding, logger } = deps;

    if (!isSupportedFile(payload.filePath)) return;

    const log = logger.child({
      repositoryId: payload.repositoryId,
      filePath: payload.filePath,
      job: 'index.file',
    });

    const repo = await prisma.repository.findUniqueOrThrow({
      where: { id: payload.repositoryId },
      include: { installation: true },
    });

    if (!repo.enabled) return;

    const octokit = github.forInstallation(repo.installation.githubId);

    await indexSingleFile({
      filePath: payload.filePath,
      ref: payload.ref,
      repo,
      octokit,
      prisma,
      embedding,
      log,
    });
  };
}
