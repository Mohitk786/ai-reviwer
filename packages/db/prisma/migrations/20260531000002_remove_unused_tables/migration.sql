-- Remove unused tables that have no code paths touching them yet.
-- Drop order: child tables (FKs) first, then parents, then orphaned enums.

DROP TABLE IF EXISTS "ReviewComment";
DROP TABLE IF EXISTS "IssueComment";
DROP TABLE IF EXISTS "PullRequestReview";
DROP TABLE IF EXISTS "Issue";
DROP TABLE IF EXISTS "Commit";
DROP TABLE IF EXISTS "Reference";
DROP TABLE IF EXISTS "IngestionJob";
DROP TABLE IF EXISTS "Query";
DROP TABLE IF EXISTS "UsageMeter";

DROP TYPE IF EXISTS "ReviewState";
DROP TYPE IF EXISTS "IssueState";
DROP TYPE IF EXISTS "ArtifactKind";
DROP TYPE IF EXISTS "ReferenceRelation";
DROP TYPE IF EXISTS "IngestionJobKind";
DROP TYPE IF EXISTS "IngestionJobState";
DROP TYPE IF EXISTS "UsageMeterKind";
