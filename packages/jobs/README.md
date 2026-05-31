# @repo/jobs

Background-job infrastructure on top of [pg-boss](https://github.com/timgit/pg-boss),
which uses the same Postgres database as the app — no Redis, no separate queue host.

## Why pg-boss (instead of BullMQ / SQS)

- **Transactional enqueue**: `INSERT user; boss.send('welcome-email')` in one transaction.
- **One backup story**: app DB and queue DB are the same DB.
- **DLQ inspection is just SQL**: `SELECT * FROM pgboss.archive WHERE state='failed'`.
- Comfortably handles thousands of jobs/sec — far past where MVP needs to be.

## Public API

```ts
// 1. Producer side (e.g., from a tRPC handler)
import { getBoss, JobNames } from '@repo/jobs';
const boss = getBoss();
await boss.send(JobNames.IngestRepoDiscover, { repositoryId });

// 2. Consumer side (e.g., in apps/worker)
import { registerHandlers, defineHandler, JobNames } from '@repo/jobs';
const handlers = [
  defineHandler(JobNames.IngestRepoDiscover, async ({ data }) => {
    // data is fully typed via Zod schema
  }),
];
await registerHandlers(handlers);
```

## Job naming convention

`<domain>.<entity>.<action>` — e.g., `ingest.pr.hydrate`, `embed.batch`,
`webhook.process`, `chunk.create`. Defined as a const enum in `types.ts`.

## Concurrency

Per-job concurrency configured at handler registration time. See `packages/jobs/src/types.ts`
for the table.

## Per-installation serialization

For ingestion jobs that must respect GitHub's per-install rate limit, handlers use a
Postgres advisory lock keyed by `installationId`. Only one ingest job per installation
runs at a time, regardless of worker replica count.
