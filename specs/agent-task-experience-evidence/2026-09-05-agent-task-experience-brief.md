# Agent and task experience: agreed design brief

## Status and boundaries

Design-only research and RFC. The user selected spec and mockups first, followed by review together before runtime implementation. Do not implement the proposed runtime, change shipped docs to claim it exists, commit, push, create a PR, or merge. Work only in `/Users/tonystark/Documents/projects/atomic-agent-task-experience`, branch `feat/agent-task-experience`, created from main at `230bb1f1c75508d087e09725014c69f022de02cc`. Allowed deliverables are research and spec artifacts, with a focused mockup and validation receipts if useful. Do not modify this agreed brief.

## Literal original request

> Let's do this work in a separate git worktree in ../, Claude Code has beautiful subagent UI, can you draw inspiration from that to beautify the Atomic subagent and expansion UI (ctrl + o) in the main chat and workflow chats so that a user can easily see things in the same way for foreground and background agents like Claude Code can? Heavily reference the deepwiki mcp with mehmoodosman/claude-code to ask all questions about the impl. Please don't mention that this is from Claude Code. Secondly, I really like the Rust implementation of the subagent engine in Codex and its background tasks engine in Rust. The great thing here is Codex actually moves subagents and tasks to the background automatically if they run for a certain period so that the entire engine doesn't get halted, I'd love to have that design along with the background and foreground task/subagent functionality in it. So, basically, I'd like the Rust backend logic of Codex here (deepwiki mcp: openai/codex) and frontend for subagents and background tasks of Claude Code. Feel free to grill me and use your create-spec skill.

## User decisions

- Spec and mockups first. Human approval before implementation.
- Rust task supervisor: Rust owns task lifecycle, bounded waits, cancellation and process supervision. TypeScript retains model sessions, tool execution integration and UI. Compare N-API versus other suitable supervision boundaries against the existing native module; do not assume a full Rust agent runtime migration.
- Breaking changes allowed. Existing APIs/configuration can be replaced with documented migration paths rather than unnecessary compatibility shims. Preserve unrelated workflow guarantees. Explicitly state this posture in spec frontmatter and a Backwards Compatibility section.
- Always stop with owner. Background tasks can outlive a launching turn, but not their owning chat/session or workflow stage. No ownership transfer, persistence daemon, or work surviving application exit. Distinguish changing the visible pane from terminating its owner.

## Contract amendment received

> note, that your design also needs to accomodate the intercom behavior that leads subagents to become async and make sure that the behavior is transparent as background subagent ui (currently not happening and only get a final lifecycle done message with an extra newline block)

Make the Intercom-triggered async path a first-class lifecycle/UI case, equal to timed yielding and explicit backgrounding. Trace actual detach events through runtime ownership, result delivery, render/update subscriptions, transcript/session storage and workflow attached-chat projection. One task identity and one continuous visible task representation must survive the transition. Users need live status and expandable activity before completion, not just a terminal lifecycle message. Completion should settle that existing UI; no duplicate result, empty newline block or notification-only substitute. Preserve distinct genuine Intercom messages, authoritative receipts, retry identities, and necessary model-context completion delivery rather than blindly suppressing all messages.

## Research requirements

Use the create-spec skill completely. Use relevant existing research under research/, not specs/ as research. Use impeccable shape/operate guidance for terminal UI design and Atomic's actual PRODUCT.md, DESIGN.md, themes, renderer and keybindings. Source requests are explicit; these are not permission to copy proprietary source. Keep vendor-comparison/provenance in separate research notes with citations, and keep Atomic-facing spec language, mockups, proposed docs and UI free of comparison branding. If code reuse is ever proposed, first verify licensing and preserve required notices.

