/**
 * Similarity search over indexed codebase chunks (Layer 1).
 *
 * Queries ChunkEmbedding using pgvector cosine distance to find existing
 * functions/classes that are semantically similar to the code being reviewed.
 * Always filtered by repositoryId — never mixes context across repos.
 */

import type { PrismaClient } from '@repo/db';
import type { EmbeddingProvider } from '@repo/embeddings';

export interface SimilarChunkMetadata {
  functionName: string | null;
  startLine: number;
  endLine: number;
  language: string;
}

export interface SimilarCodeResult {
  filePath: string;
  content: string;
  metadata: SimilarChunkMetadata;
  /** Cosine distance [0, 2] — lower is more similar. */
  distance: number;
}

/**
 * Find the top-K codebase chunks most similar to `queryText`.
 * Returns an empty array if no chunks are indexed for the repo yet.
 */
export async function searchSimilarCode(
  prisma: PrismaClient,
  embedding: EmbeddingProvider,
  opts: {
    repositoryId: string;
    queryText: string;
    topK: number;
  },
): Promise<SimilarCodeResult[]> {
  const vector = await embedding.embed(opts.queryText);
  const vectorStr = `[${vector.join(',')}]`;

  // Raw SQL is required because ChunkEmbedding.embedding is an Unsupported pgvector type.
  // <=> is cosine distance (0 = identical, 2 = opposite). HNSW index kicks in here.
  const rows = await prisma.$queryRaw<
    Array<{
      filePath: string;
      content: string;
      metadata: unknown;
      distance: number;
    }>
  >`
    SELECT
      c."filesTouched"[1]  AS "filePath",
      c.content,
      c.metadata,
      ce.embedding <=> ${vectorStr}::vector AS distance
    FROM "Chunk" c
    JOIN "ChunkEmbedding" ce ON ce."chunkId" = c.id
    WHERE c."repositoryId" = ${opts.repositoryId}
      AND c."sourceKind" = 'CODE_FILE'
    ORDER BY distance ASC
    LIMIT ${opts.topK}
  `;

  return rows.map((r) => ({
    filePath: r.filePath ?? '',
    content: r.content,
    metadata: r.metadata as SimilarChunkMetadata,
    distance: Number(r.distance),
  }));
}
