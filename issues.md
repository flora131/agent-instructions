# Windows retained spawn follow-up

The reproduced explicit-interpreter quoting, safe-verbatim cwd, and retained-to-retained log inheritance defects are repaired and validated. Eight concurrent retained children now receive only their selected standard streams through documented STARTUPINFOEX HANDLE_LIST; no parent/job topology changes or spawn serialization were introduced.

## Unresolved: mixed ordinary std spawning can inherit retained log handles

A current-source probe with four restricted retained launches and four ordinary Rust std launches concurrently, repeated for 40 rounds, observed no foreign logs in retained children but foreign retained logs in ordinary std children. The new handle list restricts the receiving retained child; it does not prevent an unrelated inherit-all CreateProcessW call from seeing temporary inheritable duplicates. Full cleanup parity is not established.

Pristine latest main **8871d84d942c4f120147737603bccc594775ca2e** was fetched, and all five local repairs rebased onto it without conflicts or patch changes. An isolated harness using that main revision's exact extracted spawn_child/configure_process functions reported zero leaks in both groups. The same harness importing the rebased current module reported foreign logs in **62 of 160 std children** and failed its zero-leak assertion (exit101), while all160 retained children held only their own logs. This is an introduced resource-lifetime regression, not a baseline exemption.

Evidence: C:/Users/coder/AppData/Local/Temp/atomic-pg-3dab9d55/{mixed-spawn.rs,pristine-main-spawn.rs,mixed-pristine-main-assertion.log,mixed-rebased-red.log,mixed-alternatives.md}. Logs have direct .log.exit files. Child-side GetFinalPathNameByHandleW identities establish the leak, not handle counts alone; every test child was waited/reaped.

Exact Rust1.98.1 (48a229cea) Windows CommandExt exposes no token setter or pre-spawn callback. spawn_with_attributes and inherit_handles are unstable, and underlying creation uses CreateProcessW and a private lock. HANDLE_LIST requires inheritable entries. No supported std token/hook alternative was found in bounded research; CreateProcessWithTokenW has documented privilege/command-line differences and is not a demonstrated compatible substitute.

A documented internal helper is conditionally authorized only after smaller supported approaches are ruled out and a lifecycle/creation-HANDLE handoff, crash/abort/failure cleanup, packaging and regression plan is recorded. No helper implementation is included yet. Do not use PID reconstruction, private std locks, global inheritance toggles, undocumented non-inheritable lists, attached-server killing or acceptance of the leak. Stop for a decision if a design changes public lifecycle or requires installation, global configuration or new permissions.

Rebased narrower-fix validation passes: native integration14/library5, focused TypeScript95, script tests59, public boundary/batch/cwd/concurrent/lease comparisons, fresh admin/nonadmin actual-source SQL persistence/attachment/shutdown/early-error, and Linux target checking. Those passes do not resolve mixed spawning or establish readiness. No PR/push/merge/release is authorized.

Progress: external 3dab9d55/progress.md. Remove this file when the unresolved issue is resolved.
