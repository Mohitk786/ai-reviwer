/**
 * Prisma client singleton.
 *
 * Why a singleton:
 * Each `new PrismaClient()` opens its own connection pool. In dev with Next.js HMR, the
 * server module is reloaded on every code change — without caching on `globalThis`, you
 * exhaust the Postgres connection limit within a few minutes of editing.
 *
 * In production we still benefit: one client per Node process, shared across all
 * request handlers and background jobs in that process.
 */

import { PrismaClient } from './generated/client/index';

// Augment globalThis with our cached client. The Symbol approach prevents collisions
// with other libraries that might also stash things on globalThis.
const PRISMA_GLOBAL_KEY = Symbol.for('@repo/db/prismaClient');

interface GlobalWithPrisma {
  [PRISMA_GLOBAL_KEY]?: PrismaClient;
}

const globalWithPrisma = globalThis as unknown as GlobalWithPrisma;

/**
 * Returns the singleton Prisma client.
 *
 * Safe to call from anywhere — handlers, services, scripts. Always returns the same
 * instance within a process.
 */
export function getPrismaClient(): PrismaClient {
  if (!globalWithPrisma[PRISMA_GLOBAL_KEY]) {
    globalWithPrisma[PRISMA_GLOBAL_KEY] = new PrismaClient({
      // Log warnings + errors. Query log is too noisy for production; enable per-test.
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return globalWithPrisma[PRISMA_GLOBAL_KEY]!;
}

/**
 * Disconnects the client. Call from graceful shutdown handlers in apps/worker
 * and apps/web (on SIGTERM). Calling on a never-connected client is a no-op.
 */
export async function disconnectPrisma(): Promise<void> {
  const client = globalWithPrisma[PRISMA_GLOBAL_KEY];
  if (client) {
    await client.$disconnect();
    delete globalWithPrisma[PRISMA_GLOBAL_KEY];
  }
}
