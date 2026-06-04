/**
 * Layer 2 — retrieval functions for ReviewMemory and RepoKnowledge.
 *
 * Both functions use pgvector cosine distance and always filter by repositoryId
 * so context never bleeds across repos.
 */

import type { PrismaClient } from '@repo/db';

// ---------------------------------------------------------------------------
// Similar past reviews
// ---------------------------------------------------------------------------

export interface SimilarReviewResult {
  filePath: string;
  pullRequestNumber: number;
  commentBody: string;
  severity: string;
  category: string;
  outcome: string; // PENDING | ACCEPTED | DISMISSED
  distance: number;
}

/**
 * Find past AI review comments semantically similar to `queryText`.
 * Results weighted toward ACCEPTED outcomes via a secondary sort.
 */
export async function searchSimilarReviews(
  prisma: PrismaClient,
  opts: {
    repositoryId: string;
    vectorStr: string;
    topK: number;
  },
): Promise<SimilarReviewResult[]> {
  const { repositoryId, vectorStr, topK } = opts;

  const rows = await prisma.$queryRaw<
    Array<{
      filePath: string;
      pullRequestNumber: number;
      commentBody: string;
      severity: string;
      category: string;
      outcome: string;
      distance: number;
    }>
  >`
    SELECT
      rm."filePath",
      rm."pullRequestNumber",
      rm."commentBody",
      rm.severity,
      rm.category,
      rm.outcome,
      rme.embedding <=> ${vectorStr}::vector AS distance
    FROM "ReviewMemory" rm
    JOIN "ReviewMemoryEmbedding" rme ON rme."reviewMemoryId" = rm.id
    WHERE rm."repositoryId" = ${repositoryId}
    ORDER BY
      distance ASC,
      -- surface ACCEPTED findings first at equal distance
      CASE rm.outcome WHEN 'ACCEPTED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END ASC
    LIMIT ${topK}
  `;

  return rows.map((r) => ({
    filePath: r.filePath,
    pullRequestNumber: Number(r.pullRequestNumber),
    commentBody: r.commentBody,
    severity: r.severity,
    category: r.category,
    outcome: r.outcome,
    distance: Number(r.distance),
  }));
}

// ---------------------------------------------------------------------------
// Repo knowledge
// ---------------------------------------------------------------------------

export interface RepoKnowledgeResult {
  content: string;
  kind: string;
  sourcePrNumber: number | null;
  distance: number;
}

/**
 * Find codebase knowledge entries most relevant to the current diff chunk.
 * Used to give the LLM repo-specific context extracted from dev comments.
 */
export async function searchRepoKnowledge(
  prisma: PrismaClient,
  opts: {
    repositoryId: string;
    vectorStr: string;
    topK: number;
  },
): Promise<RepoKnowledgeResult[]> {
  const { repositoryId, vectorStr, topK } = opts;

  const rows = await prisma.$queryRaw<
    Array<{
      content: string;
      kind: string;
      sourcePrNumber: number | null;
      distance: number;
    }>
  >`
    SELECT
      rk.content,
      rk.kind,
      rk."sourcePrNumber",
      rke.embedding <=> ${vectorStr}::vector AS distance
    FROM "RepoKnowledge" rk
    JOIN "RepoKnowledgeEmbedding" rke ON rke."repoKnowledgeId" = rk.id
    WHERE rk."repositoryId" = ${repositoryId}
    ORDER BY distance ASC
    LIMIT ${topK}
  `;

  return rows.map((r) => ({
    content: r.content,
    kind: r.kind,
    sourcePrNumber: r.sourcePrNumber ? Number(r.sourcePrNumber) : null,
    distance: Number(r.distance),
  }));
}
