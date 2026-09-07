# Atomic task experience terminal mockups

Static design proposals for [the RFC](../specs/2026-09-05-agent-task-experience.md), not screenshots of a running product. The source-backed UI review is in [the fidelity notes](2026-09-06-agent-task-ui-fidelity.md). This revision replaces the earlier ID-first layouts while preserving their lifecycle scenarios. Earlier validation receipts remain historical.

## Visual and interaction contract

Operate mode, Atomic's existing terminal identity. Bold emphasizes the task title or selected item; dim text carries metadata, connectors and hints. Use resolved theme roles, not a new palette. The literal one-cell `∀` marks live work, `✓` completed, `✗` failed, `■` cancelled and `○` queued. State words and action text carry meaning without color. Reduced motion is static. Base-canvas transcript, mantle task inspector, existing selected-row treatment; no per-task cards or saturated role badges.

Human-readable agent/type and task description lead. IDs are internal stable keys, shown in expanded metadata and focused detail, or as short suffixes when identical labels need disambiguation. No routine ID prefix, raw model identifier or telemetry column in collapsed chat. Counts mean tool calls, not event records. Unknown values are omitted, known zero preserved. All numbers below come from illustrative fixtures.

Parallel launches use a single group heading and tree-connected children. The same type need not repeat on every child when stated in the heading. One hint per group, not per nested tool. Transcript rows retain admission order; the task inspector groups agents and shells but keeps admission order within those groups. New status does not reorder selection. Every input task is still represented, including queued, failed and skipped tasks.

Three levels of disclosure: compact transcript summary; Ctrl+O prompt/activity/response within a bounded viewport; focused `/tasks` list and detail with metadata, retained transcript and explicit controls. Normal tool call/result rendering replaces numbered event logs. Never fabricate assistant text or expose hidden reasoning. The compact footer summarizes live background work and attention while the launch anchor is off-screen; it is not another transcript entry or completion toast.

| Input or event | Behavior |
|---|---|
| Ctrl+O, resolved `app.tools.expand` | Global tool expansion in the visible chat; never starts/stops work |
| `/tasks` | Shared all-task inspector; no new default chord |
| `/tasks t17` | Inspect that same task, including a terminal task |
| Enter in task list | Open detail, not automatic foregrounding |
| Foreground wait action | Observe the same live task with a new bounded wait |
| Input action | Enter selected writable stdin explicitly; preserve composer draft |
| Cancel action | Confirm the exact task before cancellation |
| Escape | Exit task/stdin focus first, without cancelling |
| Arrows / PageUp / PageDown / Home / End | Navigation only in the focused list/detail |
| Ctrl+D / Ctrl+U | Unchanged; not task navigation |
| F2 in workflow | Existing workflow graph |
| Output, completion, attention | No focus theft or scroll-to-bottom reset |
| `/skill:<selector> args` | Attached session skill expansion once; HIL answers remain literal |

Hints resolve configured bindings and disappear when unbound. In an active prompt, prompt input wins over task menus. One footer hint is enough; a footer reference does not duplicate a task row. If nothing is live or needs attention, omit the task footer. Terminal history remains accessible through `/tasks`.

Agents launch independently by default. Foreground frames below are explicitly requested waits. Requested agent waits default to 30 seconds; commands initially collect for 10 seconds. HIL releases a wait immediately. Pane navigation never closes an owner. Normal shutdown cancels cooperative sessions and cleans supervised processes; forced-crash cleanup is best effort and hung in-process JavaScript remains a documented limitation.

Each `text` block fits the declared columns × rows. Unused rows are omitted. Headings identify the host in this document; they do not prescribe a new MAIN banner in the existing main-chat chrome. Short IDs such as t17 are display aliases for stable native identities.

## M1: Main foreground, collapsed

100×30. t17 is the underlying identity, not the first thing the user must read. The action gives a useful scan target; one group-level expansion hint is sufficient.

```text
MAIN  refactor task delivery

You  Trace where the child result reaches the chat.
∀ researcher · Trace result delivery
  ⎿ Running in foreground · Reading notify.ts · 3 tool uses
  Ctrl+O expand

────────────────────────────────────────────────────────────────────────────
> Keep the receipt identity unchanged
```

