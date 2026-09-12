---
title: Provider API reference
description: Provider config and model definition contracts.
---

# Provider API reference

## Config Reference

```typescript
interface ProviderConfig {
  /** Display name for the provider in UI such as /login. */
  name?: string;

  /** API endpoint URL. Required when defining models. */
  baseUrl?: string;

  /** API key literal or config value (for env vars use "$ENV_VAR" or "${ENV_VAR}"). Required when defining models (unless oauth). */
  apiKey?: string;

  /** API type for streaming. Required at provider or model level when defining models. */
  api?: Api;

  /** Custom streaming implementation for non-standard APIs. */
  streamSimple?: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => AssistantMessageEventStream;

  /** Custom headers to include in requests. Values use the same config-value syntax as apiKey. */
  headers?: Record<string, string>;

  /** If true, adds Authorization: Bearer header with the resolved API key. */
  authHeader?: boolean;

  /** Models to register. If provided, replaces all existing models for this provider. */
  models?: ProviderModelConfig[];

  /** OAuth provider for /login support. */
  oauth?: {
    name: string;
    login(callbacks: OAuthLoginCallbacks, signal: AbortSignal): Promise<OAuthCredentials>;
    refreshToken(credentials: OAuthCredentials, signal: AbortSignal | undefined): Promise<OAuthCredentials>;
    getApiKey(credentials: OAuthCredentials): string;
    modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[];
  };
}
```

## Model Definition Reference

```typescript
interface ProviderModelConfig {
  /** Model ID (e.g., "claude-sonnet-4-5"). */
  id: string;

  /** Display name (e.g., "Claude Sonnet 4.5"). */
  name: string;

  /** API type override for this specific model. */
  api?: Api;

  /** API endpoint URL override for this specific model. */
  baseUrl?: string;

  /** Whether the model supports extended thinking. */
  reasoning: boolean;

  /** Maps Atomic thinking levels to provider/model-specific values; null marks a level unsupported. */
  thinkingLevelMap?: Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>>;

  /** Supported input types. */
  input: ("text" | "image")[];

  /** Base cost per million tokens plus optional request-wide long-context tiers. */
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tiers?: Array<{
      /** Tier applies only when input + cacheRead + cacheWrite strictly exceeds this value. */
      inputTokensAbove: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }>;
  };

  /** Default/effective context window size in tokens. */
  contextWindow: number;

  /** Maximum output tokens. */
  maxTokens: number;
  /** Default sampling parameters merged into OpenAI-compatible request bodies. */
  samplingParams?: Record<string, unknown>;

  /** Custom headers for this specific model. */
  headers?: Record<string, string>;

  /** API-specific provider compatibility settings. */
  compat?: {
    supportsStore?: boolean;
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    supportsUsageInStreaming?: boolean;
    supportsFinishReason?: boolean;
    supportsThinkingTokenBudget?: boolean;
    supportsStrictMode?: boolean;
    supportsOpenAIGrammarTools?: boolean;
    /** Atomic alias for supportsOpenAIGrammarTools. */
    supportsGrammarTools?: boolean;
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    requiresToolResultName?: boolean;
    requiresAssistantAfterToolResult?: boolean;
    requiresThinkingAsText?: boolean;
    requiresReasoningContentOnAssistantMessages?: boolean;
    thinkingFormat?: "openai" | "openrouter" | "deepseek" | "together" | "baseten" | "zai" | "qwen" | "chat-template" | "qwen-chat-template" | "string-thinking" | "ant-ling";
    supportsStrictTools?: boolean;
    chatTemplateKwargs?: Record<string, string | number | boolean | null | { "$var": "thinking.enabled" | "thinking.effort" | "thinking.budget"; omitWhenOff?: boolean }>;
    chatTemplateArgs?: Record<string, string | number | boolean | null | { "$var": "thinking.enabled" | "thinking.effort" | "thinking.budget"; omitWhenOff?: boolean }>;
    thinkingTokenBudgetField?: "thinking_token_budget" | "thinking_budget" | "thinking_budget_tokens";
    cacheControlFormat?: "anthropic";
    sendSessionAffinityHeaders?: boolean;
    sessionAffinityFormat?: "openai" | "openai-nosession" | "openrouter";
    supportsLongCacheRetention?: boolean;
    vllmPriority?: number;
    supportsToolSearch?: boolean;
    supportsMaxOutputTokens?: boolean;
  };
}
```

The `cost` shape is equivalent to `Model<Api>["cost"]`. Base rates and every tier are complete rate sets. When multiple thresholds match, `calculateCost()` uses the highest threshold and applies that tier to all four cost buckets for the request.

`openrouter` sends `reasoning: { effort }`. `deepseek` sends `thinking: { type: "enabled" | "disabled" }` and `reasoning_effort` when enabled. `together` sends `reasoning: { enabled }` and also `reasoning_effort` when `supportsReasoningEffort` is enabled. `qwen` is for DashScope-style top-level `enable_thinking`. Use `qwen-chat-template` for local Qwen-compatible servers that read `chat_template_kwargs.enable_thinking` and need `preserve_thinking`. Use `chat-template` for configurable `chat_template_kwargs`, for example DeepSeek V3.x behind vLLM with `chatTemplateKwargs: { "thinking": { "$var": "thinking.enabled" } }`. Use `thinkingFormat: "baseten"` with `chatTemplateArgs` when the provider expects toggle values under `chat_template_args` and optionally supports top-level `reasoning_effort`.
`thinkingTokenBudgetField` sends a clamped per-level thinking budget as a top-level request field (`thinking_token_budget` on vLLM, `thinking_budget` on Qwen/SGLang, `thinking_budget_tokens` on llama.cpp). `supportsThinkingTokenBudget: true` is an alias for the vLLM field name. Do not combine it with `reasoning_effort` on DashScope Qwen models.
`vllmPriority` sends a top-level `priority` request field for `openai-completions` providers. Lower values are scheduled earlier and the vLLM server default is `0`, so it only takes effect when vLLM runs with `--scheduling-policy priority`. Set it on a background or batch model so its long prefills queue behind interactive sessions. Unset by default and never set on the generated catalog.
`cacheControlFormat: "anthropic"` applies Anthropic-style `cache_control` markers to the system prompt, last tool definition, and last user, assistant, or tool-result text content.

Capability flags are enforcement claims, not preferences. `supportsStrictMode` controls strict JSON-schema tools for OpenAI-compatible APIs; Anthropic/Bedrock use `supportsStrictTools`; `supportsOpenAIGrammarTools` controls OpenAI Lark/regex custom tools. Atomic also accepts `supportsGrammarTools` as a compatibility alias and synchronizes it to the canonical OpenAI name; when both disagree, the canonical field wins. Leave these fields unset/false unless the endpoint and selected model actually preserve and enforce the corresponding request shape. See [Extensions](/extensions/authoring#constrained-sampling) for exact `constrainedSampling` modes.

For `openai-responses` providers, set `compat.sessionAffinityFormat` to `"openai"` for `session_id` plus `x-client-request-id`, `"openai-nosession"` to omit `session_id` while retaining `x-client-request-id`, or `"openrouter"` for `x-session-id`. Responses-compatible providers may also set `supportsToolSearch` when they support deferred tool loading. `supportsMaxOutputTokens` defaults to `true`; set it to `false` for OpenAI Responses-compatible gateways such as Codex-protocol proxies that reject `max_output_tokens` with a 400, and Atomic omits the parameter from those requests.
