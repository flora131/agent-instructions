# Intercom detachment and task lifecycle

Source inspection confirms that Intercom detachment preserves the running child identity but releases the foreground tool call. Completion subsequently arrives as a separate visible notification. Main-chat live updates are keyed to pending tool calls; attached workflow chats use a different reducer that can locate historical tool entries. These distinctions matter when specifying one continuous background task projection.

## Scope and provenance

Recovered from the bounded Intercom analyzer's complete final report, session `01a073ef-1ca1-7248-b95b-6c6234b233ac`. Its findings follow.

- Read the canonical brief completely and preserved it.
- Verified branch `feat/agent-task-experience` through the worktree's `HEAD`; verified current commit `230bb1f1c75508d087e09725014c69f022de02cc` through its branch ref.
- All local references below describe that checkout.
- Read the July research note `research/web/2026-07-19-pi-subagent-supervisor-detach-deadlock-bun-ipc.md`. Its retained-child wait/resume discussion is historical upstream evidence, not the current Atomic contract; current parent-question behavior is terminal fresh handoff.
- GitHub API retrieval worked using `read` with `:raw`. No shell commands, tests, or interactive reproduction ran in that analysis.

## Entry points and current contracts

| Door or event | Current contract |
|---|---|
| `ForegroundDetachHandoff.deliver(...)` | Returns `Promise<"delivered" \| "unclaimed" \| "abandoned">`; input includes sender, message, runtime generation, delivery callback and generation-validity callback. `packages/intercom/foreground-detach-handoff.ts:16-49` |
| `pi-intercom:detach-request` | Probe/commit handshake carries `requestId`, `messageId`, `childIntercomTarget`, `senderId`, `runtimeGeneration`. `packages/intercom/foreground-detach-handoff.ts:4-14` |
| `registerExecutionIntercomDetach(...)` | Only an available, detach-enabled exact child accepts the handshake. Matching commit releases foreground supervision. `packages/subagents/src/runs/foreground/execution-intercom-detach.ts:16-44` |
| `continueDetached(...)` | Requires a running attempt, publishes native `continued`, changes `running.status`, and returns the existing child path. `packages/subagents/src/runs/inprocess/runner.ts:1188-1193` |
| `subagent:parent-ask-handoff-request` | Exact run/index/agent/child/parent claim, distinct from detachment. `packages/subagents/src/runs/foreground/execution-parent-ask-handoff.ts:37-69` |
| `notifyDetachedForegroundChildExit(...)` | Emits completion through a local acknowledged notification pipeline with identity `foreground-detach-${runId}-${index}`. `packages/subagents/src/runs/foreground/subagent-executor-status.ts:156-187` |
| `WorkflowStageAdmissionBoundary.close()` | Seals admission, synchronously aborts `closeSignal`, then drains admitted work. `packages/coding-agent/src/core/workflow-stage-admission.ts:121-135` |
| `RetryIdentityReservations.begin(...)` | Fresh calls mint fresh message identities; only an explicit retry token reuses a retained exact operation. `packages/intercom/retry-identity.ts:104-150` |

## Inbound message to foreground detachment

1. `index-heavy.ts` derives the current runtime generation and live context, combines message text with attachments, and binds the workflow reply tracker. Closed workflow stages route through their closed-stage policy before normal admission. `packages/intercom/index-heavy.ts:325-361`
2. Inbound admission reserves the sender/message identity. Replies matching an active waiter settle that waiter and commit admission without becoming a new inbound chat delivery. Other messages establish reply context and a failure-release handler. `packages/intercom/index-heavy.ts:362-379`
3. Workflow-stage delivery uses `admitWorkflowStageInbound`; its callback delivers with stable retry and its claim callback requests exact foreground detachment. Successful delivery commits admission; failure invokes the release handler. `packages/intercom/index-heavy.ts:380-395`
4. For busy interactive main chat, the message enters `pendingIdleMessages` and admission commits **before** asynchronous detach probing. The source comment explicitly identifies the terminal-barrier race this ordering handles. An acknowledged claim removes the queued message and surfaces it with stable delivery retry. An unclaimed message remains idle-queued. `packages/intercom/index-heavy.ts:403-445`
5. Busy noninteractive execution has a separate branch: it sends a best-effort explanatory reply where possible, commits the inbound reservation, and leaves the current execution running. `packages/intercom/index-heavy.ts:403-420`

