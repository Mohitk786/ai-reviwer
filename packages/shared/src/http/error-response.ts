/**
 * Pure error → HTTP-response mapping.
 *
 * No logging, no I/O, no transport coupling — just `unknown -> { status, body }`.
 * Transport layers (Next.js route wrapper, future tRPC error formatter, SSE
 * frame writer) call this to produce a consistent client-facing error shape.
 *
 * Why pure: keeps `@repo/shared` free of runtime deps beyond Zod, makes the
 * mapping trivially unit-testable, and lets the caller decide how to log.
 *
 * Contract:
 *   - `AppError` subclasses → mapped to their canonical HTTP status + safe body.
 *   - Non-userFacing errors → message replaced with a generic string so internal
 *     details (paths, IDs, stack hints) never leak to the client.
 *   - Anything else (raw `Error`, primitives, undefined) → 500 + generic body.
 *
 * The body always carries `requestId` when one is provided so the client (or a
 * support engineer reading a screenshot) can correlate with server logs.
 */

import { isAppError, type AppError } from '../errors';

/**
 * Wire shape of every error response.
 *
 * `code` is a stable identifier — clients should branch on this, not on `message`.
 * `fields` is populated for `ValidationError`; keys are dotted JSON paths.
 */
export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
  requestId?: string;
}

export interface MappedError {
  status: number;
  body: ApiErrorBody;
}

/** Generic message used whenever the underlying error is not user-facing. */
const GENERIC_INTERNAL_MESSAGE = 'An internal error occurred. Please try again.';

/**
 * Stable mapping from `AppError.code` → HTTP status.
 *
 * Anything not in this map falls back to 400 (userFacing) or 500 (otherwise).
 */
const STATUS_BY_CODE: Record<string, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  ENTITLEMENT_DENIED: 402,
  UPSTREAM_FAILURE: 502,
  INTERNAL_ERROR: 500,
};

/**
 * Convert any thrown value into a safe HTTP response shape.
 *
 * Never throws. Never logs. Caller is responsible for logging with whatever
 * context is appropriate (requestId, route, userId).
 */
export function mapErrorToResponse(err: unknown, requestId?: string): MappedError {
  if (isAppError(err)) {
    const status = resolveStatus(err);
    const body: ApiErrorBody = {
      ok: false,
      error: {
        code: err.code,
        message: err.userFacing ? err.message : GENERIC_INTERNAL_MESSAGE,
      },
    };

    const fields = extractFields(err);
    if (fields) body.error.fields = fields;
    if (requestId) body.requestId = requestId;

    return { status, body };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: GENERIC_INTERNAL_MESSAGE,
      },
      ...(requestId ? { requestId } : {}),
    },
  };
}

function resolveStatus(err: AppError): number {
  const mapped = STATUS_BY_CODE[err.code];
  if (mapped !== undefined) return mapped;
  return err.userFacing ? 400 : 500;
}

/**
 * Pull `fields` off ValidationError without importing the class (avoids the
 * cross-bundle `instanceof` problem the rest of `@repo/shared/errors` already
 * works around with the `isAppError` duck-type guard).
 */
function extractFields(err: AppError): Record<string, string> | undefined {
  if (!('fields' in err)) return undefined;
  const value = (err as { fields: unknown }).fields;
  if (typeof value !== 'object' || value === null) return undefined;
  return value as Record<string, string>;
}
