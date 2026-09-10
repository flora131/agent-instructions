---
title: "SDK"
description: "Embed Atomic in a Node.js application."
---

> Atomic can help you use the SDK. Ask it to build an integration for your use case.

# SDK

The SDK provides programmatic access to atomic's agent capabilities. Use it to embed atomic in other applications, build custom interfaces, or integrate with automated workflows.

**Example use cases:**
- Build a custom UI (web, desktop, mobile)
- Integrate agent capabilities into existing applications
- Create automated pipelines with agent reasoning
- Build custom tools that spawn sub-agents
- Test agent behavior programmatically

See [examples/sdk/](https://github.com/bastani-inc/atomic/tree/main/packages/coding-agent/examples/sdk) for working examples from minimal to full control.

## Owner-bound task supervisor (S1)

S1 adds an SDK-only task foundation in `src/core/tasks/contracts.ts` and
`src/core/tasks/supervisor.ts`, backed by the native `TaskSupervisor`. It is an
internal trusted-host integration surface, not a new CLI command. The package root
exports the narrow `AgentTaskHost` adapter and its integration types, not the raw
supervisor. Runtime-created subagent contexts use it; bash/PTY and task UI integration are separate slices.

`AgentTaskHost` binds an actual trusted scope and mandatory `authorizeLaunch` guard.
Its `startAgentTask(intent, operation, runnerFactory)` returns a Result containing
`{taskId, lease}` after setup. Each launch supplies its own factory receiving the
original `AbortSignal`, reference and `reportActivity` context. Return separate
`result` and `cleanup` promises; yielding never replaces either promise, and only
confirmed cleanup may report `reaped`. Exact operation replay never calls another factory.
`observeAgentLaunch(taskId, policy?)` delegates to S1 initial observation; `waitForTask`,
`resolveTask`, `cancelTask`, `watchOwnerTasks` and `close` remain owner-scoped S1 doors.
Observation returns the exact Result/WaitOutcome DTO, not a new model response shape.
These APIs are for trusted first-party hosts, never model-supplied ownership or permission.

For already-admitted in-process tasks, the optional `taskExecution` runner hooks
retain the original execution and cleanup promises. An exact Intercom commit
yields the registered observation. In an explicit foreground group it also yields
active sibling observations through the existing group signal, once per child;
neither path detaches or completes those executions. Public launches in actual sessions use this bridge by default.

Each workflow admission boundary allocates one process-private stage attempt identity.
The actual stage session binds its original session/run/stage identity; fallback session
replacement keeps that identity and the same lazily bound `bindAgentTaskHost` owner.
Replacement disposal does not close tasks. Boundary sealing fences task admission and
starts owner closure; generation close awaits independent cleanup and surfaces failure.
Fresh boundaries have fresh identities, including restoration; history is not a restart
capability. Public producers, durable callback joins and nonvisual completion intent/admission use this owner binding.

When a task completion outbox is created from session history, it immediately retries
unacknowledged terminal completion intents through the current admission boundary.
It does not wait for another task to settle or recreate execution capabilities.
Acknowledged intents are not redelivered. Failed admission keeps the original completion
identity pending for retry; a closed boundary prevents admission.
Top-level session initialization restores admission keys from persisted custom messages,
so a crash after delivery is persisted but before its outbox acknowledgement does not
deliver the same completion again.

A host binds its actual session or workflow-stage scope with `bindHostSession`,
provides launch authorization and a runner factory, then calls `openTaskOwner`.
Authorization runs before native admission. `startAgentTask` registers an agent
task before runner setup and returns its lease without waiting for completion.
Exact operation replay reuses that task and execution; a fresh operation creates
a distinct task. Leases are environment-local capabilities, cannot be serialized,
and cannot be reconstructed from task IDs or historical records.

`initialObservation` applies launch policy: omitted policy yields
`default-background`, explicit background yields `explicit`, and foreground
registers a wait with its requested budget. A ready terminal result wins.
`await waitForTask(task, budgetMs?, designation?)` and
`await foregroundTask(task, budgetMs?)` return a Result containing a WaitOutcome,
not a lease. Native registration and the WaitId registry are populated synchronously
before either door awaits. Host lifecycle actions can use `findWait(waitId)` to
yield or dispose a registered observation; ordinary callers need no extra observe call.
SDK waits do not replace the host designation unless given a matching HostSession.
An elapsed/explicit yield or observer disposal never stops or relaunches execution;
a later yield of a disposed wait replays its ObserverCancelled Result.

Requested agent waits default to 30000 ms. Supply owner-host settings through
`bindHostSession({ scope, tasks: { wait: { kind: "automatic", agentBudgetMs: 5000 } },
authorizeLaunch, createRunner })`; `{ kind: "until-settled" }` disables timed yielding.
Per-call budgets override settings, including zero for immediate yield. These settings
apply to explicit foreground-first launch, live foregrounding and task-ID waits,
never to a default independent launch. Wide numeric budgets are not narrowed to u32.
Accepted `NaN` budgets (including configured `agentBudgetMs`) do not panic native
scheduling. The implementation leaves such observations pending until explicit yield,
settlement, observer disposal or owner closure: the elapsed comparison never reaches
`NaN`. It uses bounded sleep chunks without rewriting the caller's budget. This is
scheduling behavior, not a new finite-only input restriction or an RFC-mandated deadline;
other numeric budgets and per-call precedence are unchanged.

`await cancelTask(task, cause)` returns a Result containing a cancellation receipt
and preserves the first accepted cause. `closeTaskOwner` seals admission before
draining and succeeds only after independent cleanup acknowledgement. The trusted
runner supplies separate result and cleanup promises: confirmed reaping after
cancellation can close even if no result arrives. Natural cleanup-first delivery
waits for its outcome before acknowledging reaping. External native owner closure
also aborts resources attached to already-settled results without rewriting them.
Failed cleanup remains observable; absent acknowledgement can leave close pending.
User cancellation retains pending input attention until settlement or owner closure;
event-reduced and reattached snapshots report the same native facts. Runner result
rejections become failed `RunnerFailed` results; cleanup rejections become diagnostic
`CleanupFailed` resources, never successful reaping. Setup throws retain `SpawnFailed`
and unconfirmed cleanup. Strings and Error messages are preserved verbatim; other JS
values use safe string conversion, with `Unprintable JavaScript rejection` if conversion
throws. Cancelled cleanup still does not depend on the result promise settling.
This slice exercises fake runners, not force-stop or real-process cleanup guarantees.

### Supervised command SDK

`startCommandTask(owner, intent, operation)` starts an owned Unix pipe/PTY or Windows pipe/ConPTY command.
The command intent keeps execution timeout separate from observation: `waitForTask`
defaults to 10000 ms for commands, and expiry returns a yielded observation without
terminating the process. On Unix, owner closure sends TERM, allows 250 ms grace, then KILL,
reaps the leader and confirms process-group exit and reader drain. A cleanup failure
retains diagnostics instead of claiming a closed owner. This is normal owner/host
shutdown cleanup, not a guarantee for forced host death or a blocked JavaScript loop.

Both native and facade `CommandIntent` accept optional `shell: { program, args }`:
the executable is launched directly with `command` appended as one final argv argument.
Omitting `shell` preserves the default native pipe shell. `inheritEnv` defaults to
`true`; `false` uses exactly the supplied environment rather than inheriting the host's.
Both fields participate in operation replay identity.

`taskStdin(task)` returns a non-serializable stdin capability. `writeTaskInput` takes
an operation ID and `{kind:"bytes", bytes:Uint8Array}` or `{kind:"eof"}`. Empty bytes
are a no-op. Input has 65536 byte credits, refuses excess input before admission,
and replays recorded receipts without resending bytes. Ambiguous partial delivery
returns `InputDeliveryUnknown`, including operation ID and known accepted-byte count.

`readTaskOutput(task, {start, maximumBytes})` returns owned byte chunks at decimal
offsets, requested bounds, omitted ranges and an optional next offset. Requests
are clamped to the 1 MiB live-preview bound before allocating or reading a page;
use `nextOffset` to continue. It does not sanitize or normalize bytes. Retention
uses a 1 MiB live head/tail, 8 MiB foreground spill threshold and 5 GiB disk cap.
Retained output is not conversation history. File-spool policy uses supervised
pipe drains, never inherited direct file writers. Stdout, stderr and descendants
share one serialized disk budget; crossing writes retain only the permitted prefix.
The file remains within the cap during foreground collection and termination.
After foreground collection yields, rejected overflow kills the group and settles
`OutputLimitExceeded` after confirmed cleanup. Spool setup failure refuses launch
with `SpawnFailed`. Drained pipe/PTY output instead keeps running with bounded
retained bytes and omissions.
Unix PTY resize uses the retained portable-pty master; Windows PTY uses ConPTY.
Windows pipe and ConPTY commands start suspended and enter a kill-on-close Job Object
before resume. Failed containment refuses execution, with no unsupervised spawn fallback.
Cleanup must be confirmed; failures retain diagnostic resources rather than reporting reaping.
Native Windows legacy WSL `bash.exe` stdin transport remains refused for owned launch:
Windows jobs cannot supervise the Linux guest process tree. Atomic running inside WSL
uses the normal POSIX/Bash path instead.

Bash tools and `createLocalBashOperations` accept a trusted `taskOwner` binding.
On Unix and native Windows, that binding obtains pipe/PTY processes through supervised admission,
preserving configured shell arguments, cwd, environment and existing authorization.
Foreground collection honors the owner's command wait configuration, including
`until-settled`; the automatic default is 10000 ms. A yielded process stays owned
and its retained output remains readable. Bash output inserts explicit
`[Output omitted: bytes start-end]` markers, with an exclusive end offset, between
retained chunks rather than silently joining gaps. Without that binding, existing
bash and native PTY execution are unchanged. No UI is added.

`watchOwnerTasks(owner, cursor?)` provides an opaque `lease`, snapshot,
decimal-string cursor and disposable `AsyncIterable<NativeEvent>`. Each iterator
observes one contiguous delivery epoch. On local backlog overflow or native journal
reset, the subscription updates its authoritative `snapshot` and `cursor`, discards
stale queued deltas, and completes the old iterator (`next()` returns `done:true`,
including an already-pending read). This also works when an oversized final settlement
leaves no retained event, without later activity or cleanup. No synthetic reset event
is inserted and the `NativeEvent` and subscription types are unchanged.

After any iterator completion, reconcile `subscription.snapshot` at
`subscription.cursor`. If the owner is still live and observation is still wanted,
obtain another iterator from the **same** `subscription.events`; the old iterator stays
done. Reset does not dispose the subscription or close the owner. Subsequent deltas
are authentic and ordered; ignore events at or below an already-applied snapshot
cursor. Explicit `dispose()` (idempotent) or breaking out of a live iterator ends
observation, not the owner. Owner closure also ends delivery. Track your own disposal
when deciding whether to resume. New subscriptions are refused once owner closing
begins; existing subscriptions continue through cleanup/closure.
Calling `dispose()` from `onReconcile` also stops the active drain from publishing
its retained events. Pending and newly created iterators finish without those events;
the reconciled snapshot remains available.

The optional `subscription.onReconcile` callback is a convenience, not required for
correctness; callback exceptions remain visible as `subscription.failure`. Raw strings
and Error messages are preserved; unprintable values (including hostile conversion or
revoked proxies) use `Unprintable JavaScript rejection`. Diagnostic conversion cannot
interrupt event delivery or rearming the fallback poll. Native callbacks are wake hints;
journal drains and reset snapshots are authoritative. Each live subscription has one
fallback poll, stopped on disposal or observed closure.
The native byte journal and facade delivery backlog are bounded. Each task separately
retains its most recent 256 accepted activity report IDs, SHA-256 payload hashes and
receipts (`TASK_REPORT_IDENTITY_WINDOW`). Within that window, identical payloads return
`duplicate` with the original cursor; conflicting payloads return `ReportConflict`.
Neither check emits events or refreshes retention order. An evicted ID is fresh: while
the task is live it is `accepted`, applies its activity again and gets a new cursor;
existing terminal and owner-close guards still apply. Terminal outcome reports and
their recorded receipts are retained separately for the task record's lifetime and
never evicted by activity churn. This bounds identity entry count, not caller ID length,
task count, terminal payloads or total task-history memory. S1 adds no persistence layer.

Activity IDs have no reserved spellings, including `runner-outcome`, empty strings
and isolated surrogates. The facade submits its own result through private trusted
runner support: the actor selects a free terminal identity and accepts the outcome
under the same lock. With at most 256 retained activity IDs, at most 257 distinct
candidates suffice; selection emits no events and retains no extra ID history.
Caller-supplied reports still use the unchanged `reportTaskOutcome` contract:
same-ID cross-kind reports conflict, and terminal replay retains its original receipt.
The internal support also reuses an accepted terminal identity, so a different result
cannot replace it; cancellation-first still rejects late natural outcomes. Normal,
rejected and setup-failure results all use this path without bypassing cleanup evidence.

Caller-provided strings retain their exact JavaScript UTF-16 code units, including
isolated surrogates, valid pairs and embedded NUL, across scopes, intent, operation/report
identity, activity, results and nested output/cleanup metadata. They remain ordinary
`string` fields, not encoded wrappers. Replacing a surrogate with U+FFFD is a changed
payload or identity, never an exact replay. Nonempty descriptions supply the title;
otherwise the first nonblank task line is copied without rewriting its code units,
falling back to the agent name. Absent optional fields, empty strings, known zero metrics
and ordered duplicate data remain distinct. The optional `elapsedMs`, `toolCount` and `tokenCount` metrics and
completed/failed `exitCode` preserve JavaScript numbers without narrowing or normalization,
including fractional and extreme values. Within the retained activity window (and for
terminal reports throughout the task record's lifetime), exact replay distinguishes
omission, zero and negative zero; repeated NaN and infinite values acknowledge once.
Changed numeric payloads return `ReportConflict` without earning another event. `OutputRef` is
metadata, not proof of retained bytes: output
storage, `readTaskOutput`, command input, persistence, completion delivery and
real agent/Intercom integration belong to later slices. The credential-free
repository fixture `test/fixtures/task-s1-demo.ts` exercises this real facade and
native actor with one fake runner.

### Task transcript references

An admitted runner can call `context.bindTranscript(sessionManager)` with its existing
child session history. `readTaskTranscript(task, cursor?)` in `core/tasks/transcript.ts`
reads that binding through the task capability. It returns message and content-block
references, not copied text: `id`, `kind`, `source`, and `toolCallId` when applicable.
Kinds are `prompt`, `assistant`, `tool-call`, `tool-result`, and `response`.
Thinking blocks and non-conversation entries are excluded. Repeated source IDs are
deduplicated; repeated messages with different IDs remain distinct.

The first page contains up to 100 recent references in source order. Pass the opaque
`nextCursor` to read earlier references; `omittedEarlier` identifies remaining older
content. Cursors belong to one task and bound session. An unknown task returns
`UnknownTask`, a cursor from another task/session returns `ScopeMismatch`, and an
unbound or empty history returns `TranscriptUnavailable` with `Transcript unavailable`.
This adapter does not launch work or reconstruct live capabilities from history.
Production subagent runners bind their child history, and main and attached workflow
chat hosts mount the shared inspector. Command detail reads are scoped to the current
selection and view lifetime: late results and errors cannot overwrite another view.
## On this page and its reference

This page covers the SDK quick start, its core concepts, and one complete example. Options, resource loaders, return types, run modes, and exports live in the [SDK API reference](/sdk/reference).

Not sure the SDK is the right integration mode? Compare it with RPC and JSON mode on [Programmatic use](/programmatic).

## Quick Start

```typescript
import { createAgentSession, ModelRuntime, SessionManager } from "@bastani/atomic";

const modelRuntime = await ModelRuntime.create();

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

`ModelRuntime` is the canonical asynchronous provider runtime when an integration wants provider-owned credentials, dynamic catalogs, and native providers in one object:

```typescript
import { createAgentSession, ModelRuntime, SessionManager } from "@bastani/atomic";

const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});
```

`ModelRuntime.create()` accepts custom `authPath`, `modelsPath`, credential storage, and runtime auth overrides, plus the model-catalog options `allowModelNetwork`, `modelRefreshTimeoutMs`, `modelsStorePath`, and `modelsStore` (see [Model catalog persistence and refresh](/sdk/reference#model-catalog-persistence-and-refresh)). `ModelRegistry` and `AuthStorage` remain available as Atomic's synchronous compatibility facades. Use `readStoredCredential(provider, authPath?)` for a lightweight read of one stored provider credential.

Extensions supplied directly to SDK sessions can use the exported `InlineExtension` type. Extension APIs and event types include native `registerProvider(Provider)`, `registerEntryRenderer`, `entry_appended`, `before_provider_headers`, and `agent_settled`.

The package root also exports `buildContextEntries`, `sessionEntryToContextMessages`, and `CompactionEntry` for converting durable session branches into model context. The equivalent active-session operation is `sessionManager.buildContextEntries()`.

## Installation

Install `@bastani/atomic` as a project dependency with npm, pnpm, or Bun:

With npm:

```bash
npm install @bastani/atomic
```

With pnpm:

```bash
pnpm add @bastani/atomic
```

With Bun:

```bash
bun add @bastani/atomic
```

Atomic does not require package install scripts. If you want to disable dependency lifecycle scripts during the Atomic install, you can add `--ignore-scripts` to the install command.

The SDK is included in the main package. No separate SDK package is needed.

## Pi client

`@bastani/atomic/client` re-exports `@earendil-works/pi-client`. Pi 0.85 replaced the experimental `RemoteSession` lease API with its service-addressed Chord client; use the upstream client and agent service APIs for remote sessions.

## Core Concepts

### createAgentSession()

The main factory function for a single `AgentSession`.

`createAgentSession()` uses a `ResourceLoader` to supply extensions, skills, prompt templates, themes, and context files. If you do not provide one, it uses `DefaultResourceLoader` with normal user, project, and configured-package discovery. The SDK does not add optional bundled workflow, subagent, MCP, or web-access extensions by default. It always adds the lightweight ordinary Intercom extension at the model-session boundary.

```typescript
import { createAgentSession, SessionManager } from "@bastani/atomic";

