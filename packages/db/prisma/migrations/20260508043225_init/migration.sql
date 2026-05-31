-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('USER', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "InstallationRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "IngestionState" AS ENUM ('NOT_STARTED', 'DISCOVERING', 'HYDRATING', 'CHUNKING', 'EMBEDDING', 'ACTIVE', 'FAILED', 'PAUSED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'PAUSED');

-- CreateEnum
CREATE TYPE "UsageMeterKind" AS ENUM ('QUERIES', 'INGESTION_TOKENS', 'EMBEDDING_TOKENS');

-- CreateEnum
CREATE TYPE "ProviderCredentialKind" AS ENUM ('LLM', 'EMBEDDING', 'RERANK');

-- CreateEnum
CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING');

-- CreateEnum
CREATE TYPE "IssueState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('PULL_REQUEST', 'ISSUE', 'COMMIT', 'REVIEW_COMMENT', 'ISSUE_COMMENT');

-- CreateEnum
CREATE TYPE "ReferenceRelation" AS ENUM ('CLOSES', 'MENTIONS', 'REVERTS', 'DUPLICATES', 'FIXES');

-- CreateEnum
CREATE TYPE "ChunkSourceKind" AS ENUM ('PR_HEADER', 'PR_REVIEW_THREAD', 'PR_DISCUSSION', 'ISSUE_HEADER', 'ISSUE_DISCUSSION', 'COMMIT');

-- CreateEnum
CREATE TYPE "IngestionJobKind" AS ENUM ('BACKFILL', 'INCREMENTAL', 'WEBHOOK', 'RECONCILE');

-- CreateEnum
CREATE TYPE "IngestionJobState" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubId" INTEGER NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "email" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "githubId" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallationUser" (
    "installationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "InstallationRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallationUser_pkey" PRIMARY KEY ("installationId","userId")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "githubId" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ingestionState" "IngestionState" NOT NULL DEFAULT 'NOT_STARTED',
    "ingestedThrough" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxRepositories" INTEGER,
    "maxQueriesPerMonth" INTEGER,
    "maxIngestionTokens" BIGINT,
    "maxEmbeddingTokens" BIGINT,
    "priceMonthlyCents" INTEGER,
    "stripePriceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMeter" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "meterKind" "UsageMeterKind" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "count" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMeter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercent" INTEGER,
    "overrides" JSONB,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "kind" "ProviderCredentialKind" NOT NULL,
    "providerKind" TEXT NOT NULL,
    "encryptedSecret" BYTEA NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "model" TEXT,
    "baseUrl" TEXT,
    "organizationId" TEXT,
    "metadata" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "githubNodeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "state" "PullRequestState" NOT NULL,
    "authorLogin" TEXT,
    "authorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "mergedAt" TIMESTAMP(3),
    "mergeCommitSha" TEXT,
    "baseRef" TEXT NOT NULL,
    "headRef" TEXT NOT NULL,
    "labels" TEXT[],
    "changedFiles" INTEGER NOT NULL DEFAULT 0,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "filesTouched" TEXT[],

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestReview" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "githubNodeId" TEXT NOT NULL,
    "authorLogin" TEXT,
    "state" "ReviewState" NOT NULL,
    "body" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequestReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewComment" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "reviewId" TEXT,
    "githubNodeId" TEXT NOT NULL,
    "inReplyToId" TEXT,
    "authorLogin" TEXT,
    "body" TEXT NOT NULL,
    "path" TEXT,
    "line" INTEGER,
    "diffHunk" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueComment" (
    "id" TEXT NOT NULL,
    "githubNodeId" TEXT NOT NULL,
    "pullRequestId" TEXT,
    "issueId" TEXT,
    "authorLogin" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "githubNodeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "state" "IssueState" NOT NULL,
    "authorLogin" TEXT,
    "labels" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedByPrId" TEXT,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commit" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorLogin" TEXT,
    "authorEmail" TEXT,
    "authoredAt" TIMESTAMP(3) NOT NULL,
    "pullRequestId" TEXT,
    "filesTouched" TEXT[],

    CONSTRAINT "Commit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reference" (
    "id" TEXT NOT NULL,
    "fromKind" "ArtifactKind" NOT NULL,
    "fromId" TEXT NOT NULL,
    "toKind" "ArtifactKind" NOT NULL,
    "toId" TEXT NOT NULL,
    "relation" "ReferenceRelation" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "sourceKind" "ChunkSourceKind" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "narrativeKey" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "authorLogin" TEXT,
    "artifactCreatedAt" TIMESTAMP(3) NOT NULL,
    "artifactUpdatedAt" TIMESTAMP(3) NOT NULL,
    "state" TEXT,
    "labels" TEXT[],
    "filesTouched" TEXT[],
    "searchVector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChunkEmbedding" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChunkEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "kind" "IngestionJobKind" NOT NULL,
    "state" "IngestionJobState" NOT NULL,
    "cursor" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "stats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Query" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "citations" JSONB,
    "retrievalDebug" JSONB,
    "feedback" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Query_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE INDEX "User_githubLogin_idx" ON "User"("githubLogin");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_githubId_key" ON "Installation"("githubId");

-- CreateIndex
CREATE INDEX "Installation_accountLogin_idx" ON "Installation"("accountLogin");

-- CreateIndex
CREATE INDEX "InstallationUser_userId_idx" ON "InstallationUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubId_key" ON "Repository"("githubId");

-- CreateIndex
CREATE INDEX "Repository_installationId_enabled_idx" ON "Repository"("installationId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_owner_name_key" ON "Repository"("owner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_installationId_key" ON "Subscription"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

-- CreateIndex
CREATE INDEX "UsageMeter_installationId_periodEnd_idx" ON "UsageMeter"("installationId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMeter_installationId_meterKind_periodStart_key" ON "UsageMeter"("installationId", "meterKind", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "FeatureFlag_key_idx" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "ProviderCredential_installationId_idx" ON "ProviderCredential"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCredential_installationId_kind_key" ON "ProviderCredential"("installationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_githubNodeId_key" ON "PullRequest"("githubNodeId");

-- CreateIndex
CREATE INDEX "PullRequest_repositoryId_state_updatedAt_idx" ON "PullRequest"("repositoryId", "state", "updatedAt");

-- CreateIndex
CREATE INDEX "PullRequest_repositoryId_mergedAt_idx" ON "PullRequest"("repositoryId", "mergedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repositoryId_number_key" ON "PullRequest"("repositoryId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequestReview_githubNodeId_key" ON "PullRequestReview"("githubNodeId");

-- CreateIndex
CREATE INDEX "PullRequestReview_pullRequestId_submittedAt_idx" ON "PullRequestReview"("pullRequestId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewComment_githubNodeId_key" ON "ReviewComment"("githubNodeId");

-- CreateIndex
CREATE INDEX "ReviewComment_pullRequestId_createdAt_idx" ON "ReviewComment"("pullRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewComment_reviewId_idx" ON "ReviewComment"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueComment_githubNodeId_key" ON "IssueComment"("githubNodeId");

-- CreateIndex
CREATE INDEX "IssueComment_pullRequestId_createdAt_idx" ON "IssueComment"("pullRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "IssueComment_issueId_createdAt_idx" ON "IssueComment"("issueId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_githubNodeId_key" ON "Issue"("githubNodeId");

-- CreateIndex
CREATE INDEX "Issue_repositoryId_state_updatedAt_idx" ON "Issue"("repositoryId", "state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_repositoryId_number_key" ON "Issue"("repositoryId", "number");

-- CreateIndex
CREATE INDEX "Commit_repositoryId_authoredAt_idx" ON "Commit"("repositoryId", "authoredAt");

-- CreateIndex
CREATE INDEX "Commit_pullRequestId_idx" ON "Commit"("pullRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Commit_repositoryId_sha_key" ON "Commit"("repositoryId", "sha");

-- CreateIndex
CREATE INDEX "Reference_fromKind_fromId_idx" ON "Reference"("fromKind", "fromId");

-- CreateIndex
CREATE INDEX "Reference_toKind_toId_idx" ON "Reference"("toKind", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "Reference_fromKind_fromId_toKind_toId_relation_key" ON "Reference"("fromKind", "fromId", "toKind", "toId", "relation");

-- CreateIndex
CREATE INDEX "Chunk_repositoryId_sourceKind_artifactCreatedAt_idx" ON "Chunk"("repositoryId", "sourceKind", "artifactCreatedAt");

-- CreateIndex
CREATE INDEX "Chunk_narrativeKey_idx" ON "Chunk"("narrativeKey");

-- CreateIndex
CREATE INDEX "Chunk_contentHash_idx" ON "Chunk"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ChunkEmbedding_chunkId_model_modelVersion_key" ON "ChunkEmbedding"("chunkId", "model", "modelVersion");

-- CreateIndex
CREATE INDEX "IngestionJob_repositoryId_state_idx" ON "IngestionJob"("repositoryId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_deliveryId_key" ON "WebhookDelivery"("deliveryId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_event_receivedAt_idx" ON "WebhookDelivery"("event", "receivedAt");

-- CreateIndex
CREATE INDEX "Query_userId_createdAt_idx" ON "Query"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Query_repositoryId_createdAt_idx" ON "Query"("repositoryId", "createdAt");

-- AddForeignKey
ALTER TABLE "InstallationUser" ADD CONSTRAINT "InstallationUser_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationUser" ADD CONSTRAINT "InstallationUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageMeter" ADD CONSTRAINT "UsageMeter_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestReview" ADD CONSTRAINT "PullRequestReview_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PullRequestReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commit" ADD CONSTRAINT "Commit_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commit" ADD CONSTRAINT "Commit_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkEmbedding" ADD CONSTRAINT "ChunkEmbedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Query" ADD CONSTRAINT "Query_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Query" ADD CONSTRAINT "Query_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
