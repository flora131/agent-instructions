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

Choose **Use a subscription**, then select a provider. Built-in subscription logins include Claude Pro/Max, ChatGPT Plus/Pro (Codex), and GitHub Copilot.

### Option 2: API key

Set an API key before launching Atomic:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
atomic
```

You can also run `/login`, choose **Use an API key**, then select a provider to store the key in `~/.atomic/agent/auth.json`.

See [Providers](/providers) for all supported providers, environment variables, and cloud-provider setup.

## Verify authentication

Start Atomic in any directory and run:

```text
/model
```

Expected result: the model picker opens and lists selectable models for the provider you just configured, with the active one marked. If it opens empty, or Atomic reports that no provider is configured, re-run `/login`, or confirm the API-key environment variable is exported in the same shell you launched Atomic from.

`/login` opens **Select authentication method:**. Choose **Use a subscription** or **Use an API key** to see the corresponding provider picker and credential-configuration status. That status can reflect stored, environment, runtime, or configuration credentials; it does not test connectivity or prove that a provider will accept a request.

Select a model with `/model`, then send a short prompt such as `Reply with hello.` A successful response confirms access for that request. If it fails, check the reported authentication, quota, model-access, or network error before retrying. A configured credential or a listed model alone does not prove access.

## Next step

Continue to [First session](/getting-started/first-session).