// Minimal: defaults with DefaultResourceLoader
const { session } = await createAgentSession();

// Custom: override specific options
const { session } = await createAgentSession({
  model: myModel,
  tools: ["read", "bash"],
  // Or keep defaults and remove specific tools:
  // excludedTools: ["ask_user_question"],
  sessionManager: SessionManager.inMemory(),
});
```

### AgentSession

The session manages agent lifecycle, message history, model state, compaction, and event streaming.

```typescript
interface AgentSession {
  // Send a prompt and wait for completion
  prompt(text: string, options?: PromptOptions): Promise<void>;

  // Queue messages during streaming
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;

  // Controlled queue-pause gate
  readonly queuedMessagesPaused: boolean;
  pauseQueuedMessages(): void;
  resumeQueuedMessages(): Promise<boolean>;

  // Subscribe to events (returns unsubscribe function)
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;

  // Session info
  sessionFile: string | undefined;
  sessionId: string;

  // Model and thinking control
  setModel(model: Model): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  cycleModel(): Promise<ModelCycleResult | undefined>;
  cycleThinkingLevel(): ThinkingLevel | undefined;

  // State access
  agent: Agent;
  model: Model | undefined;
  thinkingLevel: ThinkingLevel;
  messages: AgentMessage[];
  isStreaming: boolean;

