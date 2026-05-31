/**
 * Type-safe handler registration for pg-boss.
 *
 * Wraps `boss.work(name, handler)` so that:
 *   1. The handler signature is statically typed against the job's Zod schema.
 *   2. Inputs are runtime-validated via `schema.parse(...)` before the handler
 *      sees them. A misshapen payload fails immediately and goes to the DLQ
 *      with a clear validation error.
 *   3. Concurrency and team-size options are explicit per handler.
 *
 * Usage:
 *   ```ts
 *   import { defineHandler, registerHandlers, JobNames } from '@repo/jobs';
 *
 *   const handlers = [
 *     defineHandler(JobNames.Hello, { batchSize: 8 }, async ({ data }) => {
 *       log.info({ data }, 'hello!');
 *     }),
 *   ];
 *   await registerHandlers(handlers);
 *   ```
 */

import type PgBoss from 'pg-boss';
import { jobSchemas, type JobName, type JobPayload, JobNames } from './types';
import { getBoss } from './boss';

/**
 * pg-boss work options exposed in our wrapper.
 *
 * pg-boss v10 dropped `teamSize` — concurrency is controlled by `batchSize`
 * (max jobs pulled per poll cycle) and `pollingIntervalSeconds`.
 */
export interface HandlerOptions {
  /** Max jobs pulled per poll cycle (effectively per-handler concurrency). */
  batchSize?: number;
  /** Override poll interval. Default ~2s. */
  pollingIntervalSeconds?: number;
}

/**
 * Type-erased handler entry — what we actually store in the registry.
 *
 * Why erased: `RegisteredHandler<'hello'>` is NOT assignable to `RegisteredHandler<JobName>`
 * because the inner `handler` parameter is contravariant. We get type safety at the
 * `defineHandler` call site (where N is narrowed) and erase to a uniform shape for
 * registration.
 */
export interface RegisteredHandler {
  name: JobName;
  options: HandlerOptions;
  handler: (job: { id: string; data: unknown }) => Promise<void>;
}


export function defineHandler<N extends JobName>(
  name: N,
  options: HandlerOptions,
  handler: (job: { id: string; data: JobPayload<N> }) => Promise<void>,
): RegisteredHandler {
  return {
    name,
    options,
    handler: handler as RegisteredHandler['handler'],
  };
}

/**
 * Registers all handlers with pg-boss. Each handler's incoming payload is
 * validated against its schema before being passed in.
 *
 * Idempotent — pg-boss `work` calls replace prior registrations on the same name.
 */
export async function registerHandlers(
  handlers: ReadonlyArray<RegisteredHandler>,
): Promise<void> {
  const boss = getBoss();

  for (const entry of handlers) {
    const schema = jobSchemas[entry.name];
    // pg-boss v10: queues must be created before send() or work() will accept jobs.
    try {
      await boss.createQueue(entry.name);
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== '42P07') throw err;
    }

    // Build opts conditionally — pg-boss validates `pollingIntervalSeconds` even when
    // we pass `undefined` explicitly, so omit the key entirely if the caller didn't set it.
    const opts: PgBoss.WorkOptions = {
      batchSize: entry.options.batchSize ?? 1,
      ...(entry.options.pollingIntervalSeconds !== undefined && {
        pollingIntervalSeconds: entry.options.pollingIntervalSeconds,
      }),
    };

    await boss.work<unknown>(entry.name, opts, async (jobs) => {
      // pg-boss v10's WorkHandler always receives an array of jobs.
      for (const job of jobs) {
        const data = schema.parse(job.data);
        // The cast is sound because jobSchemas[name] returns a schema whose
        // inferred type matches JobPayload<name> by construction.
        await entry.handler({ id: job.id, data: data as never });
      }
    });
  }
}

// Re-export so callers can do `import { JobNames } from '@repo/jobs'`.
export { JobNames };
