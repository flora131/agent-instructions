# #2847 two-source reconciliation provenance

This supplements, and does not replace, `../2847-baseline-inventory.json`, `../2847-destination-map.json`, or `../2847-content-ledger.md`. Those three artifacts retain their original PR bytes, source identity, eight original connective exceptions, citation evidence, and historical summary. They describe the original migration, not the subsequently reconciled current instructions.

## Sources and coverage

| Source | Immutable revision | Pages | Blocks |
| --- | --- | ---: | ---: |
| Launch baseline | `59586efd26afd32a27c999ac8bcce102777e40e4` | 44 | 1038 |
| Original migrated PR | `24f58842493deb8ec15dea44ef7e25936feeea60` | 81 | 514 blocks with 1255 independently recovered connective lines |
| Reconciled upstream main | `cb13229bebe30ea7cb65689569569494b4bc651c` | 47 | 1090 |

Every Markdown/MDX page at main is enumerated directly from that commit, including nonconflicting additions. Main has 851 fenced examples, 151 tables, and 34 callout/blockquote markers under the fence-aware scanner. The original inventory retains its historical `2847-v1` counts: 835 fences, 132 tables, 34 callout/blockquote markers. The supplemental scanner correctly keeps shorter literal fences inside longer fenced examples.

All 1090 main blocks have verified **active** reader destinations. Exact reviewed corrections additionally retain 13 full main source blocks in `../2847-history/citation-corrections.md`. A historical copy alone never satisfies main coverage. Of the 1038 original blocks, 954 remain verified at active destinations and 84 use explicit source-history spans with a named current reader replacement. Eight original correction histories are also checked. The final reader corpus has 85 pages.

The original baseline and main proofs are independent of the final reader snapshot. The PR connective proof independently subtracts the original mapped baseline's normalized line multiplicities from each original PR block, then requires the remaining exact lines in order at the same current heading. Thus replacing the final-page hashes cannot hide loss of source content or original connective prose.

## Files and schema

- `manifest.json`: schema/version, the three fixed revisions, ordered shard lists, main source page paths/full SHA-256 digests, final reader-page digests and navigation digest.
- `main-inventory-*.json`: source-only block arrays reconstructed solely from main. Each row has `id`, source path/anchor/heading, 1-based inclusive `source_lines`, heading occurrence, raw and normalized full SHA-256 digests, heading/preamble kind, substantive/navigation class, and fence/table/callout counts. Line spans use `text.split("\n")`; block text is those lines joined by LF. Page hashes cover the complete original file bytes as UTF-8 text.
- `baseline-map-*.json`, `main-map-*.json`: exactly one row per independently enumerated source ID. Each records source identity, active/historical status, precise target, mode, enumerated edits, complete normalized target digest and rationale. Active targets use repository-relative path, exact anchor (including duplicate suffix), and occurrence; explicit history uses repository-relative path and inclusive line span. `active` names a historical baseline row's reader replacement. `history` supplies a correction's full original source.
- `additions` on every `ordered` mapping records **every** additive normalized line, including multiplicity, rather than merely labelling the whole block an exception. Baseline mappings have 991 exact and 47 ordered checks; main has 1076 exact and 14 ordered checks. Original-map exception IDs remain separately frozen as the original eight.
- `pr-connective-*.json`: source-only PR block locations/full source hashes and exact `added_lines`, independently regenerated from the fixed PR and launch baseline.
- `corrections.json`: exact reviewed old/new strings and rationale, including the three original anchor corrections. Its semantic JSON SHA-256 is pinned in the verifier: editing both this file and its manifest checksum cannot invent approval to change prose.
- `supersessions.json`: the two reviewed main policy corrections, complete historical originals, active replacements, and exact main source evidence IDs/digests. Subagent inspection follows the current Background tasks/footer/Windows contracts. Workflow role guidance follows current Model selection; its approval example also uses `high`, not an unexplained `max`. Both replacements and their evidence blocks are verified active.
- `reader-retention.json`: nine reviewed restorations of still-valid original details. Pinned source-line selections and one precise character fragment are independently reconstructed from the original baseline and required on reader pages. Archives cannot replace the startup/readiness/cache caveats, package-script examples, typecheck/shrinkwrap commands, versionless release facts, package-role tree, or single-child handoff example.
- `link-retargets.json`: the formerly exempt workflow-authoring event citation, with immutable source evidence. The original 101 retargets retain their original PR line evidence; tests verify all 102 current targets by actual current anchors rather than freezing obsolete current line numbers. All other supplemental transformations are enumerated per source block in the maps.

Every JSON file is below 512000 bytes. Shards are at most 300 rows; neither the original 511053-byte inventory nor its baseline identity was silently regenerated or replaced.

## Exact comparison rules

`2847-v2` drops blank lines, trims trailing whitespace, and flattens Markdown heading depth **outside** fenced code. Leading indentation, ordinary internal whitespace, digits, prose, code, table cells/rows, caveats and URLs remain significant. Blank-line/trailing-space normalization applies inside fences too; code content and indentation do not otherwise change. Frontmatter is not removed: additions to preambles must be explicitly disclosed.

Route changes are not normalized away. Each `link` edit must preserve its fragment, correspond to the source block's actual mapped reader destination, and resolve to the exact current anchor. The sole image-prefix relocation preserves the same image relative to the docs root and must resolve. The original `CLI Reference` capitalization correction is limited to its exact ledger ID and old/new heading. Anchor corrections and the narrowly reviewed supersessions are exact pinned strings; no fuzzy matching, arbitrary URLs, numeric erasure, paragraph exclusion, or archive-wide searches are permitted.

`exact` compares complete normalized SHA-256 digests. `ordered` consumes each source line in order with multiplicity inside one exact destination block, verifies every disclosed additive line, and also checks the complete destination digest. Duplicate source IDs, omitted rows/pages, duplicate destination occurrences (independent of JSON key order), missing headings/spans, invented correction policies, changed source inventories and absent content all fail closed.

The original `2847-v1` implementation remains explicitly separate for reproducing original provenance and identifying baseline lines in the PR. Its broader route/image folding and truncated original hashes are **not** the rules for new source-to-destination preservation checks.

## Running the gate

From the repository root:

```sh
node scripts/verify-docs-preservation.mjs --working-tree
node --test scripts/verify-docs-preservation.test.mjs
node scripts/verify-docs-preservation.mjs --committed HEAD
```

The exported `verifyCommittedDocumentation({ repoRoot, revision })` resolves the candidate once, then reads all manifests, original artifacts, reader pages, histories, image destinations and navigation from that commit through bounded Git commands. It does not fall back to working-tree docs or files. Only Node builtins are imported, so the external wrapper can load the committed module through a `data:` URL from `node --input-type=module -`. The explicit working-tree API separately supports disposable in-memory negative-control overrides.

The tests remove actual prose, executable example lines, technical table rows and caveats from each source destination without writing files. They also test source/map omissions, hash tampering, duplicate IDs/occurrences, arbitrary main archives, invented corrections, wrong-route rewrites, historical/replacement supersession loss, connective loss, still-valid reader-detail loss, exact additive disclosure, fence nesting, normalization boundaries and stdin/data-URL importing. The committed API is also tested against the old PR: uncommitted supplemental files cannot make that old revision pass.

Do not update hashes merely to silence a failure. Reconstruct source inventories only from their fixed revisions; review any newly proposed mappings, additions or corrections against both sources and current contracts. A future upstream reconciliation needs its own explicitly approved source identity and provenance rather than changing this baseline in place.
