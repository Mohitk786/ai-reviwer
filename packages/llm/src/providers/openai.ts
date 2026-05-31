/**
 * OpenAI implementation of LLMProvider.
 *
 * Wraps the official `openai` SDK. Used by:
 *   - The default app-owned key (system OpenAI provider).
 *   - User-supplied OpenAI keys via BYO-LLM.
 *   - The `openai_compatible` kind (with `baseUrl` override) — Groq, Together, Ollama, etc.
 */

import OpenAI from 'openai';
import type {
  LLMProvider,
  LLMProviderConfig,
  ChatRequest,
  ChatResult,
  ValidationResult,
} from '../types';

export class OpenAIProvider implements LLMProvider {
  public readonly name = 'openai' as const;
  public readonly model: string;

  private readonly client: OpenAI;

  constructor(config: LLMProviderConfig) {
    if (config.kind !== 'openai' && config.kind !== 'openai_compatible' && config.kind !== 'azure_openai') {
      throw new Error(`OpenAIProvider received incompatible kind: ${config.kind}`);
    }
    this.client = new OpenAI({
      apiKey: config.apiKey,
      // baseURL is the override path for Azure (full deployment URL) and openai_compatible.
      baseURL: config.baseUrl,
      organization: config.organizationId,
    });
    // Default model — overridable per request.
    this.model = config.model ?? 'gpt-4.1-mini';
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const response = await this.client.chat.completions.create({
      model: request.model ?? this.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stop: request.stop,
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error('OpenAI: no choices returned');
    }

    return {
      content: choice.message?.content ?? '',
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      model: response.model,
      finishReason: mapFinishReason(choice.finish_reason),
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: request.model ?? this.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stop: request.stop,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async validate(): Promise<ValidationResult> {
    try {
      // Cheapest possible call that proves the key works: list models.
      // This avoids billing a token and works on Azure/openai_compatible too.
      await this.client.models.list();
      return { ok: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, reason };
    }
  }

  estimateTokens(text: string): number {
    // Rough heuristic — ~4 chars per token for English/code.
    // Replace with `tiktoken` if precise budgeting becomes important.
    return Math.ceil(text.length / 4);
  }
}

/**
 * Maps the OpenAI SDK's finish_reason union into our normalized enum.
 * Unknown values fall through to 'unknown' rather than throwing.
 */
function mapFinishReason(raw: string | null | undefined): ChatResult['finishReason'] {
  switch (raw) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    case 'tool_calls':
    case 'function_call':
      return 'stop';
    default:
      return raw == null ? 'unknown' : 'unknown';
  }
}
