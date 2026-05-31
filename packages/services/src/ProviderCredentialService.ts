/**
 * ProviderCredentialService — owns user-supplied API credentials (BYO-LLM).
 *
 * Responsibilities:
 *   1. Validate-before-store: when a user submits a key, we make a cheap call to the
 *      provider to confirm it works. Invalid keys never touch the DB.
 *   2. Encrypt at rest: keys are encrypted with @repo/crypto (AES-256-GCM) before
 *      INSERT/UPDATE. Plaintext exists only in memory, only during a request that
 *      needs it.
 *   3. Resolver lookup: provides `getActiveLLMConfig` for `LLMProviderResolver`.
 *      Returns the decrypted config. Never logs the plaintext.
 *
 * Boundary rule: this is the ONLY place plaintext API keys exist after entry. Routers
 * should pass a key in, get a "stored" boolean back, and never see it again.
 */

import type { PrismaClient, ProviderCredentialKind } from '@repo/db';
import { EncryptionService } from '@repo/crypto';
import {
  LLMProviderFactory,
  type LLMProviderConfig,
  type LLMProviderKind,
} from '@repo/llm';
import { ValidationError, NotFoundError, InternalError } from '@repo/shared/errors';

/** Input shape for `setLLMCredential`. The kind is fixed; this is for LLM only. */
export interface SetLLMCredentialInput {
  installationId: string;
  providerKind: LLMProviderKind;
  apiKey: string;
  /** Optional model override stored alongside the key. */
  model?: string;
  /** For Azure / openai_compatible. */
  baseUrl?: string;
  /** OpenAI organization ID. */
  organizationId?: string;
}

/** Result of a successful set/upsert. Never includes the plaintext key. */
export interface SetCredentialResult {
  ok: true;
  installationId: string;
  kind: ProviderCredentialKind;
  providerKind: string;
  validatedAt: Date;
}

export class ProviderCredentialService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Stores or replaces the LLM credential for an installation.
   *
   * Flow:
   *   1. Construct the provider with the supplied key.
   *   2. Call `provider.validate()` — fails fast on bad keys / wrong base URL.
   *   3. Encrypt the key and upsert the row.
   *
   * Throws `ValidationError` on bad input or failed validation. The error message
   * surfaces the provider's own response so users can fix their config.
   */
  async setLLMCredential(input: SetLLMCredentialInput): Promise<SetCredentialResult> {
    if (!input.apiKey || input.apiKey.trim().length === 0) {
      throw new ValidationError('apiKey is required', { apiKey: 'must be non-empty' });
    }

    // Step 1: validate the key BEFORE touching the DB.
    const config: LLMProviderConfig = {
      kind: input.providerKind,
      apiKey: input.apiKey,
      model: input.model,
      baseUrl: input.baseUrl,
      organizationId: input.organizationId,
    };
    const provider = LLMProviderFactory.create(config);
    const validation = await provider.validate();

    if (!validation.ok) {
      throw new ValidationError(
        `Provider rejected the supplied credentials: ${validation.reason}`,
        { apiKey: 'invalid', providerKind: input.providerKind },
      );
    }

    // Step 2: encrypt + upsert.
    const encrypted = this.encryption.encrypt(input.apiKey);

    const row = await this.prisma.providerCredential.upsert({
      where: {
        installationId_kind: {
          installationId: input.installationId,
          kind: 'LLM',
        },
      },
      create: {
        installationId: input.installationId,
        kind: 'LLM',
        providerKind: input.providerKind,
        // Prisma Bytes wants a Uint8Array<ArrayBuffer> — Buffer.from + slice gives us
        // a fresh ArrayBuffer-backed view (not SharedArrayBuffer).
        encryptedSecret: new Uint8Array(encrypted.ciphertext),
        encryptionKeyVersion: 1,
        model: input.model,
        baseUrl: input.baseUrl,
        organizationId: input.organizationId,
        active: true,
        lastValidatedAt: new Date(),
        lastValidationError: null,
      },
      update: {
        providerKind: input.providerKind,
        // Prisma Bytes wants a Uint8Array<ArrayBuffer> — Buffer.from + slice gives us
        // a fresh ArrayBuffer-backed view (not SharedArrayBuffer).
        encryptedSecret: new Uint8Array(encrypted.ciphertext),
        encryptionKeyVersion: 1,
        model: input.model,
        baseUrl: input.baseUrl,
        organizationId: input.organizationId,
        active: true,
        lastValidatedAt: new Date(),
        lastValidationError: null,
      },
    });

    return {
      ok: true,
      installationId: row.installationId,
      kind: row.kind,
      providerKind: row.providerKind,
      validatedAt: row.lastValidatedAt!,
    };
  }

  /**
   * Lookup contract used by `LLMProviderResolver`. Decrypts the active credential
   * (if any) and returns a ready-to-use config. Returns `null` to signal "use default".
   *
   * This is called on the hot path of every LLM-backed request. Keep it lean.
   */
  async getActiveLLMConfig(installationId: string): Promise<LLMProviderConfig | null> {
    const row = await this.prisma.providerCredential.findUnique({
      where: {
        installationId_kind: {
          installationId,
          kind: 'LLM',
        },
      },
    });

    if (!row || !row.active) return null;

    let apiKey: string;
    try {
      apiKey = this.encryption.decrypt(Buffer.from(row.encryptedSecret));
    } catch (err) {
      // Decryption failure typically means the master key was rotated incorrectly
      // or the row is corrupt. Fail loudly — silently using the default would mean
      // user thinks BYO is active when it isn't.
      throw new InternalError(
        `Failed to decrypt LLM credential for installation ${installationId}`,
        err,
      );
    }

    // Cast is safe — providerKind was validated against `LLMProviderKind` at write time.
    return {
      kind: row.providerKind as LLMProviderKind,
      apiKey,
      model: row.model ?? undefined,
      baseUrl: row.baseUrl ?? undefined,
      organizationId: row.organizationId ?? undefined,
    };
  }

  /**
   * Removes a credential. Used when a user wants to revert to the default provider,
   * or when validation fails on a webhook-driven re-check.
   *
   * Throws `NotFoundError` if no credential exists for the (installation, kind) pair.
   */
  async deleteCredential(installationId: string, kind: ProviderCredentialKind): Promise<void> {
    const result = await this.prisma.providerCredential.deleteMany({
      where: { installationId, kind },
    });
    if (result.count === 0) {
      throw new NotFoundError(`provider credential (kind=${kind})`);
    }
  }

  /**
   * Returns metadata about an installation's credential WITHOUT decrypting the key.
   * Safe for UI display (settings page).
   */
  async getCredentialInfo(
    installationId: string,
    kind: ProviderCredentialKind,
  ): Promise<{
    providerKind: string;
    model: string | null;
    baseUrl: string | null;
    active: boolean;
    lastValidatedAt: Date | null;
    lastValidationError: string | null;
  } | null> {
    const row = await this.prisma.providerCredential.findUnique({
      where: { installationId_kind: { installationId, kind } },
      select: {
        providerKind: true,
        model: true,
        baseUrl: true,
        active: true,
        lastValidatedAt: true,
        lastValidationError: true,
      },
    });
    return row;
  }
}
