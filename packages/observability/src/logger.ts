/**
 * Singleton pino logger with secret redactions.
 *
 * Usage:
 *   ```ts
 *   import { getLogger } from '@repo/observability';
 *   const log = getLogger('ingestion');
 *   log.info({ repoId }, 'starting backfill');
 *   ```
 *
 * Why singleton: pino instances open a worker thread for each transport. One
 * instance per process is correct.
 */

import pino, { type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

/** Field names that ALWAYS get redacted, at every nesting level. */
const REDACT_PATHS = [
  '*.apiKey',
  '*.api_key',
  '*.encryptedSecret',
  '*.encrypted_secret',
  '*.secret',
  '*.password',
  '*.token',
  'apiKey',
  'api_key',
  'encryptedSecret',
  'encrypted_secret',
  'secret',
  'password',
  'token',
  'authorization',
  'Authorization',
  'headers.authorization',
  'headers.Authorization',
  'req.headers.authorization',
  'req.headers.cookie',
];

let rootLogger: PinoLogger | null = null;

function buildRootLogger(): PinoLogger {
  const level = process.env.LOG_LEVEL ?? 'info';
  const isDev = process.env.NODE_ENV === 'development';

  return pino({
    level,
    redact: {
      paths: REDACT_PATHS,
      remove: false,
      censor: '[REDACTED]',
    },
    // Pretty-print in dev, structured JSON in prod.
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
    // Always include service in JSON logs so multi-service log streams can be filtered.
    base: {
      service: process.env.SERVICE_NAME ?? 'rag',
      env: process.env.NODE_ENV ?? 'development',
    },
  });
}

/**
 * Returns the singleton logger, optionally bound to a child name.
 *
 * Calling `getLogger('ingestion')` returns a child logger that prefixes log lines
 * with `{name: 'ingestion'}` — useful for filtering in production.
 */
export function getLogger(name?: string): Logger {
  if (!rootLogger) {
    rootLogger = buildRootLogger();
  }
  return name ? rootLogger.child({ name }) : rootLogger;
}
