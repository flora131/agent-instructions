# Task UI research

Research date: 2026-09-05. Design only. Read the [canonical brief](2026-09-05-agent-task-experience-brief.md) completely; it controls this work. No runtime, shipped-documentation, brief, Git, or external publication changes. No source reuse proposed.

## Summary

Use one owner-scoped task projection for main and attached workflow chats, independent of the launching tool invocation's pending state. Render one stable task row through foreground wait, background execution and settlement. Keep global `app.tools.expand` semantics; expansion, focus, waiting and execution are separate state. The existing renderer already has useful compact detail, but its update routing is bounded by tool/turn lifetime. A different color or final notification cannot repair that lifetime mismatch.

This is an Operate surface in the existing Atomic visual world. PRODUCT.md and DESIGN.md were read fully, together with impeccable shape and operate playbooks. The canonical brief records that the parent already ran context setup; this research did not rerun it or write design metadata. The explicit brief permits an In Review draft with unresolved interview choices, so the generic shape instruction to stop for confirmation does not delay delivery.

## Provenance and limits

Atomic snapshot: `230bb1f1c75508d087e09725014c69f022de02cc`, branch `feat/agent-task-experience`.

UI reference snapshot, resolved through `gh api repos/mehmoodosman/claude-code/commits/main --jq .sha`: `30a1fa0f5d84b23f05664378d4863dd42aef0952`.

