---
title: Compaction reference
sidebarTitle: "Compaction internals"
description: Compaction parameters, persistence, extension hooks, formats, settings, and historical formats.
---

# Compaction reference

## Parameters

The effective parameters appear in extension events and successful results:

| Parameter | Default | Meaning |
|---|---:|---|
| `compression_ratio` | `0.5` | Fraction of compactable **lines to keep**, not a token ratio |
| `preserve_recent` | `2` | Exact number of newest context-visible messages protected client-side |
| `query` | Last visible user message | Relevance focus for deciding which older lines to retain |

`preserve_recent` counts context-visible messages without aligning the boundary to a user turn. An assistant message or tool result may therefore begin the kept tail. Because such a tail can start or end mid-turn, the kept messages are not replayed as structured message blocks: they are serialized with the same transcript grammar as the compacted region and appended to the end of the boundary string, so the whole boundary reaches the provider as one message. Serialization of the kept tail is lossless — tool results keep their full text instead of being truncated at 16k characters, and images stay attached as image blocks rather than becoming `[image]` markers — so protected content is preserved, not merely summarized. A value of `0` protects no messages and makes the entire active transcript compactable. If `query` is absent, Atomic derives it from the last visible user message.

One consequence is worth stating for Claude models that sign their reasoning. Because the kept tail is serialized into the boundary string rather than replayed as structured assistant messages, no `thinking` or `redacted_thinking` block survives a compaction boundary. Compaction therefore **intentionally resets the signed reasoning chain**: reasoning produced before a boundary is not carried across it. This is deliberate, and it is the first of the two remedies Anthropic documents for keep-tail compaction — carry the text and tool calls across, leave the thinking blocks behind — reached structurally rather than by a stripping pass. The tail's own content is unaffected: text, tool calls, and tool results cross the boundary losslessly. See [Preserved thinking and model switches](/models/reference#preserved-thinking-and-model-switches) for how Atomic handles prefix changes *between* boundaries, which is a separate mechanism.

The query is used whole and is never truncated. This matters for structured prompts: a truncated query would make section order the retention policy, because only the leading section could influence what the planner kept, and a constraint stated later in the prompt could not. Long queries are safe — an oversized planner request surfaces as an explicit provider-overflow failure rather than silent truncation — but `keepContext` tags, not query length, are the way to guarantee a span survives.

Configure defaults in `~/.atomic/agent/settings.json` or `.atomic/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "compression_ratio": 0.5,
    "preserve_recent": 2,
    "query": "optional focus"
  }
}
```

`reserveTokens` controls the automatic threshold that decides when compaction runs; it is not converted into a classifier line ratio. Manual calls can pass parameter overrides through the SDK.

### Per-model budgets

Use `compaction.modelOverrides` to set `reserveTokens` and/or `preserve_recent` for an exact `"provider/modelId"` key. For example:

```json
{
  "compaction": {
    "reserveTokens": 16384,
    "preserve_recent": 2,
    "modelOverrides": {
      "anthropic/claude-sonnet-4-5": { "reserveTokens": 32768, "preserve_recent": 4 }
    }
  }
}
```

Each field falls back independently to the ordinary setting, then its built-in default. Keys are case-sensitive and do not support wildcards or reasoning suffixes. Both fields require non-negative safe integers. The active session model selects the budgets for manual, automatic, overflow, and post-tool compaction; switching models changes the next resolution, while borrowing a fallback planner does not. Explicit manual parameters take precedence over resolved defaults.

