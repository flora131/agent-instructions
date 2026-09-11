# #2847 / PR #2971: true-rebase preservation

The original baseline remains `59586efd26afd32a27c999ac8bcce102777e40e4`. All original and earlier supplemental ledgers remain byte-identical. This supplemental proof pins the complete pre-rebase reader to `5053a6aa244d7b97346c99f2b508e56783c42fa8` and selected main to `fadc434c561da387db764b53f41367fedf721a95`, following the previous main `7b2bf523216448ad4efb4b2e1c1e52fbcf0c2e12`.

Only two upstream documentation files changed: `computer-use.md` and `workflows/operations.md`. Nine closed, exact-source hunks reconstruct their complete files; all other source files, including assets, remain identical. The library-first guide, complete python-pptx example and caveats, and checkpoint-discovery diagnostic paragraph remain active. Superseded tool-preference sentences are historical source, not purportedly unchanged current guidance.

The active computer-use page additionally retains the original pre-rebase VBA mechanism row (line 47), immediately after the PowerShell COM row, and the complete original VBA recipe (lines 83–112), immediately before “Office Scripts, app runtimes, and file tools”. This preserves its original heading fragment, example, platform limits, security warnings, and format caveats without replacing any selected-main content. These additions are independently read from the original Git object, never inferred from the current page.

The original application-script checks paragraph (lines 53–54, including its trailing blank line) also remains active immediately before the macOS recipe. It preserves target app/version, object-name, and operation-recording caveats alongside the new file-first checks. Its only connective prefix is exactly: “For scripts that operate an application, also keep these application-specific checks:” followed by a blank line.

The verifier reverses only three disclosed active retentions, nine upstream hunks, and the reader-only URL repair below, runs every earlier preservation layer with explicit authoring-reference and review-repair flags, and checks exact forward bytes and the full reader/asset/provenance file set against the original pre-rebase snapshot. Ancestry from selected main requires this supplemental proof; artifact presence alone does not select a historical mode.

The sole additional reader-only repair changes the stage-skill reproduction URL in `workflows/verification.md` from the unpublished original local checkpoint to `https://github.com/bastani-inc/atomic/blob/d99113320267d1a6b6e5df284d2aee9743e0abf5/docs/2847-stage-skill-verification.md#reproduce-stage-skill-terminal-evidence`. Its immutable rebased target contains exactly the same active maintainer recipe bytes. The original pointer is restored for the earlier proof; neither the old ledger nor recipe is rewritten.

## Recreated history

The ten original first-parent commits were recreated as ten single-parent commits on selected main, not merge ancestry. The first and fourth merge checkpoints used independently computed merge-tree projections; the two middle merge checkpoints replayed their first-parent deltas (`cherry-pick -m 1`). The pre-repair rebased tip `edcbfda41b54d90a713f0fbcef654c37334cf8d3` has tree `962ee981441a9b518eb12d0e3d3ccd0506ec77d3`, exactly the independently computed merge-tree integration of the original tip and selected main. The active VBA retention, published recipe pointer, and this supplemental proof are disclosed subsequent repairs, not part of that tree-equality claim.

| Original checkpoint | Recreated checkpoint |
| --- | --- |
| `24f58842493deb8ec15dea44ef7e25936feeea60` | `8847b56a45e7286d7780dfa9a21bbe8e2f97b3f2` |
| `bf8dcd1bc02a7cb02caf557bb13d281b260c1704` | `277545052a33ec554d67c838cd1ff1a4a68b46ec` |
| `37bbd794fdcafac4b883e31e46d95eb60c26923d` | `c7c7bc4fe2195a59c204dbec453ab5714e3d127e` |
| `1bc84a1f948cb23ebc413f5bcd5ce136cab60763` | `104c74b9cbfbfff59d6035756f0644a644b310f0` |
| `8da40cc4ddb88b16baf8b4291722c6dabee8cfbb` | `411f5cd563b2779bfe8f0a773c7119fc540b5435` |
| `c075c61a7dcae05a767db7372d991f421b3fc507` | `d6bf6c4b44536479c669083d9dd46be661ee734f` |
| `a220514661bf21abd7e64ed1f3a64f71278cd9fd` | `d99113320267d1a6b6e5df284d2aee9743e0abf5` |
| `b496a1eb19966d306ad484ad324048c6dea2440a` | `e035c96571d7c0eef132665e55566ea1a6afba88` |
| `98acef56143df33311536a23a9ea95d796a61ed9` | `fd339f3357943753c66fa1e9309b83724ada6b33` |
| `5053a6aa244d7b97346c99f2b508e56783c42fa8` | `edcbfda41b54d90a713f0fbcef654c37334cf8d3` |

## Authentic history transport

`test/fixtures/docs-preservation-history/original-local-history.bundle.part-1` and `.part-2`, concatenated in that order, are the original Git bundle (949604 bytes; SHA-256 `ff39651dbd53ee373eac0f7b4970f3ad63612adee1ec9c566f2bb9a49a24d314`). Each part is smaller than 500 KB. The bundle was captured from the original pre-rebase tip excluding previous main. Its prerequisite commits are the original baseline and the four already-published main captures. It contains authentic original commit/tree/blob objects, not reconstructed commits. To inspect the full original corpus, concatenate the parts and use `git bundle unbundle` in a disposable repository with those published prerequisites.

The fixed bundle checksum is required even when original objects are already available locally. When needed, the verifier unbundles lazily into an owned temporary object directory, with the repository's existing object database as a read-only alternate. It never imports refs, writes to the checkout's Git database, or requires a backup ref. Temporary objects and the assembled bundle are removed in `finally`, including on verification failure. Committed mode reads committed transport bytes rather than working files, and remains usable through a data-URL import. Historical verification retains its existing rules and can use the committed HEAD transport when original objects are absent.
