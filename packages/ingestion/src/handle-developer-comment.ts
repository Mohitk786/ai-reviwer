import type { PrismaClient } from '@repo/db';
import type { GitHubAppClient } from '@repo/github';
import type { LLMProvider } from '@repo/llm';
import type { EmbeddingProvider } from '@repo/embeddings';
import type { Logger } from '@repo/observability';
import { jobSchemas, JobNames } from '@repo/jobs';
import { processDevComment } from '@repo/review';
import { z } from 'zod';

export interface ProcessDevCommentDeps {
  prisma: PrismaClient;
  github: GitHubAppClient;
  llm: LLMProvider;
  embedding: EmbeddingProvider;
  logger: Logger;
}

export function createProcessDevCommentHandler(deps: ProcessDevCommentDeps) {
  return async function handleProcessDevComment(
    job: { data: z.infer<typeof jobSchemas[typeof JobNames.ProcessDeveloperComment]> },
  ): Promise<void> {
    await processDevComment(deps, job.data);
  };
}
