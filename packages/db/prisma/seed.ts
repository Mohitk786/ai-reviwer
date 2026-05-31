/**
 * Database seed — idempotent. Safe to run on every boot.
 *
 * Seeds:
 *   - Canonical Plans (free, pro, team) so EntitlementService has something to read.
 *   - Initial FeatureFlags (all `enabled=false` — we ship dark by default).
 *
 * Run via: `npm run db:seed` (root) or `npm --workspace @repo/db run seed`.
 *
 * In production, the Docker entrypoint runs this AFTER `prisma migrate deploy`, so a
 * fresh deployment ends up with consistent baseline data.
 */

import { PrismaClient } from '../src/generated/client/index';

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// Plans — keep the slug stable; SubscriptionService looks them up by slug.
// -----------------------------------------------------------------------------

const PLANS = [
  {
    slug: 'free',
    name: 'Free',
    maxRepositories: 1,
    maxQueriesPerMonth: 100,
    maxIngestionTokens: BigInt(1_000_000),
    maxEmbeddingTokens: BigInt(5_000_000),
    priceMonthlyCents: 0,
  },
  {
    slug: 'pro',
    name: 'Pro',
    maxRepositories: 10,
    maxQueriesPerMonth: 5_000,
    maxIngestionTokens: BigInt(50_000_000),
    maxEmbeddingTokens: BigInt(100_000_000),
    priceMonthlyCents: 4900,
  },
  {
    slug: 'team',
    name: 'Team',
    maxRepositories: 50,
    maxQueriesPerMonth: 25_000,
    maxIngestionTokens: BigInt(500_000_000),
    maxEmbeddingTokens: BigInt(1_000_000_000),
    priceMonthlyCents: 19900,
  },
];

// -----------------------------------------------------------------------------
// Feature flags — keep keys stable; @repo/flags references them by string.
// All default to `enabled: false`. Flip via `UPDATE feature_flags ...` when ready.
// -----------------------------------------------------------------------------

const FLAGS = [
  {
    key: 'billing.enforcement',
    enabled: false,
    description:
      'Master switch for entitlement enforcement (rate limits + paywalls). Subscription tracking is always on; this gates blocking behavior.',
  },
  {
    key: 'ingestion.parallel',
    enabled: false,
    description:
      'Run multiple PR hydrate jobs in parallel per installation. Risk: GitHub rate-limit blowout.',
  },
  {
    key: 'retrieval.rerank',
    enabled: false,
    description: 'Enable cross-encoder rerank step (Phase 2 — requires Cohere/Voyage key).',
  },
  {
    key: 'ui.similar_incidents',
    enabled: false,
    description:
      'On a new issue webhook, post a comment listing 3 similar resolved issues. (Phase 2)',
  },
];

async function main(): Promise<void> {
  console.log('seeding plans...');
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      // Update non-key fields if the seed has changed.
      update: {
        name: plan.name,
        maxRepositories: plan.maxRepositories,
        maxQueriesPerMonth: plan.maxQueriesPerMonth,
        maxIngestionTokens: plan.maxIngestionTokens,
        maxEmbeddingTokens: plan.maxEmbeddingTokens,
        priceMonthlyCents: plan.priceMonthlyCents,
        active: true,
      },
      create: plan,
    });
  }

  console.log('seeding feature flags...');
  for (const flag of FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      // IMPORTANT: don't overwrite `enabled` on re-runs — operators may have toggled
      // flags in production. Only update description (safe).
      update: { description: flag.description },
      create: flag,
    });
  }

  console.log('seed complete.');
}

main()
  .catch((err) => {
    console.error('seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


