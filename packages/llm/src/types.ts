/**
 * LLM provider contracts.
 *
 * Every concrete provider (OpenAI, Anthropic, Google, etc.) implements `LLMProvider`.
 * Services and resolvers depend on this interface — never on a concrete class. This is
 * what makes provider swaps cheap and BYO-LLM clean.
 *
 * Interface segregation: chat is one capability; embeddings live in `@repo/embeddings`
 * with its own interface.
 */

/** A message in a chat completion request. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Inputs to a non-streaming or streaming chat completion. */
export interface ChatRequest {
  messages: ChatMessage[];
  /** Override the provider's default model. */
  model?: string;
  /** 0..2 — provider-specific scale; ~0 = deterministic. */
  temperature?: number;
  /** Hard cap on response length. */
  maxTokens?: number;
  /**
   * Stop sequences. Provider may map these to its own format. Pass-through; no
   * special semantics enforced here.
   */
  stop?: string[];
}

/** Result of a non-streaming completion. */
export interface ChatResult {
  content: string;
  /** Tokens billed for the prompt. */
  inputTokens: number;
  /** Tokens billed for the response. */
  outputTokens: number;
  /** Final model used (provider may downgrade if requested model unavailable). */
  model: string;
  /** Why generation stopped. */
  finishReason: 'stop' | 'length' | 'content_filter' | 'error' | 'unknown';
}

/** Result of credential validation. Success implies the key works for chat. */
export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * The contract every concrete LLM provider satisfies.
 *
 * Substitutability is load-bearing: callers MUST work with any LLMProvider without
 * knowing which one they have. No `if (provider.name === 'openai')` branches in
 * service code. If a capability genuinely differs, expose it via a separate
 * sub-interface (e.g., `ToolUseProvider extends LLMProvider`).
 */
export interface LLMProvider {
  /** Stable identifier — matches the `kind` in config. */
  readonly name: LLMProviderKind;
  /** Default model used when `request.model` is omitted. */
  readonly model: string;

  /** Single-shot completion. Returns the full text + usage. */
  chat(request: ChatRequest): Promise<ChatResult>;

  /**
   * Streaming completion — yields content deltas as they arrive.
   * Token usage is reported via the returned `usage()` function (some providers
   * only emit usage on the final chunk).
   */
  chatStream(request: ChatRequest): AsyncIterable<string>;

  /** Cheap call (e.g., 1-token completion) used by ProviderCredentialService.validate. */
  validate(): Promise<ValidationResult>;

  /**
   * Approximate token count for a string. Used for budget estimation BEFORE making
   * a real call. Implementations should err on the high side.
   */
  estimateTokens(text: string): number;
}

/**
 * Known provider kinds. Adding a new provider:
 *   1. Add a literal here.
 *   2. Add a class in `./providers/<kind>.ts` implementing LLMProvider.
 *   3. Add a `case` in `LLMProviderFactory.create`.
 */
export type LLMProviderKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure_openai'
  | 'mistral'
  /** Catch-all for anything that speaks the OpenAI Chat Completions API: Groq, Together, Ollama, vLLM, etc. */
  | 'openai_compatible';

/** Configuration object accepted by the factory. Provider-specific fields are optional. */
export interface LLMProviderConfig {
  kind: LLMProviderKind;
  /** Plaintext API key — present only at runtime in the resolver after decryption. */
  apiKey: string;
  /** Override the provider's default model. */
  model?: string;
  /** For Azure OpenAI / openai_compatible / self-hosted endpoints. */
  baseUrl?: string;
  /** OpenAI-specific. */
  organizationId?: string;
}