  // In-place tree navigation within the current session file
  navigateTree(targetId: string, options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string }): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }>;

  // Verbatim line compaction
  compact(options?: Partial<VerbatimCompactionParameters>): Promise<VerbatimCompactionResult>;
  abortCompaction(): void;

  // Abort current operation
  abort(): Promise<void>;

  // Cleanup
  dispose(): void;
}
```

`compact()` serializes older context to numbered lines, asks the session model for JSON deleted ranges, validates them, and mechanically reconstructs a durable verbatim transcript string. It appends a `compaction` entry with `details.strategy: "verbatim-lines"`; the recent tail remains ordinary messages. The model never authors replacement context text.

`session.navigateTree()` rejects during streaming, compaction, or branch summarization rather than queueing the navigation. The active branch stays unchanged. Wait for the operation to finish before retrying.

Session replacement APIs such as new-session, resume, fork, and import live on `AgentSessionRuntime`, not on `AgentSession`.

### createAgentSessionRuntime() and AgentSessionRuntime

Use the runtime API when you need to replace the active session and rebuild cwd-bound runtime state.
This is the same layer used by the built-in interactive, print, and RPC modes.

`createAgentSessionRuntime()` takes a runtime factory plus the initial cwd/session target. The factory closes over process-global fixed inputs, recreates cwd-bound services for the effective cwd, resolves session options against those services, and returns a full runtime result.

```typescript
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@bastani/atomic";

