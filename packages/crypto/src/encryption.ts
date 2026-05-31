/**
 * Authenticated symmetric encryption — AES-256-GCM.
 *
 * Used to encrypt user-supplied API keys (LLM, embedding, rerank credentials)
 * before persisting them to the `ProviderCredential` table. Plaintext secrets
 * exist only in memory, only for the duration of a request that needs them.
 *
 * Stored format (Buffer):
 *
 *   [ keyVersion (1B) | iv (12B) | authTag (16B) | ciphertext (N bytes) ]
 *
 *   - keyVersion lets us rotate the master key:
 *       Stage 1: Encrypt new records with v2 master key. Decrypt v1 records with v1 key.
 *       Stage 2: Run a re-encryption migration job (re-encrypt v1 rows under v2).
 *       Stage 3: Drop the v1 master key from secret store.
 *
 *   - iv (12B) is generated randomly per encryption — NEVER reuse.
 *   - authTag (16B) is GCM's integrity check; decrypt fails loudly if tampered.
 *
 * The master key is supplied as a hex string (64 chars = 32 bytes). It MUST be
 * stored in your secret manager / .env.local, not in source.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/** AES-256 needs a 32-byte key. */
const KEY_LENGTH_BYTES = 32;
/** GCM standard IV size. Other sizes work but 12B is the optimized path. */
const IV_LENGTH_BYTES = 12;
/** GCM auth tag — fixed length. */
const AUTH_TAG_LENGTH_BYTES = 16;
/** Single byte at the start of every ciphertext indicating which master key version was used. */
const KEY_VERSION_LENGTH_BYTES = 1;

/** Result type — exposed so callers can store the buffer directly in Prisma `Bytes` columns. */
export interface EncryptionResult {
  ciphertext: Buffer;
  /** Convenience — the same data, base64-encoded. Useful for logs / API responses. */
  toBase64(): string;
}

/** A single registered master key — current key + any older keys retained for decryption. */
interface KeyEntry {
  version: number;
  key: Buffer;
}

export class EncryptionService {
  /** The "active" key — used for new encryptions. */
  private readonly currentKey: KeyEntry;
  /** Older keys, keyed by version, for decrypting historical records during rotation. */
  private readonly legacyKeys: Map<number, Buffer>;

  /**
   * Construct with the active master key (hex-encoded 32 bytes).
   *
   * For key rotation, pass `legacy` mapping previous version numbers to keys.
   * Decrypt automatically dispatches to the right one based on the version byte
   * stored in the ciphertext.
   */
  constructor(
    activeKeyHex: string,
    options: { activeVersion?: number; legacy?: Record<number, string> } = {},
  ) {
    const activeKey = decodeKey(activeKeyHex);
    this.currentKey = {
      version: options.activeVersion ?? 1,
      key: activeKey,
    };

    this.legacyKeys = new Map();
    if (options.legacy) {
      for (const [versionStr, hex] of Object.entries(options.legacy)) {
        const version = Number(versionStr);
        if (!Number.isInteger(version) || version < 0 || version > 255) {
          throw new Error(`legacy key version must be a byte (0-255), got: ${versionStr}`);
        }
        this.legacyKeys.set(version, decodeKey(hex));
      }
    }
  }

  /**
   * Encrypts plaintext (string or Buffer). Returns a Buffer in the layout described above.
   *
   * Throws if plaintext is empty — empty secrets are almost always a programming bug
   * (forgot to validate input). Better to fail loudly here.
   */
  encrypt(plaintext: string | Buffer): EncryptionResult {
    const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
    if (data.length === 0) {
      throw new Error('encrypt: refusing to encrypt empty plaintext');
    }

    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.currentKey.key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const versionByte = Buffer.from([this.currentKey.version]);
    const ciphertext = Buffer.concat([versionByte, iv, authTag, encrypted]);

    return {
      ciphertext,
      toBase64: () => ciphertext.toString('base64'),
    };
  }

  /**
   * Decrypts a buffer in the canonical layout. Returns the plaintext string.
   *
   * Throws if:
   *   - Buffer is too short to contain a valid envelope.
   *   - Auth tag verification fails (tampered ciphertext).
   *   - Version byte references a key we don't have.
   */
  decrypt(ciphertext: Buffer): string {
    const minLength = KEY_VERSION_LENGTH_BYTES + IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES;
    if (ciphertext.length <= minLength) {
      throw new Error('decrypt: ciphertext too short to be valid');
    }

    const version = ciphertext[0]!;
    const iv = ciphertext.subarray(
      KEY_VERSION_LENGTH_BYTES,
      KEY_VERSION_LENGTH_BYTES + IV_LENGTH_BYTES,
    );
    const authTag = ciphertext.subarray(
      KEY_VERSION_LENGTH_BYTES + IV_LENGTH_BYTES,
      KEY_VERSION_LENGTH_BYTES + IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
    );
    const data = ciphertext.subarray(KEY_VERSION_LENGTH_BYTES + IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

    const key = this.lookupKey(version);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return plaintext.toString('utf8');
  }

  /**
   * Quick correctness check at boot. Encrypts a known string and decrypts it.
   * Throws on failure — a clear sign the master key is corrupt or wrong format.
   *
   * Call once from the app's startup sequence after constructing the service.
   */
  selfTest(): void {
    const sample = 'self-test-' + randomBytes(8).toString('hex');
    const encrypted = this.encrypt(sample);
    const decrypted = this.decrypt(encrypted.ciphertext);

    // timingSafeEqual prevents micro-leaks; here it's defensive — the data is
    // already in memory of this process. But the habit is good.
    const a = Buffer.from(sample, 'utf8');
    const b = Buffer.from(decrypted, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('EncryptionService self-test failed: roundtrip mismatch');
    }
  }

  // -------------------------------------------------------------------------

  private lookupKey(version: number): Buffer {
    if (version === this.currentKey.version) return this.currentKey.key;
    const legacy = this.legacyKeys.get(version);
    if (!legacy) {
      throw new Error(
        `decrypt: unknown master key version ${version}. ` +
          `Configure legacy keys via constructor options.`,
      );
    }
    return legacy;
  }
}

// -----------------------------------------------------------------------------

function decodeKey(hex: string): Buffer {
  if (typeof hex !== 'string' || hex.length !== KEY_LENGTH_BYTES * 2) {
    throw new Error(
      `master key must be ${KEY_LENGTH_BYTES * 2} hex chars (${KEY_LENGTH_BYTES} bytes); ` +
        `got ${hex?.length ?? 0}`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('master key must be hex-encoded');
  }
  return Buffer.from(hex, 'hex');
}
