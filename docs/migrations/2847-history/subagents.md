# Historical subagents documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: subagents::002 -->

Source: `packages/coding-agent/docs/subagents.md` lines 6–11 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/subagents.md#subagents`.

# Subagents

Atomic bundles `@bastani/subagents`, an extension for bounded specialist delegation with separate context while the parent remains in control. Use a single agent or parallel fan-out when isolation or a specialist pass materially helps with locating code, analyzing behavior, researching references, reproducing actual failures, or simplifying code. Keep interactive, exploratory, conceptual, and conversation-led work inline when direct user steering is more useful.

You do not need to install anything separately when you use `@bastani/atomic`.

<!-- baseline-block: subagents::007 -->

Source: `packages/coding-agent/docs/subagents.md` lines 58–75 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/subagents.md#bundled-agents`.

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

The bundled definitions keep their routing and model frontmatter but use compact, outcome-first bodies: role and goal, success criteria, constraints and tool routes, output contract, and stop rules where applicable. Report-producing agents ground progress claims in tool results and return concise evidence rather than narrating internal reasoning. Read-oriented agents inspect and report. `debugger`, `code-simplifier`, and `worker` can edit files, so give them an explicit scope and validation target. The debugger should finish an in-scope diagnosis by applying and validating the fix, not stop at a proposed patch.

<!-- baseline-block: subagents::009 -->

Source: `packages/coding-agent/docs/subagents.md` lines 98–132 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/subagents.md#foreground-work-and-control`.

## Foreground work and control

Foreground subagents stream progress in the conversation and return their results before the call completes.

Natural-language examples:

```text
Run the local research scan.
```

```text
Show me the current subagent status.
```

Tool examples:

```ts
subagent({ agent: "codebase-analyzer", task: "Trace the auth flow with file references." })
```

Use `interrupt` to stop a live child. Interrupted children are terminal for continuation; launch a fresh child with an explicit context handoff for follow-up work.

If the parent turn is cancelled while a foreground in-process child is still running, the child stops through the existing abort/interrupted state. That outcome is terminal and non-retryable: it does not count as a failure, never looks completed, and preserves any fallback metadata already recorded before abort. Parent receipts, Intercom summaries, and progress present the child as cancelled; persisted metadata records `interrupted` with abort cause rather than a new public status. Atomic recovers bounded, clearly labelled partial findings in this order:
1. A modified run-scoped `progress.md`
2. The last assistant message that contains actual text
3. A cancellation notice with session, progress, and output artifact references

A thinking-only aborted final message is skipped so earlier text can still be recovered. Session, Progress, and Output paths are cited only when those files exist when the cancelled envelope or receipt is built. A parallel set shares one `progress.md`; recovery attributes that file to the first progress-enabled child so siblings are not each given a copy of the same findings. A mixed parallel set that contains both a user interrupt and a parent cancellation presents the cancellation summary rather than interrupt-specific follow-up guidance.

Status and interrupt use the live Rust registry and status watch; `list` and `get` remain read-only management actions. No retained foreground-run map, resume generation, session rehydration, or bare-run-ID continuation exists. Terminal delivery remains an in-memory bounded envelope with artifacts and run history persisted once.

Inside workflow stages, completion delivery observes the stage generation boundary. A completion received before the boundary closes is queued through the stage AgentSession and processed before the stage publishes its terminal snapshot. A completion that arrives after close is routed once to the parent/main chat and cannot reopen or append to the completed stage transcript. Explicit post-mortem stage chat is still available separately.

