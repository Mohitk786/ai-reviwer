-- =============================================================================
-- Manual SQL extras — run after `prisma migrate deploy`.
--
-- Why these aren't in the Prisma schema:
--   1. tsvector triggers — Prisma models the column as Unsupported, but the
--      auto-update trigger has to be plain SQL.
--   2. HNSW index on the vector column — pgvector's index syntax isn't expressible
--      in Prisma DSL.
--
-- Workflow:
--   - During dev: copy these statements into your latest Prisma migration's
--     migration.sql (after `prisma migrate dev --create-only`), then `prisma
--     migrate dev` to apply.
--   - In production: the Docker entrypoint runs `prisma migrate deploy` then
--     `psql -f extras.sql` (idempotent statements only — see CREATE INDEX IF NOT EXISTS).
-- =============================================================================

-- 1. Full-text search trigger on Chunk.searchVector
-- ---------------------------------------------------------------------------
-- We populate `searchVector` with weighted tsvector built from `content` plus
-- denormalized metadata (authorLogin, labels). Weighted so that tokens in
-- `content` rank highest, then labels, then author.
--
-- Hybrid retrieval uses `searchVector @@ plainto_tsquery(...)` for the sparse
-- ranker alongside pgvector cosine similarity for the dense ranker.

CREATE OR REPLACE FUNCTION chunk_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."content", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."labels", ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."authorLogin", '')), 'C');
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS chunk_search_vector_trigger ON "Chunk";
CREATE TRIGGER chunk_search_vector_trigger
BEFORE INSERT OR UPDATE OF "content", "labels", "authorLogin"
ON "Chunk"
FOR EACH ROW
EXECUTE FUNCTION chunk_search_vector_update();

-- GIN index on the tsvector column for fast FTS lookups.
CREATE INDEX IF NOT EXISTS chunk_search_vector_idx
  ON "Chunk"
  USING GIN ("searchVector");

-- 2. HNSW index on ChunkEmbedding.embedding
-- ---------------------------------------------------------------------------
-- HNSW > IVFFlat for our query patterns (top-K cosine similarity with metadata
-- filters). Build is slower; queries are faster and don't require training data.
--
-- Build AFTER initial backfill — building during ingest dramatically slows inserts.
-- Tune `m` and `ef_construction` later if recall is unsatisfactory.

CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw_idx
  ON "ChunkEmbedding"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Optional: composite B-tree to support the common query pattern of
-- "embeddings for chunks of this repository" before the ANN scan.
-- (Used only when filtering by repo via JOIN to Chunk.)
CREATE INDEX IF NOT EXISTS chunk_embedding_chunkid_idx
  ON "ChunkEmbedding" ("chunkId");
