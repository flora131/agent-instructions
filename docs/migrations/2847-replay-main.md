# #2847 / PR #2971: replayed-branch and upstream-main preservation

This is an additive eighth proof, not a replacement ledger. The immutable baseline remains `59586efd26afd32a27c999ac8bcce102777e40e4`. The complete pre-rebase reader tree is `a523c8ebfa1e929871c67b70fb685b9558240cee`; its captured main was `3cd994f59031c303c4534df447719a2be899461d`. The new captured main is `ff55b141109e3f9f5980c1f0c718dea39f6b2fd9`, not a claim about subsequently moving main.

Two independent things happened and this record keeps them apart. Upstream changed five reader pages, added `web-access.md`, and listed that one page in navigation. Separately, the sixteen pushed branch commits and the stub retirement were rebased off `3cd994f5` onto `ff55b141`, which made the whole pre-rebase line unreachable from any ref.

## Exact source coverage and reader destinations

Seventeen closed source spans reconstruct all five changed upstream files completely, plus one whole added page and one navigation position. The full upstream file set and unchanged tree entries, including binary assets, must match. The JSON records exact old/new line ranges and hashes, reconstructed from Git rather than learned from reader snapshots.

- `background-tasks.md` gains the wait-budget paragraph under “Choose how long to wait” and keeps its revised owner-policy and background-shell wording, including the four `Bash` observation rows.
- `containerization.md` keeps its revised pattern-selection sentence and the Gondolin corrections, including the two added lines at the end of that section.
- `development.md` gains the complete “PDF and engine diagnostics” section ahead of “Testing”. The reader tree's own “Startup timing probes” section, which replaced the upstream benchmark paragraph in an earlier pass, is untouched.
- `subagents.md` gains its two-line opening addition and the revised owner-bound observation sentence.
- `tools.md` gains the fourteen-line built-in tool addition and the twelve-line hashline-anchor addition.
- `web-access.md` is carried in whole and must equal upstream's bytes exactly; its digest is pinned in the JSON.

The verifier reverses these exact spans, the navigation adoption and the one reader repair below, then runs the unchanged earlier reader-path proof against both the pre-rebase head itself and the restored current view. Forward reconstruction and reverse comparison cover every predecessor reader page, asset, navigation file, migration artifact, earlier bundle part and the retained maintainer recipe. No updated destination hash can authorize unrelated changes.

## The rebase carried every earlier layer across

All seventeen commits replayed with identical subjects in identical order. Restricted to `packages/coding-agent/docs` and `docs/migrations`, the difference between the pre-rebase head and the replayed head is exactly the upstream delta above and nothing else: `docs/migrations` is byte-identical across the rebase, and no conflict was resolved by dropping a side. That is asserted mechanically, not asserted here — the reversed tree must equal `a523c8eb` byte for byte, or verification fails.

| Pre-rebase | Replayed |
| --- | --- |
| `95702d2834140ee84eb09ed2b540e38b24a74201` | `c7bc0e81b53430646b0ba6fd298fb28b68b77219` |
| `d8480e2ae94a4cd2d29ee49a23db3ac51beeb4b1` | `4f43f48854714f0da9d3ff8535a554466857a22d` |
| `1a3f580ee0b87d1dc72811d1334e4368f0df183b` | `79cd76c26ce1ff5bd1fe27b0459254f8458df369` |
| `4cf8169362e7729f4f1834637a1e9a89c9ac8631` | `ea7f9d9e5ff98dcddb33b012f57657a502dbbe9d` |
| `93fae28039023b1c80d02deee09094c3bc67f98a` | `5dea96d8fe52399708f25eb696d951bed69e0e5b` |
| `0a86fff38e4c8459f9bdf131476ae45128537f31` | `f36fbdc5cb1a0cebdb07994ecfd12a305cd3c550` |
| `e59fd2cfa485d8798c31861e9d9920d96c072cc6` | `2519e592488f30dc4a1bd3c24423c2353add22c2` |
| `e8519590aa3296b09cdc02d37cddf4ddb796bf92` | `c24a8de982409a6127315db0f46922010b23957a` |
| `2196f63a08db6202c5d83fc550671535821cc06f` | `36045c86e1bbb5b105f54a1d396f1c2f61b99c3d` |
| `4a26df3498b5917c2d8bfaa05027f0e7ae5a888e` | `b82d326b0319effd96f115b130c4daabc0e4138c` |
| `5212f6b0fc36f18e7a45dbed61d7afa4cec92aea` | `4344aa2f1f40031a360bd75e06e73517255bfae6` |
| `afaadb6b45c71ae7c34019b09983f060bc03d0ff` | `5ef647172a54242d569358556acaf3a2fbf7c0c1` |
| `1fae50a771f79675722859d08e368e201807d493` | `ef84b2775e7dda42a42c4b9f80f63b9fdb2cf338` |
| `dac1bf102cdee514badd82f48c587d6b2dbd06b8` | `5261db469fdc84284a8b2b6b5987914fe8528575` |
| `f0a9e4fe9c1433e1258b050082a2df1439577e63` | `ca2093d417ab8b43bc969b1a5c136035ccdb0e4b` |
| `f45e54d00d79342b935ef9a265069bd0d4c009ad` | `3e01cbd7718c14f5320ec7cca124b998372467d3` |
| `a523c8ebfa1e929871c67b70fb685b9558240cee` | `8499c561494e942558bd80b9c13fb56c655652b7` |

