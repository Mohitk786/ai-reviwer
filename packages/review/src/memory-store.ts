/**
 * Layer 2 — Review Memory storage.
 *
 * After a review completes, each AiReviewComment is persisted as a ReviewMemory
 * row with a pgvector embedding of its diff chunk. These become the retrieval
 * corpus for future reviews on the same repo.
 *
 * Called by the StoreReviewMemory job handler (not inline in the review to keep
 * the critical path fast — memory storage is best-effort).
 */

import type { PrismaClient } from '@repo/db';
import type { EmbeddingProvider } from '@repo/embeddings';
import type { Logger } from '@repo/observability';

/** LLM-assisted category inference — simple keyword heuristic kept here so we
 *  don't burn an extra LLM call just for categorisation. */
function inferCategory(body: string): string {
  const lower = body.toLowerCase();
  if (/sql inject|xss|csrf|auth|token|secret|password|encrypt|sanitiz/.test(lower)) return 'SECURITY';
  if (/perform|slow|n\+1|index|cache|latency|timeout|memory leak/.test(lower)) return 'PERFORMANCE';
  if (/naming|style|format|lint|convention|indent|whitespace/.test(lower)) return 'STYLE';
  if (/test|coverage|spec|assert|mock|fixture/.test(lower)) return 'TEST_COVERAGE';
  if (/architect|pattern|layer|depend|coupling|abstraction|module/.test(lower)) return 'ARCHITECTURE';
  return 'CORRECTNESS';
}

export interface StoreReviewMemoryDeps {
  prisma: PrismaClient;
  embedding: EmbeddingProvider;
  logger: Logger;
}

/**
 * Embeds and stores all AiReviewComments from a completed review as ReviewMemory rows.
 * Idempotent — skips comments that already have a ReviewMemory row (unique constraint).
 */
export async function storeReviewMemory(
  deps: StoreReviewMemoryDeps,
  opts: {
    repositoryId: string;
    aiReviewId: string;
  },
): Promise<void> {
  const { prisma, embedding, logger } = deps;
  const log = logger.child({ component: 'memory-store', aiReviewId: opts.aiReviewId });

  const review = await prisma.aiReview.findUnique({
    where: { id: opts.aiReviewId },
    include: { comments: true },
  });

  if (!review || review.status !== 'COMPLETED') {
    log.warn({ status: review?.status }, 'review not COMPLETED — skipping memory store');
    return;
  }

  if (review.comments.length === 0) {
    log.debug('no comments to store');
    return;
  }

  // Only process comments that don't already have a ReviewMemory row.
  const existingIds = new Set(
    (
      await prisma.reviewMemory.findMany({
        where: { aiReviewCommentId: { in: review.comments.map((c) => c.id) } },
        select: { aiReviewCommentId: true },
      })
    ).map((r) => r.aiReviewCommentId),
  );

  const toStore = review.comments.filter((c) => !existingIds.has(c.id));
  if (toStore.length === 0) {
    log.debug('all comments already stored — skipping');
    return;
  }

  // Embed all diff chunks in one batch call.
  const diffChunks = toStore.map((c) =>
    // body is the most stable text for embedding — the actual diff patch is
    // not stored on AiReviewComment, so we embed the comment body itself.
    // Future: pass diffChunk from the orchestrator when enqueueing the job.
    c.body.slice(0, 2000),
  );

  let vectors: number[][];
  try {
    vectors = await embedding.embedBatch(diffChunks);
  } catch (err) {
    log.error({ err }, 'embedding batch failed — aborting memory store');
    return;
  }

  //BUG; why hardcoded
  const modelInfo = { model: 'openai', modelVersion: 'text-embedding-3-large' };

  let stored = 0;
  for (let i = 0; i < toStore.length; i++) {
    const comment = toStore[i]!;
    const vector = vectors[i]!;

    try {
      const memory = await prisma.reviewMemory.create({
        data: {
          repositoryId: opts.repositoryId,
          aiReviewCommentId: comment.id,
          pullRequestNumber: review.pullRequestNumber,
          filePath: comment.filePath,
          diffChunk: comment.body.slice(0, 2000),
          commentBody: comment.body,
          severity: comment.severity,
          category: inferCategory(comment.body) as never,
        },
      });

      // Insert embedding via raw SQL — pgvector not supported by Prisma types.
      const vectorStr = `[${vector.join(',')}]`;
      await prisma.$executeRaw`
        INSERT INTO "ReviewMemoryEmbedding" (id, "reviewMemoryId", model, "modelVersion", embedding)
        VALUES (
          gen_random_uuid()::text,
          ${memory.id},
          ${modelInfo.model},
          ${modelInfo.modelVersion},
          ${vectorStr}::vector
        )
        ON CONFLICT ("reviewMemoryId") DO NOTHING
      `;

      stored++;
    } catch (err) {
      // Unique constraint violation = already stored (race). Everything else is logged.
      const code = (err as { code?: string }).code;
      if (code !== 'P2002') {
        log.warn({ err, commentId: comment.id }, 'failed to store memory row — skipping');
      }
    }
  }

  log.info({ stored, total: toStore.length }, 'review memory stored');
}
