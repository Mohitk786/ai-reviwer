# @repo/crypto

Authenticated symmetric encryption for secrets stored at rest (e.g., user-supplied LLM API
keys in the `ProviderCredential` table).

## Algorithm

AES-256-GCM via Node's built-in `crypto`:

- 32-byte master key supplied as `ENCRYPTION_KEY` env var (hex-encoded).
- 12-byte IV generated per encryption (random, never reused).
- 16-byte auth tag verifies integrity on decrypt.

## Stored format

```
[ keyVersion (1B) | iv (12B) | authTag (16B) | ciphertext (N bytes) ]
```

The `keyVersion` byte enables key rotation: encrypt new records with v2 while still
decrypting v1 records, then run a re-encryption migration when ready, then drop v1.

## Public API

```ts
import { EncryptionService } from '@repo/crypto';

const enc = new EncryptionService(process.env.ENCRYPTION_KEY!);
const blob = enc.encrypt('sk-...');                  // returns Buffer
const plaintext = enc.decrypt(blob);                 // returns string
```

## Rules

- Plaintext secrets are NEVER logged, persisted, or transmitted unencrypted.
- The pino logger has these field names in its redact list: `apiKey`, `encryptedSecret`,
  `Authorization`, `secret`, `password`, `token`. Do not bypass.
- If the master key is lost, all `ProviderCredential` rows become unreadable. Treat the
  key as critical infrastructure; back it up via your secret manager.
