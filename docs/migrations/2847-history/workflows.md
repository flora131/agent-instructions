# Historical workflows documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: workflows::004 -->

Source: `packages/coding-agent/docs/workflows.md` lines 43–70 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows.md#when-to-use-workflows`.

## When to Use Workflows

Workflows are the default execution path when a request is non-trivial or combines inherent structure with a verifiable objective — implementation, build, debugging, bug fixes, migrations, features, scoped multi-file edits, docs/code changes where validation matters, and work with dependencies, handoffs, review gates, uncertainty, measurable done criteria, or evidence requirements. Choose a workflow before direct chat when the prompt includes any of these signals:

- implementation, build, debugging/diagnosis, bug-fix, migration, new-feature, scoped multi-file, or validated docs/code work
- multiple subtasks, dependencies, handoffs, uncertainty, or parallel/sequential stages
- review, validation, QA, approval, evidence, or human-input gates
- long-running or resumable background execution, saved artifacts, or important model fallback chains
- reusable automation or an explicit loop/stop condition (see the signal phrases below)

Loop or stop-condition phrasing is an especially strong workflow signal: `do X until Y`, `repeat until`, `iterate until`, `review/fix until passing`, `run checks and fix until green`, and `keep going until done` define control flow and convergence criteria that should be tracked.

Use direct chat only for tiny, deterministic, low-risk answers or edits where stage tracking clearly costs more than it adds, typically a single-file/no-test/no-review change. Choose direct chat or a workflow based on that fit; reconnaissance is already inline execution. Once workflow fit is clear, limit pre-workflow reconnaissance to the few reads needed to sharpen the objective and validation criteria, and put deeper research or behavior probing inside the run.

Workflow-first does not require builtins, monolithic workflows, or a force-fit builtin: a builtin that matches 60% of the task and fights the other 40% is worse than a small custom graph. Discover named builtin, project, user, and package workflows; or author a task-specific TypeScript `workflow({...})` inline with normal coding tools whenever the task needs richer branching, dynamic fan-out, artifacts, structured outputs, child workflows, human input, gates, retries, or loops.

