import OpenAI from 'openai';
import type { EmbeddingProvider } from '../types.js';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'openai';
  readonly model: string;
  readonly dimensions: number;
  private readonly client: OpenAI;

  constructor(config: {
    apiKey: string;
    model?: string;
    dimensions?: number;
    baseUrl?: string;
  }) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
    this.model = config.model ?? 'text-embedding-3-large';
    this.dimensions = config.dimensions ?? 1536;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimensions,
    });
    // Preserve original order — index remains the same as input order
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