## M2: Main foreground, Ctrl+O expanded, before coordination

100×30. Same t17 anchor. Prompt, activity and eventual response form a small transcript, not an event-number table. Full paths and exact arguments remain available in tool detail. Earlier entries are omitted only from this bounded viewport.

```text
MAIN  refactor task delivery

You  Trace where the child result reaches the chat.
∀ researcher · Trace result delivery
  Running in foreground · 3 tool uses · 8s · t17
  Prompt
    Trace the child result path; preserve receipt identity.
  Activity
    Read(subagent-executor-status.ts)
      ⎿ Completion identity includes run and child index.
    Read(notify.ts)
      ⎿ Inspecting admission and display flags.
  1 earlier tool use · /tasks t17 inspect transcript
  Ctrl+O collapse

────────────────────────────────────────────────────────────────────────────
> Keep the receipt identity unchanged
```

## M3: Main Intercom async, live before completion

100×30. Same row title/identity as M2. Status changes to background and a new real tool action appears after yield. The genuine peer message m42 remains visible; it is not a completion surrogate. The brief transition reason belongs in expanded detail, not a permanent extra collapsed row.

```text
MAIN  refactor task delivery

You  Trace where the child result reaches the chat.
∀ researcher · Trace result delivery
  Running in background · 4 tool uses · 12s · t17
  Prompt
    Trace the child result path; preserve receipt identity.
  Activity
    Read(notify.ts)
      ⎿ Inspecting admission and display flags.
    Bash(check notification fixture)
      ⎿ Checking delivery after the tool returned.
  Wait released for Intercom coordination; execution continues.
  2 earlier tool uses · /tasks t17 inspect transcript
  Ctrl+O collapse

Intercom  reviewer · m42
  I found the stage-close fence. Please preserve accepted receipts.

Assistant  I will check the live-task subscription.
────────────────────────────────────────────────────────────────────────────
> Keep the receipt identity unchanged
Tasks  1 agent running in background · /tasks
```

## M4: Main Intercom terminal settlement, no stray block

100×30. t17 settles at the same anchor. Completion metrics and response are inside its detail. The genuine peer message remains. A nonvisual envelope reaches model context without allocating a Spacer, Box or duplicate transcript result. No live-work footer remains for this sole completed task.

```text
MAIN  refactor task delivery

You  Trace where the child result reaches the chat.
✓ researcher · Trace result delivery
  Completed · 5 tool uses · 19s · t17
  Activity
    Read(interactive-agent-events.ts)
      ⎿ Pending-tool updates stop at tool end.
  Response
    Keep an owner-scoped subscription after the launching tool returns.
  4 earlier tool uses · /tasks t17 inspect transcript
  Ctrl+O collapse

Intercom  reviewer · m42
  I found the stage-close fence. Please preserve accepted receipts.

Assistant  The result confirms the separate task subscription.
────────────────────────────────────────────────────────────────────────────
> Keep the receipt identity unchanged
```

No empty padded completion block is inserted. The normal spacing between actual messages is intentional. In collapsed mode this becomes the same title plus `Completed · 5 tool uses · 19s` and a bounded response preview, not an appended notification.

## M5: Main explicit and timed background work

80×24, collapsed. Two distinct task identities, t21 and t22. The title explains the work; current action is subordinate. Foreground reader t21 reached its wait budget; t22 was explicitly launched in background. Reasons remain in detail.

```text
MAIN  inspect task contracts

∀ 2 agents running in background
  ├─ reader · Check owner rules · 6 tool uses
  │  Reading native declarations
  └─ checker · Check type fixtures
     Bash · Typecheck running
  Ctrl+O expand

Assistant  I can inspect the caller while these run.
────────────────────────────────────────────────────────────
>
Tasks  2 agents running in background · /tasks
```

80×24, expanded. Same order and IDs. Each child has a bounded transcript excerpt. Expansion is not a second launch, and one hint serves the group.

