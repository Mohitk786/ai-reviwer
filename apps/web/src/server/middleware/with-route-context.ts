/**
 * `withRouteContext` — Next.js App Router handler wrapper.
 *
 * Wraps a route handler with three responsibilities:
 *   1. Request-id resolution (echo client header or mint a UUID).
 *   2. AsyncLocalStorage scope so downstream services can log with context.
 *   3. Last-resort error catch — converts unhandled errors into a safe JSON
 *      response via the central formatter, never leaks stack traces.
 *
 * Routes are still free to handle expected errors themselves and return their
 * own responses (e.g. the OAuth callback redirects on AppError). The wrapper's
 * catch only fires for *unhandled* throws — typically real bugs.
 *
 * Why this lives in apps/web (not in @repo/observability):
 *   - It returns a `NextResponse` and imports `next/server`. That's transport-
 *     specific glue. Keep `@repo/observability` framework-agnostic so it stays
 *     usable in the worker and in future tRPC procedures.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  getLogger,
  runWithContext,
  type RequestContext,
} from '@repo/observability';
import { mapErrorToResponse } from '@repo/shared/http';

const REQUEST_ID_HEADER = 'X-Request-Id';
const MAX_REQUEST_ID_LEN = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const log = getLogger('http');

/**
 * Trust an incoming `X-Request-Id` only when it looks safe (ASCII-ish, bounded
 * length). Otherwise mint a fresh UUID. Untrusted clients can still set the
 * header — we just refuse weird values to keep log fields tidy.
 */
function resolveRequestId(req: NextRequest): string {
  const incoming = req.headers.get(REQUEST_ID_HEADER);
  if (
    incoming &&
    incoming.length > 0 &&
    incoming.length <= MAX_REQUEST_ID_LEN &&
    REQUEST_ID_PATTERN.test(incoming)
  ) {
    return incoming;
  }
  return randomUUID();
}

/**
 * Generic shape of a Next.js App Router handler. The second argument carries
 * dynamic route params; we keep it as `unknown` because per-route shapes vary
 * and we never inspect it inside the wrapper.
 */
type RouteHandler = (
  req: NextRequest,
  routeCtx: { params: Promise<Record<string, string | string[]>> },
) => Promise<NextResponse> | NextResponse;

export function withRouteContext(handler: RouteHandler): RouteHandler {
  return async (req, routeCtx) => {
    const requestId = resolveRequestId(req);
    const ctx: RequestContext = {
      requestId,
      method: req.method,
      path: new URL(req.url).pathname,
    };
    const startedAt = performance.now();

    return runWithContext(ctx, async () => {
      const requestLog = log.child({
        requestId,
        method: ctx.method,
        path: ctx.path,
      });

      try {
        const response = await handler(req, routeCtx);
        const durationMs = Math.round(performance.now() - startedAt);
        response.headers.set(REQUEST_ID_HEADER, requestId);
        requestLog.info(
          { status: response.status, durationMs },
          'request complete',
        );
        return response;
      } catch (err) {
        const durationMs = Math.round(performance.now() - startedAt);
        const { status, body } = mapErrorToResponse(err, requestId);
        if (status >= 500) {
          requestLog.error({ err, status, durationMs }, 'request failed');
        } else {
          requestLog.warn({ err, status, durationMs }, 'request rejected');
        }
        const response = NextResponse.json(body, { status });
        response.headers.set(REQUEST_ID_HEADER, requestId);
        return response;
      }
    });
  };
}
