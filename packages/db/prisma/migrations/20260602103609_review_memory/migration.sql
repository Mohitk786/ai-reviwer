-- CreateEnum
CREATE TYPE "ReviewMemoryOutcome" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReviewCategory" AS ENUM ('SECURITY', 'PERFORMANCE', 'STYLE', 'CORRECTNESS', 'ARCHITECTURE', 'TEST_COVERAGE');

-- CreateEnum
CREATE TYPE "KnowledgeKind" AS ENUM ('ARCHITECTURE', 'CONVENTION', 'FEATURE', 'CONSTRAINT', 'TERMINOLOGY');

-- CreateTable
CREATE TABLE "ReviewMemory" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "aiReviewCommentId" TEXT NOT NULL,
    "pullRequestNumber" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "diffChunk" TEXT NOT NULL,
    "commentBody" TEXT NOT NULL,
    "severity" "AiReviewSeverity" NOT NULL,
    "category" "ReviewCategory" NOT NULL DEFAULT 'CORRECTNESS',
    "outcome" "ReviewMemoryOutcome" NOT NULL DEFAULT 'PENDING',
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewMemoryEmbedding" (
    "id" TEXT NOT NULL,
    "reviewMemoryId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,

    CONSTRAINT "ReviewMemoryEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoKnowledge" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" "KnowledgeKind" NOT NULL,
    "sourcePrNumber" INTEGER,
    "sourceCommentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoKnowledgeEmbedding" (
    "id" TEXT NOT NULL,
    "repoKnowledgeId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,

    CONSTRAINT "RepoKnowledgeEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewConversation" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "aiReviewCommentId" TEXT NOT NULL,
    "developerLogin" TEXT NOT NULL,
    "developerCommentId" BIGINT NOT NULL,
    "developerQuestion" TEXT NOT NULL,
    "aiReply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewMemory_aiReviewCommentId_key" ON "ReviewMemory"("aiReviewCommentId");

-- CreateIndex
CREATE INDEX "ReviewMemory_repositoryId_outcome_idx" ON "ReviewMemory"("repositoryId", "outcome");

-- CreateIndex
CREATE INDEX "ReviewMemory_repositoryId_category_idx" ON "ReviewMemory"("repositoryId", "category");

-- CreateIndex
CREATE INDEX "ReviewMemory_repositoryId_createdAt_idx" ON "ReviewMemory"("repositoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewMemoryEmbedding_reviewMemoryId_key" ON "ReviewMemoryEmbedding"("reviewMemoryId");

-- CreateIndex
CREATE INDEX "RepoKnowledge_repositoryId_idx" ON "RepoKnowledge"("repositoryId");

-- CreateIndex
CREATE INDEX "RepoKnowledge_repositoryId_kind_idx" ON "RepoKnowledge"("repositoryId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "RepoKnowledgeEmbedding_repoKnowledgeId_key" ON "RepoKnowledgeEmbedding"("repoKnowledgeId");

-- CreateIndex
CREATE INDEX "ReviewConversation_repositoryId_idx" ON "ReviewConversation"("repositoryId");

-- CreateIndex
CREATE INDEX "ReviewConversation_aiReviewCommentId_idx" ON "ReviewConversation"("aiReviewCommentId");

-- CreateIndex
CREATE INDEX "AiReviewComment_githubCommentId_idx" ON "AiReviewComment"("githubCommentId");

-- AddForeignKey
ALTER TABLE "ReviewMemory" ADD CONSTRAINT "ReviewMemory_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMemory" ADD CONSTRAINT "ReviewMemory_aiReviewCommentId_fkey" FOREIGN KEY ("aiReviewCommentId") REFERENCES "AiReviewComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMemoryEmbedding" ADD CONSTRAINT "ReviewMemoryEmbedding_reviewMemoryId_fkey" FOREIGN KEY ("reviewMemoryId") REFERENCES "ReviewMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoKnowledge" ADD CONSTRAINT "RepoKnowledge_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoKnowledgeEmbedding" ADD CONSTRAINT "RepoKnowledgeEmbedding_repoKnowledgeId_fkey" FOREIGN KEY ("repoKnowledgeId") REFERENCES "RepoKnowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewConversation" ADD CONSTRAINT "ReviewConversation_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewConversation" ADD CONSTRAINT "ReviewConversation_aiReviewCommentId_fkey" FOREIGN KEY ("aiReviewCommentId") REFERENCES "AiReviewComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