const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({ cwd });
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(process.cwd()),
});
```

`AgentSessionRuntime` owns replacement of the active runtime across:

- `newSession()`
- `switchSession()`
- `fork()`
- clone flows via `fork(entryId, { position: "at" })`
- `importFromJsonl()`

Important behavior:

- `runtime.session` changes after those operations
- event subscriptions are attached to a specific `AgentSession`, so re-subscribe after replacement
- if you use extensions, call `runtime.session.bindExtensions(...)` again for the new session
- creation returns diagnostics on `runtime.diagnostics`
- if runtime creation or replacement fails, the method throws and the caller decides how to handle it

```typescript
let session = runtime.session;
let unsubscribe = session.subscribe(() => {});

await runtime.newSession();

unsubscribe();
session = runtime.session;
unsubscribe = session.subscribe(() => {});
```

### Prompting and Message Queueing

`PromptOptions` controls prompt expansion, queueing behavior while streaming, and prompt preflight notifications:

```typescript
interface PromptOptions {
  expandPromptTemplates?: boolean;
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";
  source?: InputSource;
  preflightResult?: (success: boolean) => void;
}
```

`preflightResult` is called once per `prompt()` invocation:

- `true` when the prompt was accepted, queued, or handled immediately
- `false` when prompt preflight rejected before acceptance

It fires before `prompt()` resolves. `prompt()` still resolves only after the full accepted run finishes, including retries. Failures after acceptance are reported through the normal event and message stream, not through `preflightResult(false)`.

The `prompt()` method handles prompt templates, extension commands, and message sending:

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

**Behavior:**
- **Extension commands** (e.g., `/mycommand`): Execute immediately, even during streaming. They manage their own LLM interaction via `pi.sendMessage()`.
- **File-based prompt templates** (from `.md` files): Expanded to their content before sending or queueing.
- **During streaming without `streamingBehavior`**: Throws an error. Use `steer()` or `followUp()` directly, or specify the option.
- **`preflightResult(true)`**: Means the prompt was accepted, queued, or handled immediately.
- **`preflightResult(false)`**: Means preflight rejected before acceptance.

For explicit queueing during streaming:

```typescript
// Queue a steering message for delivery after the current assistant turn finishes its tool calls
await session.steer("New instruction");

