# @repo/db

Owns the Prisma schema, migrations, generated client, and the singleton client accessor.

## Why a dedicated package

A single Prisma client per process (one connection pool) is a hard requirement for Postgres
performance. Centralizing the client here prevents accidental `new PrismaClient()` calls from
proliferating connection pools across the codebase.

## Public API

```ts
import { getPrismaClient } from '@repo/db';
const prisma = getPrismaClient();
```

The function returns the same instance on every call within a process. In dev (Next.js HMR),
the instance is cached on `globalThis` to survive module reloads.

## Schema location

`prisma/schema.prisma` — single source of truth for all DB models.

## Common workflows

```bash
# After editing schema.prisma, generate the client and apply a dev migration:
npm run db:migrate -- --name <change_name>

# Just regenerate the client (e.g., after pulling someone else's migration):
npm run db:generate

# Open Prisma Studio for ad-hoc inspection:
npm run db:studio

# Seed the DB with canonical Plans + FeatureFlags:
npm run db:seed
```

## Migrations on boot (production)

The Docker entrypoint runs `prisma migrate deploy` before starting either web or worker.
Concurrent boots are safe — Prisma uses an advisory lock for migrations.

## Rules

- Never bypass Prisma with raw SQL unless absolutely necessary, and document the reason
  in a comment when you do.
- Do not import this package in `packages/chunking` (chunking is pure functions, no DB).
- Foreign-key cascades are intentional — see the `onDelete` annotations in `schema.prisma`.
