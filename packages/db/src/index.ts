/**
 * @repo/db — Prisma client + types re-export.
 *
 * Public surface:
 *   - getPrismaClient(): the singleton client (one connection pool per process).
 *   - All Prisma model types and enums.
 *
 * Boundary rule: every other package depends on this one for DB access.
 * Do NOT instantiate `new PrismaClient()` anywhere else — always go through `getPrismaClient`.
 */

export { getPrismaClient, disconnectPrisma } from './client';
// Re-export the generated client surface — types, enums, and the PrismaClient class.
// Generated to `./src/generated/client` per the `output` setting in schema.prisma.
export * from './generated/client/index';
