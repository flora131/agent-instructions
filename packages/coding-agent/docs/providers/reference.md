---
title: Provider reference
description: Provider stop reasons and credential resolution order.
---

# Provider reference

## Stop Reasons

Every provider reports why it ended a turn. Atomic stores one of `stop`, `length`, `toolUse`, `error`, or `aborted`; the provider's own string (`end_turn`, `MAX_TOKENS`, `tool_calls`, and so on) is mapped onto it.

A terminal reason the mapping does not recognise is now reported as a **provider error** naming the raw value, instead of being reported as an ordinary successful stop. The turn fails visibly rather than looking like a model that chose to stop early, which matters most for a truncation or safety stop a new provider version invents. Reasons that already mapped to a successful stop are unchanged, and a provider that stops on its own safety or refusal signal still surfaces the raw reason in the error text (for example `Provider stopped with: SAFETY`).

While a response is still streaming the partial message carries the reason `pending`. It is replaced by the terminal reason before the message is finished, so `pending` is not a state a completed turn can be left in: a stream that ends while still `pending` is a provider error. See [Custom providers](/custom-provider) for what this requires of a provider you implement yourself.

## Resolution Order

When resolving credentials for a provider:

1. CLI `--api-key` flag
2. `auth.json` entry (API key or OAuth token)
3. Environment variable
4. Custom provider keys from `models.json`
