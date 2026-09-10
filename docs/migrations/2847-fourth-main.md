# #2847 fourth captured-main reconciliation

This supplemental record does not replace or reformat any original ledger or earlier supplemental artifact. The immutable launch baseline remains `59586efd26afd32a27c999ac8bcce102777e40e4`.

## Exact sources and historical predecessors

- Previous captured upstream: `32059e25f6608770280eacc0285b49a454a3f2f0` (47 reader pages).
- Selected fourth upstream: `7b2bf523216448ad4efb4b2e1c1e52fbcf0c2e12` (48 reader pages).
- Complete previous reader corpus and all earlier provenance: `c075c61a7dcae05a767db7372d991f421b3fc507` (85 reader pages).

These immutable Git revisions explicitly retain superseded wording, not just hashes. For example, `git show c075c61a7dcae05a767db7372d991f421b3fc507:packages/coding-agent/docs/reference/cli.md` reproduces the old default-tool inventory and this superseded sentence:

> Every bash execution runs in the foreground and receives one execution-time snapshot of the active session:

The prior first-session inventory, workflow/subagent `interrupt` instructions, and previous verification guide remain in the same predecessor corpus; their full upstream originals remain at the previous upstream revision. Historical retention alone cannot satisfy any newly selected substantive content.

## Active reconciliation

The full 372-line `computer-use.md` is required byte-for-byte from selected upstream. Fourteen existing pages and navigation change through 44 exact source-derived hunks. Thirty-three source pages and every other source asset remain unchanged. The resulting reader corpus has 86 pages.

The JSON `edits` tuples contain source path, active reader target, inclusive previous-source lines, and inclusive selected-source lines. Paths in these tuples are relative to `packages/coding-agent/docs/`. `edits_sha256` covers the complete independently reconstructed ordered source edit objects, including exact before/after text; `reader_edits_sha256` covers the mapped objects. `pages_sha256` covers the independently enumerated complete source page/navigation inventory. These are source proofs, not refreshed final-reader hashes.

The only moved source hunks are extensions to `extensions/events.md`, index to `guides.md`, quickstart to `getting-started/first-session.md`, and Intercom troubleshooting to `intercom/operations.md`. The existing absolute workflow rediscovery link remains unchanged. An exact Intercom compatibility pointer retains the new source heading. Navigation adds Computer use in Learn/Guides without replacing the reader architecture.

Eleven closed reader repairs also include `kill` in both default inventories, conditional native-Windows PowerShell availability in onboarding, and the current bash observation policy. The complete execution-time environment snapshot table and its caveats remain byte-exact. Four legacy heading anchors and the stage-skill recipe pointer preserve navigation. The complete still-valid source-checkout recipe at predecessor lines 36–47 remains active in `docs/2847-stage-skill-verification.md`; its source-derived content is checked in both working-tree and committed modes. The reader pointer names the immutable original, not a deletable PR branch.

## Verification and immutability

`reconstructFourthMainDelta` in `scripts/verify-docs-preservation.mjs` fixes every source span, mapping, repair string, and rationale. The supplemental JSON must independently reconstruct from that closed policy. Changing evidence and its accompanying hashes cannot authorize arbitrary content. Exact hunks must occur once at their named active destinations; reverse application must recover the previously proved reader corpus. Forward byte-exact closure also proves every original artifact, history, earlier supplemental ledger, image and prior reader byte, except the explicitly disclosed changes. The new maintainer recipe and complete Computer use guide are separately required at active paths.

Run `node scripts/verify-docs-preservation.mjs --working-tree`, `node --test scripts/verify-docs-preservation.test.mjs`, and after the authorized merge commit, `node scripts/verify-docs-preservation.mjs --committed HEAD`. This record claims no hosted-preview deployment, generated-output check, or browser execution.
