/**
 * Shared Zod schemas for cross-process payloads.
 *
 * Anything that crosses a process boundary (web → worker via job, worker → DB,
 * tRPC client ↔ server) goes through a schema in this folder. The schema is the
 * SINGLE source of truth for the shape — no duplicated TS interfaces.
 *
 * Phase 1 only defines the entitlement contract. Job payload schemas land in M2.
 */

export * from './entitlements';
