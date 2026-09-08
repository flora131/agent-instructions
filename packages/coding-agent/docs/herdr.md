# Herdr

Atomic includes a built-in Herdr reporter. In an eligible pane it reports agent, extension approval, and observed workflow activity using source `custom:atomic` and agent label `atomic`. No community extension is required.

## Prerequisites and environment

The CLI contract is based on Herdr **0.8.2, protocol 20**. Launch Atomic in a Herdr pane whose environment includes:

| Variable | Required value |
|---|---|
| `HERDR_ENV` | Exactly `1` |
| `HERDR_BIN_PATH` | Nonempty path to Herdr's executable CLI wrapper |
| `HERDR_PANE_ID` | Nonempty owning pane ID |
| `HERDR_SOCKET_PATH` | Nonempty server socket path |

The reporter captures these values on activation, not at module import. It runs only when the extension context has `mode: "tui"` and `hasUI: true`. Print, JSON, RPC, no-UI, workflow-stage, and subagent contexts never claim a pane merely because they inherited its environment. Missing prerequisites, disabled reporting, or ineligible contexts create no reporter timer, subprocess, or workflow observation lease.

## States and reasons

The reporter uses `agent_start`, `agent_settled`, `ui_prompt_start`, `ui_prompt_end`, and the owning session's `observeWorkflowActivity` stream. It does not infer execution from screen text or use `agent_end` as the idle boundary.

| Contribution | Reported state | Internal reason | Message |
|---|---|---|---|
| Agent executing without an open approval prompt | `working` | `executing` | None unless a workflow needs attention |
| Workflow execution, automatic continuation, retry, or stop-drain | `working` | Workflow's `executing`, `automatic_continuation`, `retrying`, or `stopping` | `Workflow needs attention` when a root is blocked or needs attention |
| Approval prompt is the only remaining work, including an agent parked on that prompt | `blocked` | `awaiting_input` | `Waiting for approval` |
| Blocked workflow with no independent execution or foreground prompt | `blocked` | Workflow's `awaiting_input` or `manual_intervention` | `Workflow needs attention` |
| All observed workflows paused, no agent or prompt work | `idle` | `paused` | None |
| Settled agent, no prompt, ready workflow source with no work | `idle` | `quiescent` | None |
| Workflow source `unavailable` or `recovering`, no known contribution | No new report | Unknown | None |

Independent workflow execution keeps the pane working even after the parent agent settles or while another contribution waits for approval. Reasons are internal reducer values, not extra CLI fields. Missing workflow knowledge is never treated as an empty ready snapshot, so an unavailable provider can leave the last reported state unchanged until a ready snapshot arrives.

Opening or closing the host-owned `/tasks` inspector is navigation and does not emit an approval span or change Herdr activity. Genuine extension approval prompts still report `blocked`. This follows [Herdr's custom-agent contract](https://herdr.dev/docs/integrations/#integrate-your-own-agent), which defines `blocked` as needing a user decision. [Prime Agent's reporter](https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/src/core/extensions/builtin/herdr-agent-state.ts) likewise observes explicit block notifications. Atomic retains its settled-event and workflow aggregation instead of copying Prime's retry grace timers.

## Opt out

Set this in global `~/.atomic/agent/settings.json` or trusted project `.atomic/settings.json`, then reload or restart Atomic:

```json
{
  "herdr": {
    "enabled": false
  }
}
```

The default is `true`, subject to the environment and ownership gates. Project settings override global settings using the normal [settings precedence](/settings).

## Reporter conflicts

If the actually loaded extension paths contain `herdr-atomic-reporter` or the legacy Pi `herdr-agent-state`, the built-in reporter defers without claiming or observing. One `unsupported` diagnostic names the loaded reporter path. Merely having such a package on disk does not cause deferral. The selected community or legacy reporter determines workflow coverage in that mode; Atomic's built-in aggregation is inactive.

## Ownership, delivery, and privacy

One module-owned lease reports each pane. A successor retires the predecessor before reporting. Sequence numbers use a clock seed and a process-level high-water mark, increasing across extension reloads, runner replacement, and clock rollback within that process. Shutdown drains the current child and releases authority with a fresh sequence strictly greater than the last report sequence. Late predecessor callbacks cannot report or release a successor.