// Wait for agent to finish (delivered only when agent stops)
await session.followUp("After you're done, also do this");
```

Both `steer()` and `followUp()` expand file-based prompt templates but error on extension commands (extension commands cannot be queued).

`pauseQueuedMessages()` is a synchronous admission gate. It moves existing raw steering/follow-up entries into a hold before an abort boundary and keeps later context-bearing arrivals—including trigger-turn custom messages, batches, interrupts, `sendUserMessage()`, and ordinary `prompt()` calls—queued without starting a provider turn. Content blocks, optional data, duplicate identities, raw text, message types, and the existing order within each queue kind are retained. Non-trigger custom messages remain history-only and do not invent a turn.

`resumeQueuedMessages()` releases that hold exactly once but does **not** itself start or continue a model turn. Its promise resolves to `true` only when raw held steering/follow-up work was released, and to `false` when no held raw work existed. The caller must use its existing explicit resume action (for example, the interactive chat submission or workflow resume boundary) to drive execution. `clearQueue()` clears the paused flag when it explicitly removes the final unowned held item; if a protected or interrupt-owned item remains, the gate stays paused.

### Agent and AgentState

The `Agent` class (from `@earendil-works/pi-agent-core`) handles the core LLM interaction. Access it via `session.agent`.

```typescript
// Access current state
const state = session.agent.state;

