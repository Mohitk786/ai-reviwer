
import type PgBoss from 'pg-boss';
import { jobSchemas, type JobName, type JobPayload, JobNames } from './types';
import { getBoss } from './boss';


export interface HandlerOptions {
  batchSize?: number;
  /** Override poll interval. Default ~2s. */
  pollingIntervalSeconds?: number;
}

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
        await entry.handler({ id: job.id, data: data as never });
      }
    });
  }
}


export { JobNames };
