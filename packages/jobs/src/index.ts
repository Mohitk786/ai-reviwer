/**
 * @repo/jobs — pg-boss singleton + Zod-typed job registry.
 *
 * Why pg-boss: same Postgres as the app DB, transactional enqueue, no Redis.
 * Why Zod-typed registry: producers and consumers share the same payload schema; mismatches
 * are caught at compile time and at runtime (zod.parse before handler runs).
 */

export { getBoss, startBoss, stopBoss, ensureQueues } from './boss';
/** Re-exported pg-boss class type — consumers can take a `Boss` without depending on pg-boss directly. */
export type { default as Boss } from 'pg-boss';
export {
  JobNames,
  jobSchemas,
  type JobName,
  type JobPayload,
} from './types';
export { defineHandler, registerHandlers } from './handlers';
