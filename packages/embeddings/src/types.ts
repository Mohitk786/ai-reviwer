export interface EmbeddingProvider {
  readonly kind: string;
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  /** Batch embed up to 2048 texts in one API call. Results are index-aligned. */
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingProviderConfig {
  kind: 'openai' | 'openai_compatible' | 'voyage';
  apiKey: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}
