# S1 consolidated review repair (#2884)

Current repair evidence: `/workspace/task-experience-evidence/s1/round3/`, `round3-repair-notes.md` and `round3-debugger-handoff.md`. Earlier rounds remain historical evidence; their regressions are retained.

| Root | Status | Defect / correction |
|---|---|---|
| 1 Public promises | Repaired; focused checks pass | Wait/foreground returned leases, cancel returned synchronous Result. Restored promised outcomes and optional host designation with synchronous internal registration. |
| 2 Subscription contract | Repaired; focused checks pass | Callback displaced cursor and lease was missing. Cursor is second; opaque lease is present; optional reconciliation is a subscription property. |
| 3 Requested wait defaults | Repaired; focused checks pass | Undefined disabled timing and configuration was unused. Trusted host tasks.wait applies 30000 ms, automatic agent override, until-settled and highest-priority call budgets. Independent launch remains immediate. |
| 4 Numeric wait budgets | Repaired; focused checks pass | N-API u32 narrowed 4294967296 to zero. Use f64 with monotonic elapsed-budget accounting and bounded scheduling intervals, not a total-budget cap. Node/Bun and Rust regressions pass. |
| 5 Independent cleanup | Repaired; focused checks pass | Promise.all blocked reaping behind a pending cancelled result. Cleanup waits for outcome OR cancellation; natural outcome-before-reaped remains intact in both delivery orders. |
| 6 External owner close | Repaired; focused checks pass | Settled executions with unreaped resources were ignored. Owner closing now aborts those resources without changing accepted results. |
| 7 Disposal replay | Repaired; focused checks pass | Native ObserverCancelled was omitted from yield mapping. Recorded refusal stays Result-shaped. |
| 8 Retained report history | **Unresolved contract blocker** | Exact arbitrary report replay requires unbounded distinct-history information, outside the bounded journal. No authorized finite lifetime/cap or storage-failure contract exists. |

## Previous full review: 13 entries, five roots

| Root | Status | Proven defect / correction |
|---|---|---|
| Numeric exit codes (3 findings) | Repaired; Node/Bun red/green | `Option<i32>` silently narrowed accepted numbers and collapsed conflicting replay. `Option<f64>` plus exact numeric-bit equality retains completed/failed exit codes, omitted/zero/-0 distinctions and NaN replay. 26 numeric round-trips/conflicts per runtime pass. |
| Cancellation projection (3 findings) | Repaired; Node/Bun red/green | The facade cleared attention on ordinary cancellation while native retained it. Match native authority: cancellation preserves attention; terminal/owner-closing clears it. Same-cursor event/native snapshots agree through settlement, owner-close and preserved cleanup failures. |
| Sleeping iterator on overflow (3 findings) | Repaired; Node/Bun red/green | Overflow replaced snapshot but left pending next() asleep. Publish snapshot/cursor then end the old iterator epoch, without disposing the subscription; a new iterator on the same iterable continues authentic ordered deltas. Local 100-metric/final-settlement overflow, native reset and oversized final settlement all notify without onReconcile or later cleanup/activity. |
| JS rejection values (1 finding) | Repaired; Node/Bun red/green | Error-only promise handlers sent missing messages into native conversion and stranded cleanup. Safe diagnostics retain raw strings/Error messages and cannot throw for other JS values. Result/cleanup/setup failures and two permanently-pending cancelled-result cleanup orders pass with no unhandled rejections. Native protocol reporting remains outside the rejection-conversion catch. |
| Report history (3 findings; original root 8) | **Unresolved contract blocker** | Exact arbitrary indefinite replay still requires unbounded retained information. Delivery queue repair is not a storage-policy resolution. |

Round2 repeatable original reviewer probe: `node /workspace/task-experience-evidence/s1/risk-probe-native-turn2.mjs` accepted 512 distinct 65,536-byte activity reports and increased RSS by 34,865,152 bytes; the oldest report still returned `duplicate` (`round2/history-current.log`). Exact replay semantics remain unchanged. No expiry, new cap/refusal, fingerprint or private persistence policy was added.

Final gate counts, generated binding status, platform limits and local commit/status are recorded in the external handoff; full S1 acceptance remains blocked only by the storage contradiction below.

