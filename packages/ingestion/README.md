# @repo/ingestion

Owns the GitHub → DB pipeline.

## Five phases

```
discover    → Paginate the repo's PR/issue/commit indexes (newest-first). Persist cursor.
hydrate     → Per artifact, fetch full nested data via GraphQL.
normalize   → Upsert into Prisma (idempotent on githubNodeId).
chunk       → Run @repo/chunking on freshly-normalized rows.
embed       → Batch-embed pending chunks via @repo/embeddings.
```

Each phase is its own pg-boss job kind. Retries, backoff, and DLQ work per phase.

## Why newest-first

A user enabling `linux/linux` would wait 12+ hours for a chronological backfill. With
newest-first, useful data lands within minutes. Display ingestion freshness in the UI.

## Phase 1 status

Scaffolding only. Real ingestion code lands in M2 (PRs), M3 (Issues + Commits), M4 (chunk + embed).

## Boundary rules

- This package writes via `@repo/db`. Other packages should NOT directly write GitHub data.
- Reads from GitHub flow through `@repo/github` only — no direct Octokit imports.
- Webhook reception happens in `apps/web`; webhook **processing** happens here.