## Upstream navigation, recorded as position

Upstream added exactly one navigation entry, `web-access`, immediately after `tools/edit` and immediately before `session-format`, and changed nothing else in `docs.json`. The reader tree nests its navigation more deeply than upstream's, so the two files share no anchor line and this is recorded as a position rather than as text: the reader navigation must list `web-access` exactly once, with the same neighbours on both sides. The reversal keeps the `tools/edit` entry and drops only the added line, so it fails unless the two are adjacent. `test/unit/docs-information-architecture.test.ts` holds the matching route contract, which names `/web-access` as a generated insertion under `/tools/edit`.

## One reader-only repair

Change only the stage-skill recipe URL's commit from `e59fd2cfa485d8798c31861e9d9920d96c072cc6` to its new replay counterpart `2519e592488f30dc4a1bd3c24423c2353add22c2`: `https://github.com/bastani-inc/atomic/blob/2519e592488f30dc4a1bd3c24423c2353add22c2/docs/2847-stage-skill-verification.md#reproduce-stage-skill-terminal-evidence`. Its full recipe bytes equal the pre-rebase head. The old SHA becomes unreachable once the branch is force-pushed; the new URL uses a retained ancestor. This is the same repair the previous replay made for the same reason. Hosted URL availability remains a postpush obligation.

## Supplemental authentic history transport

Concatenate `test/fixtures/docs-preservation-history/rebased-replay.bundle.part-1` through `.part-5` in order. The authentic Git bundle is 2434229 bytes, SHA-256 `3ea8bcff9433c88547dd2c784c374c9ae73a58a9da629b713aab85a760dc9b42`. Part sizes are 500000, 500000, 500000, 500000 and 434229 bytes; exact per-part checksums are in the supplemental JSON and verifier.

It advertises `a523c8ebfa1e929871c67b70fb685b9558240cee refs/heads/rebased-replay` and requires exactly `3cd994f59031c303c4534df447719a2be899461d`, which stays permanently reachable as an ancestor of upstream main. It contains the authentic seventeen pre-rebase commits, including the old recipe target and the reader-path predecessor `dac1bf102cdee514badd82f48c587d6b2dbd06b8` that every earlier layer still verifies against, not synthetic reconstructions. It was created with `git bundle create rebased-replay.bundle refs/heads/rebased-replay --not 3cd994f59031c303c4534df447719a2be899461d` against a temporary ref, which was then deleted.

The two older bundles are preserved separately with their original checksums and prerequisites, and this capture compares their committed bytes against the pre-rebase head as well. Verification requires all three transports even with warm objects. Cold reads import objects only into an owned temporary object directory, never refs or the checkout Git database, and delete it in `finally`. Committed verification reads committed bundle bytes and works through a data URL with working-document reads forbidden. Historical verification still uses committed HEAD transport without changing historical proof rules: a revision on the pre-rebase line does not descend from `ff55b141`, so it never routes into this layer.