Live progress and completed results show each step's resolved model ID and effective reasoning level, including after a model fallback; parallel steps keep their metadata separate. Fast inference is part of the model ID, so an agent pinned to a fast variant renders it directly — `codebase-analyzer (openai-codex/gpt-5.6-sol-fast · thinking medium)` — with no separate `fast` badge. Select fast inference in an agent definition's `model` and fallback model fields, for example `openai-codex/gpt-5.6-sol-fast:medium`; normal and fast IDs stay distinct fallback candidates and distinct records. See [Providers](/providers#fast-models) for which providers publish fast variants and what each one sends upstream.

<!-- baseline-block: subagents::010 -->

Source: `packages/coding-agent/docs/subagents.md` lines 133–140 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/subagents.md#orchestrator-model-and-group-policy`.

## Orchestrator model and group policy

Atomic applies the same delegation policy to any parent chat or workflow stage that orchestrates subagents. A named agent uses the model and fallback sequence declared by its agent definition, so the orchestrator normally omits the subagent tool's explicit `model` argument. An override needs either the user's exact model request or a documented task-specific reason recorded before launch; model diversity alone is not enough.

If an agent declares no model or fallback policy, the orchestrator consults the role guidance in [Model selection](/models/model-selection), then calls `workflow({ action: "models" })` when that tool is available. It may pin only a returned `fullId` and may add a thinking suffix only when the model entry lists that level. When the catalog tool is unavailable, the catalog is empty, or no recommended model is present, the child stays unpinned and the orchestrator reports the limit instead of inventing a model or inspecting credentials.

Each workflow invocation automatically receives one stable, non-`"default"` Intercom group as typed admission policy. Its stages and delegated children carry that group across single, parallel, and follow-up work unless a call explicitly overrides `group`. Outside workflows, children inherit the launching session's resolved group. This isolates workflow runs from unrelated runs and the main chat while `contact_supervisor` retains its authorized cross-group route.

<!-- baseline-block: subagents::011 -->

Source: `packages/coding-agent/docs/subagents.md` lines 141–173 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/subagents.md#context-and-execution-modes`.

## Context and execution modes

Subagents can run with fresh or forked context:

- `context: "fresh"` starts a separate in-process child session with only the task and selected agent context.
- `context: "fork"` creates a real branched child session from the parent session leaf. It fails fast if the parent session cannot be forked; it does not silently downgrade to fresh context.

For adversarial review or research, prefer fresh context so the specialist inspects the repository directly. Use forked context when a writer needs the parent conversation history in a separate branch.

For parallel implementation work, `worktree: true` can give each child an isolated git worktree so concurrent edits do not clobber each other.

Fresh child sessions use normal Atomic package discovery when an agent omits `extensions`, so bundled lightweight MCP and web-access wrappers are available just as they are in the parent. An explicit `extensions` field, including an empty list, switches optional extensions to allowlist mode and excludes unlisted optional builtins; mandatory bundled Intercom remains loaded. The child does not inherit the parent's normal optional discovery set.

Top-level parallel calls support up to 50 subagents after expanding each task's optional `count`. The extension's `parallel.maxTasks` setting defaults to 50 and can enforce a lower task limit; `parallel.concurrency` independently controls how many of those children run at once, while the Rust turn limiter admits at most four running turns per parent.

When one assistant response emits several sibling execution-mode `subagent` tool calls, Atomic collects that synchronous burst before starting a child and runs it as one indexed parallel set. Each original tool call still receives one result containing only the children it requested, and its live result, progress, control, and artifact updates are projected to that same route without sibling data. The TUI redraws the shared run as one aggregate parallel widget rather than retaining one widget per original call. A single call keeps its original SINGLE or PARALLEL mode, calls awaited in sequence remain separate runs, and management actions bypass collection. An execution call that arrives after a child has started still receives the existing in-progress rejection. Prefer one explicit `{ tasks: [...] }` call when planning parallel work; burst collection handles sibling calls emitted by a model.

For a collected burst, each call contributes its top-level `agent` task first and then its `tasks` entries in array order. Atomic preserves duplicates, expands `count` in place, and applies the configured task cap after flattening and expansion; the hard maximum remains 50. Each call-level `cwd` selects that call's agent-discovery scope and child base directory. A task-level `cwd` stays relative to that call base and changes only that child's execution directory, not agent discovery. This per-origin discovery rule applies only to collected sibling calls; an ordinary explicit `{ tasks: [...] }` call keeps one discovery scope from its top-level `cwd`. Per-call and per-task `group` values also stay with their originating children. Shared run options must match across every sibling call: `concurrency`, `worktree`, `context`, `share`, `control`, `sessionDir`, `maxOutput`, `artifacts`, `includeProgress`, and `agentScope`. A mismatch rejects the whole burst before any child launches and names the incompatible field.

For a collected `worktree: true` burst, every call-level `cwd` must resolve to the same path. That common path becomes the shared worktree root; differing origins reject the burst before launch, and any task-level `cwd` must still resolve to that root. Each projected caller result keeps shared worktree diff text and terminal control guidance while its child results and standard child-output sections remain route-local.

Subagent tasks, parallel items, and the top-level call accept a `group` field that sets the spawned child's [Intercom](/intercom) home group, so same-group subagents can intercom each other while staying isolated from other groups. A named string joins that group; `true` auto-generates one shared UUID group per parallel set. Precedence is `explicit subagent group > inherited current-session group > config > "default"`. Workflow stages carry their runtime-owned invocation group, so children launched without `group` automatically join the workflow group; callers do not need to copy or generate an ID. In other sessions, omission inherits that launching session's resolved group. The child group is applied only when the child has Intercom access (the peer `intercom` tool or subagent-only `contact_supervisor` tool); a child without Intercom receives no group. `contact_supervisor` still reaches the supervisor across group boundaries because Atomic requests a broker capability during typed admission and binds the child's registration to the issuing supervisor. Foreground paths use exact child scopes. The lightweight Intercom wrapper lazy-loads the authorization provider; provider failures abort launch, while hosts without a provider omit supervisor metadata instead of exposing a broken channel.

When a subagent call or parallel task uses a `cwd`, Atomic validates that working directory before starting the child runtime. Missing or non-directory paths are reported as `cwd` problems instead of lower-level runtime errors.

Single-agent calls also accept `reads: string[] | false`. Atomic prepends those files as read context for foreground execution through the same in-process session path. Relative entries resolve against the effective child `cwd` (including a relative top-level `cwd` resolved from the parent); absolute entries are unchanged. Invalid values fail before the child session starts.

Single-agent calls accept `progress: boolean` in foreground mode. `progress: true` creates a run-scoped `progress.md` under isolated subagent artifact storage and instructs the child to maintain it without writing `progress.md` into the child `cwd`; `progress: false` disables an agent's `defaultProgress`. When `progress` is omitted, the agent's default is inherited, except that inherited progress is suppressed for read-only tasks (`progress: true` still explicitly opts in). Foreground runs remove this run-owned progress storage after the child exits when `artifacts: false`, including children temporarily detached for intercom coordination. This is separate from `includeProgress: true`, which only includes detailed runtime progress telemetry in the final tool result and does not create or maintain a file.

```ts
subagent({ agent: "worker", task: "Implement the approved fix.", progress: true })
```

<!-- baseline-block: subagents::005 -->

Source: `packages/coding-agent/docs/subagents.md` lines 38–49 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/subagents.md`.

## Foreground supervisor coordination

When a foreground child calls `contact_supervisor` with `need_decision` or `interview_request`, or uses `intercom.ask` against its resolved launching parent, Atomic claims the request before broker send or reply-waiter admission. The current child ends and the parent `subagent` call returns the original question verbatim, the child agent identity, ordered attachments with duplicates preserved, and a dynamically generated `[TASK_CONTEXT]` handoff.

The handoff explicitly tells the parent to start a fresh child with a normal launch such as `subagent({ agent: "worker", task: "[TASK_CONTEXT] ... Continue with this supervisor answer: ..." })`. The new child receives a new run identity. Completed, interrupted, and parent-question children are terminal for continuation; a prior run ID cannot revive one.

For a parallel foreground run, one claimed parent ask interrupts the active siblings and closes the worker gate. Tasks still queued behind the concurrency limit never launch or request supervisor authorization. No sibling set or worktree/session execution state is retained for later continuation. Follow-up work is launched explicitly as fresh SINGLE or PARALLEL work with the necessary context.

`intercom.send`, `contact_supervisor` progress updates, and `intercom.ask` calls resolved to a sibling or other peer keep their existing Intercom delivery path. Non-parent blocking asks keep the single race-safe reply-waiter slot and exact threaded replies.

When the Intercom bridge is active, the parent may connect long enough to issue the initial child capability; the child's own connection remains tool-driven. A claimed parent decision or interview ends before child send or waiter admission. Non-interactive children still run normal extension lifecycle and remain in-process `AgentSession` instances while live.