```text
MAIN  inspect task contracts

∀ 2 agents running in background
  ├─ reader · Check owner rules
  │  Running in background · 7 tool uses · 34s · t21
  │  Wait budget reached
  │  Read(native/index.d.ts)
  │    ⎿ Checking optional exit-code fields.
  └─ checker · Check type fixtures
     Running in background · t22 · explicitly backgrounded
     Bash(typecheck fixture)
       ⎿ Compiler started.
  Ctrl+O collapse · /tasks inspect full transcripts

────────────────────────────────────────────────────────────
>
Tasks  2 agents running in background · /tasks
```

## M6: Workflow foreground, collapsed and expanded

80×24, collapsed. The concrete stage owns t31. A dependency waits for the logical result, not a foreground observation. Same title/action hierarchy as main chat.

```text
WORKFLOW  task review / inspect · attempt 2

∀ reader · Check stage ownership
  ⎿ Running in foreground · Reading admission rules · 2 tool uses
  Ctrl+O expand

Next: review · waiting for inspect result
────────────────────────────────────────────────────────────
>
F2 graph
```

80×24, expanded. Readable prompt and native tool rendering, with task metadata on a subordinate line.

```text
WORKFLOW  task review / inspect · attempt 2

∀ reader · Check stage ownership
  Running in foreground · 2 tool uses · 7s · t31
  Prompt
    Check when the stage closes its child sessions.
  Activity
    Search(closeSignal)
      ⎿ Found the stage owner boundary.
    Read(workflow-stage-admission.ts)
      ⎿ Checking the late-delivery fence.
  Ctrl+O collapse · /tasks t31 inspect

Next: review · waiting for inspect result
────────────────────────────────────────────────────────────
>
F2 graph
```

## M7: Workflow background parity, Intercom live transition

80×24, collapsed. A peer message released the explicit wait. t31's row keeps updating before completion. The parent's stage can work on something else but cannot complete a dependent node from this yielded handle.

```text
WORKFLOW  task review / inspect · attempt 2

∀ reader · Check stage ownership
  ⎿ Running in background · Reading close-scope tests · 4 tool uses
  Ctrl+O expand

Intercom  reviewer · m51
  Check the stage-attempt identity, not just the run ID.

Next: review · waiting for inspect result
────────────────────────────────────────────────────────────
>
Tasks  1 agent in background · /tasks · F2 graph
```

80×24, expanded. Same task/prompt as M6 and later real activity. No false workflow settlement, no source claim that async launch itself completed execution.

```text
WORKFLOW  task review / inspect · attempt 2

∀ reader · Check stage ownership
  Running in background · 4 tool uses · 12s · t31
  Activity
    Read(workflow-stage-subagent-cancellation.test.ts)
      ⎿ Confirming cancellation is scoped to one stage attempt.
  Wait released for Intercom coordination; execution continues.
  3 earlier tool uses · /tasks t31 inspect transcript
  Ctrl+O collapse

Intercom  reviewer · m51
  Check the stage-attempt identity, not just the run ID.

Next: review · waiting for inspect result
────────────────────────────────────────────────────────────
>
Tasks  1 agent in background · /tasks · F2 graph
```

## M8: View detach, reattach, live foregrounding and settlement

80×24. After switching away and reattaching, snapshot plus cursor restores t31. The user explicitly chooses Foreground wait; no runner restarts. t32 and t33 remain background. Long detail is bounded rather than pushing the composer out.

```text
WORKFLOW  task review / inspect · attempt 2

∀ 3 agents · 1 foreground · 2 background
  ├─ reader · Check stage ownership
  │  Running in foreground · 6 tool uses · t31
  │  Read(task checkpoint fixture)
  │    ⎿ Yield does not write a completed checkpoint.
  ├─ checker · Check native cleanup
  │  Running in background · Bash(native fixture)
  └─ auditor · Check replay routing
     Running in background · Reading stage chat buffer
  Ctrl+O collapse · /tasks inspect

Next: review · waiting for inspect result
────────────────────────────────────────────────────────────
>
Tasks  2 agents in background · /tasks · F2 graph
```

80×24. Normal stage closure after its own logical result is accepted. Already-completed t31 stays completed; unfinished t32/t33 are cancelled. A cleanup failure instead reports `closing · cleanup failed`; a blocked JS callback cannot promise this successful frame.

