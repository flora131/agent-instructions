# Task runtime and Rust supervision evidence

Design research only. Read the [unchanged agreed brief](2026-09-05-agent-task-experience-brief.md) first. No runtime changes, builds, installs, commits or publication were performed. The recommendation is a Rust supervisor around asynchronous TypeScript execution, not a migration of model sessions into Rust. Human approval remains a later step.

## Snapshot and confidence

Local source: `230bb1f1c75508d087e09725014c69f022de02cc`, branch `feat/agent-task-experience`. External source: `openai/codex` at `e01f38c388f4907f02ac5b4980a37487686204c8`, commit timestamp `2026-09-05T23:09:26Z`. Resolved with `gh api repos/openai/codex/commits/main --jq .sha`; individual files were read from raw GitHub at that SHA, without cloning. Links below pin every implementation claim. Source inspection is high confidence for the cited behavior, not executed test evidence. DeepWiki answers have no stated snapshot and are leads only.

Existing [August runtime research](web/2026-08-04-codex-inprocess-subagent-design.md) is relevant historical context, pinned to a different snapshot. Its V1/V2 distinction is important; it is not evidence that every current behavior is identical.

## DeepWiki question and answer register

These three queries were executed by the parent before this bounded research delegation. Exact questions and answer URLs are retained from the inherited tool results. This agent independently checked critical claims below.

### Q1: agent execution

> Trace actual Rust agent spawn/wait/completion execution: AgentControl::spawn_agent_internal, maybe_start_completion_watcher, SpawnAgentHandlerV2, WaitAgentHandlerV2, wait_for_final_status. Is there any elapsed-time automatic subagent backgrounding, or are model agents independently spawned and wait timeout only observation? Give source paths/symbols, exact timeout defaults/clamps, current snapshot if known; distinguish unified_exec commands from subagents and yield from completion.

