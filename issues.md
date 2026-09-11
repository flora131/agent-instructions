# Windows retained spawn follow-up

The reproduced explicit-interpreter quoting, safe-verbatim cwd, and retained-to-retained log inheritance defects are repaired and validated. Eight concurrent retained children now receive only their selected standard streams through documented STARTUPINFOEX HANDLE_LIST; no parent/job topology changes or spawn serialization were introduced.

## Unresolved: mixed ordinary std spawning can inherit retained log handles

A current-source probe with four restricted retained launches and four ordinary Rust std launches concurrently, repeated for 40 rounds, observed no foreign logs in 160 retained children but foreign retained log handles in 47 of 160 std children. The new handle list restricts the receiving retained child; it does not prevent an unrelated inherit-all CreateProcessW call from seeing temporary inheritable duplicates. Full cleanup parity is not established.

Evidence: C:/Users/coder/AppData/Local/Temp/atomic-pg-3dab9d55/{mixed-spawn.rs,mixed-spawn.log,mixed-spawn.log.exit}. Child-side GetFinalPathNameByHandleW identities establish the leak, not handle counts alone. Fixture: Temp/atomic-pg-3dab9d55-mixed-9408.

Exact Rust 1.98.1 (48a229cea) Windows CommandExt source exposes no token setter or pre-spawn callback. spawn_with_attributes and inherit_handles are unstable, and the underlying creation path uses CreateProcessW and a private lock. No supported token/hook alternative was found in bounded research.

Design disposition is pending with the parent. Do not weaken the restricted token, use private std locks, undocumented non-inheritable handle lists, or introduce a helper/nominal-parent/job redesign without an explicit decision. Preserve the verified narrower repair and this residual; do not claim readiness or universal spawn coordination.

The authorized next delivery step is a safe local commit, fetch of latest origin/main, rebase without dropping work, and revalidation against that fetched base. No PR/push/merge/release is authorized.

Progress: external 3dab9d55/progress.md. Remove this file when the unresolved issue is resolved.
