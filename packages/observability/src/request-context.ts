/**
 * Request-scoped context propagation via Node `AsyncLocalStorage`.
 *
 * Why ALS: services and repositories should be able to log with the current
 * `requestId` (and optionally `userId` / `installationId`) WITHOUT us threading
 * a context object through every function signature. ALS preserves the value
 * across `await` boundaries automatically.
 *
 * Usage:
 *   ```ts
 *   // In transport layer (route wrapper, job runner):
 *   import { runWithContext } from '@repo/observability';
 *   await runWithContext({ requestId, method, path }, async () => {
 *     await handler(req);
 *   });
 *
 *   // Anywhere downstream:
 *   import { getRequestId } from '@repo/observability';
 *   log.info({ requestId: getRequestId() }, 'doing work');
 *   ```
 *
 * Notes:
 *   - ALS adds ~5% overhead in Node — acceptable for this use case.
 *   - ALS does NOT propagate across `worker_threads` or `setImmediate` in some
 *     edge cases. All HTTP handlers and pg-boss jobs use plain async/await, so
 *     this is fine.
 *   - `setUserContext` mutates the active store in place. This is intentional:
 *     it lets a route learn the userId mid-handler (after auth resolves) and
 *     have downstream logs pick it up without re-entering `runWithContext`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Fields associated with a single inbound request (or job invocation). */
export interface RequestContext {
  /** Stable identifier for this request. Echoed in response header + logs. */
  requestId: string;
  /** HTTP method (GET, POST, etc.). Optional for non-HTTP entry points. */
  method?: string;
  /** Request path (no query string). */
  path?: string;
  /** Resolved client IP, when the transport can determine it safely. */
  ip?: string;
  /** Internal DB user id (cuid). Set by auth middleware after session resolves. */
  userId?: string;
  /** Internal DB installation id (cuid). Set when request is scoped to one tenant. */
  installationId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` inside a fresh request context. All async calls inside see the same store. */
export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** Returns the active context, or undefined if called outside `runWithContext`. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Convenience: returns just the requestId (or undefined). */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Mutates the active context in place. Intended for late-binding fields like
 * `userId` that aren't known when the request first enters the wrapper.
 *
 * No-op when called outside an active context.
 */
export function setUserContext(updates: Pick<RequestContext, 'userId' | 'installationId'>): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  if (updates.userId !== undefined) ctx.userId = updates.userId;
  if (updates.installationId !== undefined) ctx.installationId = updates.installationId;
}
