/**
 * @repo/llm — Provider-agnostic LLM abstraction.
 *
 * Architecture:
 *   - `LLMProvider` interface: contract every provider must satisfy (Liskov-substitutable).
 *   - `LLMProviderFactory.create(config)`: instantiates the right provider by `kind`.
 *   - Concrete providers in `./providers/*`: OpenAI today; Anthropic/Google/etc. drop-in later.
 *   - `LLMProviderResolver`: per-request lookup that returns either the user's BYO provider
 *     (from `ProviderCredential`) or the system default.
 *
 * SOLID notes:
 *   - Open/Closed: adding a provider = new file in `providers/` + one case in factory.
 *     No call sites change.
 *   - Dependency Inversion: services depend on `LLMProvider`, never on a concrete class.
 */

export type {
  LLMProvider,
  LLMProviderKind,
  LLMProviderConfig,
  ChatRequest,
  ChatResult,
  ChatMessage,
  ValidationResult,
} from './types';
export { LLMProviderFactory } from './factory';
export { LLMProviderResolver } from './resolver';
export { OpenAIProvider } from './providers/openai';
export { AnthropicProvider } from './providers/anthropic';
