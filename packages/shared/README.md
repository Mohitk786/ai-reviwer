# @repo/shared

Cross-cutting utilities and contracts. **Zero runtime dependencies** beyond `zod`.

## Why this constraint

Both `apps/web` (Next.js, runs in browser + Node) and `apps/worker` (pure Node)
import this package. Keeping the dependency surface tiny means no accidental
node-only modules leak into the browser bundle, and no React leaks into the worker.

## Modules

- `env.ts` — `parseEnv()` returns a typed, validated env object. Throws with named
  fields on missing/invalid values. Called once at boot in both apps.
- `errors.ts` — `AppError`, `EntitlementError`, `RateLimitError`, etc. Thrown by services,
  caught at the transport layer (tRPC error formatter / SSE error frames).
- `schemas/` — Zod schemas for cross-process payloads (job inputs, query results).
  These are the **single source of truth** for shapes that cross a boundary.

## Pattern

```ts
import { parseEnv } from '@repo/shared/env';
const env = parseEnv(process.env); // throws if invalid
```