```text
WORKFLOW  task review / inspect · attempt 2 · closed

3 agents · 1 completed · 2 cancelled
  ├─ ✓ reader · Check stage ownership
  │  Completed · 7 tool uses · 25s
  │  Response: Await the terminal result before checkpointing.
  ├─ ■ checker · Check native cleanup
  │  Cancelled · owner closed · processes reaped
  └─ ■ auditor · Check replay routing
     Cancelled · owner closed
  Ctrl+O collapse · /tasks inspect results

Next: review · inspect result accepted
────────────────────────────────────────────────────────────
F2 graph
```

No late child finding is rerouted to main chat. If the stage itself is cancelled, existing workflow cancellation rules control downstream nodes instead.

## M9: Parallel and nested hierarchy, HIL, attention and failure

100×30. Authorized workflow → stage → agent → nested command. Tree structure does not grant new child-delegation permission. An input-needed state is factual; it is not inferred from elapsed time.

```text
WORKFLOW  task review / verify · attempt 1

3 agents · 1 running · 1 input needed · 1 failed
  ├─ ∀ reader · Check task schema
  │  Running in background · Reading task contracts
  │  └─ ∀ bash · Check generated types
  │     Running · Compiler checking declarations
  ├─ ? reviewer · Choose fixture
  │  Input needed · Select native or fake runner fixture
  └─ ✗ auditor · Check cleanup fixture
     Failed · Fixture file not found
  Ctrl+O expand · /tasks inspect

Next: approval · waiting for verify result
────────────────────────────────────────────────────────────────────────────
>
Tasks  1 input needed · 1 failed · /tasks · F2 graph
```

100×30. Focused input-needed detail. Prompt activation uses its existing authoritative route and does not synthesize a response. Opening detail does not focus the actual HIL prompt automatically.

```text
TASKS  reviewer · Choose fixture
Input needed · t42 · owner verify / attempt 1

Request
  Select native or fake runner fixture.
The foreground wait was released; this task still needs your answer.

Actions
▸ Open question
  Inspect transcript
  Cancel task…

↑↓ select action · Enter choose · Esc back
```

## M10: Shell task with explicit stdin and output bounds

80×24. Shell detail prioritizes the command, state and readable output. Task ID, owner and process metadata belong here, not on every compact row. Input is an explicit action, not a writable field accidentally replacing the chat composer.

```text
TASKS  bash · Check process cleanup
Running in background · 18s · t51
Command  node task-process-tree.mjs
Owner    inspect / attempt 2 · PTY · stdin available

Output · latest 8 KiB
  parent ready
  grandchild ready
  awaiting input
Earlier output available in retained log

Actions
▸ Enter task input
  Foreground wait
  Cancel task…
↑↓ select action · Enter choose · Esc back
```

80×24. Explicit input focus targets t51; the draft remains saved. Empty bytes and EOF are distinct operations. After completion, input is disabled and foreground waiting cannot revive this task.

```text
TASK INPUT  bash · Check process cleanup · t51
Running in background · PTY

Output
  parent ready
  grandchild ready

stdin> status
Enter send · Esc leave input
Saved chat draft: Preserve my draft
```

Input/cancel receipts must be tested independently of the display. Normal cancellation shows cancelling until cleanup is confirmed; only then may detail say `Cancelled · processes reaped`. An ambiguous write is shown as delivery unknown and is not automatically resent.

## M11: Narrow and short terminal, compact overflow

48×16. Titles remain recognizable. Remove optional metrics before shortening labels; preserve essential state and route to overflow. All five tasks remain in the projection.

```text
MAIN  inspect task contracts

∀ reader · Check owner rules
  Running in background · Reading contracts
? reviewer · Choose fixture
  Input needed · Select a test fixture
3 more tasks · /tasks show all 5
Ctrl+O expand
──────────────────────────────────────────────
> Keep my draft
Tasks  1 input · 1 failed · /tasks
```

48×16. Focused list separates agents and shells. Selected ID t63 stays stable, but rows lead with descriptions rather than IDs. List grouping is fixed; a status update does not sort the selected task elsewhere.

