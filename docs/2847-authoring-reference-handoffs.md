# #2847 authoring-to-reference handoffs

PR #2971 review 3 identified missing direct reference exits after skill and extension authoring. This follow-up appends one `## Next steps` section to each of five reader pages. It changes no existing paragraph, example, table, caveat, route, navigation entry, or preservation artifact.

The reviewed predecessor is `8da40cc4ddb88b16baf8b4291722c6dabee8cfbb`. The launch baseline remains `59586efd26afd32a27c999ac8bcce102777e40e4`. All files under `docs/migrations/`, including the original ledger and both upstream reconciliation supplements, retain their predecessor bytes.

| Reader page | Added direct destinations |
| --- | --- |
| `skills/authoring.md` | Skill reference frontmatter and validation |
| `extensions/authoring.md` | Extension events and Extension API reference |
| `extensions/events.md` | Extension UI and the ExtensionContext reference |
| `extensions/ui.md` | Extension examples and Extension API reference |
| `extensions/examples.md` | Extension API reference |

## Precise additive accounting

`scripts/verify-docs-preservation.mjs` pins the five complete suffixes in `authoringReferenceAdditions`, including their headings, prose, link destinations, whitespace, and final newline. The working-tree verifier requires all five. Committed verification requires them for descendants of the reviewed predecessor, while the predecessor itself and older reconciliations retain their original rules.

The verifier removes only each exact required suffix before running the existing source, connective-content, and snapshot proofs. Its final byte comparison independently requires the prior expected bytes plus that exact suffix. Missing, altered, duplicated, relocated, or undisclosed text cannot pass. No source hash, destination map, normalization rule, original connective exception, or immutable snapshot was updated to admit these additions.

Navigation regression tests require direct article links, including the extension sequence's next-page links and the concrete reference anchors. Preservation negative controls remove or retarget each handoff and alter pre-existing content while retaining the handoff. These controls do not treat a sidebar or Reference-tab entry as a substitute for the article's next step.

Run the current verifier and its controls from the repository root:

```sh
node scripts/verify-docs-preservation.mjs --working-tree
node --test scripts/verify-docs-preservation.test.mjs
node scripts/verify-docs-preservation.mjs --committed HEAD
```
