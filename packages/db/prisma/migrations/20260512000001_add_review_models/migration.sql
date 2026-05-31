-- Migration: add_review_models
--
-- Adds the AI code review data layer:
--   - ReviewConfiguration (per-install or per-repo settings)
--   - AiReview           (one review per PR commit, pinned to commitSha)
--   - AiReviewComment    (inline review comments)
--   - Enums: AiReviewStatus, AiReviewSeverity, ReviewMode, DiffSide
--   - UsageMeterKind: +REVIEW_TOKENS
--   - Plan: +maxPrsPerMonth, +maxFilesPerPr (nullable — no default required)
--
-- ALL changes are additive. No existing tables, columns, or rows are modified.
-- Safe to deploy with the previous application version still running.

-- -----------------------------------------------------------------------------
-- Enums (must be created before tables that reference them)
-- -----------------------------------------------------------------------------

-- NOTE: ALTER TYPE ... ADD VALUE is not transactional in PostgreSQL.
-- Prisma wraps migrations in BEGIN/COMMIT but excludes ADD VALUE from the
-- transaction. This is safe — Postgres guarantees the value is visible
-- immediately after ADD VALUE completes.
ALTER TYPE "UsageMeterKind" ADD VALUE IF NOT EXISTS 'REVIEW_TOKENS';

CREATE TYPE "ReviewMode" AS ENUM ('COMMENT', 'REQUEST_CHANGES');
CREATE TYPE "AiReviewStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');
CREATE TYPE "AiReviewSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');
CREATE TYPE "DiffSide" AS ENUM ('LEFT', 'RIGHT');

-- -----------------------------------------------------------------------------
-- Plan — add review-specific limit columns (nullable = unlimited)
-- -----------------------------------------------------------------------------

ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "maxPrsPerMonth" INTEGER;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "maxFilesPerPr" INTEGER;

-- -----------------------------------------------------------------------------
-- ReviewConfiguration
-- -----------------------------------------------------------------------------

CREATE TABLE "ReviewConfiguration" (
    "id"                TEXT             NOT NULL,
    "installationId"    TEXT             NOT NULL,
    "repositoryId"      TEXT,
    "enabled"           BOOLEAN          NOT NULL DEFAULT true,
    "reviewMode"        "ReviewMode"     NOT NULL DEFAULT 'COMMENT',
    "ignorePaths"       TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
    "ignoreAuthors"     TEXT[]           NOT NULL DEFAULT ARRAY[]::TEXT[],
    "severityThreshold" "AiReviewSeverity" NOT NULL DEFAULT 'WARNING',
    "maxFilesPerPr"     INTEGER          NOT NULL DEFAULT 20,
    "createdAt"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "ReviewConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReviewConfiguration_installationId_idx"
    ON "ReviewConfiguration"("installationId");

CREATE INDEX "ReviewConfiguration_repositoryId_idx"
    ON "ReviewConfiguration"("repositoryId");

ALTER TABLE "ReviewConfiguration"
    ADD CONSTRAINT "ReviewConfiguration_installationId_fkey"
    FOREIGN KEY ("installationId") REFERENCES "Installation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewConfiguration"
    ADD CONSTRAINT "ReviewConfiguration_repositoryId_fkey"
    FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
    DEFERRABLE INITIALLY DEFERRED;

-- -----------------------------------------------------------------------------
-- AiReview
-- -----------------------------------------------------------------------------

CREATE TABLE "AiReview" (
    "id"                TEXT             NOT NULL,
    "repositoryId"      TEXT             NOT NULL,
    "pullRequestId"     TEXT,
    "pullRequestNumber" INTEGER          NOT NULL,
    "commitSha"         TEXT             NOT NULL,
    "status"            "AiReviewStatus" NOT NULL DEFAULT 'PENDING',
    "summary"           TEXT,
    "githubReviewId"    BIGINT,
    "totalComments"     INTEGER          NOT NULL DEFAULT 0,
    "startedAt"         TIMESTAMP(3),
    "completedAt"       TIMESTAMP(3),
    "error"             TEXT,
    "createdAt"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "AiReview_pkey" PRIMARY KEY ("id")
);

-- Idempotency: one review per (repo, PR number, commit SHA).
CREATE UNIQUE INDEX "AiReview_repositoryId_pullRequestNumber_commitSha_key"
    ON "AiReview"("repositoryId", "pullRequestNumber", "commitSha");

CREATE INDEX "AiReview_repositoryId_status_idx"
    ON "AiReview"("repositoryId", "status");

CREATE INDEX "AiReview_pullRequestId_idx"
    ON "AiReview"("pullRequestId");

CREATE INDEX "AiReview_repositoryId_createdAt_idx"
    ON "AiReview"("repositoryId", "createdAt");

ALTER TABLE "AiReview"
    ADD CONSTRAINT "AiReview_repositoryId_fkey"
    FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiReview"
    ADD CONSTRAINT "AiReview_pullRequestId_fkey"
    FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- AiReviewComment
-- -----------------------------------------------------------------------------

CREATE TABLE "AiReviewComment" (
    "id"              TEXT               NOT NULL,
    "reviewId"        TEXT               NOT NULL,
    "filePath"        TEXT               NOT NULL,
    "line"            INTEGER            NOT NULL,
    "side"            "DiffSide"         NOT NULL DEFAULT 'RIGHT',
    "body"            TEXT               NOT NULL,
    "severity"        "AiReviewSeverity" NOT NULL,
    "suggestion"      TEXT,
    "githubCommentId" BIGINT,
    "dismissed"       BOOLEAN            NOT NULL DEFAULT false,
    "dismissedById"   TEXT,
    "dismissedAt"     TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReviewComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiReviewComment_reviewId_severity_idx"
    ON "AiReviewComment"("reviewId", "severity");

CREATE INDEX "AiReviewComment_reviewId_filePath_idx"
    ON "AiReviewComment"("reviewId", "filePath");

ALTER TABLE "AiReviewComment"
    ADD CONSTRAINT "AiReviewComment_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "AiReview"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