```text
TASKS  all 5
Agents
  ∀ Check owner rules         background
  ? Choose fixture           input needed
▸ ∀ Check type fixtures       background
  ✗ Check cleanup fixture    failed
Shells
  ∀ Build native module      background

checker · Check type fixtures · t63
↑↓ select · Enter inspect · Esc back
```

## M12: Short expanded viewport and stable scroll anchor

48×16. The user is scrolled up. New activity does not jump to the bottom. Prompt/transcript access remains available even when only a few tool entries fit; current-action counts do not pretend this is the entire history.

```text
TASKS  reader · Check owner rules · t61
Running in background
Activity · earlier entries
  Read(control.rs)
    ⎿ Checking cancellation ordering.
  Bash(check type fixture)
    ⎿ Compiler started.
12 newer tool uses · not following latest

PageDown later · End follow latest
Esc back
```

For still shorter terminals, prompt/composer wins. Use a bounded summary and focused inspection, not unlimited transcript growth. Wrapping must count wide and combining characters without normalizing stored source text.

## M13: Main shell launch, shared collapsed row

80×24. Same shell vocabulary as M10. The command is an illustrative future fixture, not an executed command. Shell commands initially wait up to the configured collection budget.

```text
MAIN  inspect process cleanup

You  Run the process tree fixture.
∀ bash · Check process cleanup
  ⎿ Running in foreground · node task-process-tree.mjs
  Ctrl+O expand

────────────────────────────────────────────────────────────
> Preserve my draft
```

## M14: Workflow narrow and focused overflow

48×16. Same allocation as M11, with workflow owner and graph route. Existing run widgets and task summary must share the bounded footer budget rather than stack unbounded panels.

```text
WORKFLOW  review / inspect · attempt 2

∀ reader · Check owner rules
  Running in background · Reading contracts
? reviewer · Choose fixture
  Input needed · Select a test fixture
3 more tasks · /tasks show all 5
Ctrl+O expand
Next: verify · waiting for inspect
──────────────────────────────────────────────
> Keep the stage owner
Tasks  1 input · 1 failed · /tasks · F2 graph
```

48×16. Shared inspector with explicit owner context. Foreground tasks remain inspectable here too; the list is not just a foreground-excluding background selector.

```text
TASKS  inspect / attempt 2 · all 5
Agents
  ∀ Check owner rules         background
  ? Choose fixture           input needed
▸ ∀ Check type fixtures       background
  ✗ Check cleanup fixture    failed
Shells
  ∀ Build native module      background

checker · Check type fixtures · t63
↑↓ select · Enter inspect · Esc back
F2 graph
```

## M15: Workflow skill invocation

80×24. Test-only `fixture` skill selected from the stage's catalog. The live task summary is not the autocomplete list; existing composer completion owns that region.

```text
WORKFLOW  review / inspect · attempt 2

∀ researcher · Trace result delivery
  ⎿ Running in background · Reading task contracts

────────────────────────────────────────────────────────────
> /skill:fi
  skill:fixture  Inspect the fixture contract  [project]
Enter submit · Ctrl+F follow-up · F2 graph
```

80×24. Submit `/skill:fixture check cancellation` while busy. The queued command targets that stage even if the user changes panes. Expansion occurs once in the session, not in both UI and session.

```text
WORKFLOW  review / inspect · attempt 2

∀ researcher · Trace result delivery
  ⎿ Running in background · Reading the owner-close fence

Queued steering
  /skill:fixture check cancellation
  stage skill · project · inspect
────────────────────────────────────────────────────────────
>
Tasks  1 agent in background · /tasks · F2 graph
```

A mounted HIL answer starting `/skill:` stays literal. Read-only/archive/replay cannot invoke a skill; explicit editable postmortem chat remains separate from workflow execution.

## M16: Default independent launch with queued work

80×24. t71/t72 run; t73 is admitted and queued under a two-runner limit. Tool return does not skip t73. One group-level badge/count describes shared background observation; child state remains distinguishable.

```text
MAIN  inspect task contracts

∀ 3 agents · 2 running · 1 queued · background
  ├─ reader · Check owner rules
  │  Reading task contracts
  ├─ checker · Check type fixtures
  │  Bash · Compiler checking fixtures
  └─ ○ auditor · Check cleanup paths
     Queued · waiting for runner capacity
  Ctrl+O expand

Assistant  I can check the caller while these work.
────────────────────────────────────────────────────────────
>
Tasks  2 agents running · 1 queued · /tasks
```

