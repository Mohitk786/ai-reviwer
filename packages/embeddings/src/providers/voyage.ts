import type { EmbeddingProvider } from '../types.js';

// Voyage AI REST API — not using OpenAI SDK since Voyage rejects unknown params
// (e.g. `dimensions`) that the OpenAI SDK always sends.
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'voyage';
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: { apiKey: string; model?: string; dimensions?: number; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'voyage-code-2';
    this.dimensions = config.dimensions ?? 1536;
    this.baseUrl = config.baseUrl ?? 'https://api.voyageai.com/v1';
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0]!;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

// [
//   {
//     index: 1,
//     embedding: [0.1, 0.2, 0.3]
//   },  
//   {
//     index: 0,
//     embedding: [0.4, 0.5, 0.6]
//   },
//   {
//     index: 2,
//     embedding: [0.4, 0.5, 0.6]
//   }
// ]