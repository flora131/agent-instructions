---
title: "Subagents"
description: "Run focused Atomic child agents"
---

# Subagents

Atomic bundles `@bastani/subagents`, an extension for bounded specialist delegation with separate context while the parent remains in control. Use a single agent or parallel fan-out when isolation or a specialist pass materially helps with locating code, analyzing behavior, researching references, reproducing actual failures, or simplifying code. Keep interactive, exploratory, conceptual, and conversation-led work inline when direct user steering is more useful.

You do not need to install anything separately when you use `@bastani/atomic`.

Background subagents are supported. See [Background tasks](/background-tasks) for launch examples, the below-prompt status indicator, `/tasks`, shell output, cancellation, and completion notices.

## Browse agents

Open `/agents` to browse the available project, user, and built-in agents. Type to filter by name, description, or source. Use arrows to select an agent and Enter to inspect its description, model and fallbacks, tools, definition path, and system prompt. Escape returns to the catalog, then to chat. `/agents <query>` starts with a filter. Browsing is read-only and never launches an agent.

The catalog uses the same effective discovery rules as execution, so overridden definitions and disabled agents are not offered as separate launchable choices. Ask Atomic to create or modify an agent; the catalog does not change configuration.

## Task inspection

Hosts with an owner task store expose `/tasks` and `/tasks <id>` for background agents and shells, including their retained terminal results. Foreground-only work is excluded. Enter opens detail; arrows select an explicit action. Cancel asks for confirmation of the selected task. Terminal tasks retain transcript inspection but omit foreground, cancellation, and stdin actions. Escape returns from detail or stdin before returning to the composer.

`/tasks` appears in slash-command autocomplete. The inspector groups agents and shells with counts, status symbols, and a highlighted selection. Task descriptions lead; the selected row shows secondary activity and tool counts. The header and footer remain visible in ordinary terminal sizes, with a compact fallback for short terminals.

In the default isolated CLI, background subagents continue running after their launch observation returns. The engine publishes a compact task-status indicator below the prompt box, without task rows or activity previews. Run `/tasks` to open the list and inspect individual tasks; task updates never open it automatically. A compact finished-task summary remains after completion. Inspecting does not restart work or create a second task owner. Top-level model bash commands use this owner on POSIX systems; native Windows and commands inside subagent sessions retain their existing execution path.

Transcript inspection uses a dedicated scrolling view with pinned identity, position, and controls. Retained child messages use the normal message renderers, excluding hidden reasoning and inline images. Missing capture is reported as `Transcript unavailable`; metrics never substitute for missing messages. Arrows scroll, PageUp/PageDown moves one viewport, and PageUp at the top loads earlier retained history. Home/End jumps within loaded history.

Detail views pin task identity, state, available metrics, and the selected action while PageUp/PageDown scrolls the body. Recent activity shows up to five retained tool actions; errors and input requests appear explicitly. Left returns to the previous view. `x` requests cancellation without bypassing confirmation or configured task bindings. Shell inspection shows a bounded output tail with omission markers.

## Start with natural language

Ask Atomic to coordinate subagents in plain language:

```text
Map the authentication flow with focused subagents before we change it.
```

```text
Run a parallel review composition: one pass for current behavior, one for failure modes, and one for existing patterns.
```

```text
Research the upstream library behavior online, then compare it with our local implementation.
```

Atomic decides whether delegation adds value, which specialist fits each bounded part, and whether the work should run as a single child, parallel group, or forked-context run. Multiple steps, files, tests, validation, or parallelism alone do not require a workflow; clearly delegated long-running autonomous work that needs durable stages, checkpoints, resumability, HIL, gates, retries, or loops is usually better served by a workflow.

## Subagent execution is non-interactive

Supported subagent launches start immediately without opening a preview/editor prompt or waiting for terminal input. This applies to single, parallel, forked, fanout, and prompt-template execution. Ask any necessary questions in the parent conversation before delegating.

Prompt-template delegation comes from the separately installed `pi-prompt-template-model` extension, whose `requestDelegatedRun` emits `prompt-template:subagent:request`. If that caller must survive an extension reload, import `registerPromptTemplateBridgeRequestSettlement` from `@bastani/subagents`, register it before the emit, and unregister it from the normal response, cancellation, or abort path. The hook rejects the caller only when the old bridge drops a stale response emit; normal completion still arrives through `prompt-template:subagent:response`. Atomic cannot register this opt-in for an out-of-tree emitter.