An explicit wait observes one existing ID. If the stage closes before t73 starts, it is cancelled without running. This is distinct from a real Intercom group-detach skip of never-admitted foreground slots.

## M17: Output cap

80×24. Background file-spool bash is killed at 5 GiB. This is not a user cancel. The workflow node still waits for a logical result and must not treat this as success. Foreground collection does not start the size watchdog.

```text
WORKFLOW  task review / verify · attempt 1

✗ bash · Process fixture records
  Failed · output file exceeded 5 GiB · t81
  Output · latest 8 KiB
    processed record 91204
    processed record 91205
  Background command killed: output file exceeded 5 GiB
  /tasks t81 inspect retained log
  Ctrl+O collapse

Next: review · waiting for verify result
────────────────────────────────────────────────────────────
>
Tasks  1 failed · /tasks · F2 graph
```

80×24. A drained pipe/PTY command hits the same cap and keeps running. Session history is unaffected. The file stops growing; the live tail continues.

```text
WORKFLOW  task review / verify · attempt 1

∀ bash · Stream fixture records
  Running in background · t82
  Output · latest 8 KiB
    processed record 91204
    processed record 91205
  Log capped at 5 GiB; task continues.
  Some output omitted · /tasks t82 inspect retained log
  Ctrl+O collapse

Next: review · waiting for verify result
────────────────────────────────────────────────────────────
>
Tasks  1 shell in background · /tasks · F2 graph
```

## M18: Focused agent detail and failure

80×24. Detail puts the task first, then trustworthy metadata. Only here do ID, owner, elapsed and token count need to coexist. Values are present in this fixture. Recent activity is a bounded snapshot; a visible focused detail may refresh elapsed time without animating old scrollback.

```text
TASKS  researcher · Trace result delivery
Running in background · 12s · 4 tool uses · 8.2k tokens
Task t17 · owner main session

Prompt
  Trace the child result path; preserve receipt identity.
Recent activity
  Read(subagent-executor-status.ts)
  Read(notify.ts)
› Bash(check notification fixture)

Actions
▸ Inspect transcript
  Foreground wait
  Cancel task…
↑↓ select action · Enter choose · Esc back
```

The subdued › marks the latest observed activity; ▸ marks the focused action. The action menu owns input. Expanded transcript is a projection of retained session messages, not a newly synthesized summary.

80×24. Failure detail keeps the actual error visible. Terminal tasks have no foreground/input action and are never silently retried. Prompt, transcript and retained output can still be inspected.

```text
TASKS  auditor · Check cleanup fixture
Failed · 4s · 1 tool use · t64

Error
  Fixture file not found: test/fixtures/task-process-tree.mjs
No cleanup test ran.

Actions
▸ Inspect transcript
  Inspect retained output
↑↓ select action · Enter choose · Esc back
```

## M19: Empty inspector

48×16. An explicit empty view teaches where tasks will appear. No blank task container or idle spinner is added to an otherwise empty chat, and no live-task footer is shown.

```text
TASKS  current session

No tasks in this session yet.
Agents and shell tasks appear here when started.

Esc back to chat
```

## Verification contract

There are 30 static frames. M1 → M2 → M3 → M4 holds one t17 identity/anchor and adds real post-yield activity before settlement. M6/M7 repeat that behavior in workflow chat. M8 covers view-only detach, fresh bounded wait, and normal owner close. M9/M18 distinguish HIL, failure and action focus. M10 covers targeted input; M11/M12/M14 bounded mounts and scroll stability; M15 stage-local skills; M16 independent queued work; M17 file-spool kill versus drained truncate-and-continue; M19 empty state.

Future S4/S5 tests verify shared host rendering, title/ID disambiguation, native tool-message rendering, null-result no-spacing behavior, count correctness, grouped connectors, one hint per group, footer discoverability after anchor scroll-off, prompt/response access, empty/failure/terminal actions, resize and no-color output. Source-level decisions are not runtime proof. Keep the embedded RFC frames byte-identical to the selected frames here.
