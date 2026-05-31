/**
 * @repo/shared — Cross-cutting utilities with **zero runtime dependencies** beyond Zod.
 *
 * What lives here:
 *   - env.ts          → Zod-validated process.env loader (fails fast).
 *   - schemas/        → Zod schemas shared between web (tRPC) and worker (jobs).
 *   - errors.ts       → Typed error classes used across packages.
 *   - http/           → Transport-agnostic HTTP helpers (error → response mapping).
 *
 * What does NOT live here:
 *   - Prisma client (→ @repo/db)
 *   - Logger (→ @repo/observability)
 *   - Anything that imports a network/IO module
 */

export * from './env';
export * from './errors';
export * from './schemas/index';
export * from './http/index';
