-- Migration: add_code_file_chunking
--
-- Adds CODE_FILE source kind so the codebase indexing pipeline (Layer 1) can store
-- AST-chunked function/class units alongside PR/issue/commit chunks.
-- Adds metadata column to Chunk for function name, line numbers, and language.
-- Adds HNSW index on ChunkEmbedding.embedding for approximate nearest-neighbour search.
--
-- ALL changes are additive. No existing rows are modified.

-- ALTER TYPE ... ADD VALUE is not transactional in PostgreSQL.
-- Prisma wraps migrations in BEGIN/COMMIT but the ADD VALUE is effective immediately.
ALTER TYPE "ChunkSourceKind" ADD VALUE IF NOT EXISTS 'CODE_FILE';

-- metadata stores { functionName, startLine, endLine, language } for CODE_FILE chunks.
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- HNSW index for approximate nearest-neighbour cosine similarity on 1536-dim vectors.
-- m=16 ef_construction=64 are pgvector defaults — appropriate for up to ~1M vectors.
-- NOTE: Cannot use CONCURRENTLY inside a Prisma-managed transaction; safe on empty table.
CREATE INDEX IF NOT EXISTS "ChunkEmbedding_embedding_hnsw_idx"
  ON "ChunkEmbedding" USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
