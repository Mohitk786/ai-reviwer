import type { PrismaClient } from '@repo/db';
import type { EmbeddingProvider } from '@repo/embeddings';
import type { Logger } from '@repo/observability';
import { jobSchemas, JobNames } from '@repo/jobs';
import { storeReviewMemory } from './memory-store.js';
import { z } from 'zod';

export interface StoreReviewMemoryDeps {
  prisma: PrismaClient;
  embedding: EmbeddingProvider;
  logger: Logger;
}

export function createStoreReviewMemoryHandler(deps: StoreReviewMemoryDeps) {
  return async function handleStoreReviewMemory(
    job: { data: z.infer<typeof jobSchemas[typeof JobNames.StoreReviewMemory]> },
  ): Promise<void> {
    await storeReviewMemory(deps, job.data);
  };
}