The handshake has two acknowledgements, each defaulting to 50 ms. Every acknowledgement must match phase, request/message IDs, child target, sender and generation. Generation reset cancels pending waits and clears generation-local delivery bookkeeping. `packages/intercom/foreground-detach-handoff.ts:25-28,63-85,88-148`

## Child transition and continuing execution

`inprocess-run-sync.ts` races the child's terminal promise against a continuation promise. Detachment calls `control.continueDetached(running, "intercom-coordination")` and resolves continuation; it does not resolve or cancel the child's execution promise. `packages/subagents/src/runs/foreground/inprocess-run-sync.ts:330-350`

The returned value changes materially:

- Before detachment: `RunningAttempt.status === "running"`.
- After detachment: `RunningAttempt.status === "continued"`.
- Foreground return: `SingleResult.status === "continued"`, `detached: true`, `detachedReason: "intercom-coordination"`, the **same** admitted child `path`, empty `messages`, empty usage, and progress whose status remains `"running"`. `packages/subagents/src/runs/foreground/inprocess-run-sync.ts:381-408`

The detach branch removes handshake and parent-ask listeners, installs an eventual completion continuation, emits one final foreground update, then returns. The child's original promise remains responsible for the terminal outcome. `packages/subagents/src/runs/foreground/inprocess-run-sync.ts:351-414`

Normal progress callbacks build `Details` with `runId`, result and progress records and invoke `options.onUpdate`. That callback mechanism exists independently of the detach handshake; this inspected code does not introduce a separate stable task-event subscription when the foreground tool returns. `packages/subagents/src/runs/foreground/inprocess-run-sync.ts:279-299,410-414`

Parallel execution shares a detach controller. A committed exact-child detach aborts that controller; active siblings receive the detach signal, while queued tasks have skip branches after the group detaches. `packages/subagents/src/runs/foreground/execution-intercom-detach.ts:38-44`; `packages/subagents/src/runs/foreground/subagent-executor-parallel-task.ts:85-98,123-128,185-187`

## Current rendering and persistence path

**Main chat:** `tool_execution_update` updates only a component present in `pendingTools`. `tool_execution_end` updates that component and deletes its key. `agent_end` clears pending tools. Therefore subsequent events using this pending-only path do not locate the completed foreground tool component. `packages/coding-agent/src/modes/interactive/interactive-agent-events.ts:293-323`

**Attached workflow chat:** stage-handle events reach `ChatSessionHost` through `applyStageChatLiveHandleEvent`. `packages/workflows/src/tui/stage-chat-view-state.ts:114-115`; `packages/workflows/src/tui/stage-chat-view-live-events.ts:9-18`

Its `ChatMessageRenderer` handles tool updates by ID. Unlike the main handler above, `updateToolResult` falls back from pending indexes to searching existing entries by `toolCallId`, so it can update a historical matching entry if an event reaches it. Do not describe both reducers as simply dropping every post-end event. `packages/coding-agent/src/modes/interactive/components/chat-message-renderer.ts:206-214,324-351`

The stage's pending-tool replay buffer retains start plus latest update only while the tool is pending. It removes the entry on tool end and clears everything on agent start/end. This buffer is not an independent registry of detached live children. `packages/workflows/src/runs/foreground/stage-tool-execution-buffer.ts:17-43`

Both rendered tool and custom-message components receive the chat's expansion setting. `packages/coding-agent/src/modes/interactive/components/chat-message-renderer.ts:430-445,476-488`

Custom messages are appended to agent model state and persisted with content, display flag, details and stage admission key, then emit message-start/message-end events. `packages/coding-agent/src/core/agent-session-message-queue.ts:187-205`

**Evidence boundary:** the inspected paths establish separate foreground tool-update and terminal-notification mechanisms. They do not constitute an executed demonstration of every ongoing callback's delivery after detachment or a full UI reconnect reproduction.

## Terminal result delivery and spacing

