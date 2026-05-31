/**
 * FeatureFlagService — DB-backed flags with a 5-minute in-process cache.
 *
 * SLA: flipping a flag in the DB takes effect across all replicas within 5 minutes.
 * No redeploy. No push invalidation. No Redis.
 *
 * Implementation notes:
 *   - Each replica caches independently. A flag flip is observed within `CACHE_TTL_MS`
 *     of the change as cache entries naturally expire. Multiple replicas drift in lockstep
 *     up to TTL — that staleness IS the SLA.
 *   - `installationId` overrides take precedence over rollout percentage, which takes
 *     precedence over the global `enabled` boolean. See `evaluate()` for the order.
 *   - Keys are listed in `FlagKeys` for type safety and grep-ability.
 */

import type { PrismaClient } from '@repo/db';
import { createHash } from 'node:crypto';

/** The full list of flags the app knows about. Add new keys here AND in seed.ts. */
export const FlagKeys = {
  /** Master switch for entitlement enforcement (rate limits + paywalls). */
  BillingEnforcement: 'billing.enforcement',
  /** Run multiple PR hydrate jobs in parallel per installation. */
  IngestionParallel: 'ingestion.parallel',
  /** Enable cross-encoder rerank step in retrieval. */
  RetrievalRerank: 'retrieval.rerank',
  /** On a new issue webhook, post a "similar incidents" comment. */
  UISimilarIncidents: 'ui.similar_incidents',
} as const;

export type FlagKey = (typeof FlagKeys)[keyof typeof FlagKeys];

/** Cache TTL — set to 5 minutes per the product SLA. */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedDecision {
  value: boolean;
  expiresAt: number;
}

/** Optional per-call context — currently only `installationId`. */
export interface FlagContext {
  installationId?: string;
}

export class FeatureFlagService {
  /**
   * Cache keyed by `${flagKey}:${installationId|*}`.
   * Per-replica, per-process — no cross-replica coordination.
   */
  private readonly cache = new Map<string, CachedDecision>();

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Returns true if the flag is enabled for the given context.
   *
   * Performance: warm cache = 1 Map.get. Cold cache = 1 SELECT on `feature_flags`.
   * No DB load shedding needed — this is fast even at peak traffic.
   *
   * Safety: a missing flag (unknown key) returns false. Better default than guessing.
   */
  async isEnabled(key: FlagKey, ctx: FlagContext = {}): Promise<boolean> {
    const cacheKey = `${key}:${ctx.installationId ?? '*'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Cache miss → DB read.
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    const value = flag ? this.evaluate(flag, ctx) : false;

    this.cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /**
   * Forces a re-read on next `isEnabled` call. Useful from admin endpoints that
   * just toggled a flag and want immediate consistency on the same replica.
   * Other replicas still observe up-to-TTL staleness.
   */
  invalidate(key?: FlagKey): void {
    if (!key) {
      this.cache.clear();
      return;
    }
    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.startsWith(`${key}:`)) {
        this.cache.delete(cacheKey);
      }
    }
  }

  /**
   * Decision logic — the order matters and is documented at class level:
   *   1. Per-installation override (if present).
   *   2. Rollout percentage (deterministic hash of installationId).
   *   3. Global `enabled` boolean (the default).
   */
  private evaluate(
    flag: { enabled: boolean; rolloutPercent: number | null; overrides: unknown },
    ctx: FlagContext,
  ): boolean {
    // 1. Per-installation override — explicit beats rollout.
    if (ctx.installationId && flag.overrides && typeof flag.overrides === 'object') {
      const overrides = flag.overrides as Record<string, boolean>;
      if (ctx.installationId in overrides) {
        return Boolean(overrides[ctx.installationId]);
      }
    }

    // 2. Rollout percentage — deterministic per installation so the same install
    //    always lands in or out of the rollout (no flapping).
    if (flag.rolloutPercent != null && ctx.installationId) {
      return percentBucket(ctx.installationId) < flag.rolloutPercent;
    }

    // 3. Global default.
    return flag.enabled;
  }
}

/**
 * Returns an integer 0-99 deterministically derived from `id`.
 * SHA-256 → first 4 bytes → modulo 100. Cheap and deterministic.
 */
function percentBucket(id: string): number {
  const hash = createHash('sha256').update(id).digest();
  // First 4 bytes as unsigned 32-bit integer.
  const n = hash.readUInt32BE(0);
  return n % 100;
}