// state.messages: AgentMessage[] - conversation history
// state.model: Model - current model
// state.thinkingLevel: ThinkingLevel - current thinking level
// state.systemPrompt: string - system prompt
// state.tools: AgentTool[] - available tools
// state.streamingMessage?: AgentMessage - current partial assistant message
// state.errorMessage?: string - latest assistant error

// Replace messages (useful for branching or restoration)
session.agent.state.messages = messages; // copies the top-level array

// Replace tools
session.agent.state.tools = tools; // copies the top-level array

// Wait for agent to finish processing
await session.agent.waitForIdle();
```

### Events

Subscribe to events to receive streaming output and lifecycle notifications.

```typescript
session.subscribe((event) => {
  switch (event.type) {
    // Streaming text from assistant
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
      if (event.assistantMessageEvent.type === "thinking_delta") {
        // Thinking output (if thinking enabled)
      }
      break;
    
    // Tool execution
    case "tool_execution_start":
      console.log(`Tool: ${event.toolName}`);
      break;
    case "tool_execution_update":
      // Streaming tool output
      break;
    case "tool_execution_end":
      console.log(`Result: ${event.isError ? "error" : "success"}`);
      break;
    
    // Message lifecycle
    case "message_start":
      // New message starting
      break;
    case "message_end":
      // Message complete
      break;
    
    // Agent lifecycle
    case "agent_start":
      // Agent started processing prompt
      break;
    case "agent_end":
      // Agent finished (event.messages contains new messages)
      break;
    
    // Turn lifecycle (one LLM response + tool calls)
    case "turn_start":
      break;
    case "turn_end":
      // event.message: assistant response
      // event.toolResults: tool results from this turn
      break;
    
    // Session events (queue, compaction, retry)
    case "queue_update":
      console.log(event.steering, event.followUp);
      break;
    case "compaction_start":
    case "compaction_end":
    case "auto_retry_start":
    case "auto_retry_end":
    case "summarization_retry_scheduled":
    case "summarization_retry_attempt_start":
    case "summarization_retry_finished":
      break;
  }
});
```

A subscriber that rebuilds the assistant message from these deltas must
accumulate them into its own message object. `message_start` reports the
message the model is about to stream, but an in-process subscriber receives the
provider's live partial rather than a snapshot of it, and the provider keeps
appending to that same object as the stream runs. Appending a delta to it adds
text the provider already added. A subscriber that attaches part-way through a
turn missed the deltas that came before it and can seed itself from
`session.agent.state.streamingMessage`, which holds the message currently being
streamed, if any.

## Options Reference

Moved to [SDK API reference](/sdk/reference#options-reference).

### Directories

Moved to [SDK API reference](/sdk/reference#directories).

### Model

Moved to [SDK API reference](/sdk/reference#model).

#### Model catalog persistence and refresh

Moved to [SDK API reference](/sdk/reference#model-catalog-persistence-and-refresh).

### API Keys and OAuth

Moved to [SDK API reference](/sdk/reference#api-keys-and-oauth).

### System Prompt

Moved to [SDK API reference](/sdk/reference#system-prompt).

### Tools

Moved to [SDK API reference](/sdk/reference#tools).

#### Bash tool behavior

Moved to [SDK API reference](/sdk/reference#bash-tool-behavior).

#### Waiting for existing shell tasks

Both Bash and PowerShell factories accept `{ action: "wait", id: taskId, budgetMs: 1000 }` with a trusted `taskOwner` binding. No command is executed. `BashToolInput` and `PowerShellToolInput` distinguish command launches from existing-task waits; narrow by `action` before reading `command`.

`budgetMs` is optional, finite, and non-negative. Omission uses the owner's command wait policy and zero polls. Results keep the `WaitOutcome` in `details.observation`, available exit information in `details.exitCode`, and retained output in text content. Failure and cancellation metadata remain in the settled observation. Yielded waits advance through bounded retained-output pages for the same owned task, even when the tool is recreated. Partial UTF-8 characters continue on the next page. Settled waits return all retained output again, subject to labelled gaps and truncation. Aborting the call releases only its observation. A binding from `AgentTaskHost.ownerBinding` also releases waits for incoming owner messages.

Do not mix wait arguments with launch fields. Unknown or foreign IDs and unbound waits are rejected before execution hooks. Custom `operations.exec` does not provide existing-task ownership. See [Background tasks](/background-tasks) for examples and lifetime rules.

#### PowerShell tool behavior

Moved to [SDK API reference](/sdk/reference#powershell-tool-behavior).

#### Tools with Custom cwd

Moved to [SDK API reference](/sdk/reference#tools-with-custom-cwd).

### Custom Tools

Moved to [SDK API reference](/sdk/reference#custom-tools).

Normal sessions also expose `kill({ id: taskId })` for their owned bash and PowerShell background tasks. Include `kill` when using a `tools` allowlist if the agent should be able to stop those tasks. The exported `createKillTool` and `createKillToolDefinition` factories accept `KillToolOptions.taskOwner`, a trusted execution-time callback returning the same owner binding used by shell launch. Without a binding they reject execution. The result details preserve the supervisor's `CancelReceipt`, including its decision, execution outcome, and cleanup state. See [Background tasks](/background-tasks#stop-a-shell-task-from-a-tool-call).

#### Structured output final results

Moved to [SDK API reference](/sdk/reference#structured-output-final-results).

### Extensions

Moved to [SDK API reference](/sdk/reference#extensions).

### Skills

Moved to [SDK API reference](/sdk/reference#skills).

### Context Files

Moved to [SDK API reference](/sdk/reference#context-files).

### Slash Commands

Moved to [SDK API reference](/sdk/reference#slash-commands).

### Session Management

Moved to [SDK API reference](/sdk/reference#session-management).

### Settings Management

Moved to [SDK API reference](/sdk/reference#settings-management).

## ResourceLoader

Moved to [SDK API reference](/sdk/reference#resourceloader).

## Return Value

Moved to [SDK API reference](/sdk/reference#return-value).

## Complete Example

```typescript
import { getModel } from "@bastani/pi-ai/compat";
import { Type } from "typebox";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@bastani/atomic";