The reporter invokes the CLI directly with an argument array, not a shell. It permits one child per pane at a time, keeps only the newest pending state, and uses a five-second timeout plus bounded output buffering. Transport errors produce bounded `spawn_failed`, `timeout`, or `protocol_rejected` diagnostics; obsolete ownership uses `stale_owner`. Errors do not become agent or workflow failures. Child stdout and stderr are never logged raw.

Only the fixed messages in the table are sent. Prompt titles, tool arguments, provider error bodies, transcripts, and workflow outputs are not forwarded. The parent's session ID and, when available, native absolute session path accompany reports until the first successful CLI delivery per claim, using `--agent-session-id` and `--agent-session-path`. Later reports in that claim omit these flags. This is not a once-per-claim attempt: after a transport failure, later activity retries that identity; no retry timer is added. Child sessions do not replace that identity.

## Compatibility

The reporter is tested against Herdr **0.8.2 (protocol 20)**; that is the minimum supported release. The rows below record the observed CLI and server behaviour the reporter is built on, and how Atomic responds.

| Herdr behaviour (0.8.2, protocol 20) | Observed | Atomic behaviour |
|---|---|---|
| Custom-source authority | A `custom:*` source authors semantic pane state. `custom:atomic` shows as agent `atomic`. | The built-in reporter uses `custom:atomic` and does not depend on Herdr's own agent detection. |
| Equal or older `--seq` | Exit 0, silently ignored by the server. The CLI never reports a rejected stale sequence. | Each report uses `max(clock ms, previous + 1)`, tracked in a process-level high-water mark; ordering is enforced by Atomic rather than inferred from exit codes. |
| Sequence high-water mark after release | Survives `release-agent`. A later report with a lower sequence, even from a new owner, is ignored. | New processes seed from the clock. Ordering across a process restart with a rolled-back clock, or against another reporter's higher sequence, is not promised. |
| `release-agent` without `--seq` | Exit 0, no change. Release by a non-owner source is also ignored. | Release always carries a fresh sequence strictly greater than the last report sequence. Ownership checks prevent late predecessor releases from retiring a successor. |
| `idle` after `working` | Surfaced as `agent_status: done`; `idle` on a fresh pane surfaces as `idle`. | Atomic reports `idle`. Consumers reading pane state must accept `idle` or `done` for the idle state. |
| `--message` | Accepted, but not surfaced by `agent get` (`message: null`). | Only the fixed messages `Waiting for approval` and `Workflow needs attention` are sent. |
| Session identity for custom sources | `--agent-session-id`, `--agent-session-path`, and `report-agent-session` are accepted, but `agent_session` stays `null`. | The parent session identity is reported once per claim as the documented contract. Retention and automatic restoration are not observable on 0.8.2. |
| Missing or invalid environment | Not applicable: nothing is invoked. | If `HERDR_ENV` is not exactly `1`, or any of `HERDR_BIN_PATH`, `HERDR_PANE_ID`, `HERDR_SOCKET_PATH` is empty, the reporter never activates and allocates no timer, subprocess, or observation lease. |
| Server not running | Exit 1 immediately with `server_not_running`; no hang. | The report is dropped with one bounded `protocol_rejected` diagnostic. A hung binary is killed after five seconds and reported as `timeout`. |
| Older Herdr CLI | Not tested. Commands or flags used here may be rejected. | Rejections surface as bounded `protocol_rejected` or `spawn_failed` diagnostics. They never become agent or workflow failures, and no report is retried until later activity. Older releases are not claimed as compatible. |

Additional limits on this release:

- Reporting is event-driven. This integration adds no reconnect polling or crash-cleanup guarantee.
- Host-owned trust prompts are not covered by the extension prompt events. See [#2873](https://github.com/bastani-inc/atomic/issues/2873).

The full activity path, from a real workflow run through the host observation stream to the `herdr` CLI invocations, is covered by an integration test against a fake `herdr` executable that records argv. It checks the ordered `working → blocked → working → idle` reports and strictly increasing `--seq` values for a tool-only execution followed by a human-input prompt. The state table it exercises is in [Workflow activity for extensions](/workflows/operations#workflow-activity-for-extensions).

Workflow publication is a separate integration from this reporter. It consumes the host [workflow observation contract](/extensions#workflow-activity-and-lifecycle-hooks) without importing workflow scheduler internals.
