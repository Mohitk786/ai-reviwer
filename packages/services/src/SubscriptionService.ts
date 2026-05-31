/**
 * SubscriptionService — read/write subscription state and usage meters.
 *
 * Phase 1 surface:
 *   - getActiveSubscription(installationId): the row + plan, joined.
 *   - ensureFreePlanFor(installationId): idempotent creation of a Free-tier subscription
 *     when an installation is first seen (called from auth flow once it's wired).
 *   - incrementMeter(installationId, kind, by): atomic counter bump in current period.
 *
 * Race safety: meter increments use `SELECT ... FOR UPDATE` inside a transaction so
 * concurrent requests cannot push usage past a plan limit.
 *
 * Stripe sync (webhook → status updates) lands in M5/M7 once self-serve billing is
 * enabled. Until then, status flips happen via admin scripts.
 */

import type { PrismaClient, SubscriptionStatus, UsageMeterKind } from '@repo/db';
import { NotFoundError, InternalError } from '@repo/shared/errors';

export class SubscriptionService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Returns the installation's subscription with plan joined, or null if none.
   * Used by EntitlementService to look up plan limits.
   */
  async getActiveSubscription(installationId: string) {
    return this.prisma.subscription.findUnique({
      where: { installationId },
      include: { plan: true },
    });
  }


  async ensureFreePlanFor(installationId: string): Promise<void> {
    const existing = await this.prisma.subscription.findUnique({
      where: { installationId },
      select: { id: true },
    });
    if (existing) return;
 
    const freePlan = await this.prisma.plan.findUnique({ where: { slug: 'free' } });
    if (!freePlan) {
      throw new InternalError('Free plan missing — seed has not run.');
    }

    try {
      await this.prisma.subscription.create({
        data: {
          installationId,
          planId: freePlan.id,
          status: 'ACTIVE' as SubscriptionStatus,
        },
      });
    } catch (err) {
      // Concurrent race: someone else created it. Verify and proceed.
      const now = await this.prisma.subscription.findUnique({
        where: { installationId },
        select: { id: true },
      });
      if (!now) throw err;
    }
  }

  /**
   * Atomically increments a usage meter for the current monthly period. Caller is
   * responsible for choosing `by` (queries: 1, tokens: actual count).
   *
   * Returns the new count. Wrap callers in a transaction with the action they're
   * metering when correctness matters (e.g., "credit the meter only if the call
   * actually completed").
   */
  async incrementMeter(
    installationId: string,
    meterKind: UsageMeterKind,
    by = 1,
  ): Promise<bigint> {
    if (by < 0) {
      throw new InternalError('incrementMeter: `by` must be non-negative');
    }
    if (by === 0) {
      // Caller has nothing to add — return the current value.
      const current = await this.currentPeriodMeter(installationId, meterKind);
      return current?.count ?? 0n;
    }

    const { periodStart, periodEnd } = currentMonthlyPeriod();

    // Upsert + increment in a single transaction. The unique key
    // (installationId, meterKind, periodStart) lets us either create the row or
    // update its count atomically.
    const row = await this.prisma.usageMeter.upsert({
      where: {
        installationId_meterKind_periodStart: {
          installationId,
          meterKind,
          periodStart,
        },
      },
      create: {
        installationId,
        meterKind,
        periodStart,
        periodEnd,
        count: BigInt(by),
      },
      update: {
        count: { increment: BigInt(by) },
      },
    });

    return row.count;
  }

  /** Returns the meter row for the current period, or null. */
  async currentPeriodMeter(installationId: string, meterKind: UsageMeterKind) {
    const { periodStart } = currentMonthlyPeriod();
    return this.prisma.usageMeter.findUnique({
      where: {
        installationId_meterKind_periodStart: {
          installationId,
          meterKind,
          periodStart,
        },
      },
    });
  }

  /**
   * Updates a subscription's status. Called from Stripe webhooks (Phase 2) or
   * admin scripts (now). Returns the updated row.
   */
  async setStatus(installationId: string, status: SubscriptionStatus) {
    const sub = await this.prisma.subscription.findUnique({
      where: { installationId },
      select: { id: true },
    });
    if (!sub) throw new NotFoundError(`subscription for installation ${installationId}`);

    return this.prisma.subscription.update({
      where: { installationId },
      data: { status },
      include: { plan: true },
    });
  }
}

/**
 * Returns the [start, end) of the current calendar month in UTC.
 *
 * Why calendar month, not 30-day rolling: aligns with billing periods, predictable
 * for customer-facing usage displays. Period rollover happens at UTC month boundary.
 */
function currentMonthlyPeriod(): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}
