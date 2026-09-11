# PR 2971 detached-checkout CI repair

This supplement follows the captured-main reconciliation in `docs/migrations/2847-drift-main.md`. It does not replace an earlier inventory, ledger, checkpoint, or history transport.

## Fixed identities

- Failed pushed candidate: `1fae50a771f79675722859d08e368e201807d493`.
- Captured main: `3cd994f59031c303c4534df447719a2be899461d`.
- Original immutable baseline: `59586efd26afd32a27c999ac8bcce102777e40e4`.
- Hosted failure: [Tests run 34634412923, static job 103378709218](https://github.com/bastani-inc/atomic/actions/runs/34634412923/job/103378709218).

No further rebase or main integration belongs to this repair. The commit containing this supplement records the repair's exact parent and file changes.

## Demonstrated failures

The static job reported four failing script tests under Node 22.22.0:

1. The SDK image-example test imported the unbuilt coding-agent `dist/index.js`. The static job builds the AI dependency, but does not build coding-agent before running script tests.
2. The committed predecessor data-URL test globally replaced `fs.readdirSync`. On a cold checkout, Node 22's recursive cleanup of the verifier's disposable history directory calls that function and hit the test's working-tree-read prohibition.
3. The second committed predecessor data-URL test failed for the same reason.
4. The cold committed rebase test derived a clone branch from `git branch --show-current`. GitHub's detached checkout returns an empty string, so cloning failed before preservation assertions ran.

The Windows unit job [103378709314](https://github.com/bastani-inc/atomic/actions/runs/34634412923/job/103378709314) reported 12 failures on both attempts. Two default-tool inventory tests and ten information-architecture tests read CRLF checkout bytes where the approved text and preservation hashes require LF. A detached fresh clone with `core.autocrlf=true` reproduced all 12 failures, including the same drift-main README checksum mismatch. Git's checkout conversion also affected two SVG assets covered by exact-byte preservation.

The Linux release-archive job was cancelled during its smoke test. Cancellation is not passing evidence, and no source defect was inferred from it.

Reproduction uses fresh Git object databases and detached checkouts, including the actual GitHub merge ref for the failed candidate. Original pre-rebase checkpoints must be absent before and after verification. A warm author checkout is not evidence for these paths.

## Narrow repairs

- Typecheck the unchanged SDK image example against `packages/coding-agent/src/index.js`, with TypeScript-extension imports enabled for that source graph. Strict checking and the existing compiler subprocess limit remain.
- Initialize the cold fixture and fetch its parent's full `HEAD` commit with `--no-tags`. This works for both named branches and detached merge commits without transferring backup refs or unrelated historical checkpoints.
- Keep file and directory reads forbidden. Permit directory traversal only while synchronously removing a temporary root created by that child. A direct regression rejects document reads, ordinary temporary-directory reads, and unowned cleanup, then verifies nested owned cleanup succeeds.
- Pin LF checkout bytes only for the reader Markdown, MDX and SVG files, the issue's migration Markdown, and its retained stage-skill recipe. This leaves the committed blobs unchanged and keeps the exact-byte verifier strict on Windows rather than normalizing away differences inside its checks.

## Preservation boundary

Reader files, examples, caveats, navigation, assets, all migration manifests and bundled historical objects remain byte-identical to the failed candidate. The original preservation baseline does not advance. Working-tree document reads and writes to the inspected Git repository remain forbidden in the historical verifier controls. Temporary-history cleanup is distinct from reading current documentation.

The repair changes test setup, not shipped behavior or preservation policy. No assertions are skipped, no timeout or retry budgets change, and no unreachable refs are restored to make verification pass. Earlier browser approval can be reused only after proving the complete reader-tree identity. Earlier candidate test results do not count as tests of the repair commit.

Exact-head Tests, CodeQL, and Mintlify acceptance remain separate post-push requirements. This supplement does not claim hosted success.