Rich custom workflows can compose the [common workflow patterns](/workflows/reliable-design#common-workflow-patterns): classify and branch at runtime, fan out and synthesize artifacts, run worker/verifier/reducer repair cycles, generate and filter or tournament-rank candidates, and loop until explicit evidence says the work is done. Workflow definitions are composable TypeScript modules — see [Workflow Composition](/workflows/authoring#workflow-composition). Atomic can write the definition, reload workflow resources, and run it for the current task; the workflow tool has no create action.

If inline work drifts past roughly ten exploratory tool calls without an artifact, edit, or commit, or repeats a "verify one more thing" loop, save the findings to a context file and hand the task to the best-fit named or custom workflow through `reads`. Sunk research is transferable, not a reason to continue inline.

| User need | Use |
|-----------|-----|
| Run, inspect, connect to, pause, interrupt, quit, resume, or check status for an existing workflow | `/workflow ...` or `workflow({ action: ... })` |
| Run repository-wide research | Compose `fan-out-and-synthesize` with repository-focused branches, artifact outputs, and a synthesis barrier, or author a smaller task-specific research workflow. |
| Run an implementation/review loop | Author a task-specific worker → fresh verifier → reducer loop with explicit evidence, repair bounds, and stop conditions. |
| Create or edit reusable automation | A TypeScript workflow definition exported from `workflow({...})` |
| Make a workflow robust | Design the stage graph, context handoffs, artifacts, validation gates, model fallbacks, and human approval points before coding |

<!-- baseline-block: workflows/api-reference::028 -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 369–436 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/api-reference.md#ctx-tool-name-args-fn-options`.

### `ctx.tool(name, args, fn, options?)`

```typescript
type WorkflowToolOutcome<TValue extends WorkflowSerializableValue> =
  | { ok: true; value: TValue; attempts: number; cached: boolean }
  | {
      ok: false;
      error: {
        name: string;
        message: string;
        exitCode?: number;
        stdout?: string;
        stderr?: string;
      };
      attempts: number;
      cached: boolean;
    };

interface WorkflowToolContext {
  signal: AbortSignal;
}

ctx.tool<TValue extends WorkflowSerializableValue>(
  name: string,
  args: Readonly<Record<string, WorkflowSerializableValue>>,
  fn: (toolCtx: WorkflowToolContext) => Promise<TValue>,
  options?: WorkflowToolThrowOptions,
): Promise<TValue>;

ctx.tool<TValue extends WorkflowSerializableValue>(
  name: string,
  args: Readonly<Record<string, WorkflowSerializableValue>>,
  fn: (toolCtx: WorkflowToolContext) => Promise<TValue>,
  options: WorkflowToolOptions & { failureMode: "return" },
): Promise<WorkflowToolOutcome<TValue>>;
```

Runs arbitrary TypeScript code as a tracked, non-attachable durable workflow graph node and caches its serializable result by call order plus the content hash of `name` and `args`. The node is created before `fn` runs and may appear before, between, after, or without model stages. A completed call replays without rerunning `fn`, so use this primitive for workflow-owned durable side effects; keep pure computation as ordinary TypeScript.

**Cancellation and deadlines.** Every callback receives a `WorkflowToolContext` whose `signal` aborts when the run is cancelled, when the run is gracefully quit, or when this single node is aborted with `workflow({ action: "quit"|"interrupt", runId, stageId: "<tool node id or name>" })`. Forward it to `fetch`, a child process, or any client that accepts an `AbortSignal` so a stuck call can be stopped:

```ts
await ctx.tool(
  "fetch-dataset",
  { source },
  async ({ signal }) => {
    const response = await fetch(source, { signal });
    return await response.text();
  },
  { timeoutMs: 45 * 60_000 },
);
```

Zero-argument callbacks stay valid — `async () => { ... }` still compiles and runs. When `timeoutMs` is set, a callback that ignores its signal is released after the per-attempt deadline, but any child process or network request it started can keep running until it finishes on its own; forwarding the supplied signal is required for cancellation to stop that underlying work. Without a deadline, quit still abandons an ignored callback after a bounded wait and reports its owning run and node id. A cancelled call writes no replayable checkpoint, so resume re-executes exactly that call at the same ordinal and node id; under `failureMode: "return"` it also writes one inspection-only `tool-failure:` record, which is never a replay cache hit.

**Options:**
- `failureMode` — `"throw"` keeps the default throw-on-failure behavior; `"return"` returns a typed success or failure outcome after retries.
- `retriesAllowed` — retries failures when `true`; default `false`. Retries alone do not bound a callback that hangs because a hung attempt never fails.
Callbacks that spawn child processes or perform network I/O need an explicit `timeoutMs` deadline and must forward the supplied `signal` to that work.
- `maxAttempts` — positive integer maximum when retries are enabled; default `3`. Invalid enabled retry bounds throw before the callback runs.
- `intervalMs` — initial retry interval; default `1000`.
- `backoffRate` — retry interval multiplier; default `2`.
- `timeoutMs` — optional positive finite deadline in milliseconds applied to each callback attempt. Invalid values throw before the callback runs; each retry gets a fresh deadline and `AbortSignal`, and expiry is handled as an attempt failure.

With `timeoutMs`, each retry receives a fresh signal and deadline. Run cancellation and operator abort remain cancellation rather than timeout, and a callback that completes before its deadline is unchanged. Omitting `timeoutMs` keeps the existing unbounded callback path.

See [`ctx.tool` — durable cached tool execution](/workflows/operations#ctxtool--durable-cached-tool-execution) for durable failure replay, process-output safety, explicit repair handoffs, and cancellation behavior.

<!-- baseline-block: workflows/api-reference::043 -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 609–625 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/api-reference.md#output-/-outputmode`.

### `output` / `outputMode`

```typescript
readonly output?: string | false;
readonly outputMode?: "inline" | "file-only";
```

Writes stage/task output to a path or disables output persistence with `false`. `outputMode` defaults to `inline`; `file-only` keeps the parent result compact by returning an artifact reference instead of full text and requires an output path.

The runner writes the stage's **final assistant message** to `output` after the stage ends, so that path belongs to the runner. For a schema-backed stage, this means the ordinary text in the assistant message that calls `structured_output`, not the structured tool arguments. A stage that declares `output:` also automatically gets a full, rendered, line-oriented transcript of its session, and one appended instruction telling the model that its final message becomes the artifact — the workflow definition does not need to describe any of this.

An admitted external turn (for example, a subagent completion) can arrive while the stage is still running and remains visible both to the model and in the companion transcript. The runner does not try to work out which turn was "really" the deliverable: that is an inference about intent, and an earlier revision that scored candidates by byte size got it wrong in both directions. If a late turn displaces the intended content, the transcript still holds it.

The companion transcript is written once under the durable Atomic config root at `~/.atomic/workflows/runs/<runId>/transcripts/` (or the equivalent configured agent root; `ATOMIC_WORKFLOW_ARTIFACT_DIR` overrides that root). It is never placed inside the repository tree or OS temporary storage: a home-scoped durable location survives both worktree deletion and OS temp purges, and staying outside the repo keeps full tool output — which may contain secrets — from being committed accidentally. Run-scoped artifact directories are pruned only when their durable/live run record is terminal (or the directory is an unowned orphan) and older than the exported `WORKFLOW_ARTIFACT_RETENTION_MS` policy. Running, paused, quit, blocked, and awaiting-input runs are exempt indefinitely because their artifacts are live resume dependencies. A live continuation transitively protects the original run directory in its `resumedFromRunId` chain, even when intermediate continuations have different run IDs; merely quoting another run's artifact path does not protect that unrelated owner or make the quoting run depend on it. A **failed** run with no live continuation is terminal and does age out: it stays retryable, but the retention window is the grace period it gets, otherwise repeated recoverable failures would accumulate artifacts forever. When a terminal durable owner is aged out, the durable entry is deleted first; if authoritative deletion is unavailable or refuses, the artifact directory is preserved. Goal ledgers, Ralph implementation notes, and QA video paths share that same durable root and retention policy. The receipt names both absolute paths. Search the transcript with `rg`, then read only the narrow line ranges you need; do not read the whole transcript into a downstream prompt. The transcript is a secondary searchable record; the output artifact remains the curated handoff.

The receipt reports facts only. An empty artifact produces `WARNING: the stage artifact is empty; search the companion transcript for this stage's work.` A non-empty artifact is never classified, however short and even if it only names its own output path: deciding whether such text is a pointer or a deliverable requires knowing what the author meant, and the regex bank that previously attempted it produced false alarms on genuine short output. The transcript named in every receipt is the recovery path for anything that looks wrong to a reader.

<!-- baseline-block: workflows/api-reference::054 -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 728–736 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/api-reference.md#concurrency-/-failfast`.

### `concurrency` / `failFast`

```typescript
readonly concurrency?: number;
readonly failFast?: boolean;
```

`WorkflowParallelOptions` uses `concurrency` to bound active tasks in an authored `ctx.parallel(...)`. When omitted, the runtime uses the workflow's `defaultConcurrency` setting, which defaults to `4`; parallel execution is fail-fast unless `failFast` is explicitly `false`.

<!-- baseline-block: workflows/api-reference::062 -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 829–847 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/api-reference.md#stage-sendusermessage-content-options`.

### `stage.sendUserMessage(content, options?)`

```typescript
stage.sendUserMessage(
  content: string | readonly (StageTextContent | StageImageContent)[],
  options?: { readonly deliverAs?: "steer" | "followUp" },
): Promise<void>;
```

Sends a normal follow-on user turn to the retained stage session. This method starts a turn immediately when the session is idle and not controlled-paused; while streaming, it queues a follow-up by default or sends steering when `deliverAs: "steer"`. During controlled pause it joins the raw hold and does not start a turn.

`deliverAs: "steer"` is consumed after the current assistant response finishes its whole tool batch and before the next model request; `deliverAs: "followUp"` is consumed only when the agent would otherwise stop. Each queue is FIFO in admission order, and steering keeps priority over an earlier-submitted follow-up.

Native sessions accept strings or text/image content blocks. Non-native fallback adapters accept only strings and reject block arrays; `deliverAs` affects streaming delivery only, and follow-on turns retain the stage MCP scope.

Externally produced Intercom and subagent notices admitted before the generation closes drain through the same session. When a busy stage owns a foreground subagent, exact-owner detach gets first refusal before Intercom enters this boundary; unclaimed traffic then uses normal stage admission. Traffic arriving after the atomic close boundary cannot reopen the completed stage and is surfaced once through the main-chat path instead.

See [Stage follow-on user messages](/workflows/authoring#stage-follow-on-user-messages) for the full lifecycle and schema-backed example.

<!-- baseline-block: workflows/authoring::014 -->

Source: `packages/coding-agent/docs/workflows/authoring.md` lines 387–446 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/authoring.md#stage-follow-on-user-messages`.

### Stage follow-on user messages

`ctx.stage()` returns a `StageContext` with `sendUserMessage(content, options?)` to inject a normal follow-on user turn into that stage's AgentSession. Use this when workflow code needs to continue an existing stage session after `stage.prompt(...)` has already resolved, including schema-backed stages where `prompt()` is intentionally one-shot because the structured-output tool may be called exactly once.

```ts
const gate = ctx.stage("review-gate", {
  schema: Type.Object({ approved: Type.Boolean() }, { additionalProperties: false }),
});
const decision = await gate.prompt("Review the implementation and call structured_output.");
if (!decision.approved) {
  await gate.sendUserMessage("Explain the highest-priority changes needed before approval.");
}
```

When the stage session is idle, `sendUserMessage()` starts the next user turn immediately and waits for that turn to finish under the normal workflow stage guard: it observes the stage concurrency limiter, workflow abort/cancellation signals, MCP scoping, readiness gates, and session metadata capture. If `sendUserMessage()` is the first live call on a `ctx.stage(...)` handle, Atomic records the stage as a normal running/completed graph node. If it is called after a prior `prompt()`/`complete()` has already completed the stage, the follow-on turn still uses internal abort/cancellation and concurrency protection while reusing the completed stage session.

The `content` argument mirrors the Atomic SDK and accepts either a string or text/image content blocks such as `[{ type: "text", text: "Describe this" }, { type: "image", data: "...", mimeType: "image/png" }]` when the underlying stage session supports native user-message delivery. Non-native fallback adapters only support string content and reject text/image block arrays instead of stringifying them. Idle non-native fallback delivery sends the follow-on string to the already-selected session directly, so workflow model fallback retries are not re-run for that injected turn. During a controlled pause, the runner gates every `stage.sendUserMessage()` before selecting either native delivery or the `prompt()` fallback; therefore an adapter that omits optional `sendUserMessage()` is not prompted until explicit resume, and the admitted delivery runs once afterward.

When the stage is already streaming, the message is queued as a follow-up by default; pass `{ deliverAs: "steer" }` to steer the active turn instead, or `{ deliverAs: "followUp" }` to be explicit. `deliverAs` only affects streaming delivery and is a no-op for idle sessions. Follow-on turns preserve the stage's `mcp.allow` / `mcp.deny` scope for the injected user turn, just like the original `prompt()`. The older `stage.steer(text)` and `stage.followUp(text)` methods are still available for queueing while a turn is active, but they do not start a new idle turn. If that stage is paused before delivery, Atomic preserves every queued item—type, optional data, duplicate entries, raw content, and order within its steering or follow-up queue—without starting a queued model turn or workflow continuation; late context-bearing traffic joins the hold, and the existing stage `resume` action releases the queue once.

The two streaming modes have distinct, deterministic timing:

- **`steer`** is delivered at the next steering boundary: after the current assistant response has finished executing its whole tool batch, and before the next model request. It is not injected between two tool calls emitted by the same assistant response.
- **`followUp`** is delivered only when the agent would otherwise stop — no further tool-driven turns and no steering messages left.

Each queue is FIFO in admission order. There is no global FIFO *across* the two queues: steering keeps its semantic priority even when a follow-up was submitted earlier. A controlled pause or interrupt hold delays eligibility but preserves both the queue class and the order within it. An abort, kill, or fatal provider failure ends the turn without consuming what is still queued.

A message you type into an attached stage chat and submit with Enter defaults to `steer`, matching normal (non-workflow) session steering, so a mid-run correction lands at the next steering boundary rather than at the end of the turn. Ctrl+F queues a follow-up instead. This is a property of the interactive surface, not of the API: an authored `stage.sendUserMessage()` call that names no `deliverAs` still defaults to follow-up while the stage is streaming.

Custom `AgentSessionAdapter` implementations must make asynchronous idle-turn ownership observable through their public `subscribe()` stream: emit `{ type: "agent_start" }` when the submitted message has entered the turn, before waiting for that turn to finish, and emit `{ type: "agent_end", messages }` when that turn terminates. This applies both to native `sendUserMessage()` implementations and to the required `prompt()` fallback when `sendUserMessage` is omitted. Atomic retains the resulting logical ownership after releasing serialized message admission, so a concurrent second message is routed as steering/follow-up rather than another prompt even when the adapter publishes `isStreaming` asynchronously after `agent_start`. Correlated turn generations prevent a late end or older delivery settlement from clearing a newer owner. A subscription may replay earlier lifecycle state synchronously during registration; an untagged synchronous replay is treated as a snapshot and does not consume a later current-turn end. If an adapter can emit a delayed end for a replayed turn while a newer turn is active, it must attach the same stable string or numeric `turnId` to that replayed `agent_start` and its matching `agent_end`; Atomic then correlates the old end without disturbing current ownership. After `subscribe()` returns, adapters must emit `agent_start` only for newly started turns, never as a delayed replay of an earlier turn. Adapters that enter streaming synchronously are also detected through `isStreaming`; the bundled Atomic session additionally retains its internal handshake for compatibility. Implementations must not delay the current turn's `agent_start` until turn completion.

Native queue pause is an optional `StageSessionRuntime` optimization for custom adapters:

```ts
interface StageSessionRuntime {
  readonly queuedMessagesPaused?: boolean;
  pauseQueuedMessages?(): void;
  resumeQueuedMessages?(): boolean | Promise<boolean>;
}
```

Existing adapters may omit all three members and continue using the runner's prior fallback pause behavior: the active call is aborted, the workflow objective remains suspended, and public deliveries admitted through the stage handle wait until explicit resume. Adapters that implement the native capability must provide both methods. `pauseQueuedMessages()` synchronously gates raw queued steer/follow-up work before `abort()` settles; `resumeQueuedMessages()` releases that hold without starting a provider turn and returns `true` only when raw held work was released. Atomic's bundled `AgentSession` implements this stronger native hold, which preserves already-queued and late native traffic verbatim.

Reporting an already-held queue is a second optional `StageSessionRuntime` capability:

```ts
interface StageSessionRuntime {
  getSteeringMessages?(): readonly string[];
  getFollowUpMessages?(): readonly string[];
}
```

A session announces its queue by `queue_update`, so a queue that exists before Atomic's listeners reach that session is announced to nobody — which happens when a retiring session hands its pending messages to the session replacing it, and when a retained session is reopened for post-mortem chat holding what it was queued. Atomic reads these two methods once, as it attaches a session, and replays the missed snapshot to that stage's listeners; every later change still arrives as an ordinary event. An adapter that omits them loses nothing it had before: only a queue predating the attach is invisible, and a session that starts empty never had one.

Externally produced traffic has a separate lifecycle rule. Intercom messages and subagent completion notices received while a workflow stage generation is still open are admitted through the stage AgentSession's native steering/follow-up queue. For a busy stage, admission into the generation boundary happens synchronously before the exact foreground subagent owner's probe/commit detach handshake; model-visible queue insertion waits inside that admitted delivery until the handshake is claimed or falls back after an unclaimed/vanished owner. A commit accepted within a parallel foreground group releases aggregate supervision for every active sibling while retaining their process and eventual-result ownership. Reserving admission before the asynchronous handshake prevents terminal close from overtaking an in-flight Intercom delivery, while waiting inside the reservation prevents a blocking child request from queueing behind either a single foreground tool call or a parallel aggregate still waiting on another child. The stage drains already-admitted work before publishing its terminal snapshot, including schema-backed turns that have already called `structured_output`.

Closing the generation is atomic with admission: a notification admitted first belongs to that stage, while ordinary detached notifications arriving after close cannot reopen or mutate the completed stage and are surfaced once through the main-chat notification path instead. A blocking sibling `intercom.ask` is the deliberate exception: when the completed stage retains a valid conversation, Atomic schedules a post-mortem turn in that conversation so it can inspect the exact ask and reply without changing terminal workflow state. Failed running-stage admission and failed post-mortem admission return correlated actionable errors to the asker instead of consuming the full reply timeout.

Stage completion never waits for producers that are still running; only traffic already admitted at the close boundary is drained. Explicit `sendUserMessage()` calls and post-mortem stage chat remain deliberate user/workflow-authored follow-up turns on the retained session.

<!-- baseline-block: workflows/authoring::015 -->

Source: `packages/coding-agent/docs/workflows/authoring.md` lines 447–494 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/authoring.md#early-exit-with-ctx-exit`.

### Early exit with `ctx.exit()`

Use `ctx.exit(options?)` when workflow code intentionally stops the current run from a helper, branch, loop, or precondition guard with a chosen terminal status. `ctx.exit()` throws an executor-owned control signal and is typed as `never`, so code after it is unreachable. In async `run` bodies, prefer `return ctx.exit(...)` when the exit is the only path so TypeScript can see the non-returning branch.

```ts
export default workflow({
  name: "guarded-import",
  description: "",
  inputs: {},
  outputs: {
    scanned: Type.Number(),
  },
  run: async (ctx) => {
    const files = await findCandidateFiles(ctx.cwd);
    if (files.length === 0) {
      return ctx.exit({
        status: "skipped",
        reason: "No matching files",
        outputs: { scanned: 0 },
      });
    }

    const review = await ctx.task("review", { prompt: `Review ${files.join(", ")}` });
    return { scanned: files.length };
  },
});
```

`ctx.exit()` accepts `status: "completed" | "skipped" | "cancelled" | "blocked" | "failed"`; `status` defaults to `"completed"`. Choose `completed` when the objective was met and declared outputs are complete and trustworthy; `skipped` when a precondition made the run a valid no-op; `cancelled` when the work is no longer wanted, which is a decision rather than a defect; `blocked` when valid progress needs a changed condition or a later decision; and `failed` when required work was attempted and definitively could not complete. A bounded reviewer or repair loop that does not converge is `blocked`, not `failed`.

`reason` from a valid author exit is persisted and shown in status surfaces and lifecycle notices, including the default `/workflow status` list and `/workflow status <runId>` detail, so do not put secrets in it. An exit rejected during validation is finalized as an ordinary failed run rather than an accepted author exit. `outputs` may contain a partial subset of declared outputs; provided keys still must be declared in the workflow's `outputs` object, match their TypeBox schema, and be JSON-serializable. `failed` exits default to `resumable: false`; set `resumable: true` only when a later durable retry is intended. `resumable` is valid only with `status: "failed"`; supplying it for another status records a non-resumable authoring failure. A durable retry keeps the failed handle in the resume catalog and re-dispatches the workflow with completed checkpoints replayed. The low-level `resumeRun()` helper only inspects terminal runs; it reports the durable retry path instead of silently claiming that it resumed. The other exit statuses keep their existing non-resumable author-exit behavior. Public `pause`, `interrupt`, and `quit`, plus internal destructive cancellation, keep their distinct existing behavior.

An author-initiated failed exit returns to a parent as `{ exited: true, status: "failed" }` with its reason and partial outputs; it does not throw. An unintentional child failure still throws, so check `child.exited === true` before reading required child outputs and use the discriminator to branch. The lifecycle terminal notice uses the same steer/trigger-turn delivery path and references partial outputs so the launching agent does not need a separate status call.

The first selected `ctx.exit({ outputs })` snapshots its output payload synchronously by value before JavaScript `finally` blocks or cleanup callbacks can mutate the caller-owned object. The snapshot preserves undeclared keys and invalid values until post-cleanup validation, so deleting an undeclared key or changing an invalid value after `ctx.exit(...)` does not change the terminal validation result.

If reading `status`, `reason`, `resumable`, or `outputs`, or enumerating/copying the output snapshot itself, throws, Atomic still selects the exit signal, runs workflow-exit cleanup when feasible, and then records a terminal non-resumable authoring failure (`resumable: false`) if no external terminal control won first.

After the first `ctx.exit(...)` wins, the executor treats that exit as a level-triggered gate. Later delayed calls to `ctx.stage`, `ctx.task`, `ctx.chain`, `ctx.parallel`, `ctx.workflow`, or graph-backed `ctx.ui.*` prompts rethrow the selected exit signal before creating stages, prompt nodes, child runs, or control handles. Retained `StageContext` handles from before the exit also become inert: `prompt`, `complete`, steering/follow-up, model/thinking controls, tree navigation, compaction, abort, and attached-pane session-realization paths refuse to touch or create an `AgentSession` after the exit is selected.

`ctx.parallel` stops dequeuing queued work after exit even with `failFast: false` and limited concurrency; already-started stages and prompt nodes are finalized as `skipped` with a `workflow-exit` reason that prompt-node abort handling preserves instead of overwriting with a generic run-aborted reason.

Continuation replay also observes the exit gate. Replayed `ctx.stage(...).prompt(...)`, replayed `complete(...)`, graph-backed prompt-node replay, and completed child-boundary replay re-check for a selected exit after their replay microtask and before writing a current-run completed stage end. If `ctx.exit(...)` wins that gap, the pending replay finalizer is skipped/suppressed with the workflow-exit reason instead of creating a misleading completed stage in the resumed run.

The store is the terminal authority for all run-end races. `ctx.exit(...)` starts cleanup before validating exit outputs, and an internal destructive cancellation can still win the terminal `recordRunEnd` write while that cleanup is pending. When that happens, the SDK `RunResult`, `onRunEnd` callback, live store, and persisted `workflow.run.end` entries all report the canonical `killed` state; the losing `ctx.exit` status or validation failure is not returned and does not append a second run-end entry.

Control-signal probing is fail-closed. When the executor inspects an arbitrary thrown value or abort reason for internal workflow-exit markers, parent-exit markers, aggregate `errors`, `cause`, `reason`, or `scope`, throwing or inaccessible accessors are treated as “no signal for that branch.” The run then continues through ordinary failure finalization, or the ordinary killed path for external abort reasons, instead of letting author-defined getters escape the executor catch path or be misclassified as `ctx.exit(...)`.

<!-- baseline-block: workflows/builtins::005 -->

Source: `packages/coding-agent/docs/workflows/builtins.md` lines 83–100 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/builtins.md#built-in-workflows`.

## Built-in Workflows

Atomic bundles nine workflows: six reusable control-flow patterns, two autonomous implementation loops, and one end-to-end design workflow. They are available in every session. Use `/workflow list` to confirm the current set and `/workflow inputs <name>` to inspect a contract before launch.

| Workflow | What it does | When to use |
|---|---|---|
| `classify-and-act` | Structured classifier → deterministic category action; low confidence can fall back to human selection. | Route mixed requests to isolated category-specific work. |
| `fan-out-and-synthesize` | Structured partition → bounded parallel artifact branches → synthesis barrier. | Split independent slices, including repository research, and merge evidence. |
| `adversarial-verification` | Worker → per-criterion fresh verifier fan-out → deterministic mean+veto gate → findings consolidation / bounded repair; consolidator cannot approve. | Independently prove or reject a candidate with auditable graded scores. |
| `generate-and-filter` | Candidate fan-out → rubric dedupe/filter → optional judge → shortlist. | Explore more options than needed and keep the strongest distinct few. |
| `tournament` | Whole-task attempts → seeded ring and pivot-round soft scoring → full ranking reducer. | Compare subjective or approach-sensitive solutions. |
| `loop-until-done` | Durable ledger → iteration/evaluator loop → success or inspectable bound exhaustion. | Continue until explicit evidence proves completion. |
| `goal` | Durable goal ledger → bounded sub-agent orchestration → parallel review → deterministic reducer. | Autonomous implementation that needs receipts and reviewer-gated completion. |
| `ralph` | Prompt refinement → codebase research → delegated implementation → multi-model review loop. | Research-first autonomous implementation with bounded review and repair. |
| `open-claude-design` | Guided discovery and reference research → HTML generation → live review session → export and handoff. | UI, page, component, theme, or design-token work. |

Across these builtins, model-facing stages use compact, outcome-first contracts tuned for GPT-5.6, Claude Opus 5, and Claude Fable 5. Long artifacts and receipts are rendered before the final instruction, reporting stages ground completion claims in current tool evidence, and user-facing or downstream reports have explicit shape and length bounds. Orchestrators delegate only genuinely independent work that is too large for a handful of tool calls, rather than spawning agents to recheck their own work.

<!-- baseline-block: workflows/builtins::007 -->

Source: `packages/coding-agent/docs/workflows/builtins.md` lines 137–161 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/builtins.md#goal`.

### `goal`

Goal persists the literal objective and immutable acceptance criteria in a run ledger, delegates implementation through bounded orchestrator turns, records receipts, and asks independent reviewers to inspect the current delta. A TypeScript reducer returns `complete`, `blocked`, or `needs_human` rather than trusting free-form completion claims. The complete Goal artifact directory — both its owning run segment and unique `artifact-<id>` segment — is a durable checkpoint. A fresh-ID continuation therefore reuses the source ledger, receipts, and review paths without rerunning replayed producer stages; loading that ledger preserves its existing records without duplicating replayed receipts or reviews. The model-visible `goal-ledger.json` continues to omit internal turn numbers, while a sibling `goal-ledger-state.json` preserves the complete turn-bearing state for lossless continuation reloads. A live chain of continuations also protects that original owner from retention pruning.

Goal reviewers derive checks from the literal objective before consulting implementation receipts, inspect the actual checkout delta, and report commands, observed output, and file:line evidence rather than internal reasoning. Shared contracts cover acceptance-matrix traceability, contract-fidelity risks, end-to-end and QA-video evidence, and independent verification. `stop_review_loop` is the authoritative convergence signal: it remains `false` for P0–P2 findings, any `required_by_objective` finding, or unproven implementation/validation requirements; it becomes `true` only when independent evidence proves the objective and only non-blocking or authorized post-approval work remains. The deterministic reducer consumes that signal without reinterpreting free-form prose.
Goal and Ralph stage prompts — orchestrator, implementation, and reviewer alike — also carry shared code-quality verification guidance that points at the `qlty` skill for linting, auto-formatting, complexity and duplication metrics, and code smells, weighted higher when the objective asks for verifiers or high code quality. Repository-defined checks in `AGENTS.md`/`CLAUDE.md`, package scripts, and CI stay authoritative.
Both workflows also share repository-intent mining guidance: implementers and reviewers infer maintainer and requesting-user conventions from repository behavior — git history (including `git log --show-signature`), merged PRs, issues and their comments, review comments, commit subjects and trailers, and CI/branch-protection config — covering norms written docs rarely state, such as commit signing, message style and issue linking, changelog discipline, and review etiquette. The dominant, recent, intentional pattern wins over accidental drift, the requesting user's own activity weighs highest, implementers match the inferred conventions (an unsigned commit in a signed history is a miss, not a preference), and reviewers report deviations as convention findings. Behavioral evidence fills contract gaps; it never overrides the literal objective, acceptance criteria, or explicit `AGENTS.md`/`CLAUDE.md` guidance.
Goal and Ralph share the same low-confidence finding re-verification and per-round convergence evidence, documented under [`ralph`](#ralph).

| Input | Type | Required | Default | Description |
|---|---|---|---|---|
| `objective` | text | yes | — | Task to implement and validate. Keep PR/MR creation out of this text. |
| `acceptance_criteria` | text | no | objective | Immutable original contract, especially for follow-up runs. |
| `max_turns` | number | no | `10` | Maximum orchestrator/review turns. |
| `base_branch` | string | no | `origin/main` | Review and optional final-action comparison base. |
| `git_worktree_dir` | string | no | `""` | Optional reusable worktree, only when explicitly requested. |
| `create_pr` | boolean | no | `false` | Authorize the post-approval PR/MR/review stage. Prompt text alone never opts in. |

```text
/workflow goal objective="Update the CLI docs for --json, add one example, and validate the docs build"
/workflow goal objective="Implement specs/rate-limit.md and run focused checks" create_pr=true
```

Declared outputs include `result`, `status`, `approved`, `goal_id`, `objective`, `acceptance_criteria`, `ledger_path`, turn counts, receipts, remaining work, review artifacts, and optional `pr_report`.

<!-- baseline-block: workflows/operations::003 -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 11–45 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/operations.md#intercom-delivery-to-pending-workflow-stages`.

### Intercom delivery to pending workflow stages

A workflow stage uses the root-anchored `workflow:<rootRunId>/<segment>[/<segment>...]` path shown by `intercom list` and workflow status surfaces. A segment may be a stage name, a materialized run id, or a glob: `*` matches one segment and may be embedded, while `**` matches any depth. Model-facing `workflow status` and interactive status list/detail surfaces enumerate materialized pending stages by display name and canonical stage ID, printing the path only when `pendingStageDeliveryAvailable` is true and the owning run is nonterminal. An ended root or nested child never advertises a retained pending target. Duplicate names remain independently identifiable. The workflow SDK `sessionId` is **not** an Intercom target.

Join `workflow:<rootRunId>` and run `intercom({ action: "list" })` to see live sessions, materialized `PENDING`/`RUNNING` stages, and possible future literal, glob, and nested-child targets with queued counts. Then use ordinary Intercom delivery:

```ts
intercom({
  action: "send",
  to: "workflow:<rootRunId>/reviewer",
  message: "Scope changed: raw amendment text is now part of the oracle."
})
// queued — distinct from live-session delivered
```

Send material updates through Intercom to every affected workflow stage, including stages that have not started. Name and pattern sends remain sticky for every future matching stage until root termination. When shared scope or acceptance criteria change, broadcast one authoritative update to `workflow:<rootRunId>/**` (or a narrower path pattern) rather than enumerating stages; live matches receive it immediately and future descendants receive it before their first model turn. A syntactically valid path outside the persisted known set queues with a `notInKnownSet` warning and settles undeliverable at terminal only if never delivered; an entry delivered at least once is not reported undeliverable. Use `ask` once the stage session is live and can reply.

At 80 columns and wider, each `BACKGROUND` card keeps the full run identity and preserves its mode, progress, live-tool details, and elapsed/status metadata. When the remaining single-row budget permits, it adds bounded pending-stage details: a target is either shown exactly or replaced by a `stage`-labeled canonical ID, and `… N more` reports omitted pending stages. If no bounded pending-stage form fits, the pending label is omitted entirely rather than displacing the existing metadata. Tool nodes are read-only durable graph nodes, not attachable stage chats. Below 80 columns, the panel keeps its aggregate collapsed form and omits run IDs, stage identities, targets, and tool names.

For chat surfaces such as workflow status, run detail, dispatch confirmation, and the run picker, a full id wraps onto continuation rows when the card is narrower than the id. Pending-stage targets in run detail use the same rule: the exact address wraps instead of being ellipsized, and narrow status cards wrap the canonical stage ID or drop its display-name decoration rather than rendering a partial ID. The renderer keeps the card border closed at its minimum layout width, while terminals below that floor — including sub-30-column terminals — can hard-clip the box. An awaiting-input attribution banner is titled `AWAITING INPUT` and contains the same two identity rows — `？` plus the full run id, then the workflow name and optional metadata — while the existing prompt question and options remain below it in the normal prompt UI.

The `/workflow connect` run picker shows five runs at a time; use the arrow keys or mouse wheel to scroll through additional retained runs.

The rendered card shape at the 80-column breakpoint is:

```text
│   ●  339e05a4-2289-408e-9076-d1a348f582ae                                    │
│     stage-output-transcript · chain · 2/3 · 12m                              │
│                                                                              │
│   ●  d4e5f6a1-77b2-4c31-9e0a-2f1c8b4d6e5f                                    │
│     build-check · chain · 0/2 · 12m                                          │
```

Below the breakpoint the same run set is represented by the collapsed count line, for example ` ▾  4 background · 2 ● · 1 quit`; a tool-only run adds its live count, for example ` ▾  1 background · 1 ● · 1 tool`.

<!-- baseline-block: workflows/operations::004 -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 46–118 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/operations.md#running-workflows`.

## Running Workflows

List or inspect unfamiliar workflows before running them. If required inputs are missing and cannot be inferred, ask for the missing values before launch:

```ts
workflow({ action: "list" })
workflow({ action: "get", workflow: "fan-out-and-synthesize" })
workflow({ action: "inputs", workflow: "fan-out-and-synthesize" })
workflow({ action: "models" })
```

The workflow tool action surface is:

- discovery: `list`, `get`, `inputs`, plus `models` for the configured model catalog
- execution: named `run` with validated `workflow` and `inputs`
- inspection: `status`, `stages`, `stage`, `transcript`
- prompt response: `answer`; run control: `pause`, `interrupt`, `quit`, `resume`; free-form stage communication: ordinary Intercom `send`/live `ask` to `workflow:<rootRunId>/<segment>[/<segment>...]` path targets, including `*` and `**` globs
- rediscovery: `reload`

Every registered `workflow` tool call has one hard two-minute wall-clock deadline at the shared public tool boundary. The deadline covers request handling through the returned result; for background `run` and `resume`, it therefore covers startup/resume admission and acknowledgement only, not the workflow execution that continues after acknowledgement. A deadline returns one structured result:

```json
{
  "action": "run",
  "runId": "339e05a4-2289-408e-9076-d1a348f582ae",
  "status": "failed",
  "code": "WORKFLOW_TIMEOUT",
  "timeoutMs": 120000,
  "error": "Workflow run request timed out after 120000ms. The outcome is unknown. Inspect workflow status before retrying."
}
```

Expiry aborts the request operation signal so work that supports cancellation can stop, discards any later success or error, and never retries the action. The interactive engine remains available for the next command. For mutating actions (`reload`, `run`, `answer`, `pause`, `resume`, `interrupt`, and `quit`), the error additionally says that the outcome is unknown and instructs you to inspect workflow status before retrying; a timeout never claims that a mutation succeeded. When a timed-out `run` has already allocated its detached run, the structured result includes that exact full `runId`; inspect `status` with that id before any retry. A timeout before run allocation has no `runId`. Read-only actions (`models`, `list`, `get`, `inputs`, `status`, `stages`, `stage`, and `transcript`) omit that unknown-state guidance.

From interactive chat, named workflow launches run in the background so the parent chat stays available. Run `/workflow connect <run>` to see agents working and chat with and steer each stage. Inspection, prompt-response, and control calls (`status`, `stages`, `stage`, `transcript`, `answer`, `pause`, `resume`, `interrupt`, `quit`) remain available while work runs.

The no-`runId` status listing includes bounded pending-stage rows after each run summary. Each row gives the display name, canonical stage ID, literal `pending` lifecycle, `pendingStageDeliveryAvailable`, and either the exact usable Intercom target or `unavailable`. Interactive status cards and run detail show the same identity/availability distinction within their width budgets. Status cards wrap exact targets onto continuation rows instead of rendering a partially truncated address; bounded omissions retain an explicit remaining-stage count.


`workflow({ action: "models" })` returns the registry's configured-auth catalog snapshot in registry order. Each entry includes `provider`, `id`, `fullId`, an `isCurrent` marker, and `availableThinkingLevels` derived from the real model's `reasoning` and `thinkingLevelMap` metadata. This is not proof of credentials, entitlements, OAuth freshness, or live provider access, and it exposes no authentication details.

Named launches wait only for **startup admission**, not for workflow completion. Atomic returns `status: "running"` after durable registration, reusable-worktree setup, and other pre-body setup succeed, while the workflow body and stages continue in the background. If setup fails before the workflow body is admitted — for example, `git_worktree_dir` points inside the invoking checkout — the original `workflow` tool call instead returns a structured `status: "failed"` result with the allocated full run id and concrete setup error. No background-start claim or orphan run is retained, so the caller can correct the inputs and retry immediately. Failures after admission remain ordinary background lifecycle outcomes reported through status and lifecycle notices.

A model may launch in the foreground only when the user explicitly requests it or foreground execution is technically required, and it must tell the user before launching.

Run a named workflow with inputs:

```ts
workflow({
  action: "run",
  workflow: "fan-out-and-synthesize",
  inputs: { prompt: "map workflow runtime by subsystem", max_concurrency: 4 },
})
```

Slash equivalent:

```text
/workflow fan-out-and-synthesize prompt="map workflow runtime by subsystem" max_concurrency=4
```

<p align="center"><img src="../images/workflow-command.png" alt="Running a Workflow Command" width="600" /></p>

Input overrides are bare `key=value` tokens. Atomic parses values as JSON when possible, so `count=3`, `flag=true`, and `prompt="multi word value"` preserve useful types. A whole input object can also be passed as one JSON token. Runtime validation is strict: unknown input keys, missing required values, type mismatches, and invalid `select` choices fail before a named workflow run starts or before a child workflow starts.

In the TUI, `/workflow <name>` opens an inline input picker when the workflow declares inputs and either no arguments were supplied or required inputs are missing. Supplied values seed the picker. The picker is mounted and focused in the terminal host in both isolated and non-isolated interactive modes, so Tab/Shift+Tab, arrows, text editing, configured keybindings, Enter, Escape, and Ctrl+C remain responsive without per-keypress host⇄engine traffic. Escape or Ctrl+C cancels without starting the workflow. Pass `--no-picker` to skip that interactive flow.

In non-interactive (`-p`, `--print`, or `--mode json`) sessions, named workflow dispatch waits for the terminal run snapshot and skips pickers. Because human input is runtime-only and workflows no longer carry a declaration-time HIL marker, headless dispatch does not reject a workflow because its source contains `ctx.ui.*`.

If you copy a HIL workflow example into a headless session, it can pass dispatch and then fail when execution reaches the prompt with an error such as `atomic-workflows: interactive ctx.ui.confirm is unavailable in headless (non-interactive) mode; run the workflow in interactive mode or remove the interactive prompt from this stage` (the primitive name varies, including `ctx.ui.custom`). Run those workflows interactively, or guard/remove runtime `ctx.ui.*` calls before using headless mode.

<p align="center"><img src="../images/workflow-input-picker.png" alt="Workflow Input Picker" width="600" /></p>

<!-- baseline-block: workflows/operations::005 -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 119–174 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/operations.md#workflow-commands`.

## Workflow Commands

```text
/workflow list
/workflow inputs <name>
/workflow <name> --help
/workflow <name> [key=value ...]
/workflow connect [run-id]
/workflow attach [run-id] [stage-id-or-name]
/workflow pause [run-id] [stage-id-or-name]
/workflow status [run-id]
/workflow status --all
/workflow interrupt <run-id|--all>
/workflow quit <run-id|--all>
/workflow resume <run-id> [stage-id-or-name] [message]
/workflows [full-workflow-uuid]
/workflow reload
```

Common controls:

```text
/workflow status                       # list retained active and terminal runs
/workflow connect <run-id>             # graph viewer, including terminal runs
/workflow attach <run-id> <stage>      # chat with a single stage
/workflow interrupt <run-id>           # pause resumably
/workflow resume <run-id> [stage] msg  # forward a steer message and resume
/workflow quit <run-id>                # pause gracefully and keep the run resumable
/workflows [run-id]                    # retained alias for /workflow resume (history picker)
```

Surface behavior:

- **Graph vs. stage chat** - Use `connect` for the workflow graph. Use `attach` when you want a chat pane for a specific stage.
- **Hierarchy chord** - `ctrl+x` is the workflow hierarchy chord: in an attached stage chat it means **return to graph**, and in the graph it means **return to main chat**. The workflow surface handles `ctrl+x` before configurable editor or tool actions, including while a composer draft, primitive prompt, custom question, stage switcher, or legacy prompt card owns input.
- **Draft preservation** - Leaving a stage preserves unsent composer and prompt drafts and keeps pending custom questions unresolved so they reappear when you attach again.
- **Queued-message survival** - Steering and follow-up entries queued from a stage chat live on the stage session, not on the pane. Detaching to the graph and reattaching rehydrates the pending `Steering:` / `Follow-up:` rows, and while you are detached the stage's graph node shows a `✉ N queued` badge so a pending message stays visible without attaching. The attached chat shows the pending text; the detached node shows only their count. Both read one projection that the stage handle keeps current from the session's complete `queue_update` snapshots, so rows and badge shrink together as the agent consumes entries. That projection is fed by the events rather than by a concrete Atomic `AgentSession`, so a stage backed by a custom `AgentSessionAdapter` keeps this behavior as long as it publishes ordinary `queue_update` events; each snapshot replaces the previous steering and follow-up lists rather than adding to them. A queue can also outlive the session holding it — a stage session that fails over to a fallback model hands its pending messages to the session replacing it, and a completed stage reopened as a post-mortem chat is restored holding whatever it was queued. Those messages were announced before the projection could reach the new session, so Atomic reads it once as it attaches and the rows and badge show them too.
- **Reserved keys** - `ctrl+d` and `q` do not navigate workflow surfaces; `ctrl+d` keeps its ordinary editor or prompt behavior where applicable, and `q` remains printable in text-owning prompts. Existing `esc`, `ctrl+c`, and graph `h` close/hide controls are unchanged.
- **Wheel and trackpad** - While the workflow graph is active, vertical wheel/trackpad gestures pan it up and down, and horizontal gestures pan wide graphs left and right when the terminal exposes horizontal wheel events. Focused graph and stage-chat overlays receive those gestures through the fullscreen application route, so scrolling stays inside the active workflow surface instead of falling through to terminal or main-chat scrollback.
- **Fullscreen mouse routing and selection** - A focused workflow graph or attached stage chat overlay receives wheel/trackpad and click input through the host's application-owned input route before the fullscreen viewport. Events the overlay does not consume fall through to pi-tui's viewport, while non-overlay focused components leave pi-tui's transcript scrolling, scrollbar interaction, and drag-selection path intact. Graph panning, stage-chat scrolling, node click-to-attach, and drag or multi-click selection therefore work without a separate selection mode. Copy uses OSC 52; terminals that refuse OSC 52 writes still support the modifier-drag bypass (Shift/Option, as provided by the terminal). `ctrl+t` is not a workflow control: focused workflow overlays leave it to the host `app.thinking.toggle` action, while inline tree selectors keep `app.tree.filter.noTools`.
- **Tool and node detail** - Attached stage chats match main chat's tool-detail expansion behavior while keeping expansion state local to the workflow UI context. Press Ctrl+O (the configurable `app.tools.expand` binding) to expand every visible workflow node and tool card, including single, parallel, and nested subagent progress, current tool activity, and artifact paths; press it again to collapse them. The toggle works for active, completed, and archived stage views, including at the supported 40-column terminal minimum. A mounted prompt, custom question, or other input-owning overlay keeps the key instead of changing it.
- **Footer context** - An attached live stage chat carries the main chat's current-folder and Git-branch identity into its themed footer and mirrors live extension status lines such as the MCP server indicator. Branch changes trigger a repaint through the host's cached footer provider, and extension status changes are read from that same provider rather than recomputed by the workflow UI.
- **Working animation lifecycle** - Ordinary attached-stage work keeps the same exact one-cell `∀` visible while following the active workflow theme's dark → accent → bright/bold → accent → dark luminance ramp every 88ms. Every agent and SDK turn resets to the dark regular phase with a fresh lifecycle-relative cadence; turn, terminal, error, replacement, and disposal cleanup stop the active timer without stale repaint. In an eligible retained-stage chat, every accepted idle follow-up — including a workflow-authored `stage.sendUserMessage(...)` after a prior turn ended — shows Working on admission or attach, including while Atomic restores a saved retained conversation, and keeps it through prompt startup, pre-turn compaction, and agent handoff. Attaching or remounting mid-delivery paints immediately rather than waiting for the turn's first event. A message queued into a live turn with `followUp`/`steer` uses that turn's existing status instead of starting a new one. A no-turn result, prompt or restore error, or terminal completion removes it; once the last accepted post-terminal delivery settles, a leftover start cannot bring it back. An accepted manual retry clears stale status from the prior prompt before showing new pre-stream activity. `NO_COLOR` retains regular/bold activity without foreground-color escapes. Reduced motion uses a static regular accent `∀` without an animation timer; factual automatic retry, fallback, compaction, cancellation, and error copy retains precedence.
- **Subagent statusline** - If a subagent is running while the fullscreen workflow graph is open, the graph statusline mirrors its summary so the run remains visible; hide the graph with `h`, leave it with `ctrl+x`, or reconnect later to return to the full below-editor widget.
- **Run control** - Use `interrupt`, `pause`, and `resume` for resumable live work. Pause/interrupt holds a stage's queued steering and follow-up items in place without dequeuing them or starting continuation; `resume` releases those items once in their existing per-queue order, but queue release alone does not start a model turn. `resume` on a non-paused run reopens the saved snapshot or overlay. Use `quit` to pause a live run gracefully while preserving it for `/workflow resume`.
- **Rediscovery** - Use `/workflow reload` after adding, editing, installing, or removing workflow resources or package manifest workflow entries and you want Atomic to rediscover them in-process ([Reloading workflow resources](#reloading-workflow-resources)).
- **Status listing** - `/workflow status` lists all retained active and terminal top-level runs by default; implementation-owned nested child runs are flattened into their parent workflow rather than listed separately. `/workflow status --all` is retained as a compatibility alias.

`/workflows` is the retained-run history alias for `/workflow resume`: with no id it opens the same mixed picker, but the resumable section lists only runs that the resume path can actually accept and the completed section is read-only inspection. A run with no durable checkpoint, missing/pruned artifacts, or explicit deletion is omitted from the resume picker; an explicit `/workflow resume <id>` still returns an explanatory error. It is intentionally different from `/workflow list`, which lists installed workflow definitions. See [`/workflow resume` — cross-session resume selector](#workflow-resume--cross-session-resume-selector) for the full picker semantics.

At the supported 40-column terminal minimum, attached stage chats keep the `ctrl+x return to graph` hierarchy hint. The TUI may truncate provider/model context to make room, but it keeps that context separate from the hierarchy hint so the controls stay readable.

<p align="center"><img src="../images/workflow-graph.png" alt="Workflow Graph Viewer" width="600" /></p>

Human-in-the-loop prompts appear as awaiting-input nodes in the workflow graph, not as ordinary chat modals — see [Lifecycle Notices and Human Input](#lifecycle-notices-and-human-input) for how to find and answer them.

<!-- baseline-block: workflows/operations::006 -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 175–246 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/operations.md#monitor-and-control-runs`.

## Monitor and Control Runs

The workflow tool exposes lifecycle controls for non-interactive use:

```ts
workflow({ action: "status" })                                  // list every session run, in-flight first
workflow({ action: "status", statusFilter: "running" })         // filter the run listing by status
workflow({ action: "status", statusFilter: "awaiting_input" })  // runs with a pending human prompt
workflow({ action: "status", format: "json" })                  // structured listing for programmatic use
workflow({ action: "status", runId: "<full-run-uuid>" })         // full detail for one run

workflow({ action: "stages", runId: "<full-run-uuid>", statusFilter: "all" })
workflow({ action: "stage", runId: "<full-run-uuid>", stageId: "review" })
// Prefer sessionFile/transcriptPath from stages/stage; quote the exact path, preserve Windows separators, then search/read small ranges.
workflow({ action: "transcript", runId: "<full-run-uuid>", stageId: "review" })
// Omit tail/limit for the default 5-entry preview; pass them for quick recent-context checks.
workflow({ action: "transcript", runId: "<full-run-uuid>", stageId: "review", tail: 40 })
workflow({ action: "transcript", runId: "<full-run-uuid>", stageId: "review", limit: 20, includeToolOutput: true })

// Free-form stage communication uses Intercom; prompt responses use workflow answer.
intercom({ action: "send", to: "<full-run-uuid>:review", message: "please focus on tests" })
workflow({ action: "answer", runId: "<full-run-uuid>", stageId: "approval", promptId: "prompt-1", response: true })
workflow({ action: "resume", runId: "<full-run-uuid>", stageId: "review", message: "continue with tests" })

workflow({ action: "pause", runId: "<full-run-uuid>" })
workflow({ action: "pause", runId: "<full-run-uuid>", stageId: "review" })

workflow({ action: "interrupt", runId: "<full-run-uuid>" })
workflow({ action: "interrupt", all: true })

workflow({ action: "resume", runId: "<full-run-uuid>" })
workflow({ action: "resume", runId: "<full-run-uuid>", stageId: "review", message: "continue" })

workflow({ action: "quit", runId: "<full-run-uuid>" })
workflow({ action: "quit", all: true })

// Abort one in-flight ctx.tool node without pausing the run.
workflow({ action: "quit", runId: "<full-run-uuid>", stageId: "tool:<argsHash>" })
workflow({ action: "interrupt", runId: "<full-run-uuid>", stageId: "publish-artifact" })

workflow({ action: "reload", reason: "added team workflow" })
```

Control behavior:

- `runId` requires the full 36-character run UUID for every lifecycle and inspection action, including `status`. User-facing status surfaces print that exact value, so pass it back verbatim; typed prefixes are rejected with a distinct `Run id must be a full 36-character UUID` diagnostic rather than resolved. Because ids are matched exactly and are unique, no run target is ambiguous. Status lists and run pickers show top-level user-launched workflows; nested child runs are implementation details of the expanded parent graph.
- `status`, `stages`, `stage`, and `transcript` with an explicit full `runId` first use the current session store, then perform one exact DBOS hydration when that id is absent locally. This is inspection only: Atomic does not claim ownership, change status, run workflow code, or resume the workflow. A stale durable `running` root is shown as `crashed` with its resumability and an explicit `/workflow resume <id>` hint; fresh work owned by another Atomic process remains `running`, offers read-only status guidance, and stays protected from local control or resume. Deleted/tombstoned, absent, malformed, cyclic, orphaned, nonreciprocal, out-of-scope, and duplicate-node records report distinct failures instead of inventing a partial graph. `status` without `runId` remains current-session-only and never scans durable history.
- `status` without `runId` lists every top-level run in the session with a concise per-run summary: the full run id, workflow name, run status, started/ended timing with pause-adjusted elapsed time, currently active stages, and awaiting-input details (count plus the stage, prompt id, kind, and message for each pending human prompt). In-flight runs are listed first. The summaries carry the exact identifiers that `answer`, `pause`, `resume`, `interrupt`, and `quit` accept, so an orchestrating agent can list runs and act on them directly.
- `statusFilter` narrows the `status` run listing: run statuses (`pending`, `running`, `paused`, `blocked`, `completed`, `failed`, `skipped`, `cancelled`, `killed`) match runs directly, `awaiting_input` selects runs with at least one stage awaiting input or pending human prompt, and `all` (the default) includes everything.
- `format: "json"` on data-bearing inspection actions (`status`, `stages`, `stage`, `transcript`) returns the full structured result; the default text output for `status` is the concise per-run summary list.
- `status` / `status <runId>` show terminal `ctx.exit(...)` statuses (`completed`, `skipped`, `cancelled`, or `blocked`) and the optional exit reason when one was supplied.
- `stages` lists stage summaries, including flattened stages from nested `ctx.workflow(...)` imports and `sessionFile`/`transcriptPath` when a stage has a persisted session. Use `statusFilter: "all"` to include completed, failed, skipped, and pending stages.
- `stage` returns details for one stage by exact stage id or exact stage name, including nested child stages shown in the expanded graph and the persisted `sessionFile` when available. User-facing graph and control messages print full stage IDs; pass one back verbatim, or use the stage's exact name. Prefixes and partial names no longer resolve. Two stages sharing an exact name return an ambiguity diagnostic rather than selecting one.
- `transcript` is reference-first with a small preview by default: it returns metadata, transcript paths, and up to 5 recent entries. For targeted lookup, quote the exact `sessionFile`/`transcriptPath` value without changing platform separators (preserve Windows backslashes), search it with `rg` or `grep`, then read only small surrounding ranges. Text results include JSON-escaped `sessionFileJson`/`transcriptPathJson` lines for copy-safe path literals. Pass explicit `tail` or `limit` to override the 5-entry preview; `tail` overrides `limit`; `includeToolOutput` includes captured snapshot tool output in snapshot transcript results.
- `answer` responds only to a pending primitive or structured human-input prompt. It accepts `promptId` plus `response`, `text`, or `message`, preserves prompt-kind validation, and never sends stage chat, steers, resumes, or starts a model turn.
- Send free-form updates through ordinary Intercom to `workflow:<rootRunId>/<segment>[/<segment>...]`; `*` matches one segment and `**` any depth. Use `intercom list` inside the invocation group to see live, pending, and possible future targets. Atomic delivers immediately to live stages and queues matching future stages, delivering them before their first model turn. `workflow:<rootRunId>/**` remains sticky for every future descendant until root termination; narrower name and pattern sends reach every future match. Valid paths outside the known set queue with a `notInKnownSet` warning and settle undeliverable at terminal only if never delivered. Use `ask` once the target has a reply-capable live session. Use `workflow resume` only for paused workflow control.
- `pause`, `interrupt`, and `quit` can target one top-level run or `all: true`; `stageId` cannot be combined with `all: true`. Stage-scoped `pause` and `interrupt` controls can target a visible nested child stage from the expanded graph. Atomic routes stage controls to the owning nested run internally.
- `interrupt` and `quit` can also name one in-flight `ctx.tool` node with `stageId`, by expanded node id, local `tool:<argsHash>` id, or tool name. Both mean the same thing for a tool: abort that single call now. Tool nodes stay non-attachable — this is an abort control, not a chat target. Identifiers resolve exactly first and then uniquely; a name shared by two tool nodes (or by a stage and a tool) returns the same ambiguity diagnostic stages get, listing each match as `<name> (tool)`.
- Aborting one tool node leaves every sibling stage and sibling tool node running and does not pause the run. The node becomes `cancelled`, writes no replayable checkpoint, and re-runs on a later resume. Whether the run itself survives is ordinary author control flow: an awaited `ctx.tool` that is aborted rejects, exactly as it would for any other failure, unless the workflow catches it. A node that has already settled reports that it is not running rather than silently succeeding.
- Whole-run `quit` stays authoritative even if workflow code catches the tool rejection. A catch may run cleanup, but its returned outputs do not convert the quit into a completed run: the executor suspends and quit's paused/resumable record stands. To abort one call and intentionally keep the workflow going, target that node instead of quitting the run.
- A targeted tool abort reports the node outcome and the run separately: `status: "cancelled"` for the node it cancelled, `stageId` for that node, `abandoned` when the callback ignored its signal, and `workflowStatus` for the run status *observed* when the action returned. It never reports `paused`, and it never predicts what the run does next.
- `pause` never accepts a tool node: `ctx.tool` has no turn boundary to stop at, so Atomic rejects it with `Tool nodes cannot be paused; ... Use interrupt or quit to abort it.` instead of a silent no-op.
- `interrupt` is resumable: it pauses live work when pausable stages exist and keeps the run in live history/status.
- `pause` is useful for pausing a live run or a single live stage without treating it as a destructive abort.
- `resume` can target a stage with `stageId`; the target may be an exact stage id or an exact stage name. `message` is forwarded to paused work. For a live interrupted streaming prompt, Atomic preserves the existing prompt loop without duplicating the user message and injects `Continue where you left off. If you believe you are finished with your original task (or a redefined task if the user told you), stop.` when required before normal readiness-gate completion. For a paused stage that was idle waiting for a new stage-chat turn, a non-empty message resumes the stage and starts exactly one fresh prompt containing that message; an empty resume releases the pause without creating a prompt.
- An explicit workflow-tool `resume` target that is absent from the current session store triggers targeted DBOS discovery before Atomic returns `Run not found`. The target must be a full run UUID; an eligible exact ID resumes under the original workflow ID, and a malformed target is rejected before any durable lookup happens. Resource-loading and durable-backend failures remain visible. Ordinary workflow-tool `status` listing stays session-local and does not eagerly hydrate durable history.
- Exact-id durable inspection is separate from resume. `status`, `stages`, `stage`, and `transcript` may hydrate one missing-local root for read-only inspection, but they never claim it or execute replay. Only an explicit `resume` action enters the claim-and-dispatch path.
- Run-level `quit` gracefully pauses in-flight work, marks the run resumable, and leaves it available to `/workflow resume`. A run whose only in-flight work is a `ctx.tool` node is quit like any other: it pauses as resumable instead of reporting that there are no controllable stages.
- `reload` refreshes discovered workflow resources in-process; the optional `reason` is echoed in the result.

Use slash commands for graph connect and stage attach because those are interactive TUI surfaces. When a run needs user input or attention, tell the user instead of polling silently.

<!-- baseline-block: workflows/operations::007 -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 247–272 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/operations.md#pausing-quitting-and-resuming`.

### Pausing, quitting, and resuming

Graceful quit is idempotent for an already-paused resumable run. If a run is waiting on `ctx.ui`, quit preserves its current DBOS prompt reservation. Answers cannot advance paused workflow code until explicit resume; checkpointing the answer releases exactly that reservation generation. Concurrent and nested prompts use composed scopes and independent DBOS reservation tokens.

**Quit closes `ctx.tool` admission before it becomes a durability boundary.** A run-level quit pauses controllable stages and waits for their acknowledgements, then closes the root-shared tool-admission boundary shared by the root run and every nested run. Closing is what makes the following scan final: a call admitted while the stage pauses were still being acknowledged is included, and no call can start afterwards — not even while the durable write is in flight. Quit then aborts that complete set, waits a bounded interval for the callbacks to settle, and only then records the durable paused transition and marks the run resumable.

Aborting a call is the point of no return: that callback's executor is already committed to suspending. So if the durable paused transition then fails or is refused, Atomic still records the pause locally — the run is never left reported as running with nothing running it — but does not advertise it as resumable, and the reported error names both the durable failure and what it left behind. The run stays controllable, so running `/workflow quit` again re-attempts the durable transition and upgrades the run to resumable once it lands.

A `ctx.tool` call attempted after admission closed never runs: it receives the graceful-quit signal, so it suspends the workflow instead of failing it, and creates no graph node, checkpoint, or side effect.

A callback that ignores its abort signal is abandoned rather than pinning quit forever — mirroring the failure path — and the quit result reports each abandoned call in `abandonedTools` alongside the cancelled nodes in `cancelledTools`. Both carry the owning `{runId, nodeId}` identity, because two nested child runs legitimately share one local `tool:<argsHash>` id; slash/tool output prints them as `<runId>/<nodeId>`.

A run whose only in-flight work is a `ctx.tool` node counts as controllable work: it pauses as resumable instead of returning `no_active_stages`. Because a cancelled tool node has no replayable checkpoint, resume re-executes exactly that callback at the same ordinal and node id; completed sibling tools replay from cache.

Catching the cancellation does not opt out. If workflow code wraps the aborted `await ctx.tool(...)` in `try`/`catch` and returns normally, Atomic still suspends the run rather than publishing a completed result, so the paused/resumable state quit recorded is what survives.

When a callback was abandoned, its executor stays alive but stops owning the run: Atomic detaches that background job, so `/workflow resume` launches a fresh executor under the same workflow id instead of adopting a job nothing is driving. The abandoned callback may still finish afterwards — its aborted signal blocks any replayable write, and its stale bookkeeping can neither mutate the replacement run's tool node nor unregister the replacement's job or cancellation entry.

When a paused stage interrupted an active model turn, Atomic preserves that turn's existing pause loop: a non-empty resume message is delivered exactly once through the resumed loop, and (if the stage has not finalized) Atomic injects `Continue where you left off. If you believe you are finished with your original task (or a redefined task if the user told you), stop.` before normal completion/readiness handling. A no-message interrupted-turn resume injects the same continuation directly. A different state applies when the stage was idle and waiting for a new stage-chat turn: resuming with a non-empty message starts exactly one fresh prompt containing the text, while an empty resume only releases the pause and does not fabricate a user turn or continuation.

The same continuation applies to user messages queued into a live streaming stage. Steering a turn (Enter in an attached stage chat) or queueing a follow-up (Ctrl+F) arms the identical continuation prompt, which Atomic injects once when the interrupted turn ends — even if several messages were queued during that turn — so a steered stage returns to its original (or user-redefined) objective instead of stopping after answering the queued message.

Messages delivered to an idle stage start a fresh user turn immediately and receive no continuation nudge; abort, kill, workflow exit, and finalized/fail-fast stage boundaries suppress late prompt creation and continuation injection.

When several paused stages resume together, Atomic settles every acknowledgement and then re-reads the actual stage/control state. A late rejection after its stage visibly starts counts as resumed and is not retried; genuinely paused failures remain available for a later resume. The run and durable root follow visible running work, while slash/tool output reports acknowledgement or durable-transition failures as partial progress instead of a no-op. If local resume succeeds but persisting the durable running transition fails, a later resume request retries reconciliation while the durable handle remains paused. A terminal run cannot be revived by a late acknowledgement.

<!-- baseline-block: workflows/operations::009 -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 300–364 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/operations.md#lifecycle-notices-and-human-input`.

## Lifecycle Notices and Human Input

Atomic emits deduplicated main-chat notices when top-level workflow runs complete, fail, end blocked, or stop at an active recoverable provider/auth/rate-limit block. A recoverable block remains resumable (`status` surfaces and headless results report it as blocked even though the stored live snapshot stays active), is retained durably as blocked for cross-session resume, appears in the resume picker, and its notice says the workflow **is blocked** rather than implying terminal completion. Each blocked occurrence is deduped by its `blockedAt` timestamp, so a resumed workflow that hits another recoverable block re-notifies the invoking chat. Nested child workflow outcomes are reflected inside the expanded parent graph instead of producing separate top-level cards.

Treat a blocked run as continuable by default; the blocked notice text itself carries this instruction. On a `WORKFLOW BLOCKED` notice or a blocked status, keep the work moving: resume a resumable block, answer the pending prompt, steer the stage past the obstacle, or start a follow-up workflow that carries the remaining tracked work past a terminal block — continue inline only if the remaining work is minimal. Stop for user input only when the task is so ambiguous that competing interpretations lead to materially different outcomes and judgment cannot infer intent from the stated objective and repository evidence; mine git history, commits, PRs, issues, and the user's own comments before asking. When `ask_user_question` or another human input channel is unavailable, continue fully autonomously on the interpretation best supported by that evidence, and record the assumption in the result or an artifact. A budget-exceeded stop (the resumable `budget_exceeded` blocked rail) is the exception, and its notice says so: the exhausted budget is a boundary someone chose, so summarize progress and the estimated next steps, ask the user whether to proceed — prefer the `ask_user_question` tool when it is available — and resume with a raised `budget` only after approval.

Previously, the streaming `persistWhenStreaming` path directly appended the visible card. It did not enqueue a native steer/follow-up or schedule a later model step. Therefore, an earlier provider context snapshot could finish with an uncorrected running claim.

Streaming lifecycle delivery now deliberately splits display from reconciliation. Before send admission resolves, Atomic appends one `display: true`, `excludeFromContext: true` lifecycle card to agent state and `SessionManager`; that same durable entry atomically carries the recovery marker for its hidden turn. Atomic separately submits the same raw notice text as a `display: false` internal reconciliation through the native steer boundary. This fixes the former direct-context race: a visible entry cannot become provider input between an assistant `workflow` call and its required `status=running` result, while a notice that arrives during final text still causes a later correcting step. The lifecycle path never aborts the active chat itself.

| Parent state when the notice arrives | Card and prompt transition | Invariants |
| --- | --- | --- |
| Idle | Commits the display card, then starts one native prompt with the hidden reconciliation. | Admission already includes the durable card; only the hidden copy enters model context. |
| Active between completed tool calls | Commits the card and queues the hidden steer for the next native provider step. | Existing completed tool ordering stays intact. |
| Active with the workflow tool result pending | Waits for earlier event writes, commits the context-excluded card, then lets the hidden steer follow the matching result. | Provider and reopened-file order remains assistant tool call → `status=running` tool result → lifecycle reconciliation. |
| Active final-text streaming | Commits the card without stopping the current text; the hidden steer then creates a safe continuation that can correct a stale progress claim. | The unrelated text finishes normally unless another caller aborts it, and an ordinary abort cannot clear the admitted reconciliation. |

The visible card preserves the lifecycle custom type, raw notice text, exact details payload (including omitted optional fields), and display behavior. Each deduplicated occurrence has exactly one visible/persisted lifecycle card; the internal reconciliation is hidden and persisted separately only after agent-core consumes it at the provider-safe boundary. If the process exits after card admission but before consumption, startup finds the unresolved marker and queues that hidden correction once; repeated startup binding skips an already queued intent, and the persisted hidden completion suppresses all later restores. Protection is registered before public card listeners run. Session replacement and shutdown fail closed while the hidden input remains queued, since persisting it before a pending tool result would break provider protocol order; host-owned invalidation work does not run on that failed teardown. A transient reconciliation write failure retries persistence without re-queueing model input or creating another card. Physical session appends restore the exact prior file length after a partial write failure, so a later card or reconciliation retry cannot inherit a malformed JSONL tail or phantom parent. Before session replacement or shutdown can discard consumed in-memory recovery state, Atomic flushes the reconciliation again; if that write still fails, disposal stops and keeps the current session recoverable. `clearQueue()` restores only protected references it actually removed, so a reference already drained into core-local in-flight state is not aliased. Stage-session delivery transfer moves protection only with transferred queued references and leaves in-flight ownership at the source. Delivery is acknowledged only after the display card append succeeds; while the invoking chat remains active, a rejected admission retains its original payload and retries with capped backoff even if the run changes state or notification configuration is reinstalled. Session replacement cancels those admission attempts and clears their payloads rather than waking an unrelated chat with an uninspectable old run. Awaiting-input workflow states are tracked for dedupe/restore, but they do not enqueue main-chat connect cards or wake the model; prompt state remains visible through workflow status/connect surfaces.

When an active recoverable block is resumed in-process, Atomic dispatches a fresh-ID continuation that replays the source's completed stages and re-runs the failed one. The durable source is left untouched (stays `blocked`/resumable) so it remains discoverable and recoverable, including a zero-checkpoint first-stage block, if the process dies before the continuation settles. The local source snapshot is killed when that continuation is admitted, so this session has one active run. A fail-closed topology mismatch puts the blocked snapshot back so the same session can retry. A process-local claim prevents a concurrent same-session double-dispatch.

Completed top-level `ctx.tool` nodes also replay into the fresh run. See [`ctx.tool` — durable cached tool execution](#ctxtool--durable-cached-tool-execution). A fail-closed topology mismatch ends that continuation; the durable source stays blocked and resumable, and the same session can retry after the continuation settles.

Deliberate control actions on a top-level run report themselves too. `/workflow <name>` emits a `WORKFLOW STARTED` notice (`▶`), `/workflow pause` a `WORKFLOW PAUSED` notice (`⏸`, warning tone), `/workflow quit` a `WORKFLOW QUIT` notice (`⏹`, warning tone, carrying a `resumable` field), and `/workflow resume` a `WORKFLOW RESUMED` notice (`▶`). All four travel the same steer delivery, capped-backoff retry, and notice-card path as the failure notice. The paused and quit text states that the stop was deliberate and user-requested and tells the model not to resume the run or take the work over unless asked, with `/workflow resume <run-id>` as the card hint; the resumed text does not, because the run is progressing again.

**Only user actions notify.** The equivalent `workflow({ action: "run" | "pause" | "quit" | "resume" })` tool calls stay silent: the tool result already tells the agent what it just did, and a second steer would spend a turn repeating it. `/workflow interrupt` raises no notice at all. Engine-internal transitions are silent for the same reason a notice must name an actor to exist — answering a human-in-the-loop prompt resumes the run internally, and reporting that would both flood the chat and defeat the deliberate decision that `awaiting_input` never wakes the model.

**Two attributions.** *Origin* is who launched the run and renders on every kind as "which you started" or "which the user started"; it is set once at dispatch, persisted through session restore and durable resume, and inherited by a continuation from the run it continues. *Actor* is who performed this one event and renders as "The user paused" or "You paused". They differ routinely — the agent starts a run and the user quits it. A run with no recorded origin, including a legacy or restored snapshot, omits the clause entirely rather than guessing.

**One notice per request.** A whole-run pause or resume reports at run scope. A stage-scoped `/workflow pause <run> <stage>` that leaves other stages running reports at stage scope, and one that stops the last active stage reports the run instead — never a stage card and a run card for the same request. A quit reports only the quit, never the pause it publishes on the way. Because control actions are reversible, these notices are deduplicated by run id *and* the occurrence timestamp, so pause → resume → pause → resume emits four notices while repeated snapshot invalidations at one unchanged state emit one. Resuming reports a resume and never a start, whoever asked for it — a resumed run re-enters the dispatch path, so keying that on the resume rather than on the requester is what stops an agent-requested resume of a user-started run from being announced as a fresh launch. Resuming a failed or blocked run launches a continuation under a fresh run id, and its notice names both ("run 4d7e, continuing run 8c31"); resuming a quit run reuses the original workflow id so durable checkpoints replay, so that notice names the one id. A run that is already started, paused, or quit when notifications install — restore, replay, `/reload`, or a session-preserving reinstall — is seeded as delivered and stays silent, and nested `ctx.workflow(...)` child runs never notify at top level.

Configure lifecycle behavior with `workflowNotifications.enabled` (default `true`) and `workflowNotifications.notifyOn` (default `["started", "completed", "failed", "blocked", "budget_warning", "awaiting_input", "paused", "quit", "resumed"]`). A config that pins `notifyOn` explicitly keeps exactly the kinds it lists, so `notifyOn: ["failed"]` suppresses every control notice. `budget_warning` is delivered once per run and dimension through the same lifecycle-notice renderer.

**Heartbeats are separate from lifecycle notices.** A lifecycle notice reports a transition; a heartbeat reports that nothing has transitioned yet. While a top-level run is active, Atomic raises one `workflows:workflow-heartbeat` card per `startedAt + n × heartbeatIntervalMinutes` boundary, on the same queued-steer delivery (`triggerTurn`, `deliverAs: "steer"`, `persistWhenStreaming`) and the same notice-card renderer, under its own custom type. The cadence is per workflow definition — `15` minutes by default, `0` to disable — and is documented under [`heartbeatIntervalMinutes`](/workflows/api-reference#heartbeatintervalminutes). `workflowNotifications.notifyOn` selects lifecycle kinds only; it does not list or filter heartbeats. Heartbeats stop when the run reaches a terminal state: one idempotent cleanup pass drops its timer, its schedule, and any heartbeat still queued inside the scheduler, a later process discards those records rather than replaying them, and a card the parent's queue had already accepted is excluded from the model's context when it is read ([#1975](https://github.com/bastani-inc/atomic/issues/1975)).

Human input is runtime-only: call `ctx.ui.input`, `ctx.ui.confirm`, `ctx.ui.select`, `ctx.ui.editor`, or `ctx.ui.custom<T>` when the workflow needs a decision. No builder-level declaration is required or supported.

Human-in-the-loop prompts from `ctx.ui.input`, `ctx.ui.confirm`, `ctx.ui.select`, `ctx.ui.editor`, and `ctx.ui.custom<T>` appear as awaiting-input nodes in the workflow UI/graph viewer, not as ordinary chat modals. Workflow definitions do not declare HIL; runtime `ctx.ui.*` calls create prompt nodes. If the prompt lives inside an imported child workflow, it still appears in the same expanded parent graph so the user can focus and answer it without switching to a separate child status entry. When the attached stage has a pending prompt, its attribution banner is headed `AWAITING INPUT` and shows the full run id in a two-row identity block; the question and its options continue through the existing prompt UI below the banner.

Use `/workflow connect <run-id>` (or F2), then press Enter on the focused node or click a graph node to focus and open or attach it for local answers. Custom widget prompts mount inside the attached stage chat and must be completed interactively with the widget's `done(value)` callback.

When a workflow needs human input, answer in the graph viewer or attached stage chat when possible:

```text
/workflow connect <run-id>
/workflow attach <run-id> <stage-id-or-name>
```

Agents can answer primitive and structured pending prompts programmatically with `workflow({ action: "answer", ... })` only while the root workflow is nonterminal; use `promptId` when it is present in the stage details, and provide answer content with `response`, `text`, or `message`. Arbitrary custom TUI widget prompts intentionally refuse this path in iteration 1 because a generic `T` cannot be reconstructed safely from a non-TUI payload.

`ctx.ui.custom<T>(factory, options?)` reuses Atomic's TUI component path: the factory receives the same real `(tui, theme, keybindings, done)` types as extension `ctx.ui.custom`, and the workflow resumes with the value passed to `done(value)`. Use `options.label` for a safe display-only graph/status label and `options.replayIdentity` when widget semantics can change without the callsite changing. Do not put secrets in labels or replay identities; only a hash of the identity is stored, and label text is not part of replay identity. Both inline connected rendering and `overlay: true` mount in the graph viewer's attached stage chat: overlay is a placement hint rather than a capability request, so an in-stage `ask_user_question` — which always asks for an overlay — mounts, takes focus, and resolves like any other custom prompt. There is no nested host overlay above the graph chrome; the widget occupies the stage-chat custom-UI slot and `overlayOptions` / `onHandle` are not consumed there.

Prompt answers are replayable only while the source run remains in the live in-memory store. `StageSnapshot.promptAnswerState` is snapshot-safe metadata for continuation: `available` means a matching live answer can be replayed, `unavailable` means the matching prompt node exists but its private answer was purged, and `ambiguous` means multiple matching prompt nodes exist so Atomic asks again. The raw answer lives in a private `PromptAnswerRecord` ledger, is never written to snapshots or persistence, and remains resident in memory until the answer is cleared, the run is removed, or the store is cleared.

Prompt replay keys include the prompt kind, message text, select choices, input/editor initial value, custom prompt identity hash, and hashed author callsite, so changing any of those inputs may intentionally re-ask on continuation. An empty `ctx.ui.select(..., [])` has no answerable choices and throws before creating a prompt node. Arbitrary custom-widget answers cannot be supplied through `workflow answer`; focus the `custom` awaiting-input node in the interactive graph instead.

If the user answers a human-in-the-loop prompt in the workflow UI or stage UI broker, the stage receives the answer directly and the active main chat receives a display-only notice (`triggerTurn: false`, `excludeFromContext: true`) containing a concise answer summary. The notice is rendered for the user and persisted for audit, but it does not wake the model, enter LLM context, or authorize answering any other workflow prompt. Prompt answers sent by the main-chat `workflow` tool are suppressed from this notice because the tool result already informs the current turn.

When an interactive, non-schema workflow stage calls `ask_user_question`, Atomic waits for the stage's assistant turn to finish and then brokers the deterministic readiness question **“Are you ready to move on to the next stage?”**. This includes typed or freeform questionnaire answers reported as `details.answers[].kind === "chat"`: the assistant first gives its normal conversational response, then the stage becomes `awaiting_input` with `inputRequest.kind: "readiness_gate"` in workflow status and graph surfaces.

In this chat-answer flow, choosing the ready option completes the stage and releases dependent stages. Choosing the not-ready option keeps the stage open for a genuine stage-chat turn and brokers readiness again after that turn. A chat answer is never treated as an invisible stay decision. On the readiness gate, **Type something.** sends the typed text as the next stage-chat message (empty or whitespace-only text cannot be submitted). **Chat about this** is a plain option — it does not open an inline editor — and stays by sending `The user would like to chat more about this`.

The readiness prompt can be answered in the attached stage UI or with `workflow({ action: "answer", ... })`. Ordinary structured-option answers retain their existing readiness behavior. A schema-backed stage that has successfully finalized through `structured_output` is terminal and does not reopen this readiness gate.

<!-- baseline-block: workflows/operations::010 -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 365–380 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/operations.md#durable-workflows-and-cross-session-resume`.

## Durable Workflows and Cross-Session Resume

Atomic workflows use **DBOS/Postgres as their sole persistent workflow backend**. Atomic configures and launches DBOS lazily on the first workflow action, reuses that process-wide instance, and awaits readiness before workflow execution, resume, inspection, or deletion can access durable state. `DBOS_SYSTEM_DATABASE_URL` may select an existing database. Once DBOS is ready, query and write failures fail the workflow action and never switch backends.

**Zero-configuration local database.** Without `DBOS_SYSTEM_DATABASE_URL`, Atomic runs DBOS against its own embedded Postgres built from npm-distributed binaries — no Docker daemon or system Postgres install. The cluster lives under `~/.atomic/postgres/v18` on dedicated port `5439`; the first workflow action initializes it once and starts `postgres` directly behind an opaque retained native process lease. Concurrent Atomic sessions may attach to the same cluster, and an abrupt process exit releases the lease without killing Postgres. During orderly durable shutdown, only the process holding that exact lease sends fast shutdown and waits for the retained process; attached or replacement clusters are left untouched.

**Running as root (Linux).** PostgreSQL refuses to run as UID 0, so a root Atomic process (containers, CI sandboxes, eval harnesses) resolves an unprivileged system account (`postgres`, `nobody`, or `daemon`) and keeps the cluster under `/var/lib/atomic-postgres` instead (a root home directory is untraversable for that account). Before any owner command runs, Atomic probes that candidate runner itself and accepts it only when it proves the account's exact UID, exact primary GID, membership in that primary group, and no root group; legitimate additional nonroot groups remain valid. The retained native direct-Postgres spawn also clears inherited supplementary groups before setting the primary GID and UID. When the embedded binaries themselves sit under an untraversable prefix (for example a root-owned `~/.nvm` global install), Atomic publishes and reuses one exact package-content runtime generation under a root-owned cache. Published runtime files remain readable/executable but not writable by the Postgres account. Runtime reuse and publication re-snapshot the current source, publication validates the deterministic path after rename, and source mutation, corrupt content, or setup-lease displacement fails closed without unbounded repair copies.

If embedded provisioning fails without leaving retained-process cleanup pending, Atomic tries DBOS's reusable `dbos-db` Docker container. If DBOS still cannot become ready, workflows **degrade to a process-local in-memory backend with a loud warning** instead of refusing to run: the run executes normally, but its state does not survive the process and `/workflow resume` after exit has nothing to restore. Fix the configured database or set `DBOS_SYSTEM_DATABASE_URL` to a working Postgres to restore durability.

**Multiple concurrent Atomic sessions.** Every Atomic process launches DBOS with a unique executor id, and running root workflows carry owner/heartbeat metadata. Once an active model stage has a session path, Atomic records that identity after the stage-start record and awaits the checkpoint before the first model use, then runs serialized, unref'd liveness checkpoints on a bounded 30-second cadence for the root and nested scoped workflows. Each accepted checkpoint refreshes root metadata; timers stop on every stage exit and cannot keep Atomic alive. A persistent checkpoint fault fails the active stage instead of disappearing in a detached timer. A stage that is shutting down drains the checkpoint still in flight rather than abandoning it, so a failure that lands after the model turn finished is reported instead of discarded, and a stage whose final durability checkpoint fails is recorded as `failed` rather than `completed` — its caller receives the error and its concurrency slot is released either way. **Running workflows are never resume targets**: a running row with a fresh heartbeat is hidden from every session's picker and refused by direct `/workflow resume <id>` — resuming a workflow that is executing elsewhere would double-dispatch it. Once the heartbeat goes stale (about two minutes after a crash), an exact inspection or the resume picker reports the workflow as `crashed`.

Within one Atomic process, DBOS writes stay ordered per durable root workflow. A slow or stalled write for one root does not block an independent top-level workflow from persisting its registration, reaching startup admission, or recording later checkpoints. Nested workflows share their durable root's write order. Process shutdown and explicit lifecycle drains still wait for every root.

When two sessions race to resume the same paused workflow, a durable first-writer-wins claim decides exactly one winner; the loser reconciles to the authoritative state and reports that the workflow changed while resume was pending.

<!-- baseline-block: workflows/operations::012 -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 403–469 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/operations.md#ctx-tool-—-durable-cached-tool-execution`.

### `ctx.tool` — durable cached tool execution

The `ctx.tool(name, args, fn, options?)` primitive runs arbitrary TypeScript code as a first-class durable graph node and caches the result durably. The node is non-attachable and has no stage chat controls, and its graph card body is the constant `durable tool` in every state — status, timing, and dependency rows keep their own rows, and the card does not preview the result or error. In the graph viewer, focusing the node and pressing Enter, clicking it, or choosing it from the switcher opens a read-only host-style operator card from the snapshot: a status-tinted shaded rectangle with the same inner padding and header/body gap as the main-chat tool block, inset from the orchestrator header and footer bars, a `$ <tool-name>` call header, an optional short argument summary, and the result or error as its body. Running and completed call headers have no status marker; pending, failed, cached, and cancelled calls retain their quiet markers. It is collapsed by default and wraps the fully bounded result or error before showing its last visual rows, with `... (N earlier lines, ctrl+o Expand)` above the tail when the action is bound; the configured `app.tools.expand` action (`ctrl+o` by default) toggles the full bounded result or error and then a muted callback-source block when source exists. The graph statusline advertises the resolved expand key with `expand` or `collapse` alongside return-to-graph and scroll hints, including remapped keys, and omits that segment entirely when the action is unbound. The footer says `Took` for settled calls or `Elapsed` for running calls, using the same second-resolution duration as the main-chat tool block, with cached/replayed markers kept as a quiet suffix. The operator surface has no ARGS/RESULT/SOURCE/TIMING/MARKERS debug table and does not expose raw clock fields. Source capture uses `fn.toString()` at registration without re-executing the callback or reading a file. `↑`/`↓`, `PageUp`/`PageDown`, `Home`/`End`, the wheel, and the scrollbar all scroll the block, so a long payload stays readable on a keyboard-only session or a terminal without mouse reporting; Escape or `ctrl+x` returns to the graph. The message block is read-only and never offers chat attachment, steering, interrupt, or resume. Bounded payloads remain width-safe and mark truncation explicitly with `… [truncated]`; source tabs expand and control bytes become `\xNN`, while cyclic payloads, throwing `toJSON`, or throwing property getters render `<cycle>`, `<unserializable>`, or `<unreadable>` instead of crashing the view. The same cap applies to what the live run snapshot retains for a tool node, while durable checkpoints keep the exact output, raw-args `argsHash`, and replay behavior unchanged.

When the workflow body fulfills but one or more admitted tool calls failed, Atomic promotes the first observed failure to the terminal run failure, regardless of admission order, and persists that selected tool-node identity for status inspection and lifecycle output. A direct uncaught `await ctx.tool(...)` rejection keeps the original error and persists its failed-node link through session and durable restore. First-event arbitration also preserves the selected node when concurrent failures throw the same object or primitive; unrelated later stage or body errors do not inherit a caught tool's origin. Tool admission remains open while author code can catch a failure and continue. Once the body settles and failure has won before any real cancellation, Atomic closes admission, cancels remaining non-failed tool nodes, waits for observed failed nodes to finish publication, and publishes the failed root without waiting for callbacks that ignore cancellation.

Set `failureMode: "return"` when a failed check is expected data for a later repair stage. Atomic runs all configured retries first, then returns a `WorkflowToolOutcome<TValue>`. A successful callback returns `{ ok: true, value, attempts, cached }`. An exhausted callback failure returns `{ ok: false, error, attempts, cached }`; `error` preserves integer `exitCode` and string or byte-buffer `stdout`/`stderr` when the thrown value exposes them. The live and restored tool node stays `failed`, while the workflow body may continue and complete. On replay, Atomic returns the same stored outcome with `cached: true` and does not run the callback again.

On a fresh-ID continuation, completed top-level `ctx.tool` nodes replay into the new run and keep their graph identity as parents of downstream stages, including concurrent `Promise.all` fan-out. A `failureMode: "return"` checkpoint, success or `return_failure`, is reused as the recorded outcome rather than re-running the callback. A later fresh-ID hop reuses that result only when the intermediate run republished the checkpoint under its own id. That republish is best-effort; if it does not land, the next hop runs the callback again.

Start a new run, or change the tool name or args, to force a completed return-mode callback to execute again. A continuation will not. Inspection-only `tool-failure:` throwing records stay out of the replay cache, so those calls run again. Completed child stages replay; incomplete siblings follow their ordinary continuation policy. When the source checkpoint has topology, a fresh-ID continuation fails closed if it admits a live parent the restored set does not include. Replayed siblings that settle before the next sibling spawns still keep the source parents, including concurrent root-level tools with no seed stage. A topology-less checkpoint skips that check and infers parents on the continuation. A fail-closed mismatch ends the continuation; the blocked source stays resumable in the same session, including its recorded prompt answers and BLOCKED notice, and no terminal source entry is persisted. `/workflow resume` can be retried without asking those questions again. After a non-mismatch continuation settles, Atomic persists the superseded source as terminal so a rebuilt session cannot resurrect it.

Recoverable output is explicit data flow. Atomic does not add a failed tool outcome to a later stage prompt. The workflow author must place the needed fields in `prompt`, `previous`, an output, or an artifact. Each persisted error text field is best-effort secret-redacted with the workflow persistence rules and limited to 16 KiB of UTF-8; truncated fields keep the final bytes with a marker. Keep the database sensitive even with this filter.

Cancellation, closed tool admission, and durable-storage faults still throw. They never become ordinary `{ ok: false }` callback outcomes. Omitting `failureMode: "return"` also keeps the existing behavior: an exhausted callback error rejects `ctx.tool` and fails the workflow unless author code catches it. Atomic persists that failed node and the root's selected tool link for later inspection, but excludes the failure record from the replay cache, so a resume or rerun calls the function again. Command failures that expose `exitCode`, `stdout`, or `stderr` remain failures even when a wrapper also uses cancellation-like text or codes; only a real run cancellation that wins the terminal race produces a killed/cancelled root.

**Per-node cancellation and per-attempt deadlines.** Each logical `ctx.tool` call runs under its own `AbortController`, combined with the run's signal and handed to the callback as `{ signal }`. A run abort cascades to every live node; `workflow({ action: "quit"|"interrupt", runId, stageId })` naming one tool node aborts exactly that node and leaves its siblings alone. Without `timeoutMs`, retries share that logical call signal. With `timeoutMs`, every attempt gets a fresh signal and deadline; expiry aborts that attempt and becomes an ordinary attempt failure, while run cancellation and operator abort remain cancellation.

A cancelled call is recorded as `cancelled`, not `failed`, and is never a run failure by itself: it writes no replayable `tool:` checkpoint and no `return_failure` outcome even under `failureMode: "return"`, so a cancellation can never replay as data. Return mode does keep exactly one inspection-only `tool-failure:` record carrying the cancellation message, written for every cancellation timing — while the callback awaits, when the callback throws, and when the callback fulfills after the abort but before persistence. That id is excluded from replay lookup, so `getToolCheckpoint()` still misses and the call runs again. A callback that ignores its signal and returns late is caught before persistence, so its value cannot become a checkpoint either. Resume recomputes the same ordinal and `argsHash` from authored order, so the re-run occupies the same `tool:<argsHash>` graph node instead of creating a new one.

Tool admission stays open while the workflow body runs and while already-admitted tools drain, including immediate promise-settlement continuations. Before any completed, failed, blocked, exited, or cancelled executor outcome is published, admission closes atomically. A detached call through a retained `ctx.tool` function after that point returns a rejected native promise without starting its callback, retries, graph node, or durable checkpoint; ignoring that promise does not emit an unhandled rejection.

```ts
export default workflow({
  name: "data-pipeline",
  inputs: { source: Type.String() },
  run: async (ctx) => {
    // This side effect is cached durably. On resume, it will NOT re-execute.
    // Forwarding `signal` lets a quit or targeted abort stop a hung fetch instead of
    // pinning the run until the request gives up on its own.
    const data = await ctx.tool(
      "fetch-dataset",
      { source: ctx.inputs.source },
      async ({ signal }) => {
        const res = await fetch(ctx.inputs.source, { signal });
        return await res.text();
      },
      { retriesAllowed: true, maxAttempts: 3, timeoutMs: 45 * 60_000 },
    );

    // Subsequent stages use the cached result.
    const analysis = await ctx.task("analyze", { prompt: `Analyze: ${data}` });
    return { summary: analysis.text };
  },
});
```

A bounded repair loop can pass only the needed failure evidence and use distinct arguments for each real rerun:

```ts
for (let iteration = 1; iteration <= 2; iteration += 1) {
  const tests = await ctx.tool(
    "run-tests",
    { iteration },
    async () => runCommand(["bun", "test"]),
    { failureMode: "return", retriesAllowed: true, maxAttempts: 2, timeoutMs: 10 * 60_000 },
  );

  if (tests.ok) break;
  await ctx.task("repair-tests", {
    prompt: `Fix these test failures:\n${tests.error.stderr ?? tests.error.message}`,
  });
}
```

Changing `iteration` makes each loop pass a distinct durable call. Reusing the same call position and arguments during resume replays its stored outcome instead of running it again.

<!-- baseline-block: workflows/operations::015 -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 524–539 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/operations.md#configuring-dbos/postgres`.

### Configuring DBOS/Postgres

**Alpine/musl archives.** Musl release archives deliberately omit `@embedded-postgres/*` binary packages because the available packages are glibc-linked and cannot run on musl. Durable workflows on Alpine must use external Postgres by setting `DBOS_SYSTEM_DATABASE_URL` or use Docker. If neither is available, Atomic falls back to a process-local in-memory backend with a loud non-durable warning; state does not survive process exit and cross-process resume is unavailable.

DBOS/Postgres durability requires no setup on supported local platforms. To use an existing Postgres database, set `DBOS_SYSTEM_DATABASE_URL` before starting Atomic; otherwise Atomic provisions embedded Postgres where a compatible platform package exists (with drop-privilege support when running as root on Linux), with Docker as a platform fallback. The DBOS SDK ships with `@bastani/atomic`. If no durable backend can be provisioned, workflows run on a process-local in-memory backend with a loud non-durable warning — never on the legacy per-workflow file store under `~/.atomic/workflow-durable` — and cross-process resume is unavailable until Postgres provisioning is fixed.

```bash
export DBOS_SYSTEM_DATABASE_URL="postgresql://user:password@localhost:5432/atomic_dbos_sys"
```

When `/workflow resume` lists or resumes a DBOS-backed workflow in a fresh process, Atomic first hydrates its in-memory replay mirror from DBOS. Atomic stores checkpoints as structured, versioned DBOS outputs containing the checkpoint kind, id, tool argument hash, UI prompt hash, stage replay key, completed output, and additive versioned stage-topology metadata when available, so replay can skip completed `ctx.tool`, `ctx.ui`, `ctx.stage`, `ctx.task`, `ctx.chain`, `ctx.parallel`, and `ctx.workflow` work without relying on prior in-process state and completed inspection can rebuild the original DAG.

Atomic updates the in-memory replay mirror for awaited DBOS checkpoints only after DBOS accepts the write, and root metadata is mirrored as versioned DBOS records where the latest timestamp wins during hydration. Unmarked raw-output checkpoint records remain readable as generic stage checkpoints when their workflow has compatible current metadata; marked envelopes with unsupported envelope versions are ignored rather than decoded as raw output, while unsupported or malformed additive topology fields are ignored without dropping an otherwise valid stage envelope.

Atomic does not use the legacy file backend under `~/.atomic/workflow-durable`; cross-session `/workflow resume` reads DBOS only.

<!-- baseline-block: workflows/operations::019 -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 634–689 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/operations.md#workflow-configuration`.

## Workflow Configuration

Configured workflow paths live in workflow extension config. Project config paths are relative to the project root. Global config paths are relative to `~/.atomic/agent`.

Project config:

```text
.atomic/extensions/workflow/config.json
```

Global config:

```text
~/.atomic/agent/extensions/workflow/config.json
```

Example config:

```json
{
  "workflows": {
    "team": { "path": "./workflows/team.ts" },
    "shared": { "path": "/shared/team/workflows" }
  },
  "defaultConcurrency": 4,
  "maxDepth": 4,
  "budget": { "maxDurationMs": 0, "maxTokens": 0, "maxCost": 0, "warnAtPercent": 80 },
  "persistRuns": true,
  "statusFile": false,
  "resumeInFlight": "ask",
  "workflowNotifications": {
    "enabled": true,
    "notifyOn": ["started", "completed", "failed", "blocked", "budget_warning", "awaiting_input", "paused", "quit", "resumed"]
  },
  "worktree": {
    "symlinkDirectories": ["node_modules"]
  }
}
```

Runtime config defaults:

| Key | Default | Purpose |
|-----|---------|---------|
| `defaultConcurrency` | `4` | Default concurrency for authored `ctx.parallel(...)` execution |
| `maxDepth` | `4` | Maximum workflow nesting depth |
| `budget` | `{ maxDurationMs: 0, maxTokens: 0, maxCost: 0, warnAtPercent: 80 }` | Default per-run budget declaration; `0` disables a dimension; warnings default to `80` percent |
| `persistRuns` | `true` | Persist run metadata for status/resume/history |
| `statusFile` | `false` | Write a derived status file; defaults under `.atomic/workflows/status.json` when enabled |
| `resumeInFlight` | `"ask"` | Behavior when discovering resumable in-flight work |
| `workflowNotifications.enabled` | `true` | Emit workflow lifecycle notices into the active main chat |
| `workflowNotifications.notifyOn` | `["started", "completed", "failed", "blocked", "budget_warning", "awaiting_input", "paused", "quit", "resumed"]` | Lifecycle states to track; terminal `completed`/`failed`/`blocked` outcomes, active recoverable blocks, duration budget warnings, and the user-initiated `started`/`paused`/`quit`/`resumed` control actions on a top-level run create main-chat notices, while `awaiting_input` is tracked for dedupe/restore without waking the main agent |
| `worktree.symlinkDirectories` | `["node_modules"]` | Main-root directories symlinked into each runner-managed temporary worktree during post-creation setup |

Invalid JSON or invalid shapes produce `CONFIG_INVALID` diagnostics. Missing config files are ignored.

<!-- baseline-block: workflows/reliable-design::001 -->

Source: `packages/coding-agent/docs/workflows/reliable-design.md` lines 1–4 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/reliable-design.md#reliable-workflow-design`.

# Reliable Workflow Design

Use this guide to turn an objective into an acyclic, evidence-producing workflow with explicit contracts, context boundaries, verification, and stop conditions. Read [Custom Workflow Authoring](/workflows/authoring) first if you have not built a workflow definition yet.

<!-- baseline-block: workflows/reliable-design::004 -->

Source: `packages/coding-agent/docs/workflows/reliable-design.md` lines 68–92 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/reliable-design.md#stage-model-and-thinking-level-assignment`.

### Stage model and thinking-level assignment

Before launching an authored workflow, assign every model stage a **role**, **failure cost**, **primary model**, **thinking level**, and **fallback policy**. Read [Model Selection](/models/model-selection) for the role defaults, but treat thinking levels in benchmark rows as measurement configurations, not production defaults. Reserve `max` for high-cost-of-error roles or an explicit user request; use `high` for demanding mapping, lifecycle analysis, compatibility, planning, synthesis, triage, and repair; use `medium` for user-impact review and final reporting; and keep deterministic checks as tool nodes with no model call.

Print this compact assignment before launch, with a short cost/quality rationale for each model stage:

```text
Stage | Model | Thinking | Role
map | <catalog fullId> | high | codebase mapping
approve | <catalog fullId> | max | final approval
report | <catalog fullId> | medium | final reporting
tests | — | — | deterministic check (tool node)
```

An explicit user request for a thinking level always wins over the role default, but the requested level must still be supported by the configured catalog. Apply the role and failure-cost policy independently to the primary and every fallback; a fallback must not inherit `max` mechanically. Call `workflow({ action: "models" })`, use only each returned entry's `fullId` and `availableThinkingLevels`, and if the role level is unsupported choose another catalog model or leave the stage unpinned rather than inventing a suffix. An empty or unavailable catalog is not a reason to fabricate a model or level. Deterministic typechecks, tests, schema checks, runtime probes, and artifact inspection remain durable tool gates rather than model self-report.

When an arbitrary task-specific workflow has plausible-but-wrong contract risk, design a bounded evidence-backed adversarial loop:

1. Give a fresh-context, grumpy/skeptical-but-fair reviewer the literal objective. It should aggressively seek realistic counterexamples without inventing requirements or accepting hand-waving and circular worker-authored evidence, then emit a structured verifier plan: exact probe, inputs, command/assertion, expected success condition, and requirement/risk covered.
2. For known contracts, author direct task-specific `ctx.tool(...)` gates up front. For adversarially discovered risks, let the model select high-value probes in structured output, but execute the selected compile, test, schema generation/validation, runtime, and artifact-inspection checks authoritatively through durable workflow-owned `ctx.tool(...)` calls. The model must not self-report outcomes.
3. Feed the actual tool results to a skeptical evaluation stage. It classifies failures and emits one consolidated, evidence-backed, bounded repair payload for the implementation child.
4. After repair, rerun the deterministic verifier tools until the declared pass condition succeeds or the iteration budget is exhausted. Define pass, repair, failure, and iteration-limit conditions before launch.

Use `ctx.tool` for workflow-owned external checks and side effects that benefit from durable checkpointing. Leave pure transformations as ordinary TypeScript; do not wrap every model-stage action in a tool call. A custom-loop pre-launch declaration must name the skeptical reviewer, deterministic verifier gates, how model-selected plans become tool executions, how evidence reaches evaluation/repair, and the bounded success/failure condition.

<!-- baseline-block: workflows/reliable-design::006 -->

Source: `packages/coding-agent/docs/workflows/reliable-design.md` lines 124–145 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/reliable-design.md#scoring-rubric`.

### Scoring rubric

When the ladder is ambiguous, score the task on six dimensions (0–2 each):

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| **Structure** | one action | a few sequential steps | many steps, dependencies, or parallel slices |
| **Verifiability** | no objective check | spot-checkable | provable by tests, builds, artifacts, or review evidence |
| **Iteration** | one pass suffices | may need one repair round | unknown-length loop until evidence passes |
| **Risk** | trivial, reversible | scoped multi-file change | regressions, migrations, releases, or user-visible behavior |
| **Duration** | seconds to minutes | tens of minutes | long-running, background, or resumable across sessions |
| **Isolation** | one context is fine | one noisy investigation to quarantine | many slices needing clean contexts or adversarial independence |

Interpretation:

- **0–3 total:** inline. Adding stages creates more work than value.
- **4–6 total, Iteration ≤ 1, no gate:** inline subagents when the parent should retain control, or a small named/custom workflow when tracking and artifacts matter.
- **7+ total, or Iteration = 2, or Verifiability = 2 with a review/approval gate:** a real workflow. Prefer a named workflow when one fits the whole task; otherwise author a custom graph, nesting proven children where sub-problems overlap.
- **Any single hard signal overrides the arithmetic:** an explicit loop/stop condition, an approval or evidence gate, or a request for durable/background execution puts the task in workflow territory regardless of total score.

The rubric prevents two common misuses: using parent-controlled subagent calls for an ad hoc implement→review→retry pipeline (that is adversarial verification without an engine — use a workflow and let its stages delegate specialists), and unbounded inline reconnaissance — apply the ten-call rule from [When to Use Workflows](/workflows#when-to-use-workflows): save findings to a context file and hand off through `reads`.

<!-- baseline-block: workflows/reliable-design::008 -->

Source: `packages/coding-agent/docs/workflows/reliable-design.md` lines 371–383 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/reliable-design.md#prompting-the-choice`.

### Prompting the choice

Humans can steer the shape directly:

- **Name the shape or installed workflow.** "Do this inline", "use subagents to investigate", or "write a custom workflow for this" overrides automatic scoring.
- **State acceptance criteria.** Verbatim criteria make the objective provable and define reviewer and reducer contracts.
- **State the loop.** "Iterate until tests pass" or "review and fix until approved" defines a hard workflow stop condition.
- **State the evidence.** A QA video, test output, generated artifact, or reviewer sign-off tells the graph which gates it needs.
- **State the boundary.** "Work in a separate worktree", "do not create a PR", or "stop after implementation" separates implementation from final actions.
- **State the queue policy.** Say how to split, order, isolate, and bound queued items; otherwise Atomic runs the [dependency-triage and bounded-dispatch playbook](#task-queues-and-software-factories) before implementation. Ordinary list order and per-item "create a PR after" wording do not create a cross-item dependency.

Absent these controls, Atomic applies the self-prompt and rubric above; a prompt that names none of them delegates the shape decision rather than avoiding it.

<!-- baseline-block: workflows/reliable-design::030 -->

Source: `packages/coding-agent/docs/workflows/reliable-design.md` lines 988–1027 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/workflows/reliable-design.md#compression-and-artifact-handoffs`.

### Compression and Artifact Handoffs

Optimize for tokens per completed task, not the smallest prompt. Aggressive compression can force later stages to rediscover information.

A compressed handoff includes:

- objective and current status
- decisions already made
- files, symbols, commands, and artifact paths with evidence
- open questions and known risks
- rejected alternatives when they matter
- next action expected from the downstream stage

Pass file references, not content. This is the strongly encouraged default for every handoff — between stages and back to the caller — and it is what keeps a multi-stage run affordable. Use `output` with `outputMode: "file-only"` and `reads` for research bundles, logs, plans, diffs, reviewer reports, and any other stage product that can grow. In the downstream stage prompt, say `Read the file at ${artifactPath} before continuing.` Do not inject full session tails, all previous stage outputs, or every prior review round into later prompts by default; pass the latest relevant artifact paths and make older history discoverable from a ledger or index file.

Three rules make that work in practice:

1. **One owner per artifact.** The runner writes the stage's final assistant message to `output` after the stage ends, automatically writes the companion transcript outside the repository tree, and appends one instruction telling the model that its final message becomes the artifact. Your prompt does not need to restate any of that — describe the deliverable, not the plumbing. If a late admitted turn displaces the intended content, search the transcript with `rg` rather than assuming the curated artifact holds every later turn. A prompt may write other files freely; only the declared `output` path is runner-owned and overwritten at stage end.
2. **Do not read an artifact back just to return it.** `outputMode: "file-only"` exists so the parent receives a compact reference. Calling `readFile` on that artifact and returning its text as a workflow output cancels the saving and drops the whole report into the caller's context window. Return the reference and a `*_path` output instead.
3. **Return paths from the workflow.** Declared outputs are consumed by the calling session, so a workflow's `result` should be a reference plus explicit `*_path` outputs. Callers that need the body read the path; callers that only need the outcome pay nothing for it. When a detail is missing from the curated artifact, search its companion transcript with `rg` and inspect a narrow range.

Substantial handoffs should travel through files or durable artifacts instead of hidden transcript assumptions. This keeps stage prompts small, makes review/audit possible, and lets later stages reread the authoritative material without depending on what a previous model summarized. Remember that `reads` passes paths rather than content: a stage reads the file when it runs, so the artifact must hold the real report at that moment.

```ts
const researchPath = ".atomic/workflows/runs/context-demo/research.md";
await ctx.task("researcher", {
  task: "Map the subsystem and return the complete report as your final message.",
  output: researchPath,
  outputMode: "file-only",
});

const review = await ctx.task("reviewer", {
  task: [
    `Research artifact: ${researchPath}`,
    `Read the file at ${researchPath} incrementally and inspect only the sections needed for this review.`,
  ].join("\n"),
  reads: [researchPath],
});
```
