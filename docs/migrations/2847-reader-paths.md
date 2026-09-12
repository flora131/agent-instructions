# Reader learning paths — supplemental record (#2847, PR #2971)

This is the seventh capture in the #2847 preservation record and the first one that is not a
reconciliation with upstream `main`. It covers the reviewed navigation pass: the flat Learn `Guides`
group becomes five reader-intent groups, Build's single `Customization` group splits by verb, Herdr
moves into the existing `Reference > Platform setup` group beside tmux, and four short Learn
orientation pages are added.

**Nothing moved and nothing was deleted.** Every earlier proof still runs. The machine-readable
record is [`2847-reader-paths.json`](./2847-reader-paths.json); this file explains it.

## Why this record has a different shape

The earlier captures reconcile two immutable commits, so both sides of every edit reconstruct from
Git. This pass has no second immutable source: the "after" side is this branch's own edit. So the
manifest **declares** each exact before/after, `scripts/verify-docs-preservation.mjs` pins the
manifest and this file by digest, and the working tree must equal predecessor-plus-declared-edits
byte for byte. Editing the manifest alone cannot widen what is allowed, because the pinned digests
live in the script; editing both still cannot hide a change, because every declared edit must pass a
closed-set kind check that no content-dropping edit can satisfy.

- **Predecessor:** `dac1bf102cdee514badd82f48c587d6b2dbd06b8`
- **Frozen file set:** every path under `packages/coding-agent/docs/` and `docs/migrations/` at that
  commit must still exist, byte-identical apart from the declared edits. Deleting a page, renaming
  one, or adding an undeclared file fails.

## What changed

| Kind | Files | What the verifier proves about it |
| --- | --- | --- |
| `navigation-restructure` | `docs.json` | Every page entry present before is present exactly once after; the only new entries are this pass's four added pages; the three reader tabs are unchanged; nothing outside `navigation` changed. |
| `frontmatter-label` | `background-tasks.md`, `packages.md` | The edit touches `title`/`description`/`sidebarTitle` frontmatter scalars only. Any prose riding along fails. |
| `latex-escape` | `models/evals.md`, `models/model-selection.md`, `models/pareto-efficiency.md` | The *only* difference is the added backslash: `after.replaceAll("\\$", "$") === before`. No number, table cell, or caveat can change under this kind. |

## Route and fragment compatibility

`/background-tasks` keeps its route and every fragment: only its navigation label changed, to
"Background and parallel work", because the old label implied non-interactive execution. Its page
heading and anchors are untouched, so `/background-tasks#choose-how-long-to-wait` and its siblings
still resolve. `/herdr` also keeps its route; only its group moved.

## Why the currency signs were escaped

Mintlify's MDX pipeline parses `$…$` as inline math. Two price pairs in one inline context therefore
became a math span, and when that span contained a `%`, strict mode warned: `% comment has no
terminating newline; LaTeX would fail because of commenting the end of math mode [commentAtEnd]`.
Escaping the delimiters renders the same visible text and removes the warning without disabling
strict mode.

Sixteen delimiters on five lines are escaped, because the inline context that pairs them is narrower
than a page: a GitHub-flavoured table cell, a list item, and a paragraph each pair their own `$`
runs. The five lines are `models/evals.md` 29 and 112, `models/model-selection.md` 92, and
`models/pareto-efficiency.md` 26 and 32 — every context under `packages/coding-agent/docs/` whose
math span contained a `%`. Price spans with no `%` in them emit no warning and are left alone.
