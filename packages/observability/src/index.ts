/**
 * @repo/observability — Structured logging + request-scoped context + span helper.
 *
 * Public surface:
 *   - getLogger(name?): the singleton pino logger (with secret redactions baked in).
 *   - withSpan(name, fn): wraps an async function with timing + correlation id logging.
 *   - runWithContext / getRequestContext / getRequestId / setUserContext: AsyncLocalStorage
 *     for request-scoped fields (requestId, userId, installationId, method, path).
 *
 * No OpenTelemetry, no Sentry yet — pino + structured fields is enough for MVP.
 * When real tracing is added, swap the logger transport / withSpan internals; the
 * call sites stay identical.
 */

export { getLogger, type Logger } from './logger';
export { withSpan } from './span';
export {
  runWithContext,
  getRequestContext,
  getRequestId,
  setUserContext,
  type RequestContext,
} from './request-context';