Heavily use DeepWiki MCP for both named repositories, with several focused follow-ups rather than one generic summary. Discover tools through mcp search deepwiki; schema: deepwiki_ask_question({repoName, question}). Persist question, answer URL, source paths/symbols, snapshot/commit if available, confidence and contradictions in research. Ask about mechanism and specific edge cases. Treat synthesized answers as leads, cross-check critical claims against actual source where accessible. Mark unavailable evidence rather than inventing it.

Initial DeepWiki findings, not yet independently verified:

1. Codex: https://deepwiki.com/search/explain-the-actual-rust-implem_41735c7d-3d0f-4edc-b155-a4bd0c079015
   - Answer explicitly says no automatic elapsed-time subagent backgrounding. Agents are independently spawned; waits observe status. Commands yield a session handle with yield_time_ms. Need to verify exact defaults, clamps, task scheduling and completion delivery in source. Do not repeat the user's upstream attribution as a verified fact; propose Atomic auto-yield as its own desired behavior.
   - Leads: AgentControl::spawn_agent_internal, maybe_start_completion_watcher, SpawnAgentHandlerV2, WaitAgentHandlerV2, wait_for_final_status, SessionSource::SubAgent, unified_exec_keeps_long_running_session_after_turn_end, unified_exec_pause_blocks_yield_timeout.
2. UI reference: https://deepwiki.com/search/map-the-implementation-of-suba_994a672a-31a1-4e3d-9af1-e33d605022b9
   - Leads: src/tools/AgentTool/UI.tsx and AgentTool.tsx; src/components/Messages.tsx; AgentProgressLine, VerboseAgentTranscript, CtrlOToExpand, isTranscriptMode; src/components/tasks/BackgroundTasksDialog.tsx; src/tasks/LocalShellTask/LocalShellTask.tsx; LocalAgentTaskState, isBackgrounded, backgroundSignal; enqueueAgentNotification.
   - Ask follow-ups on exact collapsed/expanded line composition, event reduction, foreground/background transition races, transcript virtualization, keyboard conflict handling, notification insertion/spacing and source availability. Initial answer mixes a main-session foregrounding function with subagent behavior; verify rather than generalize.

Suggested bounded specialist research partitions:
- Atomic runtime/native bridge and Rust reference supervisor/command semantics.
- Atomic Intercom detachment, stage lifetime, completion/retry paths, and exact UI gap.
- Atomic main/attached-workflow rendering and upstream UI mechanics, leading to terminal layouts.
Separate artifacts; synthesize the shared event/identity contract before proposing integration. No runtime implementation in any branch.

## Repository intent already found

Requesting user: git user Norin Lavaee, gh login flora131. Recent commits use signed conventional subjects and Assistant-model trailers. GitHub merge signature checking could not run gpg locally; SSH author signatures verified. No commits are requested here.

- PR #2859 merged: https://github.com/bastani-inc/atomic/pull/2859. Cancels single/parallel subagents, including Intercom-detached children, when owning stage completes. Suppresses late detached completion and exact stage-owned child findings. Preserves live-stage delivery, unrelated children, accepted transport receipts and retry tokens. Inspect latest maintainer comment on issue #2840 as well. The user selected this stop-with-owner policy again.
- PR #2607 merged: https://github.com/bastani-inc/atomic/pull/2607. Removed public subagent resume, native revival and retained attempts. Terminal identities are monotonic. Parent-targeted asks/contact_supervisor terminate the old child with a fresh-start context handoff. This is distinct from peer coordination causing async detachment. Do not call foregrounding a live task 'resume', or accidentally resurrect a terminal child. Breaking changes are allowed but any proposal reversing these semantics needs explicit rationale and an unresolved user decision, not silent undoing.
- Issue #2824: https://github.com/bastani-inc/atomic/issues/2824. Unbounded BACKGROUND workflow widget, lacks manual collapse/navigation. At >=80 columns ~3 rows/run; narrow compact mode only. Existing test requires >4 runs without truncation. Maintainer flora131 approved direction but requested #2700 land first; #2565 also touches widget. Inspect present PR status before declaring dependencies. F2 graph as focused overflow is an option. Do not casually absorb these entire issues into scope; reconcile shared files/contracts and list dependencies.
- User's #2824 comment: https://github.com/bastani-inc/atomic/issues/2824#issuecomment-5536893138. Keep namespaced configurable keybindings; do not repurpose Ctrl+D/Ctrl+U.
- Adjacent issues to inspect only where material: #2529 HIL parent card; #2345 completion/HIL notifications; #1845 headless web curator blocking.