When the detached execution finishes, the continuation constructs its recovered result, calls `deliverChildResult`, applies any delivered output envelope, then invokes `onDetachedExit`. `packages/subagents/src/runs/foreground/inprocess-run-sync.ts:354-379`

Single execution checks whether the owning stage still admits messages before notifying. `packages/subagents/src/runs/foreground/subagent-executor-single.ts:226-230`

`notifyDetachedForegroundChildExit` uses the stable per-child completion notification ID described above. The notification handler:

- Deduplicates notification identities with a ten-minute seen map.
- Coalesces concurrent delivery attempts in an in-flight promise map.
- Acknowledges duplicates.
- Records success only after delivery succeeds.
- Acknowledges failure without recording successful delivery.
- Orders terminal delivery through the terminal ordering barrier.

`packages/subagents/src/runs/foreground/notify.ts:134-138,187-208,266-311`

It creates a **new** `customType: "subagent-notify"` message with `display: true` and `triggerTurn: true`, preserving model-context completion delivery. `packages/subagents/src/runs/foreground/notify.ts:256-272`

The registered notification renderer explicitly creates a `Spacer(1)` followed by a padded `Box(1, 1, ...)`. Its text preview removes empty lines in expanded mode and substitutes `(no output)` when appropriate. `packages/subagents/src/extension/index.ts:169-190`

This is verified spacing-related source evidence. It is **not** a reproduced root-cause attribution for the user's reported extra newline block.

## Parent questions are a different lifecycle

Parent handoff requests are accepted only if their run ID, child index, agent, child Intercom target and orchestrator target match the live attempt. An already claimed request is ignored. `packages/subagents/src/runs/foreground/execution-parent-ask-handoff.ts:52-68`

For a single child, acceptance stores `taskContext` and the request, then aborts the interrupt controller. This is terminal interruption rather than continuing the same child in the background. `packages/subagents/src/runs/foreground/subagent-executor-single.ts:220-224`

Native status values include `pending`, `running`, `continued`, `ok`, `error`, and `interrupted`; only the final three are terminal. `crates/atomic-natives/src/subagent_control.rs:400-426`

Native status publishing refuses changes once the current status is terminal; beginning a new attempt for a terminal child returns `TerminalChild`. `crates/atomic-natives/src/subagent_control/status.rs:85-89`; `crates/atomic-natives/src/subagent_control/control.rs:221-243`

## Ownership, cancellation and durable workflow semantics

Stage execution combines the tool signal with the owning stage's `closeSignal` using `AbortSignal.any` and registers the exact subagent run ID on that boundary. `packages/subagents/src/runs/foreground/subagent-executor-context.ts:67-68,200`

Closing the boundary is idempotent through `closePromise`, aborts immediately, then waits for admitted promises with `Promise.allSettled` before its final drain. Failed keyed admission removes its in-flight entry; successful keyed admission records completion. `packages/coding-agent/src/core/workflow-stage-admission.ts:56-98,125-135`

Detached attempts remain cancellable: `terminateChildAttempt` accepts both `"running"` and `"continued"`, invokes termination, and awaits the original execution promise. `packages/subagents/src/runs/inprocess/runner.ts:1212-1215`

The TS attempt termination path records a cause, aborts execution and calls native termination; native errors from a completion race are caught so the established terminal result can remain authoritative. `packages/subagents/src/runs/inprocess/runner.ts:864-883`

`ctx.tool` is durable callback execution, not a foreground-wait abstraction. It awaits the callback through retry handling, checks cancellation before persistence, writes a `DurableToolCheckpoint`, then publishes node completion and settlement. A successful durable write wins once persistence starts. `packages/workflows/src/durable/tool-primitive.ts:463-522`

Thus a future yielded task handle must not be substituted for the callback's logical terminal result at this seam: existing code persists whatever successful callback result it receives. This is a constraint derived from the brief and this current checkpoint boundary, not evidence of an implemented task-handle adapter.

## Transport identity and failures

`RetryIdentityInput` includes session, action, target, raw text, attachments, reply target and reply expectation. Its operation key includes all those values. Attachment object serialization is canonicalized by the existing send-signature helper; the raw text is included directly. `packages/intercom/retry-identity.ts:18-26,91-100`

