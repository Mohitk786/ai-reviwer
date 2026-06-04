import type { PrismaClient } from '@repo/db';

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
  distance: number;
}

/**
 * Find the top-K codebase chunks most similar to `queryText`.
 * Returns an empty array if no chunks are indexed for the repo yet.
 */
export async function searchSimilarCode(
  prisma: PrismaClient,
  opts: {
    repositoryId: string;
    vectorStr: string;
    topK: number;
  },
): Promise<SimilarCodeResult[]> {
  const { repositoryId, vectorStr, topK } = opts;

  // Raw SQL is required because ChunkEmbedding.embedding is an Unsupported pgvector type.
  // <=> is cosine distance (0 = identical, 2 = opposite). 
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
    WHERE c."repositoryId" = ${repositoryId}
      AND c."sourceKind" = 'CODE_FILE'
    ORDER BY distance ASC
    LIMIT ${topK}
  `;

  return rows.map((r) => ({
    filePath: r.filePath ?? '',
    content: r.content,
    metadata: r.metadata as SimilarChunkMetadata,
    distance: Number(r.distance),
  }));
}
