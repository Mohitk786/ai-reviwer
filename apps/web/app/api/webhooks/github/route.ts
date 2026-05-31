/**
 * POST /api/webhooks/github
 *
 * Receives GitHub App webhook deliveries. This is the entry point for all
 * automated review triggers, installation events, and repository sync events.
 *
 * Flow:
 *   1. Enforce a 25 MB payload cap (advisory Content-Length + read-length check).
 *   2. Read the raw body AS TEXT — HMAC must verify the exact bytes GitHub signed.
 *      JSON parsing happens only AFTER verification.
 *   3. Verify X-Hub-Signature-256 with HMAC-SHA256 (timing-safe compare).
 *   4. Extract X-GitHub-Delivery (unique delivery id) and X-GitHub-Event.
 *   5. Upsert a WebhookDelivery row (deliveryId UNIQUE → re-deliveries are no-ops).
 *   6. If already processed (processedAt IS NOT NULL), return 200 immediately.
 *   7. Enqueue a `webhook.process` job and return 202.
 *
 * The route intentionally does NO business logic — that lives in
 * `@repo/ingestion/process-webhook.ts` and runs asynchronously in the worker.
 *
 * Security: rate-limit middleware is NOT applied here. GitHub's source IPs rotate
 * and a rate-limit rejection would cause GitHub to back off and re-deliver,
 * creating a feedback loop. Signature verification is the only authentication needed.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { type Prisma } from '@repo/db';
import { getEnv } from '@repo/shared';
import { verifyGithubSignature } from '@repo/github';
import { JobNames } from '@repo/jobs';
import { getLogger } from '@repo/observability';
import { getContainer } from '@/server/container';
import { withRouteContext } from '@/server/middleware/with-route-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = getLogger('webhooks.github');
/** GitHub payloads can reach ~25 MB on large push events. */
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

export const POST = withRouteContext(async (req: NextRequest) => {
  // 1. Advisory size guard via Content-Length (not all senders include this).
  const clHeader = req.headers.get('content-length');
  if (clHeader && parseInt(clHeader, 10) > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  }

  // 2. Read raw body as text — HMAC is computed on the exact bytes GitHub sent.
  //    JSON parsing MUST happen after signature verification.
  const rawBody = await req.text();
  if (rawBody.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  }

  // 3. HMAC-SHA256 signature verification (timing-safe).
  const env = getEnv();
  const signature = req.headers.get('x-hub-signature-256');
  if (!verifyGithubSignature(rawBody, signature, env.GITHUB_WEBHOOK_SECRET)) {
    log.warn({ hasSignature: !!signature }, 'webhook signature verification failed');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  // 4. Required GitHub delivery headers.
  const deliveryId = req.headers.get('x-github-delivery');
  const event = req.headers.get('x-github-event');
  if (!deliveryId || !event) {
    return NextResponse.json(
      { error: 'missing x-github-delivery or x-github-event header' },
      { status: 400 },
    );
  }

  // 5. Parse payload. Any JSON error returns 400 — GitHub should never send malformed JSON.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const action = typeof payload['action'] === 'string' ? payload['action'] : undefined;

  // 6. Upsert the delivery for dedupe + audit. On conflict (re-delivery), `update: {}`
  //    is a no-op that returns the already-stored row.
  const c = await getContainer();
  const delivery = await c.prisma.webhookDelivery.upsert({
    where: { deliveryId },
    create: {
      deliveryId,
      event,
      action,
      payload: payload as Prisma.InputJsonValue,
      receivedAt: new Date(),
    },
    update: {},
    select: { processedAt: true },
  });

  // 7. Already processed (GitHub re-delivery after a prior 202). Safe to ack again.
  if (delivery.processedAt) {
    log.debug({ deliveryId, event }, 'webhook re-delivery already processed');
    return NextResponse.json({ ok: true, status: 'already_processed' });
  }

  // 8. Enqueue async processing. The worker does all event routing and business logic.
  await c.boss.send(JobNames.WebhookProcess, { deliveryId });

  log.info({ deliveryId, event, action }, 'webhook accepted');
  return NextResponse.json({ ok: true }, { status: 202 });
});
