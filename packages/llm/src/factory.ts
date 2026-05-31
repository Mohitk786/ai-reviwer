/**
 * LLMProviderFactory — single point of construction for any LLM provider.
 *
 * Why a factory:
 *   - Open/Closed: adding a new provider = one new file + one case here. No call sites change.
 *   - The `default: const _: never` pattern below makes TypeScript fail to compile if a
 *     new `LLMProviderKind` is added without handling it. Cheap correctness win.
 *
 * Callers (typically `LLMProviderResolver`) hand in a `LLMProviderConfig` and receive
 * an `LLMProvider`. The factory itself is stateless — no caching, no singletons.
 */

import type { LLMProvider, LLMProviderConfig } from './types';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';

export class LLMProviderFactory {
  /** Constructs a provider for the given config. Throws on unknown kind. */
  static create(config: LLMProviderConfig): LLMProvider {
    switch (config.kind) {
      case 'openai':
      case 'openai_compatible':
      case 'azure_openai':
        // OpenAIProvider also handles azure + openai_compatible via baseUrl override.
        return new OpenAIProvider(config);

      case 'anthropic':
        return new AnthropicProvider(config);

      case 'google':
        throw new Error('GoogleProvider not yet implemented (Phase 2)');

      case 'mistral':
        throw new Error('MistralProvider not yet implemented (Phase 2)');

      default: {
        // Exhaustiveness check — if a new kind is added without a case, TS fails here.
        const _exhaustive: never = config.kind;
        throw new Error(`unknown LLM provider kind: ${String(_exhaustive)}`);
      }
    }
  }
}
