> Atomic can create extensions. Ask it to build one for your use case.

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

Atomic also ships an environment-gated [Herdr reporter](/herdr). It combines settled agent activity, extension prompt events, and observed workflow roots under one parent pane owner. It defers to loaded community or legacy reporters and can be disabled with `herdr.enabled` in settings. See [Herdr setup](/herdr#setup) for the supported version and [status indicators](/herdr#status-indicators) for reported activity.

## Where to go next

Extensions are TypeScript modules that add tools, commands, event handlers, and custom UI. Read this page for startup behavior, locations, imports, and a first extension, then continue:

- [Writing extensions](/extensions/authoring) — build one, manage its state, and register custom tools.
- [Extension events](/extensions/events) — every event, its payload, and its return contract.
- [Extension UI](/extensions/ui) — render custom UI from an extension.
- [Extension API reference](/extensions/api-reference) — `ExtensionContext`, `ExtensionCommandContext`, `ExtensionAPI` methods, and error handling.
- [Extension examples](/extensions/examples) — runnable examples shipped with Atomic.
- [Security](/security) — the project-trust boundary that decides whether a project's extensions load, and what an extension can reach once it does. Read this before installing an extension you did not write.

If an extension is heavier than you need, compare the lighter mechanisms on [Build with Atomic](/build).

## Table of Contents

- [Startup and lazy discovery](/extensions#startup-and-lazy-discovery)
- [Interactive callback isolation](/extensions#interactive-callback-isolation)
- [Quick Start](/extensions#quick-start)
- [Extension Locations](/extensions#extension-locations)
- [Available Imports](/extensions#available-imports)
- [Writing an Extension](/extensions/authoring#writing-an-extension)
  - [Extension Styles](/extensions/authoring#extension-styles)
- [Events](/extensions/events#events)
  - [Lifecycle Overview](/extensions/events#lifecycle-overview)
  - [Resource Events](/extensions/events#resource-events)
  - [Session Events](/extensions/events#session-events)
  - [Agent Events](/extensions/events#agent-events)
  - [Model Events](/extensions/events#model-events)
  - [Tool Events](/extensions/events#tool-events)
- [Workflow activity and lifecycle hooks](/extensions/events#workflow-activity-and-lifecycle-hooks)
- [ExtensionContext](/extensions/api-reference#extensioncontext)
- [ExtensionCommandContext](/extensions/api-reference#extensioncommandcontext)
- [ExtensionAPI Methods](/extensions/api-reference#extensionapi-methods)
- [State Management](/extensions/authoring#state-management)
  - [Session-scoped in-memory state](/extensions/authoring#session-scoped-in-memory-state)
- [Custom Tools](/extensions/authoring#custom-tools)
- [Custom UI](/extensions/ui#custom-ui)
- [Error Handling](/extensions/api-reference#error-handling)
- [Mode Behavior](/extensions#mode-behavior)
- [Examples Reference](/extensions/examples#examples-reference)

## Startup and lazy discovery

Atomic keeps the interactive startup path responsive by registering lightweight command/tool wrappers first and deferring noncritical discovery work until after the session is usable. Built-in MCP, workflow, subagent, web-access, and Intercom extensions expose their public commands/tools immediately, but expensive server connections, workflow module evaluation, result-watcher priming, cleanup scans, and browser/provider loading may run in the background or on first explicit use. Commands such as `/workflow list`, named workflow runs/inputs, failed or durable workflow resume, `/mcp`, direct MCP tool calls, `mcp({ search })`, `mcp({ describe })`, `mcp({ server })`, and explicit reload/setup flows still wait for the resources they need before returning results; cold-cache MCP proxy `describe` first narrows hydration to prefix-matched or explicitly requested servers without starting unrelated servers after a prefix-directed miss, cold-cache unscoped MCP proxy `search` intentionally hydrates all uncached lazy servers so it can search the full configured tool set, env-selected MCP direct tools warm only their selected servers and refresh live tool registration when ready, paused live-workflow resume/pickers bypass full workflow discovery, autocomplete falls back to current/admin completions when lazy discovery fails, and workflow session restore reads only lightweight config during `session_start` so persisted-run settings apply without evaluating workflow modules.

Web-access and Intercom first-use calls await one shared lazy initializer plus the latest active lifecycle replay before executing. Failed initializer/replay attempts remain retryable. Session-scoped leases retire candidates synchronously on shutdown, reject calls spanning teardown, and require fresh initialization after restart; shutdown awaits retired replay/initializer cleanup before the extension instance can be replaced, and Intercom serializes replay with live lifecycle forwarding so matching ends and newer model selections cannot be overtaken by stale replay. Aborting one web-access caller during a shared wait does not cancel initialization for other callers, and host abort after provider/curator execution preserves the exact abort reason while explicit curator user cancellation remains result-shaped. Non-empty `web_search`/`fetch_content` batches with no successful items are marked as tool errors with stage diagnostics; partial successes remain successful and retain their completed items.

Bundled MCP startup, proxy calls, direct tools, and readiness-critical commands share a generation-scoped initializer and exact session lease. Failed background attempts remain retryable and single-flight; stale contexts cannot reuse initialized state; commands keep the state they initialized across lazy imports; and direct/proxy operations revalidate ownership after lifecycle-spanning waits and before metadata or SDK side effects. Caller cancellation races readiness, connection, manager-close, and UI-start waits with the exact reason, closes any UI runtime produced after cancellation, and does not cancel shared producers needed by survivors. Session restart/shutdown retires OAuth ownership immediately and uses bounded, observed cleanup so non-abortable SDK work cannot permanently block replacement sessions while late completion remains fenced. SDK-supported resource/tool requests still receive the call signal, though protocol-level remote cancellation is advisory; UI-backed MCP Apps calls preserve terminal cancellation ordering and keep successful result events mutually exclusive. Per-server `timeoutMs` applies a validated local-or-remote MCP tool-call inactivity limit at every call path while composing with the host abort signal; progress resets that timer, so a continuously reporting tool can run indefinitely, and omitting the field keeps the MCP SDK default.

## Interactive callback isolation

Interactive Atomic sessions run the agent engine, extensions, tools, hooks, workflow code, and extension-owned render components in a supervised child process. The terminal host owns stdin and cached rendering, so a synchronous busy loop in one callback cannot stop keyboard handling, spinners, or render scheduling. The engine sends a heartbeat every 50 ms; Atomic identifies the active callback after a 250 ms heartbeat gap and marks the engine unresponsive after one second.

Escape requests the engine's own cooperative cancellation and waits for it, for as long as the engine takes. There is no deadline on that wait, and Escape never terminates or replaces the engine, so an interrupt cannot discard in-flight tool state.

Ctrl+C is the host's escape hatch, and it applies in two distinct situations.

The first is a remote custom UI. While an engine-owned `ctx.ui.custom()` component or overlay holds input, every key is forwarded to the engine child, so a component that never resolves would trap Ctrl+C too. Ownership of the key is declared per mount:

- A component mounted with `handlesCtrlC: true` receives the press and keeps its own Skip, Close, or cancel binding. If that same component is still holding input on the next press, that press closes it, so a declared component cannot trap the keyboard either.
- A component that did not declare it is closed by the first press, through the ordinary close path: its `ctx.ui.custom()` promise resolves with `undefined`, the child is told the component closed, the editor comes back, and the engine keeps running — including any other component that generation has mounted below or above this one.

Declare `handlesCtrlC` whenever your component's hint row offers `ctrl+c` for anything. This is a migration for existing components: an extension that already bound Ctrl+C keeps that binding only by adding the option. The bundled workflow surfaces and the `/mcp`, `/mcp setup`, and MCP OAuth panels declare it. Native host selectors, dialogs, input forms, session pickers, and unrelated native overlays are unaffected: they keep Ctrl+C as their own cancel.

```typescript
await ctx.ui.custom<string | undefined>(
  (tui, theme, keybindings, done) => new PromptCard(tui, theme, done),
  { overlay: true, handlesCtrlC: true },
);
```

Both safety keys are matched by physical identity rather than by the configured `app.clear` action, so rebinding `app.clear` — even to Escape — can neither route Escape into a stop/restart branch nor take the host route away from Ctrl+C. A configured `app.clear` on any other key keeps its ordinary editor-clear behavior, and key-release events never act.

The second is an engine that is provably not answering, reported as `Interactive engine is not responding; restarting.`. That means the watchdog has called it unresponsive, a cooperative abort has been outstanding longer than that same one-second threshold, a replacement has been waiting for readiness longer than it, or a replacement failed outright. This case takes precedence over everything above: the first press terminates and replaces the engine even behind a component that declared `handlesCtrlC`, because a wedged child cannot run that component's handler either. The readiness case has no heartbeat and no watchdog diagnostic at all, so Ctrl+C is the only way out of a replacement that hangs before it becomes ready; a repeat press can stop an overdue replacement and start another, while a replacement that is still fresh is never stopped by a stray press. A failed replacement keeps Ctrl+C armed indefinitely, so recovery stays available without Atomic ever retrying on its own.

If an engine generation dies for any reason (crash, SIGKILL, closed stdin, malformed transport, explicit stop), the host tears that generation's UI down immediately rather than waiting for the next `engine_ready`. Every mounted remote component is closed newest-first so a nested overlay never restores focus to a layer that has already gone, each `ctx.ui.custom()` promise settles, `select`/`confirm`/`input`/`editor` dialogs opened by that generation are cancelled without answering the replacement child, widget keys are released — both component-factory widgets and line widgets, and only those a newer generation has not taken over — terminal modes are reset, the editor is remounted and refocused unless a surviving native modal owns input, and the blocking inline custom-UI depth unwinds to zero. Frames that generation had buffered die with it, so a mount frame from a dead child can never remount UI into the replacement, and a child that exits during the startup window — after it reported ready but before the host finished attaching — is still recovered rather than leaving a live TUI bound to a dead engine. Atomic then makes one automatic replacement attempt and reports `Interactive engine stopped unexpectedly; restarting. Cause (<kind>): <summary>.`; the bounded summary retains the process exit code or signal when available but never includes child stderr, which may contain provider output or secrets. A failed replacement reports `Interactive engine restart failed: …`, leaves the editor usable, and stays recoverable with Ctrl+C. A child that dies while that replacement is still starting does not trigger another automatic attempt either — it simply keeps Ctrl+C armed. A submission the engine never accepted is returned to the editor as a draft instead of being discarded — exactly as it was typed, including surrounding whitespace and expanded paste content, placed ahead of anything typed while the send was still pending and separated by a blank line. Submissions still queued behind it come back with it, in the order they were entered. Each submission carries its own draft, so two entries that differ only in whitespace can never restore each other's text. A restored draft is the whole report: Atomic does not add a red transport error beside it.

If the generation dies after an assistant tool call was persisted but before its result was recorded, reopening the inactive session derives an error result for each unanswered call. This closes the provider's tool-call/result pair and lets the transcript render, compact, and accept another prompt. The repair is not appended to the JSONL and deliberately says the result is unavailable: admitted work may have produced side effects, so inspect the filesystem or external system before retrying the command.

"Never accepted" is a correlated fact, not a guess from error text. Before a child runs anything for a request — extension hook, queue change, compaction, shell — it announces that it owns that request, and flushes the announcement first. A transport failure that arrives without an announcement means the work never started, so the exact draft comes back; a transport failure after one means the work may already have had effects, so the text stays gone and the failure is reported normally. Output is deliberately not the boundary: `!touch marker && sleep 400` changes the working tree and prints nothing, and offering it back would invite a second run. Classification is otherwise unchanged: it covers the raw stream failures a dying engine produces (`EPIPE`, `ERR_STREAM_DESTROYED`, `ERR_STREAM_WRITE_AFTER_END`) as well as an explicit stop or a missing child; the rejected error keeps its own identity and its `code`, `errno`, and `syscall` fields, with the classification carried in non-enumerable markers. Request timeouts after a successful write, RPC error responses, provider and model errors, and anything after `agent_start` are reported as before and never restore a draft.

Because the announcement is part of the ownership decision, the interactive-engine protocol version is now `2`. A host and child from different versions do not bind, rather than silently falling back to the old, unsafe policy.

An announcement can still be in the pipe when the child dies, so a dead generation gets a short settling window: its UI is torn down at once, but its stdout keeps being read and only its ownership frames are honoured, and its requests are classified once, with the error of whatever ended it. A replacement is started only after that — at most a bounded pause, so a descendant that inherited stdout and never closes it cannot delay recovery.

Session teardown fences engine recovery: disposal stops the current child, cancels an in-flight replacement, and waits for it before returning, so no engine child — and no host initialization — outlives the session that started it.

The engine child is launched with an environment that never contains Atomic's engine-only control values (engine role, host PID, guardian path, and any `--api-key` credential). They travel in an owner-only bootstrap file whose path is a private CLI argument; the child reads it once, freezes the values, and unlinks exactly that file. Recursive cleanup of the file's directory belongs to the host that created it, never to a path read from arguments. This matters for extensions: under Bun a child process spawned without an explicit `env` inherits the runtime's launch-time environment, so a value placed in the engine's environment could not be taken back by deleting it later. Because the engine never receives those values in its environment, `Bun.spawn()`, `Bun.spawnSync()`, and `node:child_process` calls from extension and hook code cannot leak them either. Passing an explicit `env` derived from `process.env` remains the recommended practice for anything an extension spawns.

Dialogs and `ctx.ui.custom()` components are proxied to the host as rendered lines with asynchronous input forwarding. Custom UI results must be JSON-safe. APIs that require a synchronous callback in the terminal process—raw `onTerminalInput` transforms, synchronous `getEditorText`, custom editor factories, autocomplete wrappers, component-factory widgets, and custom header/footer factories—are unavailable in isolated interactive mode and produce a warning rather than executing extension code in the host. Print and public RPC modes retain their existing execution model.

For session-style list pickers use `ctx.ui.hostSessionPicker(request)` instead of remote-rendering a selector through `ctx.ui.custom()`: the terminal host mounts the real built-in session selector natively, fed with JSON-safe rows (`HostSessionPickerRow`: `SessionInfo` with `createdAt`/`modifiedAt` epoch millis). Arrow-key navigation and search never cross the process boundary; only semantic events do — the returned handle exposes `result` (resolves with the selected row's `path`, or `undefined` on cancel), `update(rows)`, `error(message)`, and `close()`, and the request's `onDelete(path)` callback owns deletion (the host keeps the row until the extension replies with `update` or `error`). Every interactive host implements the identical API — in-process (no IPC) when not isolated, over the engine protocol when isolated — so callers never branch; the member is absent only on non-interactive surfaces (headless RPC, print), where commands should fail with an actionable error. See [Host-native session picker](/tui/reference#host-native-session-picker) for an example.

For structured forms use `ctx.ui.hostInputForm(request)`. It accepts JSON-safe field descriptors (`string`, `text`, `number`, `integer`, `boolean`, or `select`, each with a raw `initialValue`) and resolves to a raw string record or `undefined` on cancellation. The terminal host owns the component, focus, validation, configured-keybinding handling, and mutable text state, so Tab, arrows, editing, Enter, Escape, and Ctrl+C are host-local rather than asynchronously forwarded to the engine child. Both interactive modes expose the same optional API; headless RPC and print omit it. See [Host-native input form](/tui/reference#host-native-input-form).

## Quick Start

Create `~/.atomic/agent/extensions/my-extension.ts`:

```typescript
import type { ExtensionAPI } from "@bastani/atomic";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // React to events
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Register a custom tool
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  // Register a command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

Test with `--extension` (or `-e`) flag:

```bash
atomic -e ./my-extension.ts
```

## Extension Locations

> **Security:** Extensions run with your full system permissions and can execute arbitrary code. Only install from sources you trust.

Extensions are auto-discovered from:

| Location | Scope |
|----------|-------|
| `~/.atomic/agent/extensions/*.ts` | Global (all projects) |
| `~/.atomic/agent/extensions/*/index.ts` | Global (subdirectory) |
| `.atomic/extensions/*.ts` | Project-local |
| `.atomic/extensions/*/index.ts` | Project-local (subdirectory) |

Atomic also discovers extensions and package resources inherited from legacy `~/.pi/agent` and `.pi` configuration. When an inherited Pi extension uses the exact same tool, command, prompt, flag, or shortcut name as an extension bundled with Atomic, Atomic keeps the bundled registration and ignores only that conflicting inherited registration. Other resources from the inherited extension remain available. Interactive startup reports all such overlaps in one yellow summary; print and RPC modes apply the same winners without changing the Pi settings or package files.

This compatibility rule applies only to inherited Pi resources. Extensions configured through `.atomic` or passed explicitly with `--extension` retain the normal intentional override and load-order behavior described below.

Additional paths via `settings.json`:

```json
{
  "packages": [
    "npm:@foo/bar@1.0.0",
    "git:github.com/user/repo@v1"
  ],
  "extensions": [
    "/path/to/local/extension.ts",
    "/path/to/local/extension/dir"
  ]
}
```

To share extensions via npm or git as Atomic packages, see [Atomic packages](/packages).

## Available Imports

| Package | Purpose |
|---------|---------|
| `@bastani/atomic` | Extension types (`ExtensionAPI`, `ExtensionContext`, events) |
| `typebox` | Schema definitions for tool parameters |
| `@bastani/pi-ai` | AI utilities (`StringEnum` for Google-compatible enums) |
| `@earendil-works/pi-tui` | TUI components for custom rendering |

Registry dependencies work too. Add a `package.json` next to your extension (or in a parent directory), then install dependencies with Bun:

```bash
bun install
```

Imports from `node_modules/` are resolved automatically.

For distributed Atomic packages installed with `atomic install` (npm or git), runtime deps must be in `dependencies`. Package installation uses production dependency installs by default, so `devDependencies` are not available at runtime; when `npmCommand` is configured, git packages use plain `install` for compatibility with wrappers.

Node.js built-ins (`node:fs`, `node:path`, etc.) are also available.

## Writing an Extension

Moved to [Writing extensions](/extensions/authoring#writing-an-extension).

### Async factory functions

Moved to [Writing extensions](/extensions/authoring#async-factory-functions).

### Long-lived resources and shutdown

Moved to [Writing extensions](/extensions/authoring#long-lived-resources-and-shutdown).

### Extension Styles

Moved to [Writing extensions](/extensions/authoring#extension-styles).

## Events

Moved to [Extension events](/extensions/events#events).

### Lifecycle Overview

Moved to [Extension events](/extensions/events#lifecycle-overview).

### Startup Events

Moved to [Extension events](/extensions/events#startup-events).

#### project_trust

Moved to [Extension events](/extensions/events#project_trust).

### Resource Events

Moved to [Extension events](/extensions/events#resource-events).

#### resources_discover

Moved to [Extension events](/extensions/events#resources_discover).

### Session Events

Moved to [Extension events](/extensions/events#session-events).

#### session_start

Moved to [Extension events](/extensions/events#session_start).

#### session_info_changed

Moved to [Extension events](/extensions/events#session_info_changed).

#### session_before_switch

Moved to [Extension events](/extensions/events#session_before_switch).

#### session_before_fork

Moved to [Extension events](/extensions/events#session_before_fork).

#### session_before_compact / session_compact / session_compact_failed

Moved to [Extension events](/extensions/events#session_before_compact-/-session_compact-/-session_compact_failed).

#### session_before_tree / session_tree

Moved to [Extension events](/extensions/events#session_before_tree-/-session_tree).

#### session_shutdown

Moved to [Extension events](/extensions/events#session_shutdown).

### Agent Events

Moved to [Extension events](/extensions/events#agent-events).

#### before_agent_start

Moved to [Extension events](/extensions/events#before_agent_start).

#### agent_start / agent_end / agent_settled

Moved to [Extension events](/extensions/events#agent_start-/-agent_end-/-agent_settled).

#### ui_prompt_start / ui_prompt_end

Moved to [Extension events](/extensions/events#ui_prompt_start-/-ui_prompt_end).

#### turn_start / turn_end

Moved to [Extension events](/extensions/events#turn_start-/-turn_end).

#### message_start / message_update / message_end

Moved to [Extension events](/extensions/events#message_start-/-message_update-/-message_end).

#### tool_execution_start / tool_execution_update / tool_execution_end

Moved to [Extension events](/extensions/events#tool_execution_start-/-tool_execution_update-/-tool_execution_end).

#### context

Moved to [Extension events](/extensions/events#context).

#### before_provider_headers

Moved to [Extension events](/extensions/events#before_provider_headers).

#### before_provider_request

Moved to [Extension events](/extensions/events#before_provider_request).

#### after_provider_response

Moved to [Extension events](/extensions/events#after_provider_response).

### Model Events

Moved to [Extension events](/extensions/events#model-events).

#### model_select

Moved to [Extension events](/extensions/events#model_select).

#### thinking_level_select

Moved to [Extension events](/extensions/events#thinking_level_select).

### Tool Events

Moved to [Extension events](/extensions/events#tool-events).

#### tool_call

Moved to [Extension events](/extensions/events#tool_call).

#### Typing custom tool input

Moved to [Extension events](/extensions/events#typing-custom-tool-input).

#### tool_result

Moved to [Extension events](/extensions/events#tool_result).

### User Bash Events

Moved to [Extension events](/extensions/events#user-bash-events).

#### user_bash

Moved to [Extension events](/extensions/events#user_bash).

### Input Events

Moved to [Extension events](/extensions/events#input-events).

#### input

Moved to [Extension events](/extensions/events#input).

## ExtensionContext

Moved to [Extension API reference](/extensions/api-reference#extensioncontext).

### ctx.ui

Moved to [Extension API reference](/extensions/api-reference#ctx-ui).

### ctx.hasUI

Moved to [Extension API reference](/extensions/api-reference#ctx-hasui).

### ctx.cwd

Moved to [Extension API reference](/extensions/api-reference#ctx-cwd).

### ctx.isProjectTrusted()

Moved to [Extension API reference](/extensions/api-reference#ctx-isprojecttrusted).

### ctx.sessionManager

Moved to [Extension API reference](/extensions/api-reference#ctx-sessionmanager).

### ctx.modelRegistry / ctx.model / ctx.scopedModels

Moved to [Extension API reference](/extensions/api-reference#ctx-modelregistry-/-ctx-model-/-ctx-scopedmodels).

### ctx.signal

Moved to [Extension API reference](/extensions/api-reference#ctx-signal).

### ctx.isIdle() / ctx.abort() / ctx.hasPendingMessages()

Moved to [Extension API reference](/extensions/api-reference#ctx-isidle-/-ctx-abort-/-ctx-haspendingmessages).

### ctx.isProjectTrusted()

Moved to [Extension API reference](/extensions/api-reference#ctx-isprojecttrusted-2).

### ctx.shutdown()

Moved to [Extension API reference](/extensions/api-reference#ctx-shutdown).

### ctx.getContextUsage()

Moved to [Extension API reference](/extensions/api-reference#ctx-getcontextusage).

### ctx.compact()

Moved to [Extension API reference](/extensions/api-reference#ctx-compact).

### ctx.getSystemPrompt()

Moved to [Extension API reference](/extensions/api-reference#ctx-getsystemprompt).

### ctx.getSkillCatalog()

Moved to [Extension API reference](/extensions/api-reference#ctx-getskillcatalog).

## ExtensionCommandContext

Moved to [Extension API reference](/extensions/api-reference#extensioncommandcontext).

### ctx.waitForIdle()

Moved to [Extension API reference](/extensions/api-reference#ctx-waitforidle).

### ctx.newSession(options?)

Moved to [Extension API reference](/extensions/api-reference#ctx-newsession-options).

### ctx.fork(entryId, options?)

Moved to [Extension API reference](/extensions/api-reference#ctx-fork-entryid-options).

### ctx.navigateTree(targetId, options?)

Moved to [Extension API reference](/extensions/api-reference#ctx-navigatetree-targetid-options).

### ctx.switchSession(sessionPath, options?)

Moved to [Extension API reference](/extensions/api-reference#ctx-switchsession-sessionpath-options).

### Session replacement lifecycle and footguns

Moved to [Extension API reference](/extensions/api-reference#session-replacement-lifecycle-and-footguns).

### ctx.reload()

Moved to [Extension API reference](/extensions/api-reference#ctx-reload).

## ExtensionAPI Methods

Moved to [Extension API reference](/extensions/api-reference#extensionapi-methods).

### pi.on(event, handler)

Moved to [Extension API reference](/extensions/api-reference#pi-on-event-handler).

### pi.registerTool(definition)

Moved to [Extension API reference](/extensions/api-reference#pi-registertool-definition).

#### Built-in tool prompt contributions

Moved to [Extension API reference](/extensions/api-reference#built-in-tool-prompt-contributions).

### pi.sendMessage(message, options?)

Moved to [Extension API reference](/extensions/api-reference#pi-sendmessage-message-options).

### pi.sendMessages(messages, options?)

Moved to [Extension API reference](/extensions/api-reference#pi-sendmessages-messages-options).

### pi.sendUserMessage(content, options?)

Moved to [Extension API reference](/extensions/api-reference#pi-sendusermessage-content-options).

### pi.appendEntry(customType, data?)

Moved to [Extension API reference](/extensions/api-reference#pi-appendentry-customtype-data).

### pi.registerEntryRenderer(customType, renderer)

Moved to [Extension API reference](/extensions/api-reference#pi-registerentryrenderer-customtype-renderer).

### pi.setSessionName(name)

Moved to [Extension API reference](/extensions/api-reference#pi-setsessionname-name).

### pi.getSessionName()

Moved to [Extension API reference](/extensions/api-reference#pi-getsessionname).

### pi.setLabel(entryId, label)

Moved to [Extension API reference](/extensions/api-reference#pi-setlabel-entryid-label).

### pi.registerCommand(name, options)

Moved to [Extension API reference](/extensions/api-reference#pi-registercommand-name-options).

### pi.getCommands()

Moved to [Extension API reference](/extensions/api-reference#pi-getcommands).

### pi.registerMessageRenderer(customType, renderer)

Moved to [Extension API reference](/extensions/api-reference#pi-registermessagerenderer-customtype-renderer).

### pi.registerMarkdownTransformer(transformer)

Moved to [Extension API reference](/extensions/api-reference#pi-registermarkdowntransformer-transformer).

### pi.registerShortcut(shortcut, options)

Moved to [Extension API reference](/extensions/api-reference#pi-registershortcut-shortcut-options).

### pi.registerFlag(name, options)

Moved to [Extension API reference](/extensions/api-reference#pi-registerflag-name-options).

### pi.exec(command, args, options?)

Moved to [Extension API reference](/extensions/api-reference#pi-exec-command-args-options).

### pi.getActiveTools() / pi.getAllTools() / pi.setActiveTools(names)

Moved to [Extension API reference](/extensions/api-reference#pi-getactivetools-/-pi-getalltools-/-pi-setactivetools-names).

### pi.setModel(model)

Moved to [Extension API reference](/extensions/api-reference#pi-setmodel-model).

### pi.getThinkingLevel() / pi.setThinkingLevel(level)

Moved to [Extension API reference](/extensions/api-reference#pi-getthinkinglevel-/-pi-setthinkinglevel-level).

### pi.events

Moved to [Extension API reference](/extensions/api-reference#pi-events).

### Native providers

Moved to [Extension API reference](/extensions/api-reference#native-providers).

### pi.registerProvider(name, config)

Moved to [Extension API reference](/extensions/api-reference#pi-registerprovider-name-config).

### pi.unregisterProvider(name)

Moved to [Extension API reference](/extensions/api-reference#pi-unregisterprovider-name).

## State Management

Moved to [Writing extensions](/extensions/authoring#state-management).

### Session-scoped in-memory state

Moved to [Writing extensions](/extensions/authoring#session-scoped-in-memory-state).

## Custom Tools

Moved to [Writing extensions](/extensions/authoring#custom-tools).

### Tool Definition

Moved to [Writing extensions](/extensions/authoring#tool-definition).

#### Constrained sampling

Moved to [Writing extensions](/extensions/authoring#constrained-sampling).

### Fireworks deferred tool loading

Extensions making requests directly through `@bastani/pi-ai` can use native deferred tool loading with Fireworks `anthropic-messages` models. Supply the tool definitions in `context.tools` and record newly loaded tool names in the loader result's `addedToolNames` field. The provider serializes deferred definitions with `defer_loading` and inserts `tool_reference` content at the load point.

Name the loader `ToolSearch` or `tool_search` to keep deferred schemas out of the initial prompt prefix. Other names work, but Fireworks includes the schemas in the prefix and loses that cache benefit. Fireworks GLM models and Kimi K3 still use Chat Completions; this feature does not change their routing.

This is an AI SDK capability. Atomic's `pi.setActiveTools()` updates the active tool list but does not automatically populate `addedToolNames`. See the [AI SDK deferred tool-loading guide](https://github.com/bastani-inc/atomic/blob/main/packages/ai/README.md#fireworks-deferred-tools) for details.

### Overriding Built-in Tools

Moved to [Writing extensions](/extensions/authoring#overriding-built-in-tools).

### Remote Execution

Moved to [Writing extensions](/extensions/authoring#remote-execution).

### Output Truncation

Moved to [Writing extensions](/extensions/authoring#output-truncation).

### Multiple Tools

Moved to [Writing extensions](/extensions/authoring#multiple-tools).

### Custom Rendering

Moved to [Writing extensions](/extensions/authoring#custom-rendering).

#### renderCall

Moved to [Writing extensions](/extensions/authoring#rendercall).

#### renderResult

Moved to [Writing extensions](/extensions/authoring#renderresult).

#### Keybinding Hints

Moved to [Writing extensions](/extensions/authoring#keybinding-hints).

#### Best Practices

Moved to [Writing extensions](/extensions/authoring#best-practices).

#### Fallback

Moved to [Writing extensions](/extensions/authoring#fallback).

## Custom UI

Moved to [Extension UI](/extensions/ui#custom-ui).

### Dialogs

Moved to [Extension UI](/extensions/ui#dialogs).

#### Timed Dialogs with Countdown

Moved to [Extension UI](/extensions/ui#timed-dialogs-with-countdown).

#### Manual Dismissal with AbortSignal

Moved to [Extension UI](/extensions/ui#manual-dismissal-with-abortsignal).

### Widgets, Status, and Footer

Moved to [Extension UI](/extensions/ui#widgets-status-and-footer).

### Autocomplete Providers

Moved to [Extension UI](/extensions/ui#autocomplete-providers).

### Custom Components

Moved to [Extension UI](/extensions/ui#custom-components).

#### Overlay Mode (Experimental)

Moved to [Extension UI](/extensions/ui#overlay-mode-experimental).

### Custom Editor

Moved to [Extension UI](/extensions/ui#custom-editor).

### Message Rendering

Moved to [Extension UI](/extensions/ui#message-rendering).

### Theme Colors

Moved to [Extension UI](/extensions/ui#theme-colors).

## Error Handling

Moved to [Extension API reference](/extensions/api-reference#error-handling).

## Mode Behavior

| Mode | UI Methods | Notes |
|------|-----------|-------|
| Interactive | Full TUI | Normal operation |
| RPC (`--mode rpc`) | JSON protocol | Host handles UI, see [RPC mode](/rpc) |
| JSON (`--mode json`) | No-op | Event stream to stdout, see [JSON mode](/json) |
| Print (`-p`) | No-op | Extensions run but can't prompt |

In non-interactive modes, check `ctx.hasUI` before using UI methods.

## Examples Reference

Moved to [Extension examples](/extensions/examples#examples-reference).

## Workflow activity and lifecycle hooks

Moved to [Extension events](/extensions/events#workflow-activity-and-lifecycle-hooks).