// Create a runtime with custom credential storage and no models.json.
const authStorage = AuthStorage.create("/custom/agent/auth.json");
const modelRuntime = await ModelRuntime.create({ credentials: authStorage, modelsPath: null });

// Runtime API key override (not persisted). setRuntimeApiKey updates auth state;
// the scoped refresh updates that provider's catalog.
if (process.env.MY_KEY) {
  const providerId = "anthropic";
  const authController = new AbortController();
  await modelRuntime.setRuntimeApiKey(providerId, process.env.MY_KEY, { signal: authController.signal });
  await modelRuntime.refresh({ providers: [providerId], signal: authController.signal });
}

// Inline tool
const statusTool = defineTool({
  name: "status",
  label: "Status",
  description: "Get system status",
  parameters: Type.Object({}),
  execute: async () => ({
    content: [{ type: "text", text: `Uptime: ${process.uptime()}s` }],
    details: {},
  }),
});

const model = getModel("anthropic", "claude-opus-4-5");
if (!model) throw new Error("Model not found");

// In-memory settings with overrides
const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 2 },
});

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: "/custom/agent",
  settingsManager,
  systemPromptOverride: () => "You are a minimal assistant. Be concise.",
});
await loader.reload();

const { session } = await createAgentSession({
  cwd: process.cwd(),
  agentDir: "/custom/agent",

  model,
  thinkingLevel: "off",
  modelRuntime,

  tools: ["read", "bash", "status"],
  customTools: [statusTool],
  resourceLoader: loader,

  sessionManager: SessionManager.inMemory(),
  settingsManager,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("Get status and list files.");
```

## Run Modes

Moved to [SDK API reference](/sdk/reference#run-modes).

### InteractiveMode

Moved to [SDK API reference](/sdk/reference#interactivemode).

### runPrintMode

Moved to [SDK API reference](/sdk/reference#runprintmode).

### runRpcMode

Moved to [SDK API reference](/sdk/reference#runrpcmode).

## RPC Mode Alternative

For subprocess-based integration without building with the SDK, use the CLI directly:

```bash
atomic --mode rpc --no-session
```

See [RPC documentation](/rpc) for the JSON protocol.

The SDK is preferred when:
- You want type safety
- You're in the same Node.js process
- You need direct access to agent state
- You want to customize tools/extensions programmatically

RPC mode is preferred when:
- You're integrating from another language
- You want process isolation
- You're building a language-agnostic client

## Exports

Moved to [SDK API reference](/sdk/reference#exports).