## Required design evidence

Write `specs/2026-09-05-agent-task-experience.md` in the create-spec structure, plus source-backed research and terminal mockup artifacts. Mark it In Review, never human Approved.

Specify typed public entrypoints and Rust/TypeScript boundary events, failure variants, refusals, stable IDs, owner IDs, native lifetime and thread-safety, cancellation propagation, ordered updates, reconciliation after UI reconnect, terminal-state monotonicity, bounded output/backpressure and model-context result delivery. Separate execution state, foreground wait policy, UI focus and transcript expansion. Yield is not completion; background is not orphaned. Workflow DAG dependencies and durable ctx.tool execution must not falsely settle on a yielded handle. Explain JS model sessions running asynchronously behind the Rust supervisor without blocking the JS event loop or claiming Rust alone makes it nonblocking.

Include single/parallel and nested agents, explicit foreground/background, automatic wait yielding, Intercom-triggered async, commands/PTY stdin, manual foregrounding of a LIVE task, owner closure, cancel/completion races, transport disconnect/retry, HIL, failed/cancelled states, reattachment to a still-live owner, and app shutdown/process cleanup on macOS/Linux/Windows. Do not reintroduce stopped-child resume or a persistence daemon without new user approval.

Mockups must show main and attached workflow chats, collapsed and Ctrl+O expanded, live foreground and background agents, shell tasks, Intercom transition before/after, terminal settlement without stray blocks, concurrent/nested work, attention/error/cancel, narrow/short terminal and overflow. Show tool name/current action, readable hierarchy, elapsed time and counts only when available, non-color state labels, keyboard hints, selection/scroll stability and bounded viewport use. Share components/projections rather than divergent per-chat renderers. Use realistic terminal-cell widths, not a web dashboard presented as terminal evidence. Optional focused HTML is explicitly a design prototype, not runtime proof.

Compare meaningful interface/supervisor alternatives. Propose defaults for auto-yield timing/configuration and notifications with rationale, but list unresolved material user preferences for our next interview rather than pretending they are approved.

Plan implementation as dependent, independently buildable/testable vertical slices, each with objective, acceptance criteria, file ownership, red/green/refactor tests and deterministic gates. Suggested domains to refine from evidence: task identity/event contract + supervisor; command supervision/yield; subagent/Intercom integration + owner cancellation; shared projection and compact UI; expanded/transcript/navigation parity. Do not freeze arbitrary line counts or sequence independent slices unnecessarily. Include exact future Cargo, native bridge, npm/typecheck/Vitest and tmux/PTY validation commands located from repository evidence. Include docs/changelog migration work for the eventual implementation, not shipped behavior claims now.

Before handoff, inspect all new artifacts, verify cited local source paths/symbols, check local artifact links, run git diff --check and a changed-path/branch check demonstrating no runtime or shipped-doc edits. Label tests planned versus executed. Independent reviewers must review DESIGN completeness and source support, not reject missing runtime implementation or missing human approval, since neither is this run's deliverable. Report remaining interview questions with concrete options, a recommendation and tradeoffs. Return spec/mockup/research paths.

## Design helper note

The parent loaded impeccable and its shape playbook. context.mjs was invoked once from the worktree root and requested target selection because this is a monorepo. The user's requested surfaces already identify coding-agent, subagents and workflows; all inherit root PRODUCT.md and DESIGN.md. Read these and the matching actual terminal renderer rather than restarting a broad product interview or modifying design-system metadata.
