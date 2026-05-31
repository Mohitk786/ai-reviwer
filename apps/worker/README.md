# worker

Long-running Node process that drains the pg-boss queue.

## What it does

- Pulls background jobs from Postgres via [pg-boss](https://github.com/timgit/pg-boss).
- Runs ingestion (GitHub → DB), chunking, embedding.
- (Phase 1) Only the `hello` handler is wired as a smoke test.

## Why a separate process from the web app

- Edge / serverless runtimes can't host long-running jobs (initial backfill of a big repo
  takes hours).
- Different scaling axis — you want web replicas tied to user load, worker replicas tied
  to ingestion backlog.

## Local dev

```bash
# Boot Postgres (Docker)
npm run docker:up

# Run web + worker together (Turborepo runs both)
npm run dev

# Or just the worker
npm --workspace worker run dev
```

## Production

Same Docker image as the web app, different `CMD`. See top-level `Dockerfile`.

## Adding a new job

1. Add a job name + payload schema to `packages/jobs/src/types.ts`.
2. Register a handler here in `src/index.ts` via `defineHandler`.
3. Producers `boss.send(JobNames.X, payload)` — payload is type-checked.
