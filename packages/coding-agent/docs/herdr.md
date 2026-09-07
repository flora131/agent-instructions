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

One module-owned lease reports each pane. A successor retires the predecessor before reporting. Sequence numbers use a clock seed and a process-level high-water mark, increasing across extension reloads, runner replacement, and clock rollback within that process. Shutdown drains the current child and releases authority with the last report sequence. Late predecessor callbacks cannot report or release a successor.

The reporter invokes the CLI directly with an argument array, not a shell. It permits one child per pane at a time, keeps only the newest pending state, and uses a five-second timeout plus bounded output buffering. Transport errors produce bounded `spawn_failed`, `timeout`, or `protocol_rejected` diagnostics; obsolete ownership uses `stale_owner`. Errors do not become agent or workflow failures. Child stdout and stderr are never logged raw.

Only the fixed messages in the table are sent. Prompt titles, tool arguments, provider error bodies, transcripts, and workflow outputs are not forwarded. The parent's session ID and, when available, native absolute session path accompany reports until the first successful CLI delivery per claim, using `--agent-session-id` and `--agent-session-path`. After a transport failure, later activity retries that identity; no retry timer is added. Child sessions do not replace that identity.

## Herdr 0.8.2 limitations

- Custom sources can author semantic state. Herdr may display an `idle` report after working as `done`.
- Equal or older report sequences may exit successfully but be ignored. The sequence high-water mark survives release on the Herdr side. Atomic seeds a new process from the clock; it does not promise ordering across a process restart with a rolled-back clock or another reporter's higher sequence.
- The CLI accepts session identity flags for custom sources, but 0.8.2 does not retain that identity in `agent get` or `pane get`. Reporting it does not enable automatic restoration.
- The CLI accepts `--message`, but `agent get` does not surface that message on 0.8.2.
- Reporting is event-driven. This slice adds no reconnect polling or crash-cleanup guarantee, and a failed report is not retried until later activity. Older CLI versions may reject commands or flags and are not claimed as fully compatible.
- Host-owned trust prompts are not covered by the extension prompt events. See [#2873](https://github.com/bastani-inc/atomic/issues/2873).

Workflow publication is a separate integration from this reporter. It consumes the host [workflow observation contract](/extensions#workflow-activity-and-lifecycle-hooks) without importing workflow scheduler internals.
