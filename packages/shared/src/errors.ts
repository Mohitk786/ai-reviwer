/**
 * Typed application errors.
 *
 * These are thrown by services and caught at the transport layer (tRPC error
 * formatter, SSE error frames, worker DLQ). The transport maps each class to a
 * user-facing message + HTTP status / log severity.
 *
 * Rules:
 *   - All errors carry a `code` so logs can be grouped by failure mode.
 *   - The `cause` chain is preserved (Node 16.9+ Error options).
 *   - NEVER instantiate `new Error()` for a domain failure — use one of these.
 */

/** Base class. All app-thrown errors extend this. */
export class AppError extends Error {
  /** Stable identifier for this error variant (logged + sent to client). */
  public readonly code: string;
  /** Whether the underlying cause is the user's fault (4xx) vs ours (5xx). */
  public readonly userFacing: boolean;

  constructor(
    code: string,
    message: string,
    options?: { cause?: unknown; userFacing?: boolean },
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.code = code;
    this.userFacing = options?.userFacing ?? false;
  }
}

/** Caller is missing/invalid auth or trying to act on a resource they don't own. */
export class AuthError extends AppError {
  constructor(message = 'Authentication required', cause?: unknown) {
    super('AUTH_REQUIRED', message, { cause, userFacing: true });
  }
}

/** Caller is authenticated but the action is denied (entitlement / role). */
export class ForbiddenError extends AppError {
  constructor(message: string, cause?: unknown) {
    super('FORBIDDEN', message, { cause, userFacing: true });
  }
}

/** Subscription enforcement blocked the action. Reason indicates which check failed. */
export class EntitlementError extends AppError {
  public readonly reason: 'no_active_subscription' | 'plan_limit_exceeded' | 'feature_disabled';
  constructor(reason: EntitlementError['reason'], message: string) {
    super('ENTITLEMENT_DENIED', message, { userFacing: true });
    this.reason = reason;
  }
}

/** Validation failed (input shape, business rules). */
export class ValidationError extends AppError {
  /** Field-level details — keys are dotted JSON paths into the input. */
  public readonly fields: Record<string, string>;
  constructor(message: string, fields: Record<string, string> = {}) {
    super('VALIDATION_FAILED', message, { userFacing: true });
    this.fields = fields;
  }
}

/** Resource doesn't exist OR caller can't see it (intentionally indistinguishable). */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, { userFacing: true });
  }
}

/** External service refused us — rate limit, abuse, downtime. */
export class UpstreamError extends AppError {
  constructor(service: string, message: string, cause?: unknown) {
    super('UPSTREAM_FAILURE', `${service}: ${message}`, { cause, userFacing: false });
  }
}

/** Crypto / config / invariant violations — bug in our code, not user input. */
export class InternalError extends AppError {
  constructor(message: string, cause?: unknown) {
    super('INTERNAL_ERROR', message, { cause, userFacing: false });
  }
}

/**
 * Type guard. Avoids `instanceof` issues across module boundaries (which can
 * happen if AppError is bundled twice).
 */
export function isAppError(err: unknown): err is AppError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    err instanceof Error
  );
}
