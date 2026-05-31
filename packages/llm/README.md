# @repo/llm

Provider-agnostic LLM abstraction. Lets the app talk to OpenAI today and any other vendor
tomorrow with **zero changes to call sites**.

## Why an abstraction (and not direct SDK calls)

1. **BYO-LLM** — users can plug in their own API key for their own preferred provider. The
   resolver picks per request.
2. **Future swaps** — moving the default from OpenAI to Anthropic should be one line.
3. **Testability** — services accept an `LLMProvider`; tests pass a stub.

## Layers

```
Service code                      Knows: LLMProvider interface only
        ↓
LLMProviderResolver               Picks: user's credential OR system default
        ↓
LLMProviderFactory.create(cfg)    Returns: a concrete LLMProvider
        ↓
OpenAIProvider                    Wraps: openai SDK
AnthropicProvider                 Wraps: @anthropic-ai/sdk      (future)
GoogleProvider                    Wraps: @google/genai          (future)
AzureOpenAIProvider               Wraps: openai SDK + azure URL (future)
OpenAICompatibleProvider          Wraps: openai SDK + custom base URL — covers Groq, Together, Ollama, etc.
```

## Adding a new provider

1. Create `src/providers/<name>.ts` exporting a class `implements LLMProvider`.
2. Add a kind literal to `LLMProviderKind` in `types.ts`.
3. Add a `case` to `LLMProviderFactory.create`.
4. (If user-selectable) wire the kind into the credential settings UI.

That's it — services keep working.

## Validation

`provider.validate()` makes a cheap call (e.g., 1-token completion) to verify credentials
work. The credential service calls this BEFORE storing a user's API key.