Atomic intentionally differs from upstream pi: the recent-history override is an exact message count (`preserve_recent`), not a token budget (`keepRecentTokens`). Verbatim line reconstruction, `compression_ratio`, and `query` are unchanged; the latter two and `enabled` remain ordinary settings. See [Settings](/settings#compaction) for merge and validation details.

## Persistence and resume

A successful run appends the existing pi-style `type:"compaction"` entry shape:

```json
{
  "type": "compaction",
  "id": "c1",
  "parentId": "m9",
  "timestamp": "2026-07-13T10:00:00.000Z",
  "summary": "[User]: fix the failing test\n(filtered 42 lines)\n[Assistant]: Fixed.",
  "firstKeptEntryId": "m7",
  "tokensBefore": 51234,
  "details": {
    "strategy": "verbatim-lines",
    "promptVersion": 3,
    "rung": "planned",
    "parameters": {"compression_ratio": 0.5, "preserve_recent": 2, "query": "fix the failing test"},
    "stats": {"linesBefore": 812, "linesDeleted": 417, "linesKept": 395, "rangeCount": 63, "tokensBefore": 51234, "tokensAfter": 24980, "percentReduction": 51.2}
  }
}
```

`details.rung` is one of `"planned"` (a model ranked the lines — the session model **or** a borrowed fallback, including silent partial recovery), `"extension"` (a `session_before_compact` override), or `"fresh"` (the compactable conversation was discarded and a new context window started). `details.plannerModel` is present **only** when a borrowed fallback model ranked the lines:

```json
"details": {
  "strategy": "verbatim-lines",
  "promptVersion": 3,
  "rung": "planned",
  "plannerModel": {"provider": "openai", "id": "gpt-5.1", "thinkingLevel": "high"}
}
```

There is no format-version bump and no new entry type. Both `"fresh"` and `plannerModel` are additive: they are absent on every existing entry and on any compaction that used the session model, so old readers are unaffected. A `"fresh"` boundary that had to drop the `preserve_recent` tail persists `firstKeptEntryId: null`.

A `compaction` entry is active only when `details.strategy === "verbatim-lines"`. On rebuild, Atomic emits one visible custom-role boundary message: the durable `summary` with the kept tail—the entries from `firstKeptEntryId` up to the boundary—serialized and concatenated onto its end. The tail is never restored as separate assistant/tool-result blocks, so a tail that starts or ends mid-turn cannot produce out-of-order provider blocks; images inside the tail ride along as image blocks on that same boundary message. When no pre-boundary context-visible message is retained—such as with `preserve_recent: 0`—`firstKeptEntryId` is `null` and the boundary carries the `summary` alone. Messages appended after the boundary are always replayed as real messages. The boundary is converted to a user-role provider message and shown in the TUI as a collapsible compaction card.

Resume does not rerun planning or re-derive deletions: the exact compacted string and nullable tail boundary are already in JSONL. Existing records with a string `firstKeptEntryId` keep their original resume behavior. Legacy `context_compaction` logical-deletion records and old `compaction` summary records without the discriminator are inert archival data. Their historical omissions are not reapplied when an old session resumes.

## Extension hooks

### `session_before_compact`

Extensions may cancel or provide a complete replacement for the prepared region:

```typescript
pi.on("session_before_compact", async (event) => {
  const { reason, parameters, preparation, branchEntries, signal } = event;
  if (signal.aborted) return { cancel: true };

  // Optional offline override. It must contain non-whitespace text.
  if (reason === "manual" && branchEntries.length > 100) {
    return { compactedText: preparation.region.lines.slice(0, 40).join("\n") };
  }
});
```

`preparation` is a deep-frozen clone. An override changes only the compacted region text; Atomic retains the prepared boundary and persists the supplied text verbatim. Empty/whitespace text is rejected. The override path does not require provider credentials.

### `session_compact`

After persistence, Atomic emits an observe-only event:

```typescript
pi.on("session_compact", async (event) => {
  console.log(event.result.rung, event.result.stats);   // rung: "planned" | "extension" | "fresh"
  console.log(event.result.plannerModel);               // set only when a fallback model was borrowed
  console.log(event.compactionEntry.details.strategy);  // "verbatim-lines"
  console.log(event.fromExtension);
});
```

Observer errors are isolated and cannot roll back the already-persisted boundary.

### `session_compact_failed`

A failed or cancelled manual, threshold, or overflow compaction emits an observe-only failure event:

```typescript
pi.on("session_compact_failed", async (event) => {
  console.log(event.reason, event.errorMessage);
  console.log(event.aborted, event.willRetry, event.fromExtension);
});
```

`errorMessage` is absent for cancellation. `fromExtension` identifies failures after a `session_before_compact` handler supplied replacement text; no compaction boundary is persisted.

## Branch Summary Format

Branch summarization uses a structured format:

```markdown
## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements mentioned by user]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data needed to continue]

<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### Message Serialization for Branch Summaries

Before branch summarization, messages are serialized to text via [`serializeConversation()`](https://github.com/bastani-inc/atomic/blob/main/packages/coding-agent/src/core/compaction/utils.ts):

```text
[User]: What they said
[Assistant thinking]: Internal reasoning
[Assistant]: Response text
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: Output from tool
```

This prevents the model from treating it as a conversation to continue.

Tool results are truncated to 2000 characters during serialization. Content beyond that limit is replaced with a marker indicating how many characters were truncated.

## Extension Hooks for Branch Summarization

### session_before_tree

Fired before `/tree` navigation. Always fires regardless of whether user chose to summarize. Can cancel navigation or provide custom summary.

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;

  // preparation.targetId - where we're navigating to
  // preparation.oldLeafId - current position (being abandoned)
  // preparation.commonAncestorId - shared ancestor
  // preparation.entriesToSummarize - entries that would be summarized
  // preparation.userWantsSummary - whether user chose to summarize

  // Cancel navigation entirely:
  return { cancel: true };

  // Provide custom summary (only used if userWantsSummary is true):
  if (preparation.userWantsSummary) {
    return {
      summary: {
        summary: "Your summary...",
        details: { /* custom data */ },
      }
    };
  }
});
```

See `SessionBeforeTreeEvent` and `TreePreparation` in the types file.

## Settings

Configure compaction in `~/.atomic/agent/settings.json` or `<project-dir>/.atomic/settings.json` (legacy `.pi` paths are also supported):

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Enable automatic Verbatim Compaction. |
| `reserveTokens` | `16384` | Tokens to reserve for the next LLM response; threshold auto-compaction starts when completed-response usage or a prospective post-tool context exceeds the model's effective input budget minus this reserve. It is an **input-side** reserve only and never caps planner output. |

Compaction has no configuration key of its own for fallback borrowing: it reuses `settings.fallbackModels`, the same ordered `provider/model[:thinkingLevel]` list that main-chat model fallback walks. With no `fallbackModels` configured, compaction behaves as before: one planner model, then either an honest failure (recoverable) or a fresh context window (load-bearing).

Disable auto-compaction with `"enabled": false`. You can still compact manually with `/compact`.

## Historical formats

Two old formats remain parseable but inactive:

- `type:"context_compaction"` records store logical entry/content-block deletion targets from older versions. Those records are inert, so content they once hid can re-enter context when an old session resumes.
- `type:"compaction"` without `details.strategy: "verbatim-lines"` stored generated summary prose. Those records also remain inert.

Both are distinguished from active boundaries by the discriminated `details` on the shared `CompactionEntry` shape; the session format version is the same for all of them.
