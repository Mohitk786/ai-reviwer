/**
 * Anthropic implementation of LLMProvider.
 *
 * Wraps the official `@anthropic-ai/sdk`. Targeted at Claude Sonnet 4.6 for
 * the system review pipeline. Also handles user-supplied Anthropic keys via BYO-LLM.
 *
 * Note: Anthropic's messages API uses `max_tokens` as a required field (no default).
 * We default to 4096 when callers don't specify — sufficient for structured review JSON.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  LLMProviderConfig,
  ChatRequest,
  ChatResult,
  ChatMessage,
  ValidationResult,
} from '../types';

const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider implements LLMProvider {
  public readonly name = 'anthropic' as const;
  public readonly model: string;

  private readonly client: Anthropic;

  constructor(config: LLMProviderConfig) {
    if (config.kind !== 'anthropic') {
      throw new Error(`AnthropicProvider received incompatible kind: ${config.kind}`);
    }
    this.client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
    this.model = config.model ?? 'claude-sonnet-4-6';
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    // Anthropic separates system prompt from user/assistant turns.
    const systemMessages = request.messages.filter((m): m is ChatMessage & { role: 'system' } => m.role === 'system');
    const turnMessages = request.messages.filter((m) => m.role !== 'system');

    const systemText = systemMessages.map((m) => m.content).join('\n\n');

    const response = await this.client.messages.create({
      model: request.model ?? this.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature,
      stop_sequences: request.stop,
      ...(systemText ? { system: systemText } : {}),
      messages: turnMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    const content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
      finishReason: mapStopReason(response.stop_reason),
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<string> {
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const turnMessages = request.messages.filter((m) => m.role !== 'system');
    const systemText = systemMessages.map((m) => m.content).join('\n\n');

    const stream = this.client.messages.stream({
      model: request.model ?? this.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature,
      stop_sequences: request.stop,
      ...(systemText ? { system: systemText } : {}),
      messages: turnMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }

  async validate(): Promise<ValidationResult> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  estimateTokens(text: string): number {
    // ~4 chars per token is a reasonable upper-bound estimate for Anthropic.
    return Math.ceil(text.length / 4);
  }
}

function mapStopReason(
  reason: Anthropic.Message['stop_reason'],
): ChatResult['finishReason'] {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'max_tokens': return 'length';
    case 'stop_sequence': return 'stop';
    default: return 'unknown';
  }
}