Reservations distinguish fresh-in-flight, retained, retry-in-flight, settled, exhausted and released. A claimed retry keeps the original `messageId`, increments reuse count, and does not extend expiry. Fresh identical operations remain separate. `packages/intercom/retry-identity.ts:44-55,129-150,210-216,289-298`

Named failures include:

- `RetryIdentityCapacityError`
- `RetryTokenError`: `invalid`, `expired`, `mismatch`, `in_flight`, `settled`, `exhausted`

The default maximum is three claimed retries and 1,000 entries. `packages/intercom/retry-identity.ts:11-14,67-88`

Existing tests explicitly distinguish omitted attachments from `[]`, preserve array order and duplicate attachments, and assign independent identities to concurrent identical failures. `test/unit/intercom-retry-identity.test.ts:70-134`

These transport identities are separate from child identity, foreground run identity and completion-notification identity.

## Retrieved maintainer decisions

Retrieved directly from GitHub's API during the analyst session:

- [PR #2859](https://github.com/bastani-inc/atomic/pull/2859), merged at `4bba528a44990febbc7acd8fc2151987492c9406`, cancels stage-owned single/parallel detached children, suppresses late findings from exactly those runs, and preserves accepted receipts and retry tokens. Its body explicitly says sender cancellation cannot retract broker acceptance.
- [Latest comment on #2840](https://github.com/bastani-inc/atomic/issues/2840#issuecomment-5543720588), by `flora131`:

  > Better fix is to cancel the subagent once the stage completes so that this isn't an issue. We DO NOT want to route the subagents findings to the main/parent chat if the workflow has moved on.

- [PR #2607](https://github.com/bastani-inc/atomic/pull/2607), merged at `e15671047ba2e72afe448f75f6b37887fff522f1`, removes public child resume and native revival. Its migration starts a new child using explicit `[TASK_CONTEXT]`. It preserves raw questions, omitted/empty questions, and ordered duplicate attachments.
- [PR #2880](https://github.com/bastani-inc/atomic/pull/2880), merged at `5e7ba822c6009f433631c678a6586f2b92b6cffa`, separates immutable registration authority from mutable group membership using `registrationGroup`. Membership changes and reconnects must not grant workflow control authority or restore explicitly left groups.

PR validation counts are historical reports, not current-run test results.

## Existing regression coverage and future rerun commands

The following files exist in the current checkout. Commands are **planned, not executed**:

```sh
npx --no-install vitest --run --project unit \
  test/unit/subagents-foreground-intercom-detach.test.ts \
  test/unit/subagents-parallel-intercom-detach.test.ts \
  test/unit/intercom-foreground-detach-handoff.test.ts \
  test/unit/workflow-stage-subagent-cancellation.test.ts \
  test/unit/intercom-terminal-ordering-barrier.test.ts \
  test/unit/intercom-retry-identity.test.ts \
  test/unit/intercom-tool-retry-real-broker.test.ts

npx --no-install vitest --run --project integration \
  test/integration/intercom-reconnect-recovery.test.ts
```

Source-backed scenarios include eventual result exactly once, exact-child routing before tool-start observation, cancellation after detach, sibling continuation, duplicate commits, commit without matching probe and generation mismatch. `test/unit/subagents-foreground-intercom-detach.test.ts:73,115,164,195,221,290,333`

Stage tests cover detached single cancellation without late notification and detached parallel cancellation without stopping another stage. `test/unit/workflow-stage-subagent-cancellation.test.ts:181,219`

## Unverified details

- No live terminal scenario, newline-block reproduction, test execution or git diff check ran in the analyst session.
- Full broker receipt/retry call chains and every DAG scheduler caller were not exhaustively traced; current retry contracts, durable settlement boundary and maintainer guarantees are documented above.
- No proposed runtime code, UI layouts or external Rust design was produced in that partition.

## Contract amendments received

Inherited user amendment:

> note, that your design also needs to accomodate the intercom behavior that leads subagents to become async and make sure that the behavior is transparent as background subagent ui (currently not happening and only get a final lifecycle done message with an extra newline block)