The [reference README](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/README.md#L1-L33) describes a recovered source-map tree, not an official release or supported SDK. Short excerpt: “The underlying software is Anthropic’s proprietary product.” GitHub's repository license metadata was `null`. Its [build limitation](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/README.md#L141-L147) says there is no package.json and private tooling is needed. Accessibility of files is not a reuse license. Do not copy implementation, source maps, or visual branding into Atomic artifacts. Findings below are architectural analysis of a pinned, unofficial historical tree, not claims about today's shipped product.

Raw files were retrieved without cloning. The initial guessed `src/tasks/LocalAgentTask/LocalAgentTask.ts` returned HTTP 404; the actual file is `.tsx`. DeepWiki gave no snapshot, so matching its claims to this SHA is a cross-check, not proof its index uses that SHA. No reference application was built or exercised.

## DeepWiki query log

The parent executed these three focused MCP questions. Their answer links are the durable synthesis record. Claims were checked below rather than accepted wholesale.

### Q1: composition and expansion

Question: “Trace subagent terminal UI collapsed versus Ctrl+O expanded in src/tools/AgentTool/UI.tsx, AgentProgressLine, VerboseAgentTranscript, CtrlOToExpand and Messages.tsx. Give exact source paths/symbols and line composition, available counts, elapsed/action text, hierarchy and transcript virtualization. Distinguish foreground subagent and background task renderer mechanics, specify snapshot/version and any source availability limitations.”

[Answer](https://deepwiki.com/search/trace-subagent-terminal-ui-col_40debf34-5dbb-4e38-82fb-70fdfa2dae6b). Leads: `VerboseAgentTranscript`, condensed progress, `CtrlOToExpand`, virtual list, `extractLastToolInfo`. Confidence: high for individually verified branches U1/U2/U4; unverified for every count/elapsed formatting detail in the synthesized answer. No snapshot supplied. The answer's broad language about bounded memory is stronger than verified UI virtualization: a virtual viewport does not by itself bound all stored task history.

### Q2: background transition and notifications

Question: “Focused follow-up: trace AgentTool.tsx backgroundSignal, LocalAgentTaskState/isBackgrounded and explicit versus mid-execution async transition to live task UI. How are stable toolUseId/task IDs used when foreground progress becomes background and completes? Where do enqueueAgentNotification, Messages.tsx and BackgroundTasksDialog avoid duplicate transcript rows or blank newline notification blocks? Explain cancellation/completion/background races. Give exact source paths and distinguish agent foregrounding from main-session foregrounding and unavailable source evidence.”

[Answer](https://deepwiki.com/search/focused-followup-trace-agentto_ebef5fce-480a-41ea-ab59-ea234c8b9bdc). Leads: foreground registration with background promise, agent-iterator race, `async_launched`, background progress, notification enqueue. Confidence: high for the checked promise/ID branches U3/U5; not a verified exactly-once notification guarantee. The answer explicitly lacked `Messages.tsx` context for blank blocks and ended mid-error discussion. A dialog excluding its foregrounded task prevents a duplicate list item, not arbitrary duplicate transcript/result delivery. Do not transplant the reference's terminal child continuation semantics into Atomic.

### Q3: keyboard, overflow and attention

Question: “Focused terminal UI follow-up: exact keyboard dispatch for Ctrl+O transcript expansion, task focus/navigation and conflict handling; narrow/short terminal overflow and virtualized scroll anchor stability; nested/parallel grouping; HIL/attention/error/cancel statuses; local shell/PTY stdin task display. What are the shared components versus divergent background dialogs? Give source symbols, paths and actual implementation limits. Which behaviors are only proposals? Also identify repository version/provenance and licensing limits if knowable, do not infer proprietary source is reusable.”

[Answer](https://deepwiki.com/search/focused-terminal-ui-followup-e_c3ec016e-0dc0-49c5-8167-27b3bfed4a35). Leads: global transcript action, modal pager, task dialogs, output tail, list virtualization. Confidence: high for checked keyboard/filter/anchor branches U4/U5/U6; shell tail byte count, short-screen status-line threshold and HIL behavior remain unverified in this pass. DeepWiki explicitly could not establish HIL/attention or licensing. Its statement that transcript search is only a TODO is not adopted: search callbacks are present in the inspected Messages virtual-list call, and no whole-feature verification was done.

## Verified reference mechanisms

Each excerpt is deliberately short. These establish mechanisms, not permission for code reuse.

| ID | Source and short surrounding excerpt | Finding |
| --- | --- | --- |
| U1 | [CtrlOToExpand.tsx:29–36](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/components/CtrlOToExpand.tsx#L29-L36): `useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o")`; `if (isInSubAgent || inVirtualList) { return null; }` | Hints follow configured shortcuts and suppress redundant nested hints. Atomic should use its own namespaced action, not this action string. |
| U2 | [UI.tsx:468–500](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/tools/AgentTool/UI.tsx#L468-L500): `terminalSize.rows < toolToolRenderLinesEstimate`; `In progress…`; `toolUseCount` | Compactness can depend on available height, not width alone. [UI.tsx:509–536](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/tools/AgentTool/UI.tsx#L509-L536): `processedMessages.slice(-MAX_PROGRESS_MESSAGES_TO_SHOW)`; `INITIALIZING_TEXT` replaces an empty branch. Counts must count tool uses, not progress events. |
| U3 | [LocalAgentTask.tsx:573–612](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/tasks/LocalAgentTask/LocalAgentTask.tsx#L573-L612): `backgroundSignalResolvers.set(agentId, resolveBackgroundSignal!)`; `taskId: agentId` | A foreground task has a stable agent-keyed background signal. An optional timer exists in this UI reference; that says nothing about the Rust reference's subagent behavior. [AgentTool.tsx:884–889](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/tools/AgentTool/AgentTool.tsx#L884-L889): `Promise.race([nextMessagePromise...` demonstrates waiting on activity versus background transition. |
| U4 | [Messages.tsx:464–467](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/components/Messages.tsx#L464-L467): `scrollRef != null && !disableVirtualScroll`; [699–701](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/components/Messages.tsx#L699-L701): `VirtualMessageList ... itemKey={messageKey}` | Virtualization is gated. [276–307](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/components/Messages.tsx#L276-L307) includes both a 30-message transcript constant and a 200-message nonvirtual safety cap. Do not simplify this to “always 30 messages” or an unlimited history guarantee. |
| U5 | [BackgroundTasksDialog.tsx:122–125](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/components/tasks/BackgroundTasksDialog.tsx#L122-L125): `task.id === foregroundedTaskId` is excluded | Active foreground detail is omitted from the background selector. This does not prove live transcript deduplication. |
| U6 | [defaultBindings.ts:43–46](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/keybindings/defaultBindings.ts#L43-L46): `'ctrl+o': 'app:toggleTranscript'`; [ScrollKeybindingHandler.tsx:557–565](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/components/ScrollKeybindingHandler.tsx#L557-L565): `PromptInput not mounted` | Reference Ctrl+U/Ctrl+D modal paging relies on absent editor owners. Atomic's explicit user constraint forbids repurposing those keys, even if the reference does so. |

## Atomic rendering and reconnect evidence

All source links below use the current checkout SHA. The smallest useful integration is a shared task projection feeding the existing hosts, not a replacement web/React UI.

| ID | Source and excerpt | Consequence |
| --- | --- | --- |
| A1 | [tool-rendering.ts:19–53](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/subagents/src/extension/tool-rendering.ts#L19-L53): `if (burst && !burst.owner) return new Container()`; `renderLiveSubagentResult(burst?.result ?? result, options, theme, context)` | Existing grouped tool-call bursts already select one visual owner. Keep launch/tool grouping distinct from child task identity. |
| A2 | [render-result.ts:41–75](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/subagents/src/tui/render-result.ts#L41-L75): `subagentResultRenderKey(result, options)`; `clearResultAnimationTimer(context)` | Foreground transcript deliberately avoids timer repaint because above-fold churn cleared scrollback. Do not add elapsed-time animation that reintroduces this. Live activity-driven snapshot time and a separately budgeted visible dock clock are safer. |
| A3 | [render-result-compact.ts:23–65](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/subagents/src/tui/render-result-compact.ts#L23-L65): `r.progress || r.progressSummary`; `compactCurrentActivity`; `keyHintIfBound("app.tools.expand", "for live detail")` | Existing compact identity/action/stats can become the common row vocabulary. Expanded [render-result.ts:94–185](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/subagents/src/tui/render-result.ts#L94-L185) uses explicit `running`, `yielded`, `detached`, `cancelled` and recent tools/output. These labels currently mix wait and execution concepts. |
| A4 | [interactive-agent-events.ts:280–323](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/coding-agent/src/modes/interactive/interactive-agent-events.ts#L280-L323): `pendingTools.get(event.toolCallId)`; `pendingTools.delete(event.toolCallId)`; `pendingTools.clear()` | Main chat partial results only update pending components. Tool end deletes the route; agent end clears routes. An independent task subscription must continue after yield/tool return. |
| A5 | [chat-message-renderer.ts:190–224](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/coding-agent/src/modes/interactive/components/chat-message-renderer.ts#L190-L224): `upsertToolEntry`; `updateToolResult(toolCallId, event.partialResult, true, false)` | Attached chat's shared message renderer already handles tool IDs, but tool-result projection alone is not an owner-lifetime registry. |
| A6 | [stage-tool-execution-buffer.ts:16–42](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/workflows/src/runs/foreground/stage-tool-execution-buffer.ts#L16-L42): `agent_start ... agent_end` clears; `tool_execution_end` deletes; replay contains start plus latest update | Late attachment recovers pending tool activity only. A yielded tool has disappeared from this buffer. Proposed attach needs task snapshot plus ordered cursor replay while owner remains live, separate from this buffer. |
| A7 | [stage-chat-view-live-events.ts:9–27](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/workflows/src/tui/stage-chat-view-live-events.ts#L9-L27): `ctx.chatHost.applyAgentEvent(event)`; `clearBusyForTerminalWorkflowStage()` | Do not bypass terminal-stage cleanup when adding task updates. Owner closure must fence late running events. |
| A8 | [keybindings.ts:112](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/coding-agent/src/core/keybindings.ts#L112): `"app.tools.expand": { defaultKeys: "ctrl+o"... }`; [interactive-editor-actions.ts:67–90](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/coding-agent/src/modes/interactive/interactive-editor-actions.ts#L67-L90): recursively `child.setExpanded(expanded)` | Ctrl+O is global tool expansion, not task cancellation or foregrounding. Preserve that meaning. |
| A9 | [stage-chat-view-input.ts:22–60](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/workflows/src/tui/stage-chat-view-input.ts#L22-L60) and [94–103](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/workflows/src/tui/stage-chat-view-input.ts#L94-L103): `ctx.onDetach()`; prompt handling precedes `handleToolsExpandInput`; `ctx.setToolsExpanded?.(!expanded)` | Existing attached chat shares expansion state and protects mounted prompt/editor input. View detach is not owner termination. Proposed task-focus handlers need equally explicit precedence. |
| A10 | [widget.ts:425–485](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/workflows/src/tui/widget.ts#L425-L485): `if (width < COLLAPSED_BREAKPOINT_COLS)`; `for (let i = 0; i < display.length; i++)` | Workflow dock is compact only below 80 columns and otherwise renders all selected runs. Bound mounted height without deleting rows from the pure complete projection. |

Current trace, not a proposed implementation:

```text
subagent partial result
  extension renderSubagentToolResult
    renderLiveSubagentResult
      renderSingleCompact / renderMultiCompact / expanded renderSubagentResult
main tool_execution_update
  pendingTools[toolCallId].updateResult
  tool_execution_end removes update route
attached workflow stage event
  StageToolExecutionBuffer records pending start/latest update
  applyStageChatLiveHandleEvent
    chatHost.applyAgentEvent
      ChatMessageRenderer.applyEvent
        updateToolResult
  turn/tool terminal clears pending replay state
```

This pass verifies the UI boundary gap, not the entire Intercom broker/result-delivery trace. The separately assigned Intercom research owns exact detachment, transport receipt/retry and transcript persistence causality. Do not claim a reproduced blank-block runtime defect from source inspection alone.

## Visual direction and projection recommendation

PRODUCT.md and DESIGN.md establish the restrained Catppuccin role palette, keyboard-first density, non-color state labels, rounded-or-no-border containers, terminal-default type, and literal one-cell `∀` working identity. Actual compact subagent source consumes `toolTitle`, `accent`, `warning`, `dim`, and `muted` roles. The shipped `dark.json` is not a literal copy of DESIGN.md's hex palette: [dark.json:13–28](https://github.com/bastani-inc/atomic/blob/230bb1f1c75508d087e09725014c69f022de02cc/packages/coding-agent/src/modes/interactive/theme/dark.json#L13-L28) includes `"accent": "#8abeb7"` and role aliases. Use resolved theme roles; do not “repair” theme files or impose hard-coded hex colors as part of this RFC.

Recommended proposed component responsibilities:

- Owner-scoped task projection owns stable task ID, parent task ID, event revision, execution state, attention descriptor, current action, optional observed counts/time, bounded activity and output references.
- Shared task row/detail renderer reads that projection in both chat hosts. A launch group can aggregate child rows without merging their identities. Task state survives wait yield; terminal outcome replaces the same row. Genuine messages remain separate transcript content.
- View state owns selection by task ID, per-task scroll anchor by activity sequence, follow-bottom flag, focus target and global expansion. New events do not steal selection or turn follow-bottom back on. A task's position should not jump because elapsed time or status changes; explicit sorting/navigation is different from event order.
- Use a bounded dock summary with explicit hidden count and accessible focused overflow. Keep transcript detail where the user launched work; a summary/reference in another view must not become a second task/result identity.
- Terminal text sanitization is a display transform only. Preserve raw stored/model/transport text and IDs. Show unknown counts as absent, not invented zeroes. Truncation is visibly marked and expanded output remains retrievable within retention policy.

## Dependencies and neighboring work

Checked live on 2026-09-05 using `gh issue view ... --json number,state,title,body,comments` and `gh pr view 2700 --json state,mergedAt,headRefOid`.

- [#2824](https://github.com/bastani-inc/atomic/issues/2824) is OPEN. The [requesting maintainer comment](https://github.com/bastani-inc/atomic/issues/2824#issuecomment-5536893138) requires #2700 first, configurable namespaced actions, Ctrl+D/Ctrl+U unchanged, and suggests evaluating F2 as overflow. The issue explicitly preserves the complete-renderer regression for more than four runs. This informs shared dock constraints; it is not permission to implement that whole issue here.
- [#2700](https://github.com/bastani-inc/atomic/pull/2700) is OPEN, `mergedAt: null`, head `4914e13ea7f7d1addb03bab8dc7465770e2a1254`. It proposes one safe prompt per visible run tree, concrete run/stage/prompt identity, top-level connect path, and no parent transcript/model insertion. Do not describe it as landed. Reconcile its final widget/prompt projection before eventual implementation. Its broader inline-answer/notification follow-ups are outside this draft's implementation scope.
- [#2565](https://github.com/bastani-inc/atomic/issues/2565) is OPEN, presentation of resumable workflow stops. Preserve distinction between a resumable workflow run and a terminal child task. A warning-colored run does not authorize child resurrection or recolor genuinely failed task nodes.

## Scenario checklist for the mockup writer

These are proposed design proofs, not running-product screenshots. Use labeled cell dimensions and actual monospaced layouts, preferably 100×30, 80×24 and 48×16. Validate terminal-cell width, including Unicode, rather than string length alone. Do not freeze these illustrative dimensions as implementation breakpoints.

| Scenario | Required visible proof |
| --- | --- |
| Main foreground, collapsed | Task identity, agent/tool name, `running · foreground`, current action, observed elapsed/tools only if available; usable composer and expansion hint. |
| Main foreground, expanded | Same identity and status; recent actions/tool arguments/output, clipped history with range/overflow navigation; no different execution semantics. |
| Main background, both modes | Explicit and timed yield variants have `running · background`, reason, live action changes before result, same launch identity. |
| Intercom before/after/settled | Identical ID/location before foreground wait, after `background · coordination`, during further activity, and at terminal result. One authentic peer message is visibly distinct; no synthetic empty notification box or duplicate completion transcript. |
| Attached workflow, both modes | Same row/detail component vocabulary, owner run/stage label and stage dependency still waiting while child runs; visible-pane detach does not cancel. Reattach while live reconstructs the same latest row. |
| Shell and PTY | Stable shell task ID, command, current output, running/background or exit code; explicit `stdin available`/`input needed` versus no stdin. Focusing input must not silently cancel or relaunch. |
| Parallel and nested | Parent/group label, each child identity and status, readable indent hierarchy; one child may settle while siblings continue. Aggregation must not label all complete on one yielded tool return. |
| Attention/HIL/error/cancel | Plain-text reason and action target. Distinguish waiting for human input from elapsed-inactivity attention, failure and cancellation. Owner closure visibly settles unfinished descendants; already completed rows do not regress. |
| Narrow and short | Compact summary preserves active/attention/error counts, essential action and overflow affordance without crowding transcript/composer off-screen. Selected ID and scroll anchor survive resize/new output. |
| Unknown/large output | Unknown counts omitted, long paths/text clipped by cells with visible continuation, bounded output notices and retained artifact pointer; no misleading completeness. |

Keyboard behavior must accompany each layout: global configured Ctrl+O for expansion; task focus/selection distinct from expansion; arrows/PageUp/PageDown/Home/End only in the appropriate focused view; editor input and HIL take precedence; Escape exits task focus before applying any destructive action. Ctrl+D/Ctrl+U remain unchanged. Read key hints from action mappings and hide unbound hints. Never label foregrounding an already-live task “resume”.

## Contrastive choices for the next interview

1. Overflow: A, reuse F2 workflow graph for workflow overflow and a task-focused list for main chat; B, one shared task-focused view in both chats, with F2 still opening graph. Recommend B for task interaction parity, while preserving F2 and linking to graph. Tradeoff: one new focus surface, but fewer divergent task controls. Do not pick a new default chord until collision review.
2. Attention: A, persistent count plus explicit task-local reason; B, automatically open/focus task detail. Recommend A to preserve typing/selection; allow an explicit jump action. Critical owner failures can use existing notification policy, not silent focus theft.
3. Expansion: A, preserve global Ctrl+O with bounded detail for all rows; B, redefine Ctrl+O to selected task only. Recommend A because both existing hosts expose global tool expansion. A separate namespaced selected-task detail action can serve focused inspection without changing existing meaning.

## Checks actually executed and limits

Executed read-only git/gh/curl-equivalent urllib source checks and local source inspection. Confirmed branch and full SHA; retrieved current issue/PR status and verified the cited mechanisms above. No runtime, tmux, screenshot, performance, accessibility or test-suite execution occurred. This deliverable is source-backed design research. Future deterministic checks must cover the full before/after/settlement trace in both chat hosts, no-blank/no-duplicate rendering, expansion remapping, no-color/reduced-motion, owner close, attach cursor recovery, resize and scroll stability. Parent's final artifact validation owns link/path/width and design-only diff checks.

Contract amendment carried forward: “note, that your design also needs to accomodate the intercom behavior that leads subagents to become async and make sure that the behavior is transparent as background subagent ui (currently not happening and only get a final lifecycle done message with an extra newline block)”

### Additional parent DeepWiki follow-up

The parent reported a fourth focused challenge to generator continuity: [answer](https://deepwiki.com/search/criticalevidence-followup-sour_ef91b6cc-fc1d-4577-a5f6-2d3d9bd3679b). Question scope, paraphrased from the parent handoff: challenge the claim that backgrounding preserves one ongoing generator and ask for demonstrated empty-block/duplicate suppression. Exact full question/answer text is not present in this child handoff; the parent should preserve it in the consolidated query log. According to that handoff, the answer claims “one ongoing generator” but also describes iterator return followed by new `runAgent`, and acknowledges no demonstrated Messages empty-block/duplicate suppression. Confidence in uninterrupted generator continuity: unsupported.

The raw source independently shows why stable identity must not be equated with generator continuity: [AgentTool.tsx:916–948](https://github.com/mehmoodosman/claude-code/blob/30a1fa0f5d84b23f05664378d4863dd42aef0952/src/tools/AgentTool/AgentTool.tsx#L916-L948) includes `agentIterator.return(undefined)` and later `updateAsyncAgentProgress(backgroundedTaskId, ...)`. The first operation closes an iterator; the second preserves task-keyed UI updates. Atomic should specify its own runner continuity guarantee rather than infer it from a stable task ID in this reference.