## Latest full review: nine exact findings, three roots

| Reviewer | Original title | Root / current result |
|---|---|---|
| completion-reviewer | [P2] Resolve unbounded report retention outside the journal | Storage: unresolved |
| completion-reviewer | [P2] Preserve exact numeric identity when replaying metrics | Metrics: repaired |
| completion-reviewer | [P2] Contain exceptions thrown while formatting callback failures | Callbacks: repaired |
| evidence-reviewer | [P2] Bound report history outside the event journal | Storage: unresolved |
| evidence-reviewer | [P2] Preserve exact numeric identity in metric report replay | Metrics: repaired |
| evidence-reviewer | [P2] Contain failures while formatting callback exceptions | Callbacks: repaired |
| risk-reviewer | [P2] Resolve unbounded report history outside the journal | Storage: unresolved |
| risk-reviewer | [P2] Preserve numeric activity-report identity during replay | Metrics: repaired |
| risk-reviewer | [P2] Safely record arbitrary reconciliation callback exceptions | Callbacks: repaired |

- **Metrics:** derived `f64` equality rejected identical NaN and collapsed -0/+0. Reused terminal optional-number bit equality in `ActivityChange` and `TaskMetrics`; terminal results now call that same helper. All three metric fields preserve absence, raw values and exact replay. Durable Rust covers 3,375 combinations including distinct NaN payloads; Node/Bun each cover 2,744 combinations and 107,016 conflicts through real native reports, journal and facade/native snapshots. No normalization, limit, refusal or public shape change.
- **Callbacks:** `String(error)` and even `instanceof Error` could throw for arbitrary JS values, interrupting drain/poll rearming. All four diagnostic catches (callback, setup, result, cleanup) now use the existing safe rejection helper. Node/Bun each pass 45 direct/native-wake/fallback-timer cases, including hostile conversion, null-prototype and revoked Proxy values. Safe failure messages, final snapshot/reset notification without later activity, iterator resumption and stopped polling after disposal are asserted. Original callback-optional regressions remain unchanged.
- Original `native-contract.mjs` and `callback-contract.mjs` reproduce red and pass unchanged on Node/Bun after repair. Exact commands, stacks and statuses are under `round3/`. The first callback fixture's fault listener swallowed top-level assertion exit status; this harness defect was corrected before production repair. Its empty logs are retained, not treated as success; six corrected red scenarios fail with actual stacks.
- **Storage remains unresolved:** `round3/history-current.log` accepted 192 × 256-KiB reports, evicted every journal event, retained oldest replay after closure, and recorded RSS 54,976,512 → 122,327,040 bytes (+67,350,528). The probe's exit 0 proves the unresolved retention behavior, not compliance with the bound. No expiry/admission/fingerprint/storage policy was added. Six findings/two roots repaired; three storage findings remain required.

## Root 8: precise blocker, not an exemption

`task_supervisor/task.rs` retains full accepted reports and receipts in `activities` and checks duplicates before owner/terminal refusals. The previous round's Node probe accepted 768 unique 64-KiB reports (50,331,648 payload bytes) for one task with an empty drained journal; RSS rose from 56,057,856 to 109,273,088 bytes and replay survived close. Queue bounds do not resolve this defect.

With arbitrary report IDs/payloads and indefinite exact replay/conflict detection, distinct histories must stay distinguishable. Any fixed total-state bound admits only finitely many representations, so sufficiently many histories collide. Lossless compression/deduplication cannot bound arbitrary incompressible input; fixed-size fingerprints cannot guarantee exact equality. Closed-owner collection changes observable replay while runner capabilities remain live. A private spool only moves the unbounded state to disk and introduces disk-full/read-error/lifetime obligations not covered by ReportError; silently refusing, dropping, or throwing for these is not an authorized fix.

Resolution requires an explicit contract decision: define a finite report replay lifetime/admission/retention policy with corresponding observable outcomes, or authorize a storage model and failure/lifetime semantics while narrowing the bound to in-memory delivery. No such policy was invented; report semantics and protected RFC remain unchanged. This blocker does not invalidate independently tested repairs to roots 1–7.
