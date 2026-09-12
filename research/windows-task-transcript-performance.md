# Windows task transcript rendering

## Reproduce

From the repository root, after `npm ci --ignore-scripts` and `npm run build`:

```powershell
bun --no-install research/windows-task-transcript-probe.mjs --baseline
bun --no-install research/windows-task-transcript-probe.mjs
```

The baseline mode reads the exact `TaskLiveTranscript` source at `ff55b141109e3f9f5980c1f0c718dea39f6b2fd9` through `git show`, transpiles it in memory, and uses this checkout's unchanged shared message renderers. It does not switch branches or write baseline product files. The candidate imports the current source directly. Keep the shared renderers unchanged for this comparison.

The probe exercises 100, 500 and 1,000 retained Markdown assistant messages, width 100, a hydrated streaming assistant and 30 text deltas. It checks every history marker exactly once, every delta in order, all 30 render requests, and unsubscribe. Each event is rendered immediately. No refresh interval, transcript limit or platform override is used.

## Measured result

Native Windows Server 2022, x64, AMD EPYC-v4 with eight logical processors, Bun 1.4.2. The benchmark uses real message components but headless stdout, not a terminal. Bun's `process.version` is not the installed Node CLI version.

The first same-workload run immediately before and after implementation measured:

| History | Baseline median / p95 | Candidate median / p95 |
| --- | --- | --- |
| 100 | 5.46 / 11.39 ms | 0.079 / 0.432 ms |
| 500 | 41.25 / 47.20 ms | 0.146 / 0.366 ms |
| 1,000 | 77.25 / 87.20 ms | 0.280 / 0.757 ms |

At 1,000 messages both variants return 9,003 rows and 1,000,226 rendered-string bytes from 407,891 serialized history bytes. CPU time across the timed loop fell from 2,563 to 16 ms. Process CPU accounting is coarse on Windows; zero reported by the smallest candidate workload does not mean zero work.

A second run using the committed probe's in-memory baseline mode, while other checks were running, measured 103.13 / 142.69 ms versus 0.358 / 1.458 ms at 1,000 messages. CPU totals were 3,140 versus 94 ms. These loaded-machine samples confirm the reduction but are not uncontended latency measurements.

The research CPU profile attributed 86.9% inclusive sampled time to `AssistantMessageComponent.render`, including Markdown parsing, highlighting, wrapping and Unicode width work. Previously every changed event discarded all message components. Retaining components for unchanged controller entry identities preserves their rendering caches. Superseded identities are weakly held. Width changes still reach each component, explicit invalidation recreates all components, and renderer callbacks still request rendering directly.

The structural regression test in `test/unit/task-live-transcript.test.ts` failed on the original implementation with 3,131 message reconstructions, then passed with 131. It asserts work rather than a machine-dependent time limit. Fresh-render parity also covers duplicate content, Unicode, thinking, tool arguments, partial/final tool results, aborted/error completion, widths and theme invalidation.

## Limits

These numbers prove a Windows component-rendering bottleneck and its reduction. Intermediate rendered bytes are not terminal-write bytes. They do not explain Windows-versus-Linux/macOS terminal differences. Linux and macOS measurements were not executed. Native terminal scenario evidence is recorded separately from this headless benchmark; neither is evidence of visible Windows Terminal smoothness.

No change to task source selection, paging, navigation, event delivery, refresh scheduling or subscription lifecycle is part of the optimization.

## Native Windows terminal scenario

```powershell
$evidence = Join-Path $env:TEMP ('task-transcript-' + [guid]::NewGuid())
New-Item -ItemType Directory $evidence | Out-Null
bun --no-install research/windows-task-transcript-terminal-probe.ts "$evidence/candidate"
$baseline = git show ff55b141109e3f9f5980c1f0c718dea39f6b2fd9:packages/coding-agent/src/modes/interactive/components/task-live-transcript.ts
$env:TASK_TERMINAL_BASELINE = "$evidence/baseline.ts"
[IO.File]::WriteAllText($env:TASK_TERMINAL_BASELINE, ($baseline -join "`n"))
bun --no-install research/windows-task-transcript-terminal-probe.ts "$evidence/baseline"
Remove-Item Env:TASK_TERMINAL_BASELINE
```

This uses an owned atomic-natives Windows ConPTY, Bun and the source local ChatSessionHost. It types `/tasks`, opens the transcript, loads earlier history, emits 1,000 messages with 8,000 deltas, scrolls during streaming, resizes 120×40 to 72×24 and back, reaches LIVE-0999 with End, completes the task and verifies unsubscribe/exit. The baseline preload replaces only the transcript module and logs a receipt proving it loaded. Output directories retain source hashes, frame/event JSONL, terminal ANSI bytes and result assertions.

Both final runs passed. The candidate produced 255 instrumented render calls, 92,351 terminal bytes and median/p95 render times 1.84/10.63 ms. The baseline produced 247 calls, 91,036 bytes and 25.57/109.60 ms. Other checks were running, so these are loaded-machine observations, not controlled display-latency numbers. Frame logging is synchronous and perturbs timing. Both use the same event cadence; physical frames and terminal chunks are not equivalent.

End was explicitly characterized during growth. Both baseline and candidate retained the numeric position reached by End rather than following later growth. This existing non-sticky behavior is unchanged; pressing End again reaches the latest content.

This scenario validates a real native PTY input/output path with deterministic task events. It does not validate the default isolated engine, real-provider/artifact I/O, or final screen pixels in a visible terminal window. No video was produced. Tool/error/fallback semantics are covered by focused tests, not this terminal scenario.
