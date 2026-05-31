/**
 * Liveness/readiness probe for Docker / load balancers.
 *
 * Liveness:  the process is up and responding.
 * Readiness: DB is reachable.
 *
 * Returns 200 + `{ ok: true, db: 'ok' | 'fail' }` on liveness; readiness check
 * fails (503) when DB is unreachable. Container orchestrators should target the
 * readiness path before sending traffic.
 */

import { NextResponse } from 'next/server';
import { getPrismaClient } from '@repo/db';
import { getLogger } from '@repo/observability';
import { withRouteContext } from '@/server/middleware/with-route-context';

const log = getLogger('health');

// Always run on Node — pgvector + Prisma are not edge-compatible.
export const runtime = 'nodejs';
// Skip caching: this endpoint must reflect live state.
export const dynamic = 'force-dynamic';

export const GET = withRouteContext(async () => {
  let dbOk = false;
  try {
    const prisma = getPrismaClient();
    // Cheapest possible round-trip — proves connection without hitting any table.
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    log.warn({ err }, 'health: db unreachable');
  }

  return NextResponse.json(
    { ok: true, db: dbOk ? 'ok' : 'fail' },
    { status: dbOk ? 200 : 503 },
  );
});
