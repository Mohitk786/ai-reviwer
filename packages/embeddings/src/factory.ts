import type { EmbeddingProvider, EmbeddingProviderConfig } from './types.js';
import { OpenAIEmbeddingProvider } from './providers/openai.js';
import { VoyageEmbeddingProvider } from './providers/voyage.js';

export class EmbeddingProviderFactory {
  static create(config: EmbeddingProviderConfig): EmbeddingProvider {
    switch (config.kind) {
      case 'openai':
      case 'openai_compatible':
        return new OpenAIEmbeddingProvider(config);
      case 'voyage':
        return new VoyageEmbeddingProvider(config);
      default: {
        const _exhaustive: never = config.kind;
        throw new Error(`Unknown embedding provider kind: ${String(_exhaustive)}`);
      }
    }
  }
}
