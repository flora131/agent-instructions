---
title: Subagent reference
description: Fallback model resolution and reasoning-level contracts.
---

# Subagent reference

## Fallback models

Agents can define ordered `fallbackModels` for retryable provider or model failures such as rate limits, quota/usage-limit exhaustion (for example a provider reporting `The usage limit has been reached`, or `usage_limit_reached`/`insufficient_quota` codes), auth problems, unavailable models, network timeouts, or 5xx errors. Atomic tries the requested primary model first, then configured fallbacks, and finally appends the current user-selected model as the last fallback candidate when available. The main chat and workflow stages share one failure classifier, so auth, model-availability, request-incompatibility, and transport signals are handled consistently. Cancellations, safety refusals, and task/tool failures are never retried on another model.

A candidate that cannot serve the current request — for example an HTTP 400/413/422 bad/unprocessable/payload-too-large request, an unsupported tool or parameter, a context-length/context-window overflow, or a `too large` / `invalid_request` error — is treated as request/context incompatible and the fallback sequence advances to the next candidate rather than stopping. This means that if none of the configured candidates are applicable to the request, Atomic falls back to the currently selected user model instead of failing outright.

Model fallback decisions use structured provider and attempt causes. There is no per-attempt idle watchdog, no child wall-clock kill cap, and no timeout-regex classification: a quiet provider response is allowed to finish, and only an explicit termination or provider failure supplies a retryable cause. Numeric process exit codes are not used as an outcome discriminator.

When registry availability shows that a known candidate provider has no configured auth, Atomic records a skipped model attempt before starting the in-process turn. Unknown/custom providers are still attempted, and the current user-selected model appended as the final fallback is never filtered out by this pre-admission check.

Fallbacks do not retry ordinary task failures, validation failures, tool failures, cancellations, or workflow-code errors. Because a fallback may send the same prompt and context to a different provider, choose models that match your cost, privacy, and data-handling requirements.

Each candidate can also carry its own reasoning effort — see [Reasoning levels](#reasoning-levels).

## Reasoning levels

Set the reasoning (thinking) effort for each model candidate with a `model_name:thinking_effort` suffix on `model` and on every `fallbackModels` entry. Valid efforts are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` — the same shorthand used by `atomic --model sonnet:high`. `xhigh` and `max` are used only when the selected model's capability map supports them.

```markdown
---
name: deep-reviewer
description: Adversarial reviewer for risky diffs
tools: read, search, bash
model: anthropic/claude-sonnet-4:high
fallbackModels: openai/gpt-5:medium, anthropic/claude-haiku-4-5:off
---
```

Because the effort travels with each model string, every primary and fallback candidate is self-contained: a fallback can run at a different effort than the primary, so a high-effort primary degrades gracefully to a cheaper, lower-effort fallback.

**Migrate off the legacy `thinking` field.** The separate `thinking:` frontmatter field is deprecated. It still works as a default for any candidate that has no suffix, and a suffix always wins, but new agents should encode the effort directly on `model` and `fallbackModels`:

```diff
-model: openai/gpt-5.5
-fallbackModels: anthropic/claude-opus-4-8
-thinking: xhigh
+model: openai/gpt-5.5:xhigh
+fallbackModels: anthropic/claude-opus-4-8:xhigh
```

`fallbackThinkingLevels` exists only as an optional compatibility helper: it is aligned by index to `fallbackModels` and supplies a fallback candidate's effort only when that fallback entry has no suffix. Prefer suffixed model strings instead. Attempt metadata reports the resolved model and the effective reasoning effort used for each attempt.