Subagents now run and return their results directly. Atomic does not infer acceptance gates from prompt wording, inject `acceptance-report` instructions into child prompts, parse or strip `acceptance-report` blocks, or reject completed child runs because changed-file, test, or review evidence is missing. Put any evidence or validation requirements directly in the task text you give the parent or child agent.

## Owner-bound task observation

Runtime-created session contexts bind single launches to their actual session or workflow-stage owner. Omitted `wait` returns an admitted observation with reason `default-background`; `wait: {kind: "background"}` uses reason `explicit`. `wait: {kind: "foreground", budgetMs: 30000}` opts into foreground-first observation. The omitted foreground budget is 30000 ms. `subagent({action: "wait", id: taskId, budgetMs: 1000})` observes an existing task in the same owner without restarting it.

The agent may choose foreground-first or background observation for each authorized call without asking the user merely to select a mode. When a foreground observation expires, the returned task is still running. Wait for terminal completion before using its result in dependent work. See [Choosing how long to wait](/background-tasks#choose-how-long-to-wait) for shell and subagent defaults and the separate execution-timeout behavior.

An Intercom peer-message yield keeps the original execution alive. Terminal completion is recorded separately and admitted as a readable `task-completion` custom message. Background completions show a visible notification in main or owning workflow-stage chat, without requiring the parent model to reply. Its text names the available agent/task, outcome, error, and response excerpt; the receipt remains in structured details. Failed delivery retains the same persisted completion identity for retry. Parallel launches admit accepted slots independently of foreground/background observation and keep execution queued under the configured concurrency limit. Intercom yields do not skip queued siblings. Existing unbound SDK callers retain their legacy result fields.

Durable `ctx.tool` callbacks wait for tasks admitted inside their callback before checkpointing, even when the launching observation yielded. Session lifetime closure cancels session-owned work; stage generation closure, not pane detach or fallback session replacement, owns stage tasks.

## Supervisor coordination

In a parallel run, `intercom.ask`, `contact_supervisor({ reason: "need_decision" })`, and `interview_request` wait only in the requesting child. The supervisor answers with ordinary `intercom({ action: "reply", message: "..." })`; use `pending` and `replyTo` to select the exact question when several asks are pending. The correlated reply returns to the same child execution, with its context and run identity intact. Do not relaunch the requester or its siblings to deliver an answer.

`intercom.send` and `contact_supervisor` progress updates return after delivery without waiting for a reply. An exact-child Intercom handshake can release the parallel call's foreground observations so the supervisor can handle the message. This is not execution cancellation: active siblings keep running, queued siblings start once capacity is available, and worktrees stay owned until their children exit. Background calls use the same communication path without needing to release an observation.

Targeted `interrupt` still stops only the selected child. Explicit batch cancellation and session/workflow-stage lifetime closure still stop the intended owned children, including pending reply waits. A late or duplicate reply cannot revive a terminal child. Ordinary Intercom group restrictions and the authorized cross-group `contact_supervisor` route are unchanged.

### Single-child handoff

A single-child launch retains its existing terminal handoff: a parent-targeted blocking ask is claimed before send/waiter admission, ends that child, and returns the original question, ordered attachments, agent identity, and a dynamic `[TASK_CONTEXT]` handoff through the parent `subagent` call. The handoff explicitly requests a fresh child with a new run identity and the supervisor answer in its task. This single-child behavior does not apply to parallel runs or collected sibling launches.

When the Intercom bridge is active, the parent may connect to issue the child capability; the child's own connection remains tool-driven. Non-interactive children still run normal extension lifecycle and remain in-process `AgentSession` instances while live.

## Migration from acceptance gates

If you have older subagent calls or custom agents that used the removed gate fields:

- Remove `acceptance` properties from `subagent()` calls, task entries, and parallel task items. Atomic no longer reads these fields.
- Remove `completionGuard: false` from agent frontmatter and custom agent definitions. The no-mutation completion guard no longer exists, so the override has no effect and management rewrites strip it.
- Move validation, command, evidence, review, or residual-risk requirements into the natural-language task text passed to the parent or child agent.

## Bundled agents

Atomic currently bundles these agents from `@bastani/subagents`:

| Agent | Use it for | Edit files? |
|---|---|---|
| `codebase-locator` | Find relevant files, directories, tests, configs, and docs for a topic. | No |
| `codebase-analyzer` | Explain how specific code works and trace data flow with file references. | No |
| `codebase-pattern-finder` | Find similar implementations, conventions, and test examples to model after. | No |
| `codebase-research-locator` | Locate prior `research/` and `specs/` documents related to the task. | No |
| `codebase-research-analyzer` | Extract decisions, constraints, and still-relevant conclusions from prior local docs. | No |
| `codebase-online-researcher` | Research official docs, ecosystem behavior, and open-source source references online; it may persist reusable research notes. | Research notes only |
| `debugger` | Reproduce a concrete failure, prove its root cause, apply the smallest in-scope fix, and rerun the failing scenario. | Yes |
| `code-simplifier` | Simplify recently changed code under its behavior-preservation “doors” rubric. | Yes |
| `worker` | Implement an approved task or handoff, validate the narrow change, and escalate product, architecture, or scope decisions to its supervisor. | Yes |

All bundled agents except `debugger` default to `openai-codex/gpt-6-astra:low`; `debugger` uses `openai-codex/gpt-6-astra:xhigh`. Their fallback chains start with GitHub Copilot Astra, OpenAI Astra, Anthropic Fable 5.1, then GitHub Copilot Fable 5.1. Ordinary agents use Astra/Fable 5.1 at `low`, with Sol and GPT-5.5 fallbacks at `medium`, including the locator roles. Debugger keeps Astra and Sol at `xhigh` and Anthropic fallbacks at `high`. Later candidates retain provider-specific reasoning levels and identifiers; OpenRouter mirrors follow the direct-provider candidates. Each agent definition contains its complete ordered chain.

The bundled definitions keep their routing and model frontmatter but use compact, outcome-first bodies: role and goal, success criteria, constraints and tool routes, output contract, and stop rules where applicable. Report-producing agents ground progress claims in tool results and return concise evidence rather than narrating internal reasoning. Read-oriented agents inspect and report. `debugger`, `code-simplifier`, and `worker` can edit files, so give them an explicit scope and validation target. The debugger should finish an in-scope diagnosis by applying and validating the fix, not stop at a proposed patch.

## Review compositions

Atomic does not bundle a single generic review agent. Instead, compose specialists with distinct angles and let the parent session synthesize their findings before applying any fix.

Common review angles:

| Angle | Specialist pattern |
|---|---|
| Current behavior and regressions | `codebase-analyzer` inspects the changed flow and cites file/line evidence. |
| Failure modes | `debugger` runs in inspect-only mode to reproduce or reason about likely failures without editing. |
| Fit with project conventions | `codebase-pattern-finder` compares the patch with existing local examples. |
| Prior decisions | `codebase-research-locator` finds relevant docs, then `codebase-research-analyzer` extracts applicable constraints. |
| External API or library conformance | `codebase-online-researcher` checks authoritative sources and version-specific behavior. |

Example request:

```text
Review the current diff with fresh-context specialists: analyze correctness, inspect failure modes without editing, and compare the implementation to existing patterns. Synthesize only issues worth fixing now.
```

Compose those review and research passes with the `subagent` tool. Treat them as parent-side recipes, not bundled slash commands.

## Foreground work and control

Explicit foreground-first observations wait for the child until it settles or the observation yields. The child continues after a yield; owner-bound calls without `wait` use background observation by default.

Natural-language examples:

```text
Run the local research scan.
```

```text
Show me the current subagent status.
```

Tool examples:

```ts
subagent({ agent: "codebase-analyzer", task: "Trace the auth flow with file references.", wait: { kind: "foreground", budgetMs: 30000 } })
```

Use `interrupt` to stop a live child. Interrupted children are terminal for continuation; launch a fresh child with an explicit context handoff for follow-up work.

If the parent turn is cancelled while a foreground in-process child is still running, the child stops through the existing abort/interrupted state. That outcome is terminal and non-retryable: it does not count as a failure, never looks completed, and preserves any fallback metadata already recorded before abort. Parent receipts, Intercom summaries, and progress present the child as cancelled; persisted metadata records `interrupted` with abort cause rather than a new public status. Atomic recovers bounded, clearly labelled partial findings in this order:
1. A modified run-scoped `progress.md`
2. The last assistant message that contains actual text
3. A cancellation notice with session, progress, and output artifact references

A thinking-only aborted final message is skipped so earlier text can still be recovered. Session, Progress, and Output paths are cited only when those files exist when the cancelled envelope or receipt is built. A parallel set shares one `progress.md`; recovery attributes that file to the first progress-enabled child so siblings are not each given a copy of the same findings. A mixed parallel set that contains both a user interrupt and a parent cancellation presents the cancellation summary rather than interrupt-specific follow-up guidance.

For owner-bound task IDs, status and interrupt resolve the same task owner as launch and wait. Legacy run IDs use the live Rust registry and status watch; `list` and `get` remain read-only definition management actions. Neither identifier revives a completed execution. Owner-bound completions use persisted delivery identities; unbound callers retain their legacy result and artifact behavior.

In-process status results use compact rows such as `∀ debugger_1 · Running`, matching the other subagent tool cards. The collapsed card shows up to six children and an omitted count; expanding the tool result shows every child, full paths, parent, task, depth, loaded/cold residency, and any recorded termination cause or session file. Multiple runs have separate labels. The configured tool-expansion shortcut appears below the compact rows. This is a status snapshot, not an animated live monitor; inspection does not start or resume work. Model-facing status text and canonical identifiers remain unchanged.

Inside workflow stages, completion delivery observes the stage generation boundary. A completion admitted before the boundary closes is queued through the stage AgentSession and processed before the stage publishes its terminal snapshot. Closing the boundary cancels still-running stage-owned children, and findings or completion notifications that arrive afterward are suppressed rather than routed to the parent/main chat. Explicit post-mortem stage chat remains available separately for deliberate follow-up.

Cancellation does not retract an Intercom send already submitted to the broker. That operation keeps its transport receipt or retry identity, while the closed stage suppresses late incoming messages from its own children. A transport acknowledgement does not mean a late finding was shown in the parent chat.

Live progress and completed results show each step's resolved model ID and effective reasoning level, including after a model fallback; parallel steps keep their metadata separate. Fast inference is part of the model ID, so an agent pinned to a fast variant renders it directly — `codebase-analyzer (openai-codex/gpt-5.6-sol-fast · thinking medium)` — with no separate `fast` badge. Select fast inference in an agent definition's `model` and fallback model fields, for example `openai-codex/gpt-5.6-sol-fast:medium`; normal and fast IDs stay distinct fallback candidates and distinct records. See [Providers](/providers#fast-models) for which providers publish fast variants and what each one sends upstream.

## Owner-bound task projection

Host adapters can construct an `OwnerTaskStore` from their existing supervisor and owner lease, check the `store.connect()` result, then call `bindOwnerTaskStore(session, store)` for that exact live session. Binding does not create or connect an owner. The store observes snapshot/cursor reconciliation and notifies already-mounted chats even when the producer binds lazily. Disposing the view does not cancel the owner. Reattachment uses existing identities rather than replaying launch tools.

Native task snapshots retain `wasBackground` once a designated observation yields, so a fresh projection can distinguish completed background work from foreground-only commands. Trusted hosts recover authentic command settlement receipts independently of the bounded event journal. Neither recovery path registers a new wait or restarts execution.

Main and workflow-stage chats use below-prompt background counts instead of persistent task rows in the transcript. Session replacement clears the previous owner's status before a replacement store binds. A workflow question retains the background count below its input area. Completion notifications use the same shared renderer in both chats.

Custom `ChatSessionHost` adapters can still use live task rows; set `taskRowsInChat: false` for footer-only status. Those rows show agent labels, state, duration, and bounded activity previews. Display-colliding labels get a stable short suffix derived from the task ID. Retention is at most 64 reports and 8 KiB of encoded preview records per task; omitted previews are labelled rather than presented as a complete transcript.

This is a host integration API above the SDK task foundation. Existing subagent and command producers are not automatically migrated by binding a projection. Full task transcript retrieval and `/tasks` navigation are separate integrations; unavailable transcript content is not inferred from activity reports.

## Orchestrator model and group policy

Atomic applies the same delegation policy to any parent chat or workflow stage that orchestrates subagents. A named agent uses the model and fallback sequence declared by its agent definition, so the orchestrator normally omits the subagent tool's explicit `model` argument. An override needs either the user's exact model request or a documented task-specific reason recorded before launch; model diversity alone is not enough.

If an agent declares no model or fallback policy, the orchestrator consults the role guidance in [Model selection](/models/model-selection) and the measured per-evaluation scores in [Evals](/models/evals), then calls `workflow({ action: "models" })` when that tool is available. It may pin only a returned `fullId` and may add a thinking suffix only when the model entry lists that level. When the catalog tool is unavailable, the catalog is empty, or no recommended model is present, the child stays unpinned and the orchestrator reports the limit instead of inventing a model or inspecting credentials.

Each workflow invocation automatically receives one stable, non-`"default"` Intercom group as typed admission policy. Its stages and delegated children carry that group across single, parallel, and follow-up work unless a call explicitly overrides `group`. Outside workflows, children inherit the launching session's resolved group. This isolates workflow runs from unrelated runs and the main chat while `contact_supervisor` retains its authorized cross-group route.

## Context and execution modes

Subagents can run with fresh or forked context:

- `context: "fresh"` starts a separate in-process child session with only the task and selected agent context.
- `context: "fork"` creates a real branched child session from the parent session leaf. It fails fast if the parent session cannot be forked; it does not silently downgrade to fresh context.

For adversarial review or research, prefer fresh context so the specialist inspects the repository directly. Use forked context when a writer needs the parent conversation history in a separate branch.

For parallel implementation work, `worktree: true` can give each child an isolated git worktree so concurrent edits do not clobber each other.

Observation yields do not release these worktrees. Cancelling a queued child before it starts, or closing the session or workflow-stage owner, still allows the batch's worktrees and branches to be removed after the remaining executions finish. Live children's changes stay in place until then; Atomic captures worktree diffs before cleanup.

Fresh child sessions use normal Atomic package discovery when an agent omits `extensions`, so bundled lightweight MCP and web-access wrappers are available just as they are in the parent. An explicit `extensions` field, including an empty list, switches optional extensions to allowlist mode and excludes unlisted optional builtins; mandatory bundled Intercom remains loaded. The child does not inherit the parent's normal optional discovery set.

Top-level parallel calls support up to 50 subagents after expanding each task's optional `count`. The extension's `parallel.maxTasks` setting defaults to 50 and can enforce a lower task limit; `parallel.concurrency` independently controls how many of those children run at once, while the Rust turn limiter admits at most four running turns per parent.

When one assistant response emits several sibling execution-mode `subagent` tool calls, Atomic collects that synchronous burst before starting a child and runs it as one indexed parallel set. Each original tool call still receives one result containing only the children it requested, and its live result, progress, control, and artifact updates are projected to that same route without sibling data. The TUI redraws the shared run as one aggregate parallel widget rather than retaining one widget per original call. A single call keeps its original SINGLE or PARALLEL mode, calls awaited in sequence remain separate runs, and management actions bypass collection. An execution call that arrives after a child has started still receives the existing in-progress rejection. Prefer one explicit `{ tasks: [...] }` call when planning parallel work; burst collection handles sibling calls emitted by a model.

For a collected burst, each call contributes its top-level `agent` task first and then its `tasks` entries in array order. Atomic preserves duplicates, expands `count` in place, and applies the configured task cap after flattening and expansion; the hard maximum remains 50. Each call-level `cwd` selects that call's agent-discovery scope and child base directory. A task-level `cwd` stays relative to that call base and changes only that child's execution directory, not agent discovery. This per-origin discovery rule applies only to collected sibling calls; an ordinary explicit `{ tasks: [...] }` call keeps one discovery scope from its top-level `cwd`. Per-call and per-task `group` values also stay with their originating children. Shared run options must match across every sibling call: `concurrency`, `worktree`, `context`, `share`, `control`, `sessionDir`, `maxOutput`, `artifacts`, `includeProgress`, and `agentScope`. A mismatch rejects the whole burst before any child launches and names the incompatible field.

For a collected `worktree: true` burst, every call-level `cwd` must resolve to the same path. That common path becomes the shared worktree root; differing origins reject the burst before launch, and any task-level `cwd` must still resolve to that root. Each projected caller result keeps shared worktree diff text and terminal control guidance while its child results and standard child-output sections remain route-local.

Subagent tasks, parallel items, and the top-level call accept a `group` field that sets the spawned child's [Intercom](/intercom) home group, so same-group subagents can intercom each other while staying isolated from other groups. A named string joins that group; `true` auto-generates one shared UUID group per parallel set. Precedence is `explicit subagent group > inherited current-session group > config > "default"`. Workflow stages carry their runtime-owned invocation group, so children launched without `group` automatically join the workflow group; callers do not need to copy or generate an ID. In other sessions, omission inherits that launching session's resolved group. The child group is applied only when the child has Intercom access (the peer `intercom` tool or subagent-only `contact_supervisor` tool); a child without Intercom receives no group. `contact_supervisor` still reaches the supervisor across group boundaries because Atomic requests a broker capability during typed admission and binds the child's registration to the issuing supervisor. Foreground paths use exact child scopes. The lightweight Intercom wrapper lazy-loads the authorization provider; provider failures abort launch, while hosts without a provider omit supervisor metadata instead of exposing a broken channel.

Detached children remain owned by the workflow stage that launched them. When that stage completes, Atomic cancels every still-running owned child (single or parallel) with the existing parent-cancellation outcome (`status: "interrupted"`, `cause: "abort"`) and suppresses late findings and completion notifications instead of routing them to the parent/main chat. A detached child that finishes while its stage is still live notifies normally, and completing one stage does not affect children owned by other stages or sessions.

When a subagent call or parallel task uses a `cwd`, Atomic validates that working directory before starting the child runtime. Missing or non-directory paths are reported as `cwd` problems instead of lower-level runtime errors.

Single-agent calls also accept `reads: string[] | false`. Atomic prepends those files as read context for foreground execution through the same in-process session path. Relative entries resolve against the effective child `cwd` (including a relative top-level `cwd` resolved from the parent); absolute entries are unchanged. Invalid values fail before the child session starts.

Single-agent calls accept `progress: boolean` in foreground mode. `progress: true` creates a run-scoped `progress.md` under isolated subagent artifact storage and instructs the child to maintain it without writing `progress.md` into the child `cwd`; `progress: false` disables an agent's `defaultProgress`. When `progress` is omitted, the agent's default is inherited, except that inherited progress is suppressed for read-only tasks (`progress: true` still explicitly opts in). Foreground runs remove this run-owned progress storage after the child exits when `artifacts: false`, including children temporarily detached for intercom coordination. This is separate from `includeProgress: true`, which only includes detailed runtime progress telemetry in the final tool result and does not create or maintain a file.

```ts
subagent({ agent: "worker", task: "Implement the approved fix.", progress: true })
```

## Delegation and child boundaries

Child-safety boundaries are enforced by typed admission policy and the bundled subagent extension:

- In-process child sessions load bundled extensions through normal discovery. The `subagent` tool may therefore be registered when the child's active tool selection permits it, including the default no-allowlist case; an explicit allowlist may omit it. Tool presence does not grant fanout. The bundled subagents skill remains parent-only and is stripped from child prompts, including fanout-authorized children.
- Child context is filtered to remove parent orchestration artifacts, old control/status messages, and prior parent `subagent` tool calls/results.
- Children are instructed that they are not the parent orchestrator and must complete their assigned task directly rather than delegating.
- Delegation is exactly one level deep and is not configurable. A session admitted as a subagent child is refused every launch and `interrupt`; only `list`, `get`, and `status` stay available. A management-restricted child is also refused `create`, `update`, and `delete`.
- The rule is enforced twice: the subagent executor refuses a child before any run starts, and the Rust admission door refuses a child deeper than the single permitted level. Admitted depth is typed admission state, never inherited from process environment state.

This keeps the parent session responsible for orchestration.

## Custom agents

Custom agents are Markdown files with YAML frontmatter and a system prompt body. Keep the body outcome-first and locally complete: state the role or goal, observable success criteria, constraints and context-dependent tool routes, required output shape, and stop conditions. Reserve absolute wording for true invariants, request evidence and conclusions rather than private reasoning, and avoid repeated self-check instructions. Common locations are:

| Scope | Path |
|---|---|
| User | `~/.atomic/agent/agents/**/*.md` |
| Project | `.atomic/agents/**/*.md` |

A small custom read-only inspection agent:

```markdown
---
name: strict-inspector
description: Inspect code for correctness and regressions
tools: read, search, bash
model: anthropic/claude-sonnet-4
fallbackModels: openai/gpt-5-mini
inheritProjectContext: true
---

## Role and goal
Inspect the current diff for correctness and regressions without editing files.

## Success criteria
Cite each actionable issue with file:line evidence and the observed failure or risk.

## Output and stop rule
Return only issues worth fixing now. Stop when the relevant diff and affected call paths have been inspected, or name the evidence you could not access.
```

## Fallback models

Agents can define ordered `fallbackModels` for retryable provider or model failures such as rate limits, quota/usage-limit exhaustion (for example a provider reporting `The usage limit has been reached`, or `usage_limit_reached`/`insufficient_quota` codes), auth problems, unavailable models, network timeouts, or 5xx errors. Atomic tries the requested primary model first, then configured fallbacks, and finally appends the current user-selected model as the last fallback candidate when available. The main chat and workflow stages share one failure classifier, so auth, model-availability, request-incompatibility, and transport signals are handled consistently. Cancellations, safety refusals, and task/tool failures are never retried on another model.

A candidate that cannot serve the current request — for example an HTTP 400/413/422 bad/unprocessable/payload-too-large request, an unsupported tool or parameter, a context-length/context-window overflow, or a `too large` / `invalid_request` error — is treated as request/context incompatible and the fallback sequence advances to the next candidate rather than stopping. This means that if none of the configured candidates are applicable to the request, Atomic falls back to the currently selected user model instead of failing outright.

Model fallback decisions use structured provider and attempt causes. There is no per-attempt idle watchdog, no child wall-clock kill cap, and no timeout-regex classification: a quiet provider response is allowed to finish, and only an explicit termination or provider failure supplies a retryable cause. Numeric process exit codes are not used as an outcome discriminator.

When registry availability shows that a known candidate provider has no configured auth, Atomic records a skipped model attempt before starting the in-process turn. Unknown/custom providers are still attempted, and the current user-selected model appended as the final fallback is never filtered out by this pre-admission check.

Fallbacks do not retry ordinary task failures, validation failures, tool failures, cancellations, or workflow-code errors. Because a fallback may send the same prompt and context to a different provider, choose models that match your cost, privacy, and data-handling requirements.

Each candidate can also carry its own reasoning effort — see [Reasoning levels](#reasoning-levels).

## Reasoning levels

Set the reasoning (thinking) effort for each model candidate with a `model_name:thinking_effort` suffix on `model` and on every `fallbackModels` entry. Valid efforts are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` — the same shorthand used by `atomic --model sonnet:high`. `xhigh` and `max` are used only when the selected model's capability map supports them.

```markdown
---
name: deep-reviewer
description: Adversarial reviewer for risky diffs
tools: read, search, bash
model: anthropic/claude-sonnet-4:high
fallbackModels: openai/gpt-5:medium, anthropic/claude-haiku-4-5:off
---
```

Because the effort travels with each model string, every primary and fallback candidate is self-contained: a fallback can run at a different effort than the primary, so a high-effort primary degrades gracefully to a cheaper, lower-effort fallback.

**Migrate off the legacy `thinking` field.** The separate `thinking:` frontmatter field is deprecated. It still works as a default for any candidate that has no suffix, and a suffix always wins, but new agents should encode the effort directly on `model` and `fallbackModels`:

```diff
-model: openai/gpt-5.5
-fallbackModels: anthropic/claude-opus-4-8
-thinking: xhigh
+model: openai/gpt-5.5:xhigh
+fallbackModels: anthropic/claude-opus-4-8:xhigh
```

`fallbackThinkingLevels` exists only as an optional compatibility helper: it is aligned by index to `fallbackModels` and supplies a fallback candidate's effort only when that fallback entry has no suffix. Prefer suffixed model strings instead. Attempt metadata reports the resolved model and the effective reasoning effort used for each attempt.

## Related docs

- [Workflows](/workflows) for multi-stage reusable automation.
- [Intercom](/intercom) for cross-session messaging and supervisor escalation.
- [Skills](/skills) for reusable instructions invoked with `/skill:<name>`.
- [Settings](/settings) for user and project configuration.
