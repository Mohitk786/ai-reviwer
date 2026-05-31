/**
 * Tiny span helper — wraps an async operation with timing + correlation id logging.
 *
 * Not a real OpenTelemetry span — for MVP, structured logs are enough. When real
 * tracing is added later, this implementation changes; call sites stay identical.
 *
 * Usage:
 *   ```ts
 *   const result = await withSpan('embed.batch', async (span) => {
 *     span.set('chunkCount', chunks.length);
 *     return await provider.embed(chunks);
 *   });
 *   ```
 */

import { randomUUID } from 'node:crypto';
import { getLogger } from './logger';

export interface Span {
  /** Add a structured field that will be logged when the span ends. */
  set(key: string, value: unknown): void;
}

class SpanImpl implements Span {
  public readonly fields: Record<string, unknown> = {};
  set(key: string, value: unknown): void {
    this.fields[key] = value;
  }
}

/**
 * Run `fn` inside a span. Logs `{ name, durationMs, ok, ...spanFields }` on completion.
 * On thrown errors, logs at error level and re-throws (caller decides retry/fallback).
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const log = getLogger('span');
  const span = new SpanImpl();
  const correlationId = randomUUID();
  const startedAt = performance.now();

  try {
    const result = await fn(span);
    const durationMs = Math.round(performance.now() - startedAt);
    log.info({ name, correlationId, durationMs, ok: true, ...span.fields }, `span ${name} ok`);
    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - startedAt);
    log.error(
      { name, correlationId, durationMs, ok: false, err, ...span.fields },
      `span ${name} failed`,
    );
    throw err;
  }
}
