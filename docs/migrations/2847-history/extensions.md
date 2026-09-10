# Historical extensions documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: extensions::002 -->

Source: `packages/coding-agent/docs/extensions.md` lines 3–31 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions.md#extensions`.

# Extensions

Extensions are TypeScript modules that extend Atomic's behavior. They can subscribe to lifecycle events, register custom tools callable by the LLM, add commands, and more.

> **Placement for /reload:** Put extensions in `~/.atomic/agent/extensions/` (global) or `.atomic/extensions/` (project-local) for auto-discovery; legacy `.pi` paths remain supported. Use `atomic -e ./path.ts` only for quick tests. Extensions in auto-discovered locations can be hot-reloaded with `/reload`.

**Key capabilities:**
- **Custom tools** - Register tools the LLM can call via `pi.registerTool()`
- **Event interception** - Block or modify tool calls, inject context, observe/cancel deletion-only compaction, and customize branch summaries
- **User interaction** - Prompt users via `ctx.ui` (select, confirm, input, notify)
- **Custom UI components** - Full TUI components with keyboard input via `ctx.ui.custom()` for complex interactions
- **Custom commands** - Register commands like `/mycommand` via `pi.registerCommand()`
- **Session persistence** - Store state that survives restarts via `pi.appendEntry()`
- **Reload-surviving state** - Keep in-memory objects alive across `/reload` via `sessionScopedExtensionState()`
- **Custom rendering** - Control how tool calls/results and messages appear in TUI

**Example use cases:**
- Permission gates (confirm before `rm -rf`, `sudo`, etc.)
- Git checkpointing (stash at each turn, restore on branch)
- Path protection (block writes to `.env`, `node_modules/`)
- Compaction policies (cancel compaction or provide exact deletion targets)
- Conversation summaries (see `summarize.ts` example)
- Interactive tools (questions, wizards, custom dialogs)
- Stateful tools (todo lists, connection pools)
- External integrations (file watchers, webhooks, CI triggers)
- Games while you wait (see `snake.ts` example)

