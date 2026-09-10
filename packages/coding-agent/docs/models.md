---
title: "Custom models"
description: "Add model entries for a supported provider API with minimal and full examples."
---

# Custom Models

Add custom providers and models (Ollama, vLLM, LM Studio, proxies) via the single `models.json` in the active Atomic agent directory, normally `~/.atomic/agent/models.json`, or the directory selected by `ATOMIC_CODING_AGENT_DIR`/`PI_CODING_AGENT_DIR`. Atomic reads only that file: it does not read project-scoped `.atomic/models.json`, fall back to `~/.pi/agent/models.json`, or merge `.pi` and `.atomic` model configuration files. The legacy `.pi` read fallback remains available for configuration surfaces that explicitly use layered config paths, such as `auth.json`; it does not apply to `models.json`.

The interactive `/model` selector and `/scoped-models` render the current authenticated snapshot immediately and refresh network-backed catalogs in the background for up to 15 seconds. A direct `/model <model_name>` checks an exact cached match first; only a miss waits for the same bounded refresh, then falls back to the current cache when refresh stalls or fails. Closing either selector cancels its background refresh. The terminal owns that deadline: it stops waiting and replaces `Refreshing model catalogs…` with a cached-model timeout or error status even when lower-level work rejects or ignores cancellation. In isolated-engine sessions the same deadline covers both credential reload and catalog work inside the engine, and model selection does not queue behind the refresh. Login and logout publish credential changes independently of catalog refresh, and a refresh that started against an older credential generation is discarded instead of restoring stale provider availability. A slow catalog therefore falls back to cached models without requiring an `auth.json` or `~/.atomic` reset.

