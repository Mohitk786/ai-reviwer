# @repo/flags

DB-backed feature flags with a 5-minute in-process cache.

## SLA

Flip a flag in the DB → all replicas reflect the new value within 5 minutes. No redeploy,
no push invalidation, no Redis.

## Why DB + per-replica cache (not LaunchDarkly / Statsig)

- Self-contained: one less external dependency.
- One backup story: flag state is in the app DB.
- 5-min staleness is acceptable for the things we gate (billing enforcement, dev feature
  rollouts). For sub-second flag changes you'd need a different design.

## Public API

```ts
import { FeatureFlagService, FlagKeys } from '@repo/flags';

const flags = new FeatureFlagService(prisma);
const enforcing = await flags.isEnabled(FlagKeys.BillingEnforcement, { installationId });
```

## Decision logic (in this order)

1. Per-installation override (if `overrides[installationId]` is set).
2. Percentage rollout (deterministic hash of `installationId`).
3. Global `enabled` boolean.

## Adding a flag

Add the key to `FlagKeys` in `service.ts` and seed it via `packages/db/prisma/seed.ts`.
Default to `enabled: false`.
