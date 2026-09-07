# S1 consolidated review repair (#2884)

Current repair evidence: `/workspace/task-experience-evidence/s1/round1/` and `round1-repair-notes.md`.

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

## Root 8: precise blocker, not an exemption

`task_supervisor/task.rs` retains full accepted reports and receipts in `activities` and checks duplicates before owner/terminal refusals. A current Node probe accepts 768 unique 64-KiB reports (50,331,648 payload bytes) for one task with an empty drained journal; RSS rises from 56,057,856 to 109,273,088 bytes and replay survives close. Queue bounds do not resolve this defect.

With arbitrary report IDs/payloads and indefinite exact replay/conflict detection, distinct histories must stay distinguishable. Any fixed total-state bound admits only finitely many representations, so sufficiently many histories collide. Lossless compression/deduplication cannot bound arbitrary incompressible input; fixed-size fingerprints cannot guarantee exact equality. Closed-owner collection changes observable replay while runner capabilities remain live. A private spool only moves the unbounded state to disk and introduces disk-full/read-error/lifetime obligations not covered by ReportError; silently refusing, dropping, or throwing for these is not an authorized fix.

Resolution requires an explicit contract decision: define a finite report replay lifetime/admission/retention policy with corresponding observable outcomes, or authorize a storage model and failure/lifetime semantics while narrowing the bound to in-memory delivery. No such policy was invented; report semantics and protected RFC remain unchanged. This blocker does not invalidate independently tested repairs to roots 1–7.
