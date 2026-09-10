---
title: Authentication
description: Connect Atomic to a provider with a subscription login or an API key.
---

# Authentication

**Outcome:** Atomic can reach a model provider and `/model` lists models you can select.

**Prerequisites:** [Installation](/getting-started/installation) is complete.

## Authenticate

Atomic can use subscription providers through `/login`, or API-key providers through environment variables or the auth file.

### Option 1: subscription login

Start Atomic and run:

```text
/login
```

Then select a provider. Built-in subscription logins include Claude Pro/Max, ChatGPT Plus/Pro (Codex), and GitHub Copilot.

### Option 2: API key

Set an API key before launching Atomic:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
atomic
```

You can also run `/login` and select an API-key provider to store the key in `~/.atomic/agent/auth.json`.

See [Providers](/providers) for all supported providers, environment variables, and cloud-provider setup.

## Verify authentication

Start Atomic in any directory and run:

```text
/model
```

Expected result: the model picker opens and lists selectable models for the provider you just connected, with the active one marked. If it opens empty, or Atomic reports that no provider is configured, the credential did not take — re-run `/login`, or confirm the API-key environment variable is exported in the same shell you launched Atomic from.

`/login` on its own also reports which providers currently have stored credentials, which is the quickest way to confirm what Atomic can reach.

## Next step

Continue to [First session](/getting-started/first-session).