See [examples/extensions/](https://github.com/bastani-inc/atomic/tree/main/packages/coding-agent/examples/extensions) for working implementations.

<!-- baseline-block: extensions::003 -->

Source: `packages/coding-agent/docs/extensions.md` lines 32–58 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions.md#table-of-contents`.

## Table of Contents

- [Startup and lazy discovery](#startup-and-lazy-discovery)
- [Interactive callback isolation](#interactive-callback-isolation)
- [Quick Start](#quick-start)
- [Extension Locations](#extension-locations)
- [Available Imports](#available-imports)
- [Writing an Extension](#writing-an-extension)
  - [Extension Styles](#extension-styles)
- [Events](#events)
  - [Lifecycle Overview](#lifecycle-overview)
  - [Resource Events](#resource-events)
  - [Session Events](#session-events)
  - [Agent Events](#agent-events)
  - [Model Events](#model-events)
  - [Tool Events](#tool-events)
- [ExtensionContext](#extensioncontext)
- [ExtensionCommandContext](#extensioncommandcontext)
- [ExtensionAPI Methods](#extensionapi-methods)
- [State Management](#state-management)
  - [Session-scoped in-memory state](#session-scoped-in-memory-state)
- [Custom Tools](#custom-tools)
- [Custom UI](#custom-ui)
- [Error Handling](#error-handling)
- [Mode Behavior](#mode-behavior)
- [Examples Reference](#examples-reference)

<!-- baseline-block: extensions::009 -->

Source: `packages/coding-agent/docs/extensions.md` lines 221–251 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions/authoring.md#writing-an-extension`.

## Writing an Extension

An extension exports a default factory function that receives `ExtensionAPI`. The factory can be synchronous or asynchronous:

```typescript
import type { ExtensionAPI } from "@bastani/atomic";

export default function (pi: ExtensionAPI) {
  // Subscribe to events
  pi.on("event_name", async (event, ctx) => {
    // ctx.ui for user interaction
    const ok = await ctx.ui.confirm("Title", "Are you sure?");
    ctx.ui.notify("Done!", "info");
    ctx.ui.setStatus("my-ext", "Processing...");  // Footer status
    ctx.ui.setWidget("my-ext", ["Line 1", "Line 2"]);  // Widget above editor (default)
  });

  // Register tools, commands, shortcuts, flags
  pi.registerTool({ ... });
  pi.registerCommand("name", { ... });
  pi.registerShortcut("ctrl+x", { ... });
  pi.registerFlag("my-flag", { ... });
}
```

Editable user, project, and package extensions and user workflows are loaded through [jiti](https://github.com/unjs/jiti), so TypeScript works without compilation. `/reload` uses content-hash invalidation across the complete imported file graph: an unchanged graph can reuse its evaluated factory, while a direct edit or a transitive dependency edit re-evaluates that extension's modules.

In Bun compiled or bundled single-file builds, Atomic's five fixed installed builtin extension bundles (workflows, subagents, MCP, web access, and Intercom) take a separate startup path. Atomic installs its live host-module bridge, imports each precompiled bundle natively once, and reuses the evaluated factory across `/reload`. This avoids jiti source reads, transforms, hashing, and graph manifests for immutable shipped code. A builtin bundle's module-scoped state is therefore **not** re-evaluated by `/reload` in those builds. This optimization is limited to exact installed entries of identity-verified Atomic packages; editable extensions and workflows retain the dynamic behavior above.

If the factory returns a `Promise`, Atomic awaits it before continuing startup. That means async initialization completes before `session_start`, before `resources_discover`, and before provider registrations queued via `pi.registerProvider()` are flushed.

<!-- baseline-block: extensions::014 -->

Source: `packages/coding-agent/docs/extensions.md` lines 344–416 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions/events.md#lifecycle-overview`.

### Lifecycle Overview

```
Atomic starts
  │
  ├─► project_trust (user/global and CLI extensions only, before project resources load)
  ├─► session_start { reason: "startup" }
  └─► resources_discover { reason: "startup" }
      │
      ▼
user sends prompt ─────────────────────────────────────────┐
  │                                                        │
  ├─► (extension commands checked first, bypass if found)  │
  ├─► input (can intercept, transform, or handle)          │
  ├─► (skill/template expansion if not handled)            │
  ├─► before_agent_start (can inject message, modify system prompt)
  ├─► agent_start                                          │
  ├─► message_start / message_update / message_end         │
  │                                                        │
  │   ┌─── turn (repeats while LLM calls tools) ───┐       │
  │   │                                            │       │
  │   ├─► turn_start                               │       │
  │   ├─► context (can modify messages)            │       │
  │   ├─► before_provider_request (can inspect or replace payload)
  │   ├─► after_provider_response (status + headers, before stream consume)
  │   │                                            │       │
  │   │   LLM responds, may call tools:            │       │
  │   │     ├─► tool_execution_start               │       │
  │   │     ├─► tool_call (can block)              │       │
  │   │     ├─► tool_execution_update              │       │
  │   │     ├─► tool_result (can modify)           │       │
  │   │     └─► tool_execution_end                 │       │
  │   │                                            │       │
  │   ├─► turn_end                                 │       │
  │   └─► post-tool threshold preflight            │       │
  │       (may compact before the next provider request)   │
  └─► agent_end                                            │
                                                           │
user sends another prompt ◄────────────────────────────────┘

/new (new session) or /resume (switch session)
  ├─► session_before_switch (can cancel)
  ├─► session_shutdown
  ├─► session_start { reason: "new" | "resume", previousSessionFile? }
  └─► resources_discover { reason: "startup" }

/fork or /clone
  ├─► session_before_fork (can cancel)
  ├─► session_shutdown
  ├─► session_start { reason: "fork", previousSessionFile }
  └─► resources_discover { reason: "startup" }

/compact or auto-compaction
  ├─► compaction_start / compaction_end (verbatim line-compaction status)
  ├─► session_before_compact (can cancel or provide compactedText)
  ├─► session_compact (after the compaction boundary is persisted)
  └─► session_compact_failed (failure or cancellation)

/tree navigation
  ├─► session_before_tree (can cancel or customize)
  └─► session_tree

/model or CTRL+P (model selection/cycling)
  ├─► thinking_level_select (if model change changes/clamps thinking level)
  └─► model_select

thinking level changes (settings, keybinding, pi.setThinkingLevel())
  └─► thinking_level_select

exit (CTRL+C, CTRL+D, SIGHUP, SIGTERM)
  └─► session_shutdown
```

<!-- baseline-block: extensions::029 -->

Source: `packages/coding-agent/docs/extensions.md` lines 628–641 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions/events.md#agent_start-/-agent_end-/-agent_settled`.

#### agent_start / agent_end / agent_settled

`agent_start` begins a low-level run. `agent_end` fires when that run ends, but Atomic may still retry, compact and retry, or deliver queued follow-ups. Use `agent_settled` when a status integration needs to know Atomic has no automatic continuation left.

```typescript
pi.on("agent_start", async (_event, ctx) => {});
pi.on("agent_end", async (event, ctx) => {
  // event.messages - messages from this low-level run
});
pi.on("agent_settled", async (_event, ctx) => {
  // ctx.isIdle() is true unless another extension started a run.
});
```

<!-- baseline-block: extensions::030 -->

Source: `packages/coding-agent/docs/extensions.md` lines 642–660 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions/events.md#ui_prompt_start-/-ui_prompt_end`.

#### ui_prompt_start / ui_prompt_end

These notification-only events wrap blocking user-facing extension prompts opened through `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`, `ctx.ui.editor()`, and `ctx.ui.custom()`. Each event has `reason: "ui_prompt"`, the prompt `kind`, and the prompt `title` when that method accepts one. Host and status integrations can use the pair to report that Atomic is waiting for the user instead of still working.

Atomic coalesces nested or overlapping prompts into one outer span. The end event keeps the outer prompt's kind and title and fires after every prompt in that span settles, including rejected promises and synchronous failures. Rebinding the host UI context closes an active span before a prompt from the new context can begin.

Handlers run best-effort from the microtask queue. Atomic does not await them before opening or closing the prompt, so a slow handler cannot delay the UI.

```typescript
pi.on("ui_prompt_start", (event) => {
  // event.kind - "select" | "confirm" | "input" | "editor" | "custom"
  // event.title - prompt title when available
});

pi.on("ui_prompt_end", (event) => {
  // Atomic is no longer waiting on this outer prompt span.
});
```

<!-- baseline-block: extensions::048 -->

Source: `packages/coding-agent/docs/extensions.md` lines 984–1029 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions/events.md#input`.

#### input

Fired when user input is received, after extension commands are checked but before skill and template expansion. The event sees the raw input text, so `/skill:foo` and `/template` are not yet expanded.

**Processing order:**
1. Extension commands (`/cmd`) checked first - if found, handler runs and input event is skipped
2. `input` event fires - can intercept, transform, or handle
3. If not handled: skill commands (`/skill:name`) expanded to skill content
4. If not handled: prompt templates (`/template`) expanded to template content
5. Agent processing begins (`before_agent_start`, etc.)

```typescript
pi.on("input", async (event, ctx) => {
  // event.text - raw input (before skill/template expansion)
  // event.images - attached images, if any
  // event.source - "interactive" (typed), "rpc" (API), or "extension" (via sendUserMessage)

  // Transform: rewrite input before expansion
  if (event.text.startsWith("?quick "))
    return { action: "transform", text: `Respond briefly: ${event.text.slice(7)}` };

  // Handle: respond without LLM (extension shows its own feedback)
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }

  // Route by source: skip processing for extension-injected messages
  if (event.source === "extension") return { action: "continue" };

  // Intercept skill commands before expansion
  if (event.text.startsWith("/skill:")) {
    // Could transform, block, or let pass through
  }

  return { action: "continue" };  // Default: pass through to expansion
});
```

**Results:**
- `continue` - pass through unchanged (default if handler returns nothing)
- `transform` - modify text/images, then continue to expansion
- `handled` - skip agent entirely (first handler to return this wins)

Transforms chain across handlers. See [input-transform.ts](https://github.com/bastani-inc/atomic/blob/main/packages/coding-agent/examples/extensions/input-transform.ts) and [input-transform-streaming.ts](https://github.com/bastani-inc/atomic/blob/main/packages/coding-agent/examples/extensions/input-transform-streaming.ts) for `streamingBehavior`-aware routing.

<!-- baseline-block: extensions::055 -->

Source: `packages/coding-agent/docs/extensions.md` lines 1081–1123 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions/api-reference.md#ctx-modelregistry-/-ctx-model-/-ctx-scopedmodels`.

### ctx.modelRegistry / ctx.model / ctx.scopedModels

Access models, auth state, and provider-aware requests.

Use `ctx.modelRegistry.complete()` for an extension model request that must use Atomic's provider composition. It dispatches through the active `ModelRuntime`, retaining registered custom providers and resolved request auth: the credential-specific `baseUrl`, headers (including `null` suppression markers), and environment values.

```typescript
const model = ctx.modelRegistry.find("github-copilot", "gpt-5.5");
if (!model) throw new Error("Model not found");

const response = await ctx.modelRegistry.complete(
  model,
  { messages },
  { signal: ctx.signal },
);
```

Use `getApiKeyAndHeaders()` only when an extension must inspect auth before dispatch; normal requests do not need to resolve or overlay auth themselves.

`await ctx.modelRegistry.refresh(options)` returns `{ aborted, errors }`, not just completion. `errors` is a per-provider map, so extensions can report partial refresh failures; `aborted` reports cancellation. Host integrations that call `ModelRuntime.setRuntimeApiKey(providerId, apiKey, options)` must note that it records the runtime credential but does not refresh the catalog; call `refresh({ providers: [providerId], signal })` explicitly when a fresh catalog is needed.

`ctx.scopedModels` is the read-only list of models scoped to the current session — the same set the `/scoped-models` command shows. It is resolved from the `--models` CLI flag and the `enabledModels` setting, matched against the available catalogue. It is empty when no scoping is configured, meaning every available model is usable. Each entry is `{ model, thinkingLevel? }`, where `thinkingLevel` is set only when a pattern pinned it (for example `anthropic/*:high`). Use it to populate a model picker that mirrors the built-in one instead of enumerating the whole catalogue.

The value is resolved at access time, so it tracks session replacement. Under the isolated interactive engine it reflects the engine's catalogue rather than a stale host snapshot.

It reports the scope and cannot change it. `ctx.scopedModels` is a getter with no setter, typed `readonly ScopedModel[]`, so assigning to it or pushing an entry is a compile error. The guarantee also holds at runtime, where the type does not reach: each read returns a fresh copy — of the array, of every `{ model, thinkingLevel }` entry in it, and of each entry's model — and all three are frozen. A JavaScript extension, or one that asserts the `readonly` away, therefore cannot widen the set of models the session may use by pushing an entry, nor change which model it selects by swapping one in place; the attempt throws rather than quietly working. Read it, and change scope through the commands and settings that own it.

```typescript
for (const { model, thinkingLevel } of ctx.scopedModels) {
  console.log(`${model.provider}/${model.id}${thinkingLevel ? `:${thinkingLevel}` : ""}`);
}
```

Both types are exported: `ScopedModel` for one entry, `ExtensionScopedModels` for the accessor's own type. They are declared at the public extension type path (`core/extensions/types.ts`) and re-exported from the package root, so an extension never reaches into an internal module to describe what it just read.

```typescript
import type { ExtensionScopedModels, ScopedModel } from "@bastani/atomic";

function firstScoped(scope: ExtensionScopedModels): ScopedModel | undefined {
  return scope[0];
}
```

<!-- baseline-block: extensions::068 -->

Source: `packages/coding-agent/docs/extensions.md` lines 1323–1341 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions/api-reference.md#ctx-navigatetree-targetid-options`.

### ctx.navigateTree(targetId, options?)

Navigate to a different point in the session tree:

```typescript
const result = await ctx.navigateTree("entry-id-456", {
  summarize: true,
  customInstructions: "Focus on error handling changes",
  replaceInstructions: false, // true = replace default prompt entirely
  label: "review-checkpoint",
});
```

Options:
- `summarize`: Whether to generate a summary of the abandoned branch
- `customInstructions`: Custom instructions for the summarizer
- `replaceInstructions`: If true, `customInstructions` replaces the default prompt instead of being appended
- `label`: Label to attach to the branch summary entry (or target entry if not summarizing)

<!-- baseline-block: extensions::101 -->

Source: `packages/coding-agent/docs/extensions.md` lines 2135–2209 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions/authoring.md#tool-definition`.

### Tool Definition

```typescript
import { Type } from "typebox";
import { StringEnum } from "@bastani/atomic";
import { Text } from "@earendil-works/pi-tui";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does (shown to LLM)",
  promptSnippet: "List or add items in the project todo list",
  promptGuidelines: [
    "Use my_tool for todo planning instead of direct file edits when the user asks for a task list."
  ],
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),  // Atomic's Pi-compatible TypeBox helper
    text: Type.Optional(Type.String()),
  }),
  prepareArguments(args) {
    if (!args || typeof args !== "object") return args;
    const input = args as { action?: string; oldAction?: string };
    if (typeof input.oldAction === "string" && input.action === undefined) {
      return { ...input, action: input.oldAction };
    }
    return args;
  },

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Check for cancellation
    if (signal?.aborted) {
      return { content: [{ type: "text", text: "Cancelled" }] };
    }

    // Stream progress updates
    onUpdate?.({
      content: [{ type: "text", text: "Working..." }],
      details: { progress: 50 },
    });

    // Run commands via pi.exec (captured from extension closure)
    const result = await pi.exec("some-command", [], { signal });

    // Return result
    return {
      content: [{ type: "text", text: "Done" }],  // Sent to LLM
      details: { data: result },                   // For rendering & state
      // Optional: stop after this tool batch when every finalized tool result
      // in the batch also returns terminate: true.
      terminate: true,
    };
  },

  // Optional: Custom rendering
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

**Signaling errors:** To mark a tool execution as failed (sets `isError: true` on the result and reports it to the LLM), throw an error from `execute`. Returning a value never sets the error flag regardless of what properties you include in the return object.

**Early termination:** Return `terminate: true` from `execute()` to hint that the automatic follow-up LLM call should be skipped after the current tool batch. This only takes effect when every finalized tool result in that batch is terminating. Atomic does not register `structured_output` in normal agent sessions by default; use `createStructuredOutputTool({ schema, capture, output, name })` when an extension, SDK session, or workflow stage needs a schema-backed final-answer tool. The factory uses the supplied schema as the tool parameters directly, captures the tool arguments as whatever JSON value matches the schema, emits the same pretty-printed JSON as the terminating tool-result text for `atomic -p`, optionally writes them to the configured `output.outputPath`, and terminates the turn. In text print mode, a terminating result from a factory-created structured-output tool is emitted to stdout as the final response. Custom factory names are opt-in tools: if you register `final_decision`, include `final_decision` in any explicit `tools` allowlist; if you register the default `structured_output` name, it is available only to that session/runtime.

```typescript
// Correct: throw to signal an error
async execute(toolCallId, params) {
  if (!isValid(params.input)) {
    throw new Error(`Invalid input: ${params.input}`);
  }
  return { content: [{ type: "text", text: "OK" }], details: {} };
}
```

**Important:** Use `StringEnum` from `@bastani/atomic` for string enums. It retains Pi's Google-compatible schema and composes with Atomic's direct TypeBox types; `Type.Union`/`Type.Literal` doesn't work with Google's API.

<!-- baseline-block: extensions::102 -->

Source: `packages/coding-agent/docs/extensions.md` lines 2210–2264 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/extensions/authoring.md#constrained-sampling`.

#### Constrained sampling

`ToolDefinition.constrainedSampling` is preserved for extension tools, SDK `customTools`, wrappers, and isolated execution. It accepts `false` or the exported `ConstrainedSamplingConfig`:

```typescript
pi.registerTool({
  name: "strict_edit",
  label: "Strict edit",
  description: "Edit one file",
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  constrainedSampling: { type: "json_schema", strict: "prefer" },
  async execute(_id, params) {
    return { content: [{ type: "text", text: params.path }], details: {} };
  },
});
```

Exact modes:

- `{ type: "json_schema", strict: "prefer" }` requests strict provider enforcement and falls back to ordinary tool calling when unavailable.
- `{ type: "json_schema", strict: "require" }` fails the request rather than silently weakening the constraint.
- `{ type: "grammar", variants: { openai_lark?: string, openai_regex?: string } }` requests an OpenAI custom grammar tool; Lark wins when both non-empty variants are present.
- `false` explicitly opts out. Its runtime effect matches omission, but public tool inspection preserves `false` as a present property.

Atomic preserves the optional property's exact own-key state across wrappers, active-session inspection, staged extension inspection, bundled tools, and isolated transport: omission stays absent; explicitly present `undefined` stays present; `false` and config objects remain unchanged. This distinction matters to SDK/extension code that uses `Object.hasOwn()` rather than an ordinary property read.

Grammar tools require an object schema with exactly one required string property. They are emitted only when model metadata advertises `supportsOpenAIGrammarTools` (also exposed as Atomic's `supportsGrammarTools` alias); otherwise provider handling falls back to the normal function/JSON-schema path. Older OpenAI models and gateways that rewrite schemas cannot honor custom grammar tools. Typed RPC clients receive these claims through optional `ModelInfo.compat`. See [Custom Models](/models#constrained-tool-sampling) and [RPC](/rpc#get_available_models).

**Argument preparation:** `prepareArguments(args)` is optional. If defined, it runs before schema validation and before `execute()`. Use it only when a custom tool must normalize arguments before validation. Return the object you want validated against `parameters`, keep the public schema strict, and avoid advertising deprecated fields.

```typescript
pi.registerTool({
  name: "deploy_plan",
  label: "Deploy Plan",
  description: "Create a deployment plan for one target environment",
  parameters: Type.Object({
    environment: Type.String(),
    dryRun: Type.Optional(Type.Boolean()),
  }),
  prepareArguments(args) {
    if (!args || typeof args !== "object") return args;
    const input = args as { env?: unknown; environment?: unknown; dryRun?: unknown };
    if (typeof input.environment === "string") return args;
    if (typeof input.env !== "string") return args;
    return { environment: input.env, dryRun: input.dryRun };
  },
  async execute(toolCallId, params) {
    return {
      content: [{ type: "text", text: `Planning deploy to ${params.environment}` }],
      details: {},
    };
  },
});
```
