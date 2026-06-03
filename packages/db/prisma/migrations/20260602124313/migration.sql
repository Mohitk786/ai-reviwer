/*
  Warnings:

  - The values [ISSUE_HEADER,ISSUE_DISCUSSION] on the enum `ChunkSourceKind` will be removed. If these variants are still used in the database, this will fail.
  - The values [RERANK] on the enum `ProviderCredentialKind` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `contentHash` on the `Chunk` table. All the data in the column will be lost.
  - You are about to drop the column `githubNodeId` on the `PullRequest` table. All the data in the column will be lost.
  - You are about to drop the column `ingestedThrough` on the `Repository` table. All the data in the column will be lost.
  - Added the required column `embedding` to the `RepoKnowledgeEmbedding` table without a default value. This is not possible if the table is not empty.
  - Added the required column `embedding` to the `ReviewMemoryEmbedding` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ChunkSourceKind_new" AS ENUM ('PR_HEADER', 'PR_REVIEW_THREAD', 'PR_DISCUSSION', 'COMMIT', 'CODE_FILE');
ALTER TABLE "Chunk" ALTER COLUMN "sourceKind" TYPE "ChunkSourceKind_new" USING ("sourceKind"::text::"ChunkSourceKind_new");
ALTER TYPE "ChunkSourceKind" RENAME TO "ChunkSourceKind_old";
ALTER TYPE "ChunkSourceKind_new" RENAME TO "ChunkSourceKind";
DROP TYPE "public"."ChunkSourceKind_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ProviderCredentialKind_new" AS ENUM ('LLM', 'EMBEDDING');
ALTER TABLE "ProviderCredential" ALTER COLUMN "kind" TYPE "ProviderCredentialKind_new" USING ("kind"::text::"ProviderCredentialKind_new");
ALTER TYPE "ProviderCredentialKind" RENAME TO "ProviderCredentialKind_old";
ALTER TYPE "ProviderCredentialKind_new" RENAME TO "ProviderCredentialKind";
DROP TYPE "public"."ProviderCredentialKind_old";
COMMIT;

-- DropIndex
DROP INDEX "Chunk_contentHash_idx";

-- DropIndex
DROP INDEX "PullRequest_githubNodeId_key";

-- AlterTable
ALTER TABLE "Chunk" DROP COLUMN "contentHash";

-- AlterTable
ALTER TABLE "PullRequest" DROP COLUMN "githubNodeId";

-- AlterTable
ALTER TABLE "RepoKnowledgeEmbedding" ADD COLUMN     "embedding" vector(1536) NOT NULL;

-- AlterTable
ALTER TABLE "Repository" DROP COLUMN "ingestedThrough";

-- AlterTable
ALTER TABLE "ReviewMemoryEmbedding" ADD COLUMN     "embedding" vector(1536) NOT NULL;
