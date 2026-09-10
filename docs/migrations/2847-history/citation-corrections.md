# Citation and contract reconciliation history

These are original source blocks retained for losslessness, not current instructions. Active docs use the corrected destinations and current contracts listed in the content handoff. Baseline: `59586efd26afd32a27c999ac8bcce102777e40e4`. Supplemental upstream: `cb13229bebe30ea7cb65689569569494b4bc651c`.

<!-- source-block: cb13229b:extensions.md#extensions -->

Source: `packages/coding-agent/docs/extensions.md` lines 3–33 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

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

Atomic also ships an environment-gated [Herdr reporter](/herdr). It combines settled agent activity, extension prompt events, and observed workflow roots under one parent pane owner. It defers to loaded community or legacy reporters and can be disabled with `herdr.enabled` in settings. The tested Herdr release and observed CLI behaviour are listed under [Compatibility](/herdr#compatibility).

<!-- source-block: cb13229b:extensions.md#table-of-contents -->

Source: `packages/coding-agent/docs/extensions.md` lines 34–61 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

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
- [Workflow activity and lifecycle hooks](#workflow-activity-and-lifecycle-hooks)
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

<!-- source-block: cb13229b:workflows/operations.md#workflow-activity-for-extensions -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 331–351 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

## Workflow activity for extensions

Extensions can subscribe with `ctx.observeWorkflowActivity(observer)` and use the typed `workflow_lifecycle`, `workflow_activity_changed`, `workflow_stage_completed`, and `workflow_heartbeat` hooks. See [Workflow activity and lifecycle hooks](/extensions#workflow-activity-and-lifecycle-hooks) for the public types and subscription example.

The workflows extension publishes activity for its owning session, folding nested runs into full root summaries. Observation is silent and independent of `workflowNotifications.enabled`, `notifyOn`, and the user/agent attribution filters used by chat notices. It neither wakes the model nor adds graph nodes. The built-in [Herdr reporter](/herdr) is one consumer: it reports these root states, combined with agent and approval-prompt activity, to the owning Herdr pane (see its [compatibility matrix](/herdr#compatibility)).

| Runtime situation | Root activity |
| --- | --- |
| A stage or `ctx.tool` is executing | `working` |
| One branch waits for human input while another executes | `working`, with `needsAttention: true` |
| Only human input can advance the workflow | `blocked / awaiting_input` |
| An active failure requires intervention, or a budget stop requires approval | `blocked / manual_intervention` |
| Paused with no execution draining | `idle / paused` |
| Quit or cancellation requested while work drains | `working / stopping`; independent sibling execution retains its own working reason |
| Execution completed or intentionally stopped | `idle` |
| A failed or blocked executor has ended without a pending prompt or budget approval | `idle / quiescent`, with `needsAttention: true`; the stored failure remains unchanged |

Registration delivers an ordered initial snapshot, followed by structurally changed root replacements and removals. Late attachment reconstructs current activity; historical `running` records alone are not evidence of live execution. Durable catalog/resume hydration publishes `recovering` before awaiting the backend and `ready` afterwards. `recovering` and `unavailable` are unknown source states, not empty ready snapshots: do not interpret them as idle.

Lifecycle targets identify runs, stages, tools, and prompts. Nested stage/tool ids use the expanded graph's `runId:nodeId` identity; `runId` still names the actual owning run and `rootRunId` names the aggregate. Control requests carry `action` and remain distinct from the status outcome. Prompt cancellation is not an answer. The completion convenience hook shares its event id with the corresponding successful stage lifecycle event and excludes failed/skipped stages. Only an explicit execution replay publishes `delivery: "replay"`; reading restored history never manufactures completion hooks. Heartbeats observe the existing configured scheduler cadence and do not prove execution.

<!-- source-block: 59586efd:workflows/operations.md#workflow-commands -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 119–174 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Reason: Retarget to the actual current page and Mintlify heading anchor.

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

<!-- source-block: cb13229b:workflows/operations.md#workflow-commands -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 125–180 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

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
- **Footer context** - An attached live stage chat shows its own current folder and Git branch and mirrors live extension status lines such as the MCP server indicator. Branch changes trigger a repaint through the host's cached footer provider. The compact `/tasks` picker retains this context and the stage's model and reasoning level even while its foreground turn streams; detail, transcript, input, and confirmation pages remain fullscreen.
- **Working animation lifecycle** - Ordinary attached-stage work keeps the same exact one-cell `∀` visible while following the active workflow theme's dark → accent → bright/bold → accent → dark luminance ramp every 88ms. Every agent and SDK turn resets to the dark regular phase with a fresh lifecycle-relative cadence; turn, terminal, error, replacement, and disposal cleanup stop the active timer without stale repaint. In an eligible retained-stage chat, every accepted idle follow-up — including a workflow-authored `stage.sendUserMessage(...)` after a prior turn ended — shows Working on admission or attach, including while Atomic restores a saved retained conversation, and keeps it through prompt startup, pre-turn compaction, and agent handoff. Attaching or remounting mid-delivery paints immediately rather than waiting for the turn's first event. A message queued into a live turn with `followUp`/`steer` uses that turn's existing status instead of starting a new one. A no-turn result, prompt or restore error, or terminal completion removes it; once the last accepted post-terminal delivery settles, a leftover start cannot bring it back. An accepted manual retry clears stale status from the prior prompt before showing new pre-stream activity. `NO_COLOR` retains regular/bold activity without foreground-color escapes. Reduced motion uses a static regular accent `∀` without an animation timer; factual automatic retry, fallback, compaction, cancellation, and error copy retains precedence.
- **Subagent statusline** - If a subagent is running while the fullscreen workflow graph is open, the graph statusline mirrors its summary so the run remains visible; hide the graph with `h`, leave it with `ctrl+x`, or reconnect later to return to the full below-editor widget.
- **Run control** - Use `interrupt`, `pause`, and `resume` for resumable live work. Pause/interrupt holds a stage's queued steering and follow-up items in place without dequeuing them or starting continuation; `resume` releases those items once in their existing per-queue order, but queue release alone does not start a model turn. `resume` on a non-paused run reopens the saved snapshot or overlay. Use `quit` to pause a live run gracefully while preserving it for `/workflow resume`.
- **Rediscovery** - Use `/workflow reload` after adding, editing, installing, or removing workflow resources or package manifest workflow entries and you want Atomic to rediscover them in-process ([Reloading workflow resources](#reloading-workflow-resources)).
- **Status listing** - `/workflow status` lists all retained active and terminal top-level runs by default; implementation-owned nested child runs are flattened into their parent workflow rather than listed separately. `/workflow status --all` is retained as a compatibility alias.

`/workflows` is the retained-run history alias for `/workflow resume`: with no id it opens the same mixed picker, but the resumable section lists only runs that the resume path can actually accept and the completed section is read-only inspection. A run with no durable checkpoint, missing/pruned artifacts, or explicit deletion is omitted from the resume picker; an explicit `/workflow resume <id>` still returns an explanatory error. It is intentionally different from `/workflow list`, which lists installed workflow definitions. See [`/workflow resume` — cross-session resume selector](#workflow-resume--cross-session-resume-selector) for the full picker semantics.

At the supported 40-column terminal minimum, attached stage chats keep the `ctrl+x return to graph` hierarchy hint. The TUI may truncate provider/model context to make room, but it keeps that context separate from the hierarchy hint so the controls stay readable.

<p align="center"><img src="../images/workflow-graph.png" alt="Workflow Graph Viewer" width="600" /></p>

Human-in-the-loop prompts appear as awaiting-input nodes in the workflow graph, not as ordinary chat modals — see [Lifecycle Notices and Human Input](#lifecycle-notices-and-human-input) for how to find and answer them.

<!-- source-block: 59586efd:workflows/operations.md#lifecycle-notices-and-human-input -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 300–364 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Reason: Retarget to the actual current page and Mintlify heading anchor.

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

<!-- source-block: cb13229b:workflows/operations.md#lifecycle-notices-and-human-input -->

Source: `packages/coding-agent/docs/workflows/operations.md` lines 352–418 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

## Lifecycle Notices and Human Input

Atomic emits deduplicated main-chat notices when top-level workflow runs complete, fail, end blocked, or stop at an active recoverable provider/auth/rate-limit block. A recoverable block remains resumable (`status` surfaces and headless results report it as blocked even though the stored live snapshot stays active), is retained durably as blocked for cross-session resume, appears in the resume picker, and its notice says the workflow **is blocked** rather than implying terminal completion. Each blocked occurrence is deduped by its `blockedAt` timestamp, so a resumed workflow that hits another recoverable block re-notifies the invoking chat. Nested child workflow outcomes are reflected inside the expanded parent graph instead of producing separate top-level cards.

Treat blocked runs as continuable by default: resume, answer a pending prompt, steer, or use a follow-up workflow. An explicit inline/no-workflow request overrides this default. Safely hold/stop the affected run, reconcile completed work and in-flight side effects, then continue inline without duplicate execution or claiming completed work was undone. Preserve safety, authorization and validation. See [execution-mode guidance](/workflows/verification#execution-mode). Resolve material ambiguity from objective and repository evidence. A `budget_exceeded` stop remains an authorization boundary: summarize progress and ask before raising the budget; do not evade the chosen limit by changing execution mode.

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

Ended recoverable blocks, including reviewer execution failures, use this same in-process continuation path. A resume response that only returns an unchanged blocked snapshot or refuses a non-resumable target reports no progress, not success. Inspect the returned continuation ID rather than assuming the original snapshot became running.

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

<!-- source-block: 59586efd:workflows/builtins.md#just-describe-it -->

Source: `packages/coding-agent/docs/workflows/builtins.md` lines 12–66 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Reason: Retarget to the actual current page and Mintlify heading anchor.

### Just describe it

Describe the workflow you want in plain chat and Atomic will design and write it for you, using the [custom authoring guide](/workflows/authoring) as its authoring reference:

```text
Create a reusable Atomic workflow called explain-file. It takes one required
text input `path` and runs a single fresh-context task that reads the file,
then returns { explanation } summarizing purpose, risks, and key symbols.
```

For example:

```text
Create a reusable Atomic workflow called review-changes.

It should accept one required text input `target` for a diff, PR summary, or
review focus.

Run two independent reviewers in parallel with fresh context:
- one focused on correctness, regressions, and missing tests
- one focused on edge cases, maintainability, and hidden risks

Then add a synthesis stage that consolidates both reviews, deduplicates
overlap, keeps only evidence-backed issues, and separates blockers from
optional suggestions.

Return structured output with `consolidated_review` and `decision` fields.
```

Atomic will:

- ask clarifying questions when stage purpose, inputs, models, or handoffs are ambiguous,
- write a `.atomic/workflows/<name>.ts` file using `workflow({...})`,
- pick `ctx.task` / `ctx.chain` / `ctx.parallel` / `ctx.ui` per the [WorkflowContext primitives](/workflows/api-reference#workflowcontext) and [task options](/workflows/api-reference#task-and-stage-options) reference,
- use `ctx.tool(name, args, fn)` for workflow-owned side effects so completed operations are durably checkpointed and do not run again after resume (see [`ctx.tool`](/workflows/operations#ctxtool--durable-cached-tool-execution)),
- run `/workflow reload` so Atomic rediscovers the workflow resource and you can launch it immediately,
- then report the generated workflow folder so you can inspect the code it wrote, using `Custom workflow created. You can inspect its code at: <workflow-folder-path>` (for example, `.atomic/workflows/`); Atomic does this only for newly created custom workflows, never builtin or pre-existing workflows.


You can also edit or harden an existing workflow in plain chat — ask Atomic to add a stage, switch a model, save artifacts, or wire in a human approval gate.

List and run it like any other workflow:

```text
/workflow list
/workflow inputs <name>
/workflow <name> key=value ...
```

Named workflow runs execute in the background. By default, after launch expect a full run id and monitor it with `/workflow status <run-id>`, F2, or `/workflow connect <run-id>`. A definition with `autoAttach: true` instead opens the graph overlay as soon as an interactive top-level named launch through `/workflow <name>` or the registered `workflow` tool is accepted. This option does not affect headless launches or nested `ctx.workflow(...)` calls, and existing input-form launch behavior is unchanged.

For a request with several implementation items, do not turn list order into one serial workflow by default. Triage dependencies first, then launch independent items as a bounded wave of separate top-level runs; see [Task queues and software factories](/workflows/reliable-design#task-queues-and-software-factories).

While a workflow is running, the visible below-editor `BACKGROUND` panel advances its elapsed label every second from the moment the run starts; it does not require opening or switching to the orchestrator. Updates repaint the existing mounted panel in place, paused timers stay frozen, the panel renders every qualifying top-level run, and terminal or quit cards retain their brief recent-run expiry. At normal widths the panel names materialized pending stages with canonical stage IDs and exact Intercom targets when pre-start delivery is available; unavailable delivery is labeled instead of implying steerability. An exact target is never partially truncated: the panel uses only pending-stage forms that fit the metadata-row budget, and omits the pending label entirely when none fit so existing live-tool and elapsed/status metadata is not displaced. The narrow form remains aggregate-only. A zero-stage workflow whose work consists only of `ctx.tool(...)` calls mounts the same panel without a synthetic stage: at normal widths its run metadata reports the live-tool total when more than one is active, followed by pending and running durable tool-node names and statuses as space permits; the collapsed narrow form reports only the number of live tools. Quit cards remain resumable and discoverable with `/workflow status` after they leave the panel. A run waiting for human input uses the blue `？` indicator in the BACKGROUND panel, the `/workflow connect` picker, and the `/workflow status` listing; answering or cancelling the prompt restores the run's current indicator.

<!-- source-block: cb13229b:workflows/builtins.md#just-describe-it -->

Source: `packages/coding-agent/docs/workflows/builtins.md` lines 12–66 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

### Just describe it

Describe the workflow you want in plain chat and Atomic will design and write it for you, using the [custom authoring guide](/workflows/authoring) as its authoring reference:

```text
Create a reusable Atomic workflow called explain-file. It takes one required
text input `path` and runs a single fresh-context task that reads the file,
then returns { explanation } summarizing purpose, risks, and key symbols.
```

For example:

```text
Create a reusable Atomic workflow called review-changes.

It should accept one required text input `target` for a diff, PR summary, or
review focus.

Run two independent reviewers in parallel with fresh context:
- one focused on correctness, regressions, and missing tests
- one focused on edge cases, maintainability, and hidden risks

Then add a synthesis stage that consolidates both reviews, deduplicates
overlap, keeps only evidence-backed issues, and separates blockers from
optional suggestions.

Return structured output with `consolidated_review` and `decision` fields.
```

Atomic will:

- ask clarifying questions when stage purpose, inputs, models, or handoffs are ambiguous,
- write a `.atomic/workflows/<name>.ts` file using `workflow({...})`,
- pick `ctx.task` / `ctx.chain` / `ctx.parallel` / `ctx.ui` per the [WorkflowContext primitives](/workflows/api-reference#workflowcontext) and [task options](/workflows/api-reference#task-and-stage-options) reference,
- use `ctx.tool(name, args, fn)` for workflow-owned side effects so completed operations are durably checkpointed and do not run again after resume (see [`ctx.tool`](/workflows/operations#ctxtool--durable-cached-tool-execution)),
- run `/workflow reload` so Atomic rediscovers the workflow resource and you can launch it immediately,
- then report the generated workflow folder so you can inspect the code it wrote, using `Custom workflow created. You can inspect its code at: <workflow-folder-path>` (for example, `.atomic/workflows/`); Atomic does this only for newly created custom workflows, never builtin or pre-existing workflows.


You can also edit or harden an existing workflow in plain chat — ask Atomic to add a stage, switch a model, save artifacts, or wire in a human approval gate.

List and run it like any other workflow:

```text
/workflow list
/workflow inputs <name>
/workflow <name> key=value ...
```

Named workflow runs execute in the background. By default, after launch expect a full run id and monitor it with `/workflow status <run-id>`, F2, or `/workflow connect <run-id>`. A definition with `autoAttach: true` instead opens the graph overlay as soon as an interactive top-level named launch through `/workflow <name>` or the registered `workflow` tool is accepted. This option does not affect headless launches or nested `ctx.workflow(...)` calls, and existing input-form launch behavior is unchanged.

For a request with several implementation items, do not turn list order into one serial workflow by default. Triage dependencies first, then launch independent items as a bounded wave of separate top-level runs; see [Task queues and software factories](/workflows/reliable-design#task-queues-and-software-factories).

While a workflow is running, the visible below-editor `BACKGROUND` panel advances its elapsed label every second from the moment the run starts; it does not require opening or switching to the orchestrator. Updates repaint the existing mounted panel in place, paused timers stay frozen, the panel renders every qualifying top-level run, and terminal or quit cards retain their brief recent-run expiry. At normal widths the panel names materialized pending stages with canonical stage IDs and exact Intercom targets when pre-start delivery is available; unavailable delivery is labeled instead of implying steerability. An exact target is never partially truncated: the panel uses only pending-stage forms that fit the metadata-row budget, and omits the pending label entirely when none fit so existing live-tool and elapsed/status metadata is not displaced. The narrow form remains aggregate-only. A zero-stage workflow whose work consists only of `ctx.tool(...)` calls mounts the same panel without a synthetic stage: at normal widths its run metadata reports the live-tool total when more than one is active, followed by pending and running durable tool-node names and statuses as space permits; the collapsed narrow form reports only the number of live tools. Quit cards remain resumable and discoverable with `/workflow status` after they leave the panel. A run waiting for human input uses the blue `？` indicator in the BACKGROUND panel, the `/workflow connect` picker, and the `/workflow status` listing; answering or cancelling the prompt restores the run's current indicator.

<!-- source-block: 59586efd:workflows/api-reference.md#ctx-tool-name-args-fn-options -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 369–436 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Reason: Retarget to the actual current page and Mintlify heading anchor.

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

<!-- source-block: cb13229b:workflows/api-reference.md#ctx-tool-name-args-fn-options -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 369–436 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

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

Zero-argument callbacks stay valid — `async () => { ... }` still compiles and runs. When `timeoutMs` is set, a callback that ignores its signal is released after the per-attempt deadline, but any child process or network request it started can keep running until it finishes on its own; forwarding the supplied signal is required for cancellation to stop that underlying work. Without a deadline, quit still abandons an ignored callback after a bounded wait and reports its owning run and node id. A cancelled call writes no replayable checkpoint. Targeted node aborts, and all cancellations under `failureMode: "return"`, retain an inspection-only `tool-failure:` record, never a replay cache hit. An uncaught targeted abort records `failedToolNodeId` while the tool node stays `cancelled`; `failedStageId` remains model-stage-only. Resume without a stage override retries the proven unfinished tool at its original ordinal and node id, replaying completed checkpoints. Missing or ambiguous frontier evidence returns `insufficient_state`; see [tool-abort recovery](/workflows/operations#recovering-an-uncaught-tool-abort).

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

<!-- source-block: 59586efd:workflows/api-reference.md#ctx-exit-options -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 437–458 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Reason: Retarget to the actual current page and Mintlify heading anchor.

### `ctx.exit(options?)`

```typescript
ctx.exit(options?: WorkflowExitOptions<TOutputs>): never;

type WorkflowExitOutputValues<TOutputs extends WorkflowOutputValues> =
  [keyof TOutputs] extends [never]
    ? Readonly<Record<string, never>>
    : Partial<TOutputs>;
interface WorkflowExitOptions<TOutputs extends WorkflowOutputValues = WorkflowOutputValues> {
  readonly status?: "completed" | "skipped" | "cancelled" | "blocked" | "failed";
  readonly reason?: string;
  /** Valid only when status is failed; defaults to false. */
  readonly resumable?: boolean;
  readonly outputs?: WorkflowExitOutputValues<TOutputs>;
}
```

Intentionally ends the current run from any call depth. `status` defaults to `"completed"`; `failed` exits default to `resumable: false`, and `resumable: true` keeps the durable run eligible for a later retry. Supplying `resumable` with another status records a non-resumable authoring failure. The runtime persists and displays `reason`, and `outputs` may provide only declared, schema-valid, serializable output keys.

See [Early exit with `ctx.exit()`](/workflows/authoring#early-exit-with-ctxexit) for snapshotting, cleanup, replay, and race semantics.

<!-- source-block: cb13229b:workflows/api-reference.md#ctx-exit-options -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 437–458 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

### `ctx.exit(options?)`

```typescript
ctx.exit(options?: WorkflowExitOptions<TOutputs>): never;

type WorkflowExitOutputValues<TOutputs extends WorkflowOutputValues> =
  [keyof TOutputs] extends [never]
    ? Readonly<Record<string, never>>
    : Partial<TOutputs>;
interface WorkflowExitOptions<TOutputs extends WorkflowOutputValues = WorkflowOutputValues> {
  readonly status?: "completed" | "skipped" | "cancelled" | "blocked" | "failed";
  readonly reason?: string;
  /** Valid only when status is failed; defaults to false. */
  readonly resumable?: boolean;
  readonly outputs?: WorkflowExitOutputValues<TOutputs>;
}
```

Intentionally ends the current run from any call depth. `status` defaults to `"completed"`; `failed` exits default to `resumable: false`, and `resumable: true` keeps the durable run eligible for a later retry. Supplying `resumable` with another status records a non-resumable authoring failure. The runtime persists and displays `reason`, and `outputs` may provide only declared, schema-valid, serializable output keys.

See [Early exit with `ctx.exit()`](/workflows/authoring#early-exit-with-ctxexit) for snapshotting, cleanup, replay, and race semantics.

<!-- source-block: 59586efd:workflows/api-reference.md#schema -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 597–608 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Reason: Retarget to the actual current page and Mintlify heading anchor.

### `schema`

```typescript
readonly schema?: TSchema;
```

Enables a schema-specific, single-use final-answer tool for that item. `ctx.stage`, `ctx.task`, `ctx.chain`, and `ctx.parallel` items accept a TypeBox schema or a plain JSON Schema descriptor object. The schema may describe an object, array, or primitive, and the captured JSON value becomes the schema-backed `stage.prompt(...)` result or `WorkflowTaskResult.structured`; task text remains formatted JSON for handoffs.

A schema-backed `StageContext` supports one `prompt()` call, so create another stage for another structured prompt. Missing or invalid `structured_output` calls receive up to three corrective follow-ups quoting the contract error and reminding the model to call `structured_output` instead of replying with plain JSON. That budget is per model candidate: a candidate that spends the initial prompt and all three follow-ups without a valid call is treated as a failed candidate and the stage advances to the next entry in [`fallbackModels`](#fallbackmodels--fallbackthinkinglevels), which receives the original stage prompt and its own fresh budget. The recorded attempt error names what the turn actually looked like — no assistant message after the prompt, an assistant message with empty text, or the `structured_output` validation error — so a repeated external cause is attributable. With no fallback candidate left, the stage fails with the contract error rather than completing. An explicit tool allowlist automatically receives the final-answer tool, while items without `schema` do not.

When `schema` and `output` are both configured, the successful `structured_output` turn carries two separate results. All ordinary assistant text blocks from that exact message, in order, are written to the artifact; the successful tool arguments become the typed schema-backed workflow value. The runtime snapshots both sides against the exact successful tool-call id rather than searching by tool name, so corrective attempts and later admitted turns cannot replace either result, and it never serializes the tool arguments into the artifact. When the successful message carries no ordinary text — including when a model-fallback session recreation leaves the live session without that message — the artifact falls back to the most recent earlier assistant text that made no `structured_output` call; if no such text exists the artifact is empty and its receipt includes the standard empty-artifact warning. Stages with `schema` but no `output` keep their existing result-text behavior. Builtin pattern workflows that hand structured decisions to later stages (`adversarial-verification`, `generate-and-filter`, `tournament`, `loop-until-done`) persist those decisions themselves, so their `*.json` inter-stage artifacts remain machine-readable JSON.

<!-- source-block: cb13229b:workflows/api-reference.md#schema -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 597–608 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

### `schema`

```typescript
readonly schema?: TSchema;
```

Enables a schema-specific, single-use final-answer tool for that item. `ctx.stage`, `ctx.task`, `ctx.chain`, and `ctx.parallel` items accept a TypeBox schema or a plain JSON Schema descriptor object. The schema may describe an object, array, or primitive, and the captured JSON value becomes the schema-backed `stage.prompt(...)` result or `WorkflowTaskResult.structured`; task text remains formatted JSON for handoffs.

A schema-backed `StageContext` supports one `prompt()` call, so create another stage for another structured prompt. Missing or invalid `structured_output` calls receive up to three corrective follow-ups quoting the contract error and reminding the model to call `structured_output` instead of replying with plain JSON. That budget is per model candidate: a candidate that spends the initial prompt and all three follow-ups without a valid call is treated as a failed candidate and the stage advances to the next entry in [`fallbackModels`](#fallbackmodels--fallbackthinkinglevels), which receives the original stage prompt and its own fresh budget. The recorded attempt error names what the turn actually looked like — no assistant message after the prompt, an assistant message with empty text, or the `structured_output` validation error — so a repeated external cause is attributable. With no fallback candidate left, the stage fails with the contract error rather than completing. An explicit tool allowlist automatically receives the final-answer tool, while items without `schema` do not.

When `schema` and `output` are both configured, the successful `structured_output` turn carries two separate results. All ordinary assistant text blocks from that exact message, in order, are written to the artifact; the successful tool arguments become the typed schema-backed workflow value. The runtime snapshots both sides against the exact successful tool-call id rather than searching by tool name, so corrective attempts and later admitted turns cannot replace either result, and it never serializes the tool arguments into the artifact. When the successful message carries no ordinary text — including when a model-fallback session recreation leaves the live session without that message — the artifact falls back to the most recent earlier assistant text that made no `structured_output` call; if no such text exists the artifact is empty and its receipt includes the standard empty-artifact warning. Stages with `schema` but no `output` keep their existing result-text behavior. Builtin pattern workflows that hand structured decisions to later stages (`adversarial-verification`, `generate-and-filter`, `tournament`, `loop-until-done`) persist those decisions themselves, so their `*.json` inter-stage artifacts remain machine-readable JSON.

<!-- source-block: 59586efd:workflows/api-reference.md#gitworktreedir-/-basebranch -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 663–679 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Reason: Retarget to the actual current page and Mintlify heading anchor.

### `gitWorktreeDir` / `baseBranch`

```typescript
readonly gitWorktreeDir?: string;
readonly baseBranch?: string;
```

Selects or creates a reusable same-repository Git worktree for `ctx.stage`, `ctx.task`, `ctx.chain`, and `ctx.parallel`.

- **Creation and validation:** A missing path is created with `git worktree add --detach <path> <baseBranch>` from the canonical main repository root, where an omitted or blank `baseBranch` defaults to `HEAD`. Existing paths must be same-repository worktree roots outside the invoking checkout; the checkout itself, nested targets, and missing targets whose symlinked parent resolves inside it are rejected.
- **Cwd remapping:** The default cwd preserves the invoking repository-relative subdirectory inside the worktree. Absolute cwd values inside the invoking repository are remapped, values already inside the worktree are preserved, and relative values resolve from the worktree cwd without lexical or symlink escape.
- **Output containment:** Runner-managed reusable-worktree relative outputs follow the effective worktree cwd and cannot escape through traversal or symlinks. Temporary-worktree outputs are copied to distinct runner-owned artifact directories before cleanup, including in `file-only` mode. Explicit absolute outputs remain caller-selected.
- **Caching and diagnostics:** Temporary isolation defaults to the runner invocation cwd, and relative task cwd values resolve there. Reusable setup is cached by canonical repository and target identity independently of equivalent path spelling or `baseBranch`, revalidates checkout identity before reuse, retries one transient timeout from read-only repository probes, and reports the exact Git command, cwd, timeout, elapsed time, exit status or signal, and spawn error details on failure.
- **Security boundary:** Worktrees isolate checkouts and cwd, not the operating system. Use a container, VM, or another OS-enforced boundary for untrusted code that can race or mutate arbitrary paths.

For lower-level integrations, [`setupGitWorktree(options)`](#setupgitworktreeoptions) returns the validated and remapped setup result.

<!-- source-block: cb13229b:workflows/api-reference.md#gitworktreedir-/-basebranch -->

Source: `packages/coding-agent/docs/workflows/api-reference.md` lines 667–683 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

### `gitWorktreeDir` / `baseBranch`

```typescript
readonly gitWorktreeDir?: string;
readonly baseBranch?: string;
```

Selects or creates a reusable same-repository Git worktree for `ctx.stage`, `ctx.task`, `ctx.chain`, and `ctx.parallel`.

- **Creation and validation:** A missing path is created with `git worktree add --detach <path> <baseBranch>` from the canonical main repository root, where an omitted or blank `baseBranch` defaults to `HEAD`. Existing paths must be same-repository worktree roots outside the invoking checkout; the checkout itself, nested targets, and missing targets whose symlinked parent resolves inside it are rejected.
- **Cwd remapping:** The default cwd preserves the invoking repository-relative subdirectory inside the worktree. Absolute cwd values inside the invoking repository are remapped, values already inside the worktree are preserved, and relative values resolve from the worktree cwd without lexical or symlink escape.
- **Output containment:** Runner-managed reusable-worktree relative outputs follow the effective worktree cwd and cannot escape through traversal or symlinks. Temporary-worktree outputs are copied to distinct runner-owned artifact directories before cleanup, including in `file-only` mode. Explicit absolute outputs remain caller-selected.
- **Caching and diagnostics:** Temporary isolation defaults to the runner invocation cwd, and relative task cwd values resolve there. Reusable setup is cached by canonical repository and target identity independently of equivalent path spelling or `baseBranch`, revalidates checkout identity before reuse, retries one transient timeout from read-only repository probes, and reports the exact Git command, cwd, timeout, elapsed time, exit status or signal, and spawn error details on failure.
- **Security boundary:** Worktrees isolate checkouts and cwd, not the operating system. Use a container, VM, or another OS-enforced boundary for untrusted code that can race or mutate arbitrary paths.

For lower-level integrations, [`setupGitWorktree(options)`](#setupgitworktreeoptions) returns the validated and remapped setup result.

<!-- source-block: cb13229b:models/model-selection.md#aa-cross-check-for-current-candidates -->

Source: `packages/coding-agent/docs/models/model-selection.md` lines 41–55 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Retarget to the actual current page and Mintlify heading anchor.

## AA cross-check for current candidates

These are selected candidates, not a replacement DeepSWE frontier. The [AA leaderboard](https://artificialanalysis.ai/leaderboards/models) was retrieved **2026-09-08** under Intelligence Index **v4.3**, announced **2026-09-07**. Scores are index points, not pass percentages; cost is weighted USD per **AA Intelligence Index task**, not DeepSWE cost. Speed uses the default 10k-input workload in standardized output tokens per second, not full-task latency. The source has no separate publication timestamp for these measurements.

| Model and AA measurement configuration | Intelligence Index | AA $/task | Output tokens/s | Candidate role and tradeoff |
| --- | --- | --- | --- | --- |
| [Claude Fable 5.1, max with default fallback](https://artificialanalysis.ai/models/claude-fable-5-1) | 53 | $7.63 | 69 | Knowledge-work planning candidate; xhigh also displays 53 at $5.98 per task |
| [GPT-6 Astra, max](https://artificialanalysis.ai/models/gpt-6-astra) | 53 | $3.26 | 62 | Terminal and document-reasoning candidate; xhigh displays 53 at $2.31 and scores higher on those two individual evaluations |
| [Gemini 3.8 Flash, high](https://artificialanalysis.ai/models/gemini-3-8-flash) | 41 | $1.24 | 286 | Strong historical Datacurve result, but only 20% on the new Terminal-Bench v4.0; check the intended task distribution |
| [GPT-5.6 Luna, max](https://artificialanalysis.ai/models/gpt-5-6-luna) | 38 | $0.18 | 121 | Budget long-context candidate with verification; 12% on Terminal-Bench v4.0 |

AA's [v4.3 announcement](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v4-3) replaces 𝜏³-Banking with AutomationBench-AA and Terminal-Bench v2.1 with v4.0. Fable 5.1 max with default fallback scores 58% normalized Elo on AA-Briefcase and 63% on GDPval-AA v2, versus Astra max at 53% and 54%. These are transformed Elo displays, **not pass rates**. Astra xhigh scores 32% GDP.pdf All-pass and 60% Terminal-Bench v4.0; Astra max scores 31% and 59%. Use the [per-evaluation tables](/models/evals#per-evaluation-scores-for-catalog-models) and [task-type picker](/models/evals#pick-by-task-type), not an aggregate rank. A rounded lead does not establish statistical significance, security-review reliability or the best model for every role. Fable's default-fallback result is not evidence for an arbitrary no-fallback configuration.

The separate [Coding Agent Index v1.4](https://artificialanalysis.ai/agents/coding-agents), retrieved 2026-09-08, still uses Terminal-Bench v2.1 alongside DeepSWE and SWE-Atlas-QnA. It reports Claude Code + Fable 5.1 max with fallback at **70**, **$9.18/task** and **24.0 minutes/task**, Opencode + Gemini 3.8 Flash high at **61**, **$2.04/task** and **11.9 minutes/task**, and Codex + Luna max at **57**, **$0.29/task** and **8.0 minutes/task**. These are named-agent runs, not Atomic or interchangeable base-model results. All fourteen rows are in [Evals](/models/evals#coding-agent-index-v14-is-a-different-comparison). Fable 5.1 remains absent from the separately dated Datacurve snapshot below.

<!-- source-block: cb13229b:subagents.md#task-inspection -->

Source: `packages/coding-agent/docs/subagents.md` lines 22–41 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: The newer background-tasks.md contract and native Windows shell support supersede the earlier task-inspection paragraph.

## Task inspection

Hosts with an owner task store expose `/tasks` and `/tasks <id>` for background agents and shells, including their retained terminal results. Foreground-only work is excluded. Enter opens detail; arrows select an explicit action. Cancel asks for confirmation of the selected task. Terminal tasks retain transcript inspection but omit foreground, cancellation, and stdin actions. Escape returns from detail or stdin before returning to the composer.

`/tasks` appears in slash-command autocomplete. The inspector groups agents and shells with counts, status symbols, and a highlighted selection. Task descriptions lead; the selected row shows secondary activity and tool counts. The header and footer remain visible in ordinary terminal sizes, with a compact fallback for short terminals.

The list opens as a compact inline widget, like the `/workflow connect` picker. Detail, transcript, input, and stop-confirmation pages are fullscreen; returning to the list preserves selection. Every agent row includes its resolved model and reasoning level when available, including completed background tasks.

While `/tasks` or its fullscreen transcript/detail view is active, Escape navigates back or closes that view; it does not cancel a pending `ask_user_question`. The questionnaire waits out of the way and returns with its selection intact after task navigation closes. With no task view active, Escape cancels the questionnaire normally.

In the default isolated CLI, background subagents continue running after their launch observation returns. The engine publishes a compact task-status indicator below the prompt box, without task rows or activity previews. Run `/tasks` to open the list and inspect individual tasks; task updates never open it automatically. A compact finished-task summary remains after completion. Inspecting does not restart work or create a second task owner. Top-level model bash commands use this owner on POSIX systems; native Windows and commands inside subagent sessions retain their existing execution path.

Transcript inspection uses a dedicated scrolling view with pinned identity, position, and controls. Retained child messages use the normal message renderers, excluding hidden reasoning and inline images. Missing capture is reported as `Transcript unavailable`; metrics never substitute for missing messages. Arrows scroll, PageUp/PageDown moves one viewport, and PageUp at the top loads earlier retained history. Home/End jumps within loaded history.

Open live transcripts subscribe to child-session events, so streaming text and partial/final tool results refresh without reopening the page or waiting for a task-activity counter. Earlier pages remain anchored while updates arrive. Leaving the transcript releases its subscription without affecting execution.

Detail views pin task identity, state, available metrics, and the selected action while PageUp/PageDown scrolls the body. Recent activity shows up to five retained tool actions; errors and input requests appear explicitly. Left returns to the previous view. `x` requests cancellation without bypassing confirmation or configured task bindings. Shell inspection shows a bounded output tail with omission markers.

After a confirmed `x` stop settles, the owning chat receives a visible **stopped** notification and the parent model receives the stop context, even if the child returns no final message. Repeated stops do not duplicate notifications or replace an already-recorded terminal result. Closing the owner still suppresses late completion delivery.

<!-- source-block: 59586efd:workflows/reliable-design.md#stage-model-and-thinking-level-assignment -->

Source: `packages/coding-agent/docs/workflows/reliable-design.md` lines 68–92 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Reason: Reconcile role defaults with model-selection.md, updated by 6806f7995 after the workflow paragraph.

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

<!-- source-block: cb13229b:workflows/reliable-design.md#stage-model-and-thinking-level-assignment -->

Source: `packages/coding-agent/docs/workflows/reliable-design.md` lines 101–125 at `cb13229bebe30ea7cb65689569569494b4bc651c`. Reason: Reconcile role defaults with model-selection.md, updated by 6806f7995 after the workflow paragraph.

### Stage model and thinking-level assignment

Before launching an authored workflow, assign every model stage a **role**, **failure cost**, **primary model**, **thinking level**, and **fallback policy**. Read [Model Selection](/models/model-selection) for the role defaults and [Evals](/models/evals) for the measured per-evaluation scores — its task-type picker maps each stage type (terminal debugging, knowledge-work planning, tool-calling loops, document research, code-reading review) to the eval that measures it and the models that lead it — but treat thinking levels in benchmark rows as measurement configurations, not production defaults. Reserve `max` for high-cost-of-error roles or an explicit user request; use `high` for demanding mapping, lifecycle analysis, compatibility, planning, synthesis, triage, and repair; use `medium` for user-impact review and final reporting; and keep deterministic checks as tool nodes with no model call.

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