A complete `defaultProvider`/`defaultModel` pair in `settings.json` is resolved after built-in, configured, and extension providers register. If the provider remains unsupported, interactive mode reports a generic saved-configuration warning and leaves model selection open instead of routing the session to a different provider. Print and JSON modes write that diagnostic to stderr and exit nonzero before prompting, keeping JSON stdout JSONL-clean. RPC rejects `prompt` with the same correlated diagnostic until an explicit successful `set_model` selects an available model or an explicit model cycle returns a different available model. A null or unchanged cycle result does not clear the condition. If the provider is supported but the model is unknown or lacks authentication, normal automatic selection of an available authenticated model continues. Valid custom- and extension-provider defaults resolve once their provider registration is available. See [Settings](/settings#model-&-thinking).


## Where to go next

This page shows minimal and full `models.json` examples you can copy. Every field, override, derived variant, and API compatibility contract lives in the [Model configuration reference](/models/reference).

For choosing which model to use rather than how to declare one, see [Model selection](/models/model-selection).

## Table of Contents

- [Minimal Example](#minimal-example)
- [Full Example](#full-example)
- [Supported APIs](/models/reference#supported-apis)
- [Provider Configuration](/models/reference#provider-configuration)
- [Model Configuration](/models/reference#model-configuration)
- [GPT-6-Astra Built-in Models](#gpt-6-astra-built-in-models)
- [Request-wide Cost Tiers](/models/reference#request-wide-cost-tiers)
- [Overriding Built-in Providers](/models/reference#overriding-built-in-providers)
- [Per-model Overrides](/models/reference#per-model-overrides)
- [Derived Fast Model Variants](/models/reference#derived-fast-model-variants)
- [Anthropic Messages Compatibility](/models/reference#anthropic-messages-compatibility)
- [OpenAI Compatibility](/models/reference#openai-compatibility)

## Minimal Example

For local models (Ollama, LM Studio, vLLM), only `id` is required per model:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

The `apiKey` is required but Ollama ignores it, so any value works.

Some OpenAI-compatible servers do not understand the `developer` role used for reasoning-capable models. For those providers, set `compat.supportsDeveloperRole` to `false` so Atomic sends the system prompt as a `system` message instead. If the server also does not support `reasoning_effort`, set `compat.supportsReasoningEffort` to `false` too.

You can set `compat` at the provider level to apply to all models, or at the model level to override a specific model. This commonly applies to Ollama, vLLM, SGLang, and similar OpenAI-compatible servers.

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "gpt-oss:20b",
          "reasoning": true
        }
      ]
    }
  }
}
```

## Full Example

Override defaults when you need specific values:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        {
          "id": "llama3.1:8b",
          "name": "Llama 3.1 8B (Local)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 32000,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

Atomic reloads the active agent directory's single `models.json` each time you open `/model`. Provider definitions, per-model overrides, dynamic catalogs, and isolated-engine model state are rebuilt from that fresh configuration, so edits take effect without restarting. Invalid edits report an error.

## Google AI Studio Example

Use `google-generative-ai` with a `baseUrl` to add models from Google AI Studio, including custom Gemma 4 entries:

```json
{
  "providers": {
    "my-google": {
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "api": "google-generative-ai",
      "apiKey": "$GEMINI_API_KEY",
      "models": [
        {
          "id": "gemma-4-31b-it",
          "name": "Gemma 4 31B",
          "input": ["text", "image"],
          "contextWindow": 262144,
          "reasoning": true
        }
      ]
    }
  }
}
```

The `baseUrl` is required when adding custom models to the `google-generative-ai` API type.

## Supported APIs

Moved to [Model configuration reference](/models/reference#supported-apis).

## Provider Configuration

Moved to [Model configuration reference](/models/reference#provider-configuration).

### Value Resolution

Moved to [Model configuration reference](/models/reference#value-resolution).

### Custom Headers

Moved to [Model configuration reference](/models/reference#custom-headers).

## Model Configuration

Moved to [Model configuration reference](/models/reference#model-configuration).

### GPT-6-Astra Built-in Models

Atomic ships `openai/gpt-6-astra` and `openai-codex/gpt-6-astra`. Both accept text and image input, expose tool search and additional tools, and offer exactly `low`, `medium`, `high`, `xhigh`, and `max` reasoning. `off`, `minimal`, and Codex's client-side `ultra` orchestration preset are not API reasoning levels and do not appear in Atomic's selector.

The built-in OpenAI and Codex entries use a 272,000-token default input/context limit and a 128,000-token maximum output. OpenAI documents a 1,050,000-token API maximum, but requests above 272,000 aggregate input tokens enter the long-context price tier for the whole request. Override `contextWindow` only when the larger window and its price are intentional.

| Aggregate input | Input | Cached input | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| Up to 272,000 | $10 | $1 | $12.50 | $50 |
| Above 272,000 | $20 | $2 | $25 | $75 |

Rates are per million tokens. `openai/gpt-6-astra-fast` and `openai-codex/gpt-6-astra-fast` are derived canonical choices that keep these base catalog rates; the OpenAI adapters apply Fast's 2x multiplier at request time. The Codex fast choice sends upstream ID `gpt-6-astra` with `service_tier: priority` while Atomic records `gpt-6-astra-fast`.

Amazon Bedrock exposes `openai.gpt-6-astra`, `global.openai.gpt-6-astra`, and `us.openai.gpt-6-astra` through the `amazon-bedrock` provider. These entries keep the same 272,000 input and 128,000 output limits, text and image input, and five reasoning levels; Atomic sends the selected effort as Bedrock's OpenAI `reasoning_effort` field. They do not get Fast or OpenAI tool-search metadata. Atomic sends each Bedrock ID unchanged and records all four price fields as zero because AWS had not published Astra pricing. Zero means unknown here, not free.

Atomic does not synthesize Azure OpenAI Astra entries. Live-provider catalogs remain authoritative: the current OpenRouter catalog publishes `openai/gpt-6-astra` and `openai/gpt-6-astra-pro`, while the Vercel AI Gateway publishes `openai/gpt-6-astra` and `openai/gpt-6-astra-fast`. Atomic imports those exact IDs and their request-wide long-context prices. Vercel owns its suffixed ID, so it remains route-less and does not gain Atomic's first-party fast-route behavior.

On OpenAI Responses, Astra uses the newer prompt-cache payload. `cacheRetention: "long"` sends `prompt_cache_options.ttl: "30m"` instead of the legacy `prompt_cache_retention: "24h"`; `none` sends explicit mode without a cache key, and `short` sends neither cache option. Earlier Responses models keep the 24-hour field for long retention.

### Sampling Parameters

Moved to [Model configuration reference](/models/reference#sampling-parameters).

### Request-wide Cost Tiers

Moved to [Model configuration reference](/models/reference#request-wide-cost-tiers).

### Thinking Level Map

Moved to [Model configuration reference](/models/reference#thinking-level-map).

### Context Window

Moved to [Model configuration reference](/models/reference#context-window).

## Overriding Built-in Providers

Moved to [Model configuration reference](/models/reference#overriding-built-in-providers).

## Per-model Overrides

Moved to [Model configuration reference](/models/reference#per-model-overrides).

## Derived Fast Model Variants

Moved to [Model configuration reference](/models/reference#derived-fast-model-variants).

## Anthropic Messages Compatibility

Moved to [Model configuration reference](/models/reference#anthropic-messages-compatibility).

### Forced tool use on Claude Fable 5.1

Moved to [Model configuration reference](/models/reference#forced-tool-use-on-claude-fable-5-1).

### Preserved thinking and model switches

Moved to [Model configuration reference](/models/reference#preserved-thinking-and-model-switches).

## OpenAI Compatibility

Moved to [Model configuration reference](/models/reference#openai-compatibility).

### Constrained tool sampling

Moved to [Model configuration reference](/models/reference#constrained-tool-sampling).

### Catalog freshness and precedence

Moved to [Model configuration reference](/models/reference#catalog-freshness-and-precedence).
