# @repo/observability

Structured logging + a tiny span helper.

## Why pino

- Fast (lowest-overhead JSON logger in the Node ecosystem).
- Structured by default (objects, not printf strings).
- Native redaction of secret fields.

## Public API

```ts
import { getLogger, withSpan } from '@repo/observability';

const log = getLogger('ingestion');
log.info({ repoId }, 'starting backfill');

const result = await withSpan('embed.batch', async (span) => {
  span.set('chunkCount', chunks.length);
  return await provider.embed(chunks);
});
```

## Redaction

These field names are redacted at all log levels: `apiKey`, `encryptedSecret`,
`Authorization`, `secret`, `password`, `token`. Add to the redact list in `logger.ts`
when introducing new sensitive fields.

## Forward path

When OpenTelemetry / Sentry are added later, only `withSpan` and the logger transport
need to change — call sites stay identical.
