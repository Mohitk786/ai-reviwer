/**
 * LLMProviderResolver — picks the right provider per request.
 *
 * Lookup order:
 *   1. The installation's saved `ProviderCredential` (kind=LLM, active=true).
 *      → BYO-LLM: user supplied their own key.
 *   2. The system default config (constructor argument).
 *      → App-owned OpenAI key from env.
 *
 * The resolver does NOT cache decrypted credentials. Each call decrypts fresh — keys
 * stay in memory only for the duration of the call. If decryption becomes a hot path,
 * add a short-TTL cache here (NOT in the credential service).
 */

import type { LLMProvider, LLMProviderConfig } from './types';
import { LLMProviderFactory } from './factory';

/**
 * Minimal contract for the credential lookup. Defined as an interface to avoid a
 * circular dep between @repo/llm and @repo/services. The DI container injects the
 * concrete `ProviderCredentialService` here.
 */
export interface CredentialLookup {
  /**
   * Returns a usable `LLMProviderConfig` for the installation, or null if none is
   * configured / valid. Plaintext apiKey lives only in the returned object's lifetime.
   */
  getActiveLLMConfig(installationId: string): Promise<LLMProviderConfig | null>;
}

export class LLMProviderResolver {
  constructor(
    private readonly credentials: CredentialLookup,
    private readonly defaultConfig: LLMProviderConfig,
  ) {}

  /**
   * Returns the provider this installation should use right now.
   *
   * Idempotent — repeated calls don't increment counters or write to DB. Always
   * prefers the user's BYO credential when present.
   */
  async resolveForInstallation(installationId: string): Promise<LLMProvider> {
    const userConfig = await this.credentials.getActiveLLMConfig(installationId);
    if (userConfig) {
      return LLMProviderFactory.create(userConfig);
    }
    return LLMProviderFactory.create(this.defaultConfig);
  }

  /**
   * Returns the system-default provider WITHOUT consulting the credential store.
   * Used for app-internal calls (e.g., generating an embedding for a system query)
   * where BYO doesn't apply.
   */
  resolveDefault(): LLMProvider {
    return LLMProviderFactory.create(this.defaultConfig);
  }
}
