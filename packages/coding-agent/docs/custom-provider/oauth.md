---
title: Provider OAuth
description: OAuth login callbacks, credential storage, and dynamic catalog refresh.
---

# Provider OAuth

## OAuth Support

Add OAuth/SSO authentication that integrates with `/login`:

```typescript
import type { OAuthCredentials, OAuthLoginCallbacks } from "@bastani/pi-ai";

pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com/v1",
  api: "openai-responses",
  models: [...],
  oauth: {
    name: "Corporate AI (SSO)",

    async login(callbacks: OAuthLoginCallbacks, signal: AbortSignal): Promise<OAuthCredentials> {
      // Option 1: Browser-based OAuth
      callbacks.onAuth({ url: "https://sso.corp.com/authorize?..." });

      // Option 2: Device code flow
      callbacks.onDeviceCode({
        userCode: "ABCD-1234",
        verificationUri: "https://sso.corp.com/device"
      });

      // Option 3: Prompt for token/code
      const code = await callbacks.onPrompt({ message: "Enter SSO code:" });

      // Exchange for tokens (your implementation). Forward `signal` so
      // cancelling /login aborts the in-flight network request.
      const tokens = await exchangeCodeForTokens(code, { signal });

      return {
        refresh: tokens.refreshToken,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    async refreshToken(
      credentials: OAuthCredentials,
      signal: AbortSignal | undefined
    ): Promise<OAuthCredentials> {
      const tokens = await refreshAccessToken(credentials.refresh, { signal });
      return {
        refresh: tokens.refreshToken ?? credentials.refresh,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    getApiKey(credentials: OAuthCredentials): string {
      return credentials.access;
    },

    // Optional: modify models based on user's subscription
    modifyModels(models, credentials) {
      const region = decodeRegionFromToken(credentials.access);
      return models.map(m => ({
        ...m,
        baseUrl: `https://${region}.ai.corp.com/v1`
      }));
    }
  }
});
```

After registration, users can authenticate via `/login corporate-ai`.

Existing extension OAuth definitions keep their `login`, `refreshToken`, `getApiKey`, and optional `modifyModels` methods. OAuth refresh is serialized so concurrent requests do not overwrite each other's credentials.

In isolated interactive mode, extension code and executable OAuth methods remain in the engine process. Atomic transports only the JSON-safe provider description (`id`, `name`, `loginLabel`, and `usesCallbackServer`) to the terminal process; it never serializes provider functions or acquired credentials and does not load the extension a second time in the frontend. `loginLabel` replaces the login dialog title, while `usesCallbackServer: true` exposes a redirect-URL paste field that races the browser callback. The engine executes the provider's login closure and correlates browser URLs, device codes, progress/info messages, prompts, selections, and manual-code callbacks with the originating login.

After acquisition, the engine owns serialized credential persistence and logout. It publishes the authenticated provider against its already-loaded snapshot as soon as persistence succeeds; dynamic catalog and ambient-availability refreshes run separately under the model selector's deadline and never extend the login transaction. Logout similarly publishes stored-credential removal without invoking `refreshModels`; Atomic gives the provider's local remaining-auth probe a short deadline so extension code cannot keep the dialog open. The frontend applies the returned snapshot only after the engine transaction succeeds. Escape or Ctrl+C cancels only the matching login and leaves the prior credential/catalog intact. Built-in OAuth and direct, non-isolated extension OAuth use the same persistence and cancellation semantics; later provider registrations continue to override earlier registrations by ID.

Intentional cancellation is quiet, including native `AbortError`, an aborted signal or its exact reason, nested abort causes, and the legacy exact `Login cancelled` error. Provider denial, timeout, network/protocol errors, malformed responses, token exchange failures, and storage failures remain visible. Catalog-refresh failures are reported by `/model` while cached models remain selectable; they do not turn a persisted login into a failed transaction.

## Dynamic model catalog refresh

Providers whose catalogs change at runtime can add `refreshModels`. Atomic calls it during the model picker's bounded asynchronous refresh, independently of authentication completion:

```typescript
pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com/v1",
  api: "openai-responses",
  apiKey: "$CORPORATE_AI_KEY",
  models: cachedModels,
  async refreshModels({ signal, force, credential, store }) {
    const models = await fetchCorporateModels({ signal, force, credential });
    await store.write({ models, checkedAt: Date.now() });
    return models;
  }
});
```

The current catalog stays readable while refresh is pending. Successful provider results are applied independently; a provider that fails, times out, or observes an aborted `signal` retains its previous list. Use the provider-scoped `store` only when the catalog should persist across sessions.

### OAuthLoginCallbacks

The `callbacks` object provides three ways to authenticate:

```typescript
interface OAuthLoginCallbacks {
  // Open URL in browser (for OAuth redirects)
  onAuth(params: { url: string }): void;

  // Show device code (for device authorization flow)
  onDeviceCode(params: { userCode: string; verificationUri: string }): void;

  // Prompt user for input (for manual token entry)
  onPrompt(params: { message: string }): Promise<string>;
}
```

### OAuthCredentials

Credentials are persisted in `~/.atomic/agent/auth.json` (legacy `~/.pi/agent/auth.json` may be read for compatibility):

```typescript
interface OAuthCredentials {
  refresh: string;   // Refresh token (for refreshToken())
  access: string;    // Access token (returned by getApiKey())
  expires: number;   // Expiration timestamp in milliseconds
}
```