[Answer](https://deepwiki.com/search/trace-actual-rust-agent-spawnw_2bed1c1d-9d75-4de7-ba43-8e62e1f1c9de).

Answer leads: independent agent spawn, completion watcher, configured wait timeout; alleged 50 ms minimum, 30,000 ms default, 3,600,000 ms hard maximum. It described V2 as waiting for other agents' completion and likened completion notification to yielding. **Correction:** current V2 wait observes mailbox activity or steering, not a set of final-status targets. Completion notification is not foreground wait yield. Numeric V2 defaults were not independently verified in this pass; do not present them as current verified defaults. Confidence: high for verified mechanisms below, low for the unchecked constants and conflated synthesis.

### Q2: commands and cleanup

> Focused follow-up on unified_exec Rust command supervisor: exact exec_command yield_time_ms defaults/clamps, session IDs and write_stdin, process completion versus yield timeout ordering, bounded output/backpressure and completion delivery. Explain unified_exec_keeps_long_running_session_after_turn_end and unified_exec_pause_blocks_yield_timeout tests. What owns cancellation and macOS/Linux process group versus Windows process-tree/PTY cleanup on thread/session closure or app shutdown? Give exact source paths/symbols and distinguish verified code from inference; no analogy between completion notification and wait yield.

[Answer](https://deepwiki.com/search/focused-followup-on-unifiedexe_ed878433-5f3c-4b6f-94b3-5712f59e16ee).

Answer leads: command process store, 250..30,000 ms clamp, Windows 10,000 ms floor, output buffer, exit watcher, shutdown test. **Correction:** process termination after a collection deadline belongs to one-shot completion timeout, not ordinary interactive yield. The answer's OS cleanup explanation explicitly guessed what `terminate()` does. Do not claim verified cross-platform tree cleanup from that answer. The named pause test was not found in the current `core/tests/suite/unified_exec.rs`; the current collection algorithm's pause handling was verified instead. Confidence: high for constants and mode distinction, limited for upstream OS internals.

### Q3: lifecycle edge cases

> Focused edge-case follow-up: agent wait cancellation, parent close and live thread shutdown ownership; terminal status monotonicity, completion watcher races, nested/parallel agents, guard limits and communication retry identity. Does interrupting wait stop children, and does a command surviving turn end imply it survives owner thread/application exit? Identify Rust Send/Sync and Tokio supervision boundaries versus model execution, source paths/tests and uncertainty. Contrast independent agent spawn with proposed elapsed-time automatic foreground-wait yielding, without claiming that proposal already exists upstream.

[Answer](https://deepwiki.com/search/focused-edgecase-followup-agen_52002b82-003b-4770-9458-4dae98409d71).

Answer leads: wait interruption, shutdown tree, completion watcher, `Arc`/`Mutex`. **Correction:** the claimed upstream terminal monotonicity is not established. Current `is_final` explicitly excludes `Interrupted`; event conversion maps `TurnStarted` to `Running`. Atomic's stronger terminal-child identity invariant comes from its own reducer and the brief. `Arc` alone does not prove `Send + Sync`; inspect concrete fields and compile trait assertions in future work. Communication retry identity was not answered by this synthesis. Confidence: high for cited source, no claim for unanswered retry semantics.

### Q4: source contradiction follow-up

The parent supplied an additional query receipt during this pass: [source verification follow-up](https://deepwiki.com/search/source-verification-at-current_c537e0a1-f360-4abc-b5cf-d0553b45c682). The question challenged the findings at `e01f38c388f4907f02ac5b4980a37487686204c8`. Exact question text was not included in this handoff, so this is a summary, not a quotation. The parent reports that the answer retracts the V2 final-status-wait claim and the terminal-monotonicity simplification, while lacking enough indexed context to verify OneShot. Raw source above remains authoritative. This additional provenance changes no product scope.

## Verified upstream mechanisms

### Independent execution, wait observation, completion

[Spawn implementation](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/agent/control/spawn.rs#L603-L620) defines `async fn spawn_agent_internal(...) -> CodexResult<LiveAgent>`. [Watcher registration](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/agent/control/spawn.rs#L788-L801) calls `self.maybe_start_completion_watcher(new_thread.thread_id, ...)`. These inspected paths do not implement elapsed-time foreground detachment. Atomic auto-yield should be described as its own proposed wait policy, not an upstream fact.

[Completion watcher](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/agent/control.rs#L573-L635):

```rust
let control = self.clone();
tokio::spawn(async move {
    // subscribe_status; borrow current status before waiting
    while !is_final(&status) {
        if status_rx.changed().await.is_err() {
            status = control.get_status(child_thread_id).await;
            break;
        }
        status = status_rx.borrow().clone();
    }
    // return if not final; format_inter_agent_completion_message
```

The subscribe/read-before-wait pattern avoids missing an already-observed completion. It does not prove exactly-once transport or immutable child identity.

[V2 wait](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs#L51-L96):

```rust
Some(ms) if ms > max_timeout_ms => { /* RespondToModel error */ }
Some(ms) => ms.max(min_timeout_ms),
None => default_timeout_ms,
// subscribe_activity(...)
let outcome = wait_for_activity(&mut activity_rx, pending_activity, deadline).await;
```

[Result](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs#L127-L158) is `{message: String, timed_out: bool}`, with `MailboxActivity`, `Steered`, `TimedOut`. This door does not terminate children when the observation ends.

[Status conversion](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/agent/status.rs#L6-L30):

```rust
EventMsg::TurnStarted(_) => Some(AgentStatus::Running),
// ...
!matches!(status, AgentStatus::PendingInit | AgentStatus::Running | AgentStatus::Interrupted)
```

Do not import this status model as Atomic's permanent terminal-child identity contract.

### Command wait versus execution deadline

[Handler defaults](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/tools/handlers/unified_exec.rs#L62-L71):

```rust
fn default_exec_yield_time_ms() -> u64 { 10_000 }
fn default_write_stdin_yield_time_ms() -> u64 { 250 }
fn default_tty() -> bool { false }
```

[Constants](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/unified_exec/mod.rs#L73-L82) include minimum 250, Windows initial floor 10,000, empty stdin minimum 5,000, maximum initial yield 30,000 ms, 1 MiB output budget and 64 processes. [Clamp](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/unified_exec/mod.rs#L210-L217): `yield_time_ms.clamp(MIN_YIELD_TIME_MS, MAX_YIELD_TIME_MS)` after applying the Windows floor.

[Mode selection](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs#L299-L318):

```rust
ExecCommandLifetime::Interactive => None,
ExecCommandLifetime::OneShot => {
    tty = false;
    Some(Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_EXEC_COMMAND_TIMEOUT_MS)))
}
```

[Collection and timeout](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/unified_exec/process_manager.rs#L602-L627):

```rust
let wait = completion.as_ref().map_or_else(
    || Duration::from_millis(yield_time_ms),
    |completion| completion.timeout,
);
// collect_output_until_deadline(...)
if let Some(completion) = completion.as_mut() && !process.has_exited() {
    completion.timed_out = true;
    process.mark_timed_out();
    // terminate_confirmed().await
}
```

This is the critical distinction: ordinary yield returns control, whereas one-shot execution timeout terminates. [Response fields](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/unified_exec/process_manager.rs#L795-L808) include `process_id: response_process_id` and `exit_code`; [stdin polling](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/unified_exec/process_manager.rs#L951-L963) clamps empty polls separately from writes:

```rust
if request.input.is_empty() {
    time_ms.clamp(MIN_EMPTY_YIELD_TIME_MS, self.max_write_stdin_yield_time_ms)
} else { time_ms.min(MAX_YIELD_TIME_MS) }
```

[Output collection](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/unified_exec/process_manager.rs#L1478-L1555) calls `extend_deadlines_while_paused`, drains a `HeadTailBuffer`, observes cancellation/output closure, then selects output, exit, deadline and pause changes. It uses a 50 ms post-exit drain cap. This provides concrete design leads for bounded output and HIL pause policy, not proof that every event queue is bounded.

### Shutdown evidence and limits

[Legacy close/tree shutdown](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/agent/control/legacy.rs#L46-L115) has separate `close_agent` and `shutdown_agent_tree`:

```rust
let descendant_ids = self.live_thread_spawn_descendants(agent_id).await?;
let result = self.shutdown_live_agent(agent_id).await;
for descendant_id in descendant_ids {
    // shutdown_live_agent(descendant_id).await
}
```

It does not authorize Atomic persistence/revival or ownership transfer. [Process Drop](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/src/unified_exec/process.rs#L644-L648): `fn drop(&mut self) { self.terminate(); }`. This proves a termination request, not universal descendant reaping or cleanup after SIGKILL.

[Survives-turn test](https://github.com/openai/codex/blob/e01f38c388f4907f02ac5b4980a37487686204c8/codex-rs/core/tests/suite/unified_exec.rs#L2851-L2940) launches `exec sleep 3000` with `yield_time_ms: 250`, waits for `TurnComplete`, and checks the process. It explicitly calls `skip_if_host_windows!`, so it is not Windows evidence. The external test was inspected, not run. Upstream per-platform process-tree internals remain unverified in this bounded pass.

## Atomic current boundary

[Generated native declarations](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/natives/native/index.d.ts#L31-L63) expose:

```ts
admitChildSession(spec: NativeChildSpec, parent: NativeParentContext): NativeAdmissionResult
beginChildAttempt(path: string): NativeExecutionGuardResult
finishChildAttempt(token: number, status: AgentStatus): void
terminateChildAttempt(token: number, cause: TerminationCause): Promise<NativeTerminationResult>
subscribeChildStatusWithCause(path: string, callback: (update: NativeStatusUpdate) => void): void
```

Admission failures are `depthExceeded | capacityExhausted | dispatchGuardBusy | invalidCwd | unknownAgent | terminalChild`. Native status is `pending | running | ok | error | interrupted | continued`. Arrays really are generated `Array<ChildIdentity>`, not an alternate collection. The JS bridge numbers are not branded IDs today. Subscription returns `void`, not an unsubscribe lease.

[State reducer](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/crates/atomic-natives/src/subagent_control/status.rs#L72-L99):

```rust
self.sender.send_if_modified(|current| {
    if current.status.is_terminal() { return false; }
    *current = StatusUpdate { status, cause };
    accepted = true;
    true
});
```

[Terminal definition](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/crates/atomic-natives/src/subagent_control.rs#L395-L428): `matches!(self, Self::Ok | Self::Error | Self::Interrupted)`. `continued` is explicitly nonterminal. Proposed yield must not map to any terminal value.

[Control ownership](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/crates/atomic-natives/src/subagent_control/control.rs#L107-L149) stores `Arc<ControlState>` with `Weak<HostMarker>`; callbacks and attempts are mutex-protected registries. [Callbacks](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/crates/atomic-natives/src/subagent_control/control.rs#L410-L470) use `ThreadsafeFunctionCallMode::NonBlocking`. Neither alone guarantees bounded queue memory or environment teardown safety; add explicit unsubscribe and shutdown barriers in the design.

[Termination](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/crates/atomic-natives/src/subagent_control/control.rs#L40-L85) records first cause, requests cooperative cancellation, waits a grace budget, then sets `force_abort` and completes its bookkeeping. [Finish/terminate](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/crates/atomic-natives/src/subagent_control/control.rs#L263-L360) caches termination receipts, rejects nonterminal finish except special `Continued`, and settles interrupted status. Do not interpret native bookkeeping completion as forcibly aborting arbitrary JavaScript or reaping shell descendants.

[TS session cancellation](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/subagents/src/runs/inprocess/runner.ts#L858-L894):

```ts
activeSessionManager?.flush();
await session?.abort();
// finally
await this.native.terminateChildAttempt(token, nativeCause(cause));
```

[Prompt completion](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/subagents/src/runs/inprocess/runner.ts#L1035-L1047) awaits `session.prompt(admitted.spec.task)`, then `terminating`, then publishes status and finishes the native attempt. Rust does not execute the model here. JS async I/O can remain responsive; synchronous tool work can still block its event loop.

[Detach](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/subagents/src/runs/inprocess/runner.ts#L1187-L1194):

```ts
if (running.status !== "running") throw new Error("continue_detached requires a running attempt");
this.native.publishChildStatus(running.child.identity.path, nativeStatus("continued"));
running.status = "continued";
running.promise.catch(() => undefined);
return running.child.identity.path;
```

The same running promise survives detachment. This is the integration seam for one stable task ID, not a new task launch. [Result delivery](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/subagents/src/runs/inprocess/runner.ts#L1212-L1240) uses a `delivered` set keyed by child path and writes artifacts; transport acknowledgments are a separate concern for Intercom research.

## Atomic shell and PTY cleanup

[PTY native entrypoints](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/crates/atomic-natives/src/pty.rs#L18-L151) provide `start`, `write`, `resize`, `kill`:

```rust
let _ = options.signal;
// options.command/cwd/env; dimensions default then clamp
let (control_tx, control_rx) = mpsc::channel::<ControlMessage>();
env.spawn_future(async move {
    let result = tokio::task::spawn_blocking(move || { /* run_pty_sync */ }).await;
```

The accepted native signal is not consumed. TS owns abort forwarding today. Named native errors include `PTY session already running`, `PTY session is not running`, `PTY session is no longer available`, lock poison and execution panic. `PtyRunResult` returns optional exit code plus required cancelled/timedOut booleans. The control channel shown is unbounded; a new supervisor must not assume current stdin/output paths provide a complete backpressure policy.

[TS adapter](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/coding-agent/src/core/tools/bash-pty-native.ts#L79-L126):

```ts
const onAbort = () => { try { session.kill(); } catch {} };
// start, stream chunks, remove abort listener in finally
if (options.signal?.aborted || result.cancelled) throw new Error("aborted");
if (result.timedOut ?? result.timed_out) throw new Error(`timeout:${options.timeout}`);
```

[Native Unix cleanup](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/crates/atomic-natives/src/pty.rs#L431-L451):

```rust
libc::kill(-pgid, libc::SIGTERM);
// child.kill(), then 50 ms grace on Unix
libc::kill(-pgid, libc::SIGKILL);
```

The non-Unix branch shown calls `child.kill()` with no explicit native Job Object tree contract. Do not claim full Windows descendant cleanup from it. [Pipe cleanup](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/coding-agent/src/utils/shell.ts#L285-L320) differs:

```ts
// Windows trusted System32 taskkill.exe
["/F", "/T", "/PID", String(pid)]
// Unix
process.kill(-pid, "SIGKILL"); // fallback to child PID
```

A native design should unify ownership and confirmed cleanup rather than equate this fire-and-forget helper with a reaping receipt.

## Recommended design obligations, not current implementation

1. Keep four independent dimensions: task execution, foreground wait, UI focus and transcript expansion. `yieldWait` changes only wait policy, preserving task/owner/child identity and the execution promise. Explicit, timed and Intercom detachment share that transition.
2. Owner capability is assigned at admission and immutable. Main session and workflow-stage owner closure atomically stop new admission, request cancellation of descendants, await cleanup, then close subscriptions. Pane navigation does none of this. Reattachment can inspect only the same still-live owner; process restart is not reattachment.
3. A Rust actor serializes lifecycle commands and allocates ordered event sequences. TS dispatches model prompts/tools asynchronously and reports progress/completion with opaque task and attempt identities. The actor must not hold a lock across JS callbacks or I/O. Callback payloads are owned data, never JS object pointers on worker threads.
4. Separate `WaitOutcome = Settled(result) | Yielded(handle, reason)` from domain task result. Workflow durable `ctx.tool` and DAG dependencies wait on domain settlement, never on the yielded observation handle. Model-context completion delivery has its own acknowledgment identity; renderer deduplication cannot suppress genuine messages.
5. Add subscription leases, snapshot plus cursor reconciliation, bounded per-task output, explicit truncation metadata and event coalescing. Never drop settlement/owner closure or reset sequence on pane changes. Preserve raw command/task/message text, optional unknown metrics and input ordering; a display count must not manufacture zeros.
6. First accepted terminal settlement wins. Cancellation racing completion returns the already-settled state or commits cancellation; no terminal-to-running transition. Cleanup status may progress independently after execution settlement, without lying that processes have been reaped. Duplicate terminal reports reconcile idempotently; conflicting late reports cannot rewrite the result.
7. Native cancellation must reach TS AbortController, native child handles and descendants. Rust cannot preempt an arbitrary blocked JS callback. Keep arbitrary JS execution outside critical supervision locks; explicitly expose cleanup failure rather than report success after merely setting `force_abort`.
8. macOS/Linux: own process-group handles, signal TERM, bound grace, KILL remaining descendants, reap child and drain/close PTY readers. Test grandchild survival, shell exit before grandchildren, spawn failure, permission failure and PID reuse safety. Windows: recommend native Job Objects with kill-on-close and assignment before untrusted execution; explicitly handle nested-job restrictions, ConPTY lifetime and assignment failure. Confirm process exit using retained handles, not PID-only polling. This is a proposal, not verified current behavior.
9. Normal application shutdown closes owners and awaits bounded cleanup before destroying the N-API environment. Abrupt termination needs OS-enforced containment where possible. Unix SIGKILL cannot execute Rust Drop; the design must state that limitation instead of promising destructor-based cleanup. No daemon or ownership transfer is authorized.

## Interface alternatives for the RFC

| Boundary | Advantages | Costs and recommendation |
|---|---|---|
| Extend existing N-API module with typed owner/task doors | Uses the existing distribution/build boundary; minimal serialization; Rust owns process handles and lifecycle | Recommended. Add environment teardown, callback lifetime, sequence/replay and backpressure contracts. TS model work still needs abort cooperation. |
| App-owned Rust sidecar with framed typed IPC | Can supervise independently of a stalled JS event loop; subprocess isolation | More startup, packaging, IPC and crash handling. Must die with application and never become a persistence daemon. A sidecar alone still cannot forcibly stop an in-process JS callback. |
| Entire agent/model runtime in Rust | One scheduler and model execution language | Reject for this brief: exceeds TS sessions/tools/UI decision and adds migration work unrelated to supervision. |

Suggested interview choice: elapsed foreground budget around 10 seconds versus a longer quiet budget around 30 seconds, with an explicit disabled option. Recommend the shorter budget for commands and an independently configurable agent budget. These are product proposals, not imported defaults or approved constraints. Execution deadline must remain distinct and optional. HIL should expose attention immediately; whether its time consumes the wait budget is a visible policy choice, not task completion.

## Future validation commands and slice gates

These are **future commands, not tests run during design research**. Existing manifests locate them. [Workspace](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/Cargo.toml#L1-L37) has `members = ["crates/atomic-natives"]`, `napi10`, `tokio_rt`, `tokio_time` and Tokio multi-thread runtime. [Native crate](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/crates/atomic-natives/Cargo.toml#L1-L56) is `cdylib` plus `rlib` with Windows target dependencies. No crate feature matrix is declared there; platform cfg coverage matters. [Bridge build](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/natives/scripts/build-native.ts#L25-L47) invokes `napi build` and generates `index.js`/`index.d.ts` with `--no-const-enum`. Do not hand-edit generated contracts during implementation.

```sh
# Future setup, once implementation is authorized
npm ci --ignore-scripts
npm run build
# Rust and generated bridge gates
cargo test -p atomic-natives
cargo check -p atomic-natives
npm run build --workspace=@bastani/atomic-natives
npm run typecheck
# Existing focused regression entrypoints, extend in their owning slice
npx --no-install vitest --run --project unit test/unit/subagents-inprocess-public-contracts.test.ts test/unit/subagents-inprocess-runner-termination.test.ts test/unit/subagents-inprocess-progress-emission.test.ts
npm run test --workspace=@bastani/atomic -- test/bash-pty-native.test.ts
npm run test:integration
npm run check
```

[Root scripts](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/package.json#L17-L39): `test:unit`, `test:integration`, `typecheck`, `check` are authoritative. [CI](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/.github/workflows/test.yml#L84-L109) explicitly builds natives before root suites. Run native/PTY assertions on actual macOS, Linux and Windows hosts; cross-compiling is not process-cleanup execution proof.

Vertical RGR implications: identity/owner slice first proves forbidden terminal revival and admission-close race; command slice adds a real child that yields but continues, then verifies owner-close reaping; TS/Intercom slice proves the same running promise and task ID survive async transition and settle exactly once. Every slice needs failure/replay cases and should remain independently buildable. UI slices consume these contracts, not competing lifecycle state.

Future tmux command skeleton after a deterministic fixture is added in its implementation slice:

```sh
tmux new-session -d -s atomic-task-design-check -x 100 -y 32 'bun packages/coding-agent/src/cli.ts'
tmux send-keys -t atomic-task-design-check C-o
tmux capture-pane -p -t atomic-task-design-check
# close only this dedicated validation session after observing app owner cleanup
tmux kill-session -t atomic-task-design-check
```

The launch command is documented in [DEV_SETUP.md](../DEV_SETUP.md). This skeleton alone is not an acceptance scenario: the future slice must provide a credential-free task fixture, explicit/timed/Intercom actions, stable-ID assertions, owner-close process checks and captured before/after panes. Browser mockups cannot replace terminal proof.

## Executed checks and limitations

Executed: current-checkout file reads and symbol searches; GitHub commit resolution and raw pinned reads; `git status --porcelain`; inspection of manifests, CI and existing test paths. No builds, tests or running terminal scenario were claimed. `node_modules` was absent in preflight; design research does not need generated runtime artifacts. One attempted upstream `core/src/config/types.rs` read returned 404, so V2 numeric defaults remain explicitly unverified. Shell glob misses were corrected with recursive source searches. Source observations are not reproduced defects requiring runtime fixes in this design-only run.

Deferred outside this research partition: exact Intercom receipt/retry/render chain belongs to the dedicated Intercom evidence; shared terminal component/mockup behavior belongs to UI evidence. No recommended cleanup or API changes were implemented.
