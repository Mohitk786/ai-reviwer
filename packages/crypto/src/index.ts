/**
 * @repo/crypto — Authenticated symmetric encryption for at-rest secrets.
 *
 * Used to encrypt user-supplied LLM API keys (and similar secrets) before storing them
 * in the `ProviderCredential` table. Plaintext secrets must NEVER touch the DB.
 *
 * Algorithm: AES-256-GCM via Node's built-in `crypto` (no native deps).
 */

export { EncryptionService } from './encryption';
export type { EncryptionResult } from './encryption';
