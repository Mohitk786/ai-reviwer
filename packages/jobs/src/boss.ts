/**
 * pg-boss singleton — same Postgres as the app DB.
 *
 * Why same DB: transactional enqueue (`INSERT user; boss.send(...)` in one tx),
 * one backup story, no Redis dependency.
 *
 * pg-boss creates a `pgboss` schema on first start. The first call to `start()`
 * runs its own migrations idempotently (advisory-lock guarded — concurrent boots
 * are safe).
 */

import PgBoss from 'pg-boss';

let bossInstance: PgBoss | null = null;
let started = false;

interface BossOptions {
  connectionString: string;
  /** Logger to use for pg-boss internal events; defaults to no-op. */
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

/**
 * Returns the singleton instance. Does NOT connect — call `startBoss()` once
 * from the worker entry to actually open the queue (which runs schema migrations).
 *
 * Producers (e.g., the web app sending jobs) can call `getBoss()` and then
 * `boss.send(...)` once `startBoss` has been invoked SOMEWHERE in the process —
 * typically the worker. The web app, if it just enqueues, can call its own
 * `startBoss` to get the migration done at boot.
 */
export function getBoss(connectionString?: string): PgBoss {
  if (!bossInstance) {
    if (!connectionString) {
      throw new Error('getBoss: connectionString required on first call');
    }
    bossInstance = new PgBoss({
      connectionString,
      // Job retention. Default = 30d; we go lower to keep table tidy.
      retentionDays: 14,
      // Archive completed jobs to `pgboss.archive` for forensic queries.
      archiveCompletedAfterSeconds: 60 * 60 * 24, // 1 day
      // Be forgiving on slow boots (e.g., container cold start).
      monitorStateIntervalSeconds: 30,
    });
  }
  return bossInstance;
}

/**
 * Starts pg-boss (runs internal migrations, opens the listener loop).
 * Safe to call multiple times — second call is a no-op.
 *
 * Concurrent calls across replicas: each invocation grabs a Postgres advisory
 * lock for migrations, so multiple workers booting at once will not race.
 */
export async function startBoss(options: BossOptions): Promise<PgBoss> {
  const boss = getBoss(options.connectionString);
  if (started) return boss;

  // Wire pg-boss internal events to the provided logger (or stay quiet).
  if (options.logger) {
    boss.on('error', (err) => options.logger!.error({ err }, 'pg-boss error'));
  }

  await boss.start();
  started = true;
  return boss;
}

/**
 * Ensures the given queue names exist in pg-boss.
 *
 * pg-boss v10 requires explicit queue creation before send() will accept jobs.
 * Call this from both the worker (via registerHandlers) and the web server
 * container so that send() works regardless of which process started first.
 * Idempotent — safe to call on every boot.
 */
export async function ensureQueues(queueNames: string[]): Promise<void> {
  const boss = getBoss();
  for (const name of queueNames) {
    try {
      await boss.createQueue(name);
    } catch (err: unknown) {
      // 42P07 = "relation already exists" — stale table from a prior run where the
      // queue row was deleted but the hashed partition table was not dropped.
      // The queue is still usable; swallow and continue.
      if ((err as { code?: string }).code !== '42P07') throw err;
    }
  }
}

/** Stops the queue gracefully. Call from SIGTERM handler in apps/worker. */
export async function stopBoss(): Promise<void> {
  if (bossInstance && started) {
    await bossInstance.stop({ graceful: true });
    started = false;
    bossInstance = null;
  }
}
