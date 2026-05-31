/**
 * EntitlementService — answers "can installation X perform action Y, costing Z units?"
 *
 * Two distinct modes, switched by the `billing.enforcement` feature flag:
 *
 *   Flag OFF (default in MVP):
 *     - All `check()` calls return `{ allowed: true, reason: 'flag_off_default_allowed' }`.
 *     - Meters are NOT incremented (callers shouldn't have to care about flag state).
 *     - This is the "ship dark" mode — subscription tracking exists but doesn't bite.
 *
 *   Flag ON:
 *     - Active subscription required.
 *     - Plan limit checked against current period meter.
 *     - On allow, meter is incremented atomically.
 *     - Plan-limit-exceeded returns `{ allowed: false, reason: 'plan_limit_exceeded' }`.
 *
 * Flipping the flag in the DB takes effect within 5 minutes (FlagService cache TTL).
 */

import type { PrismaClient, UsageMeterKind } from '@repo/db';
import type { FeatureFlagService } from '@repo/flags';
import { FlagKeys } from '@repo/flags';
import {
  type EntitlementAction,
  type EntitlementResult,
} from '@repo/shared/schemas';
import type { SubscriptionService } from './SubscriptionService';

/** Mapping from public action → which limit + meter to check. */
const ACTION_TO_METER: Record<
  EntitlementAction,
  { meter: UsageMeterKind; limitField: 'maxQueriesPerMonth' | 'maxIngestionTokens' | 'maxEmbeddingTokens' | null }
> = {
  query: { meter: 'QUERIES', limitField: 'maxQueriesPerMonth' },
  ingest_tokens: { meter: 'INGESTION_TOKENS', limitField: 'maxIngestionTokens' },
  embed_tokens: { meter: 'EMBEDDING_TOKENS', limitField: 'maxEmbeddingTokens' },
  // `enable_repo` is checked against `maxRepositories` separately; not metered.
  enable_repo: { meter: 'QUERIES' /* unused */, limitField: null },
};

export interface CheckInput {
  installationId: string;
  action: EntitlementAction;
  /** Units this action will consume. Default 1 (e.g., one query). For tokens, pass count. */
  cost?: number;
}

export class EntitlementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly flags: FeatureFlagService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /**
   * Main entry point. Returns whether the action is allowed and (when relevant) how
   * many units remain in the current period.
   *
   * IMPORTANT: when `allowed: true` and the flag is ON, the meter is incremented
   * inside this call. Callers MUST proceed with the action; if they decide to skip
   * it for any reason, they have to refund manually or accept the over-credit.
   * (Real-world apps usually credit on completion instead — that's a Phase 2 evolution
   * once we have multi-step actions worth refunding.)
   */
  async check(input: CheckInput): Promise<EntitlementResult> {
    const { installationId, action } = input;
    const cost = input.cost ?? 1;

    // Flag off → free-for-all path.
    const enforcing = await this.flags.isEnabled(FlagKeys.BillingEnforcement, {
      installationId,
    });
    if (!enforcing) {
      return { allowed: true, reason: 'flag_off_default_allowed' };
    }

    // Flag on → real check.
    const sub = await this.subscriptions.getActiveSubscription(installationId);
    if (!sub) {
      return { allowed: false, reason: 'no_active_subscription' };
    }
    if (sub.status !== 'ACTIVE' && sub.status !== 'TRIALING') {
      return { allowed: false, reason: 'no_active_subscription' };
    }

    // Special case: enable_repo checks repo count, not a meter.
    if (action === 'enable_repo') {
      return this.checkRepoLimit(installationId, sub.plan.maxRepositories);
    }

    // Token / query meters.
    const mapping = ACTION_TO_METER[action];
    if (!mapping.limitField) {
      // Defensive — should never happen.
      return { allowed: false, reason: 'feature_disabled' };
    }
    const limit = sub.plan[mapping.limitField];
    if (limit == null) {
      // Plan has no limit for this action — unlimited tier.
      await this.subscriptions.incrementMeter(installationId, mapping.meter, cost);
      return { allowed: true, reason: 'within_limits' };
    }

    // Compare current usage + cost against limit.
    const meter = await this.subscriptions.currentPeriodMeter(installationId, mapping.meter);
    const used = meter?.count ?? 0n;
    const limitBig = typeof limit === 'bigint' ? limit : BigInt(limit);
    const willBe = used + BigInt(cost);

    if (willBe > limitBig) {
      const remaining = limitBig - used;
      return {
        allowed: false,
        reason: 'plan_limit_exceeded',
        remaining: remaining > 0n ? Number(remaining) : 0,
      };
    }

    // Within limits — increment and return success.
    await this.subscriptions.incrementMeter(installationId, mapping.meter, cost);
    const remaining = limitBig - willBe;
    return {
      allowed: true,
      reason: 'within_limits',
      remaining: Number(remaining),
    };
  }

  /**
   * Repo-count check. Different shape from meter checks because we count rows, not
   * accumulated usage. Compares current `Repository` count against plan's `maxRepositories`.
   */
  private async checkRepoLimit(
    installationId: string,
    limit: number | null,
  ): Promise<EntitlementResult> {
    if (limit == null) {
      return { allowed: true, reason: 'within_limits' };
    }
    const enabled = await this.prisma.repository.count({
      where: { installationId, enabled: true },
    });
    if (enabled >= limit) {
      return {
        allowed: false,
        reason: 'plan_limit_exceeded',
        remaining: 0,
      };
    }
    return {
      allowed: true,
      reason: 'within_limits',
      remaining: limit - enabled,
    };
  }
}
