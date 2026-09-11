# #2847 review corrections after the fourth captured main

This supplemental record preserves the original ledger and every earlier supplemental artifact unchanged. The immutable launch baseline remains `59586efd26afd32a27c999ac8bcce102777e40e4`. The reviewed reader checkpoint is `98acef56143df33311536a23a9ea95d796a61ed9`; its captured upstream is `7b2bf523216448ad4efb4b2e1c1e52fbcf0c2e12`.

## Authentication correction

The migrated authentication page first appeared in PR revision `24f58842493deb8ec15dea44ef7e25936feeea60`. Its old instructions skipped the authentication-method selector and treated configuration status as a provider-access check. At the captured upstream, `packages/coding-agent/src/modes/interactive/interactive-auth-routing.ts` opens `Select authentication method:` before the provider picker. The picker reads credential status through `getProviderAuthStatus`; it does not send a provider request. The active guide now names both method choices, distinguishes configuration from connectivity, and uses a successful prompt as the request-specific access check.

The complete superseded page below is copied from checkpoint `98acef56143df33311536a23a9ea95d796a61ed9:packages/coding-agent/docs/getting-started/authentication.md`. It is historical evidence, not current setup guidance.

````markdown
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
````

## SDK image correction

The invalid nested `source` object was inherited from `c4cb45d34fa8021633f34590e5e75ddc24f3178a`, rather than introduced by this migration. At captured upstream, `PromptOptions.images` in `packages/coding-agent/src/core/agent-session-types.ts` is `ImageContent[]`; `packages/ai/src/types.ts` defines the flat fields `type`, `data`, and `mimeType`. The active example uses those fields without changing runtime behavior.

This complete superseded prompt example is copied from checkpoint `98acef56143df33311536a23a9ea95d796a61ed9:packages/coding-agent/docs/sdk.md`, lines 276–288. It is retained for provenance, not for copying into a current integration.

```typescript
// Basic prompt (when not streaming)
await session.prompt("What files are here?");

// With images
await session.prompt("What's in this image?", {
  images: [{ type: "image", source: { type: "base64", mediaType: "image/png", data: "..." } }]
});

// During streaming: must specify how to queue the message
await session.prompt("Stop and do this instead", { streamingBehavior: "steer" });
await session.prompt("After you're done, also check X", { streamingBehavior: "followUp" });
```

## Compatible fragments

Review of the actual Mintlify 4.2.731 renderer found eight frozen inventory fragments absent both in the premerge hosted preview and in the reviewed local checkpoint. These are inventory/rendering discrepancies, not demonstrated migration regressions. Explicit compatible IDs now supplement the existing headings. No heading, prose, numbered example, table, or code block is replaced.

| Reader page | Added fragment |
| --- | --- |
| `compaction.md` | `what-verbatim-means` |
| `models/artificial-analysis-index.md` | `role-benchmark-map` |
| `session-format.md` | `base-message-types-from-bastani/pi-ai` |
| `workflows/authoring.md` | `type-unsafe-t-escape-hatch-for-deeply-nested-values` |
| `workflows/reliable-design.md` | `1-classify-and-act` |
| `workflows/reliable-design.md` | `2-fan-out-and-synthesize` |
| `workflows/reliable-design.md` | `4-generate-and-filter` |
| `workflows/reliable-design.md` | `7-constructive-quorum` |

The original 1,023-entry inventory remains untouched. The workflow learning-path structure remains unchanged. The compatible IDs add destinations for the frozen inventory spellings without removing the renderer's existing destinations.

## Preservation checks and remaining acceptance

`2847-review-repairs.json` records only these exact approved before/after edits. The verifier pins that policy and this historical record independently; changing the files and their internal metadata cannot authorize another edit. Each before-text must occur once in the immutable checkpoint. The verifier reverses the repairs before running every earlier source and connective-content proof, then reconstructs the checkpoint byte-for-byte and applies the repairs forward. The new historical copies are separately compared with their immutable source.

Working-tree mode always checks this layer. Committed mode applies it only to descendants of the checkpoint, leaving verification of that checkpoint and earlier revisions intact. Negative controls cover reverted or changed corrections, missing IDs, altered history, invented policy and unrelated reader edits.

This record does not claim rendered-fragment verification or generated-output acceptance. A fresh exact-candidate rendered comparison remains required. Hosted `llms.txt` and `llms-full.txt` also require an identified updated PR preview; the old preview cannot prove this candidate, and its observed `llms-full.txt` 404 must still be investigated. No push or deployment is part of these corrections.
