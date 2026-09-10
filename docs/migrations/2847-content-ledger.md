# Content ledger — bastani-inc/atomic#2847

This is the human summary of the no-content-loss record for the Learn / Build / Reference information-architecture migration. The record is kept as two files, deliberately separated:

- **`2847-baseline-inventory.json`** — the Phase 1 guardrail. Every field in it is derived from the immutable launch baseline commit and nothing else: the block, route, public-entry-point, anchor, link, image, and repository-reference inventories. No field is read from, or can be influenced by, the migrated working tree. `test/unit/docs-information-architecture.test.ts` rebuilds the whole file from that commit with `git show` and asserts equality, so its independence is mechanically checked rather than asserted in prose.
- **`2847-destination-map.json`** — the post-move record. It holds every field that requires the migrated tree — destination path, anchor, occurrence, status, verification mode, and the link retargets — keyed by the baseline id it maps.

**Disclosure:** the baseline inventory was **reconstructed after the content moved**. It is byte-reproducible from an immutable commit, and the migration's losslessness is verified against it block by block, but reproducibility from that commit is not the same as the file having been authored before the move. This is stated here rather than only in the run notes.

Nothing in either file is trusted on its own: the contract test re-reads every source block from the baseline commit and re-hashes every destination.

- **Baseline revision:** `59586efd26afd32a27c999ac8bcce102777e40e4`
- **Hash normalization:** `2847-v1`
- **Baseline pages:** 44
- **Baseline public entry points:** 47
- **Heading-delimited blocks:** 1038
- **Blocks kept on their source page:** 658
- **Blocks moved to a child page:** 380
- **Blocks with no destination:** 0
- **Blocks marked for deletion:** 0
- **Baseline repository references:** 614

> Derived exclusively from the baseline commit named above. No field in this file is read from, or influenced by, the migrated working tree, and test/unit/docs-information-architecture.test.ts regenerates the whole file from that commit and asserts byte equality. It was reconstructed after the content moved; reconstructibility from an immutable commit is not the same as having been authored before the move.

## Public entry points

Page count and public-route count are deliberately separate: a page count cannot represent the canonical route or a redirect, and both existed at the baseline.

| Kind | Count | Entries |
| --- | --- | --- |
| `page` | 44 | one per baseline Markdown/MDX file, including `/index` |
| `canonical` | 1 | `/`, served by `index.md` |
| `redirect` | 2 | `/session` → `/session-format`, `/tree` → `/sessions` |

Mintlify redirect sources cannot carry a fragment, which is why every moved fragment is covered by a compatibility heading rather than a redirect.

## Tracked separately

| Element | Baseline count |
| --- | --- |
| Code fences | 835 |
| Technical tables | 132 |
| Callouts and blockquotes | 34 |
| Heading anchors | 1023 |
| Internal links | 422 |
| Image references | 6 |

Every one of those elements travels inside the block that contains it, so a block
with exactly one destination carries its fences, tables, and callouts with it.
The per-block counts are in `2847-baseline-inventory.json`.

## Block classification

| Class | Blocks | Meaning |
| --- | --- | --- |
| `substantive` | 988 | Prose, examples, tables, callouts, caveats, API detail. Must have exactly one destination and must not be deleted. |
| `navigation` | 50 | Hand-written tables of contents and heading-only scaffolding. Retained in place in this migration; none were removed. |

## Verification modes

| Mode | Blocks | What the test proves |
| --- | --- | --- |
| `exact-hash` | 1030 | The destination block, located by its exact anchor, re-hashes to the baseline block's hash under `2847-v1` normalization. |
| `ordered-body-containment` | 8 | The destination gained connective text, so every baseline body line must still appear there in order and with the same multiplicity. Additions are permitted; deletion and reordering are not. |

### The connective-text exceptions, in full

| Ledger ID | Destination | Explanation |
| --- | --- | --- |
| `containerization::001` | `containerization.md#containerization` | connective text was added inside this block; every baseline body line is still present at the destination, in order and with the same multiplicity. No baseline line was removed. |
| `prompt-templates::002` | `prompt-templates.md#prompt-templates` | connective text was added inside this block; every baseline body line is still present at the destination, in order and with the same multiplicity. No baseline line was removed. |
| `quickstart::001` | `quickstart.md#quickstart` | connective text was added inside this block; every baseline body line is still present at the destination, in order and with the same multiplicity. No baseline line was removed. |
| `quickstart::029` | `quickstart.md#next-steps` | connective text was added inside this block; every baseline body line is still present at the destination, in order and with the same multiplicity. No baseline line was removed. |
| `sdk::001` | `sdk.md#None` | frontmatter was added above the preamble to supply the navigation label #2847 specifies; every baseline line is still present at the destination, in order and with the same multiplicity. No baseline line was removed. |
| `skills::004` | `skills.md#locations` | connective text was added inside this block; every baseline body line is still present at the destination, in order and with the same multiplicity. No baseline line was removed. |
| `tui::001` | `tui.md#None` | frontmatter was added above the preamble to supply the navigation label #2847 specifies; every baseline line is still present at the destination, in order and with the same multiplicity. No baseline line was removed. |
| `usage::011` | `reference/cli.md#cli-reference` | connective text was added inside this block; every baseline body line is still present at the destination, in order and with the same multiplicity. No baseline line was removed. |

This set is closed: the contract test asserts these eight IDs exactly, so a ninth
cannot be created by relabelling a row.

### Live anchor corrections

Four live reader citations named anchors that never resolved: three carry github-slugger shapes Mintlify never generated, and one named a section that moved to a child page. Repairing them changes a baseline line, which a route retarget does not, so each correction is recorded here and in `2847-destination-map.json`. The destination check applies exactly these corrections to the baseline block before hashing, so any unrecorded byte change still fails.

| Ledger ID | Source | Baseline target | Corrected target | Why |
| --- | --- | --- | --- | --- |
| `providers::002` | `providers.md:12` | `#llamacpp` | `#llama-cpp` | github-slugger deletes the dot; Mintlify 4.2.731 maps it to a separator, so only #llama-cpp resolves |
| `models::001` | `models.md:7` | `/settings#model--thinking` | `/settings#model-&-thinking` | github-slugger deletes the ampersand and doubles the separator; Mintlify preserves `&` |
| `changelog::002` | `changelog.mdx:11` | `/extensions#ctxmodelregistry--ctxmodel--ctxscopedmodels` | `/extensions/api-reference#ctx-modelregistry-/-ctx-model-/-ctx-scopedmodels` | the section moved to the extension API reference and its Mintlify id keeps `/` and maps `.` to `-` |

The fourth citation, `packages/coding-agent/README.md:82`, is not a ledger block, so it is recorded as a retargeted repository reference instead.

### Duplicate baseline blocks

Two baseline blocks share a normalized hash. Each claims a distinct destination occurrence, because Mintlify numbers repeated headings page-wide and a pointer that drops the `-N` suffix silently resolves to the wrong content.

| Ledger ID | Baseline heading | Destination | Occurrence |
| --- | --- | --- | --- |
| `rpc::005` | `Commands` | `rpc/protocol.md#commands` | 1 |
| `rpc::048` | `Commands` | `rpc/protocol.md#commands-2` | 2 |

## Repository references

Every baseline reference to a coding-agent docs path or a published `docs.bastani.ai` route, each with exactly one disposition. New references may be added; no baseline reference may disappear silently.

| Disposition | Count | Meaning |
| --- | --- | --- |
| `fixture` | 1 | test fixture input |
| `historical` | 272 | an immutable released-changelog reference, resolved against its release tag |
| `other-doc-tree` | 27 | the repository-root `docs/` tree or another package's docs, outside this migration |
| `placeholder` | 22 | a synthetic path such as `docs/foo.md`, never a real page |
| `retargeted` | 9 | the migration pointed this reference at a new destination |
| `unchanged` | 283 | the baseline target is still named and still resolves |

| Category | Count |
| --- | --- |
| `changelog` | 288 |
| `example` | 3 |
| `prompt` | 16 |
| `readme` | 112 |
| `script` | 49 |
| `skill` | 1 |
| `source` | 41 |
| `test` | 104 |

### Live reference retargets

A compatibility heading keeps an old anchor resolving, so a stale citation passes every existence check while still landing the reader on a `Moved to …` stub. These citations were pointed at the page that holds the content. Every rewrite changes the route prefix only — the fragment is untouched — so under `2847-v1` normalization no block hash moves.

- **Docs-internal links retargeted:** 101
- **Live references outside the docs tree retargeted:** 9
- **Recorded exceptions:** 1

| Page | Line | Baseline target | Destination |
| --- | --- | --- | --- |
| `changelog.mdx` | 10 | `/usage#credential-commands` | `/reference/cli#credential-commands` |
| `changelog.mdx` | 12 | `/custom-provider#stop-reasons` | `/custom-provider/streaming#stop-reasons` |
| `changelog.mdx` | 12 | `/providers#stop-reasons` | `/providers/reference#stop-reasons` |
| `changelog.mdx` | 21 | `/extensions#constrained-sampling` | `/extensions/authoring#constrained-sampling` |
| `changelog.mdx` | 21 | `/models#constrained-tool-sampling` | `/models/reference#constrained-tool-sampling` |
| `changelog.mdx` | 21 | `/rpc#get_available_models` | `/rpc/protocol#get_available_models` |
| `changelog.mdx` | 22 | `/custom-provider#oauth-support` | `/custom-provider/oauth#oauth-support` |
| `changelog.mdx` | 23 | `/models#catalog-freshness-and-precedence` | `/models/reference#catalog-freshness-and-precedence` |
| `changelog.mdx` | 24 | `/rpc#bash` | `/rpc/protocol#bash` |
| `changelog.mdx` | 45 | `/custom-provider#usage-and-cost` | `/custom-provider/streaming#usage-and-cost` |
| `changelog.mdx` | 45 | `/models#request-wide-cost-tiers` | `/models/reference#request-wide-cost-tiers` |
| `compaction/reference.md` | 21 | `/models#preserved-thinking-and-model-switches` | `/models/reference#preserved-thinking-and-model-switches` |
| `custom-provider.md` | 38 | `#override-existing-provider` | `/custom-provider/override#override-existing-provider` |
| `custom-provider.md` | 39 | `#register-new-provider` | `/custom-provider/registration#register-new-provider` |
| `custom-provider.md` | 40 | `#unregister-provider` | `/custom-provider/registration#unregister-provider` |
| `custom-provider.md` | 41 | `#oauth-support` | `/custom-provider/oauth#oauth-support` |
| `custom-provider.md` | 42 | `#custom-streaming-api` | `/custom-provider/streaming#custom-streaming-api` |
| `custom-provider.md` | 44 | `#config-reference` | `/custom-provider/api-reference#config-reference` |
| `custom-provider.md` | 45 | `#model-definition-reference` | `/custom-provider/api-reference#model-definition-reference` |
| `custom-provider/api-reference.md` | 143 | `/extensions#constrained-sampling` | `/extensions/authoring#constrained-sampling` |
| `custom-provider/streaming.md` | 200 | `/models#request-wide-cost-tiers` | `/models/reference#request-wide-cost-tiers` |
| `environment-variables.md` | 46 | `/rpc#bash` | `/rpc/protocol#bash` |
| `environment-variables.md` | 46 | `/usage#environment-variables` | `/reference/cli#environment-variables` |
| `extensions.md` | 52 | `#writing-an-extension` | `/extensions/authoring#writing-an-extension` |
| `extensions.md` | 53 | `#extension-styles` | `/extensions/authoring#extension-styles` |
| `extensions.md` | 54 | `#events` | `/extensions/events#events` |
| `extensions.md` | 55 | `#lifecycle-overview` | `/extensions/events#lifecycle-overview` |
| `extensions.md` | 56 | `#resource-events` | `/extensions/events#resource-events` |
| `extensions.md` | 57 | `#session-events` | `/extensions/events#session-events` |
| `extensions.md` | 58 | `#agent-events` | `/extensions/events#agent-events` |
| `extensions.md` | 59 | `#model-events` | `/extensions/events#model-events` |
| `extensions.md` | 60 | `#tool-events` | `/extensions/events#tool-events` |
| `extensions.md` | 61 | `#extensioncontext` | `/extensions/api-reference#extensioncontext` |
| `extensions.md` | 62 | `#extensioncommandcontext` | `/extensions/api-reference#extensioncommandcontext` |
| `extensions.md` | 63 | `#extensionapi-methods` | `/extensions/api-reference#extensionapi-methods` |
| `extensions.md` | 64 | `#state-management` | `/extensions/authoring#state-management` |
| `extensions.md` | 65 | `#session-scoped-in-memory-state` | `/extensions/authoring#session-scoped-in-memory-state` |
| `extensions.md` | 66 | `#custom-tools` | `/extensions/authoring#custom-tools` |
| `extensions.md` | 67 | `#custom-ui` | `/extensions/ui#custom-ui` |
| `extensions.md` | 68 | `#error-handling` | `/extensions/api-reference#error-handling` |
| `extensions.md` | 70 | `#examples-reference` | `/extensions/examples#examples-reference` |
| `extensions.md` | 122 | `/tui#host-native-session-picker` | `/tui/reference#host-native-session-picker` |
| `extensions.md` | 124 | `/tui#host-native-input-form` | `/tui/reference#host-native-input-form` |
| `extensions/api-reference.md` | 15 | `/extensions#custom-ui` | `/extensions/ui#custom-ui` |
| `extensions/api-reference.md` | 19 | `/rpc#extension-ui-protocol` | `/rpc/extension-ui#extension-ui-protocol` |
| `extensions/api-reference.md` | 468 | `/extensions#events` | `/extensions/events#events` |
| `extensions/api-reference.md` | 472 | `/extensions#custom-tools` | `/extensions/authoring#custom-tools` |
| `extensions/api-reference.md` | 753 | `/extensions#custom-ui` | `/extensions/ui#custom-ui` |
| `extensions/api-reference.md` | 877 | `/extensions#session-scoped-in-memory-state` | `/extensions/authoring#session-scoped-in-memory-state` |
| `extensions/authoring.md` | 351 | `/models#constrained-tool-sampling` | `/models/reference#constrained-tool-sampling` |
| `extensions/authoring.md` | 351 | `/rpc#get_available_models` | `/rpc/protocol#get_available_models` |
| `index.md` | 46 | `/quickstart#release-archive` | `/getting-started/installation#release-archive` |
| `intercom.md` | 41 | `#how-connection-works` | `/intercom/operations#how-connection-works` |
| `intercom.md` | 42 | `#the-intercom-tool` | `/intercom/reference#the-intercom-tool` |
| `intercom.md` | 43 | `#actions` | `/intercom/reference#actions` |
| `intercom.md` | 44 | `#targeting-sessions-and-pending-workflow-stages` | `/intercom/reference#targeting-sessions-and-pending-workflow-stages` |
| `intercom.md` | 45 | `#deferred-delivery-to-pending-stages` | `/intercom/reference#deferred-delivery-to-pending-stages` |
| `intercom.md` | 46 | `#send-vs-ask-vs-reply` | `/intercom/reference#send-vs-ask-vs-reply` |
| `intercom.md` | 47 | `#attachments` | `/intercom/reference#attachments` |
| `intercom.md` | 54 | `#workflow-and-subagent-notifications` | `/intercom/operations#workflow-and-subagent-notifications` |
| `intercom.md` | 55 | `#workflow-delivery-modes` | `/intercom/operations#workflow-delivery-modes` |
| `intercom.md` | 56 | `#subagent-control-notices` | `/intercom/operations#subagent-control-notices` |
| `intercom.md` | 57 | `#delivery-ordering` | `/intercom/operations#delivery-ordering` |
| `intercom.md` | 58 | `#configuration` | `/intercom/reference#configuration` |
| `intercom.md` | 59 | `#keyboard-shortcuts` | `/intercom/operations#keyboard-shortcuts` |
| `intercom.md` | 60 | `#how-it-works` | `/intercom/operations#how-it-works` |
| `intercom.md` | 62 | `#limitations` | `/intercom/operations#limitations` |
| `models.md` | 25 | `#supported-apis` | `/models/reference#supported-apis` |
| `models.md` | 26 | `#provider-configuration` | `/models/reference#provider-configuration` |
| `models.md` | 27 | `#model-configuration` | `/models/reference#model-configuration` |
| `models.md` | 28 | `#request-wide-cost-tiers` | `/models/reference#request-wide-cost-tiers` |
| `models.md` | 29 | `#overriding-built-in-providers` | `/models/reference#overriding-built-in-providers` |
| `models.md` | 30 | `#per-model-overrides` | `/models/reference#per-model-overrides` |
| `models.md` | 31 | `#derived-fast-model-variants` | `/models/reference#derived-fast-model-variants` |
| `models.md` | 32 | `#anthropic-messages-compatibility` | `/models/reference#anthropic-messages-compatibility` |
| `models.md` | 33 | `#openai-compatibility` | `/models/reference#openai-compatibility` |
| `models/model-selection.md` | 75 | `/models#preserved-thinking-and-model-switches` | `/models/reference#preserved-thinking-and-model-switches` |
| `packages.md` | 23 | `#creating-an-atomic-package` | `/packages/authoring#creating-an-atomic-package` |
| `packages.md` | 24 | `#gallery-metadata` | `/packages/authoring#gallery-metadata` |
| `packages.md` | 25 | `#package-structure` | `/packages/authoring#package-structure` |
| `packages.md` | 26 | `#convention-directories` | `/packages/authoring#convention-directories` |
| `packages.md` | 27 | `#dependencies` | `/packages/authoring#dependencies` |
| `packages.md` | 28 | `#package-filtering` | `/packages/reference#package-filtering` |
| `packages.md` | 30 | `#scope-and-deduplication` | `/packages/reference#scope-and-deduplication` |
| `packages.md` | 55 | `/quickstart#uninstall` | `/getting-started/installation#uninstall` |
| `providers.md` | 17 | `#stop-reasons` | `/providers/reference#stop-reasons` |
| `providers.md` | 18 | `#resolution-order` | `/providers/reference#resolution-order` |
| `providers.md` | 137 | `/models#catalog-freshness-and-precedence` | `/models/reference#catalog-freshness-and-precedence` |
| `reference/cli.md` | 34 | `/quickstart#uninstall` | `/getting-started/installation#uninstall` |
| `sdk.md` | 60 | `#model-catalog-persistence-and-refresh` | `/sdk/reference#model-catalog-persistence-and-refresh` |
| `sdk/reference.md` | 280 | `/extensions#constrained-sampling` | `/extensions/authoring#constrained-sampling` |
| `sdk/reference.md` | 280 | `/rpc#get_available_models` | `/rpc/protocol#get_available_models` |
| `skills.md` | 21 | `#skill-structure` | `/skills/authoring#skill-structure` |
| `skills.md` | 22 | `#frontmatter` | `/skills/reference#frontmatter` |
| `skills.md` | 23 | `#validation` | `/skills/reference#validation` |
| `skills.md` | 24 | `#example` | `/skills/authoring#example` |
| `themes.md` | 16 | `#theme-format` | `/themes/reference#theme-format` |
| `themes.md` | 17 | `#color-tokens` | `/themes/reference#color-tokens` |
| `themes.md` | 18 | `#color-values` | `/themes/reference#color-values` |
| `themes.md` | 73 | `#color-tokens` | `/themes/reference#color-tokens` |
| `windows.md` | 23 | `/quickstart#package-managers` | `/getting-started/installation#package-managers` |

#### Exceptions, with written justification

- `workflows/authoring.md:161` keeps `/extensions#events` rather than `/extensions/events#events`.
  #2847 forbids restructuring the workflow pages and this file is byte-identical to the launch baseline. The link still resolves through the preserved `## Events` compatibility heading on /extensions, so the cost is one extra hop on a page the acceptance contract freezes.

### Retargeted references

| File | Line | Baseline target | Destination |
| --- | --- | --- | --- |
| `packages/coding-agent/README.md` | 82 | `docs/index.md#alpine-and-musl-linux-archives` | `docs/getting-started/installation.md#alpine-and-musl-linux-archives` |
| `packages/coding-agent/README.md` | 141 | `docs/rpc.md#get_available_models` | `docs/rpc/protocol.md#get_available_models` |
| `packages/coding-agent/README.md` | 141 | `docs/extensions.md#constrained-sampling` | `docs/extensions/authoring.md#constrained-sampling` |
| `packages/workflows/README.md` | 106 | `../coding-agent/docs/extensions.md#events` | `../coding-agent/docs/extensions/events.md#events` |
| `packages/workflows/src/extension/workflow-prompts.ts` | 66 | `packages/coding-agent/docs/extensions.md#events` | `packages/coding-agent/docs/extensions/events.md#events` |
| `test/unit/execution-routing-guidance.test.ts` | 897 | `packages/coding-agent/docs/intercom.md` | `packages/coding-agent/docs/intercom/reference.md` |
| `test/unit/workflow-authoring-folder-disclosure.test.ts` | 31 | `packages/coding-agent/docs/quickstart.md` | `packages/coding-agent/docs/getting-started/first-session.md` |
| `test/unit/workflow-extension-hook-guidance.test.ts` | 38 | `packages/coding-agent/docs/extensions.md#events` | `packages/coding-agent/docs/extensions/events.md#events` |
| `test/unit/workflow-stage-guidance-docs.test.ts` | 15 | `packages/coding-agent/docs/intercom.md` | `packages/coding-agent/docs/intercom/reference.md` |

## Per-page disposition

| Source page | Blocks | Kept | Moved | Destinations |
| --- | --- | --- | --- | --- |
| `changelog.mdx` | 15 | 15 | 0 | — |
| `compaction.md` | 30 | 18 | 12 | `compaction/reference.md` |
| `containerization.md` | 5 | 5 | 0 | — |
| `custom-provider.md` | 24 | 5 | 19 | `custom-provider/api-reference.md`, `custom-provider/oauth.md`, `custom-provider/override.md`, `custom-provider/registration.md`, `custom-provider/streaming.md` |
| `development.md` | 10 | 10 | 0 | — |
| `environment-variables.md` | 5 | 5 | 0 | — |
| `extensions.md` | 126 | 9 | 117 | `extensions/api-reference.md`, `extensions/authoring.md`, `extensions/events.md`, `extensions/examples.md`, `extensions/ui.md` |
| `index.md` | 9 | 3 | 6 | `build.md`, `guides.md`, `reference.md` |
| `intercom.md` | 31 | 15 | 16 | `intercom/operations.md`, `intercom/reference.md` |
| `json.md` | 5 | 5 | 0 | — |
| `keybindings.md` | 18 | 18 | 0 | — |
| `llama-cpp.md` | 5 | 5 | 0 | — |
| `models.md` | 23 | 5 | 18 | `models/reference.md` |
| `models/artificial-analysis-index.md` | 11 | 11 | 0 | — |
| `models/model-selection.md` | 8 | 8 | 0 | — |
| `models/pareto-efficiency.md` | 8 | 8 | 0 | — |
| `packages.md` | 16 | 9 | 7 | `packages/authoring.md`, `packages/reference.md` |
| `prompt-templates.md` | 8 | 8 | 0 | — |
| `providers.md` | 27 | 25 | 2 | `providers/reference.md` |
| `quickstart.md` | 29 | 9 | 20 | `getting-started/authentication.md`, `getting-started/first-session.md`, `getting-started/installation.md`, `getting-started/project-instructions.md` |
| `rpc.md` | 88 | 5 | 83 | `rpc/examples.md`, `rpc/extension-ui.md`, `rpc/protocol.md` |
| `sdk.md` | 40 | 15 | 25 | `sdk/reference.md` |
| `security.md` | 6 | 6 | 0 | — |
| `session-format.md` | 34 | 34 | 0 | — |
| `sessions.md` | 14 | 13 | 1 | `compaction.md` |
| `settings.md` | 27 | 25 | 2 | `guides/configuration.md` |
| `shell-aliases.md` | 1 | 1 | 0 | — |
| `skills.md` | 18 | 11 | 7 | `skills/authoring.md`, `skills/reference.md` |
| `subagents.md` | 16 | 13 | 3 | `subagents/authoring.md`, `subagents/reference.md` |
| `terminal-setup.md` | 13 | 12 | 1 | `usage.md` |
| `termux.md` | 10 | 10 | 0 | — |
| `themes.md` | 22 | 9 | 13 | `themes/reference.md` |
| `tmux.md` | 5 | 5 | 0 | — |
| `tools.md` | 5 | 5 | 0 | — |
| `tools/edit.md` | 18 | 18 | 0 | — |
| `tui.md` | 41 | 26 | 15 | `tui/reference.md` |
| `usage.md` | 24 | 11 | 13 | `reference/cli.md` |
| `windows.md` | 7 | 7 | 0 | — |
| `workflows.md` | 4 | 4 | 0 | — |
| `workflows/api-reference.md` | 91 | 91 | 0 | — |
| `workflows/authoring.md` | 18 | 18 | 0 | — |
| `workflows/builtins.md` | 10 | 10 | 0 | — |
| `workflows/operations.md` | 21 | 21 | 0 | — |
| `workflows/reliable-design.md` | 92 | 92 | 0 | — |

## Baseline routes

Every route below still resolves after the migration; none were renamed and no
redirect was added. The frozen list is asserted by
`test/unit/docs-information-architecture.test.ts`.

- `/changelog`
- `/compaction`
- `/containerization`
- `/custom-provider`
- `/development`
- `/environment-variables`
- `/extensions`
- `/index`
- `/intercom`
- `/json`
- `/keybindings`
- `/llama-cpp`
- `/models`
- `/models/artificial-analysis-index`
- `/models/model-selection`
- `/models/pareto-efficiency`
- `/packages`
- `/prompt-templates`
- `/providers`
- `/quickstart`
- `/rpc`
- `/sdk`
- `/security`
- `/session-format`
- `/sessions`
- `/settings`
- `/shell-aliases`
- `/skills`
- `/subagents`
- `/terminal-setup`
- `/termux`
- `/themes`
- `/tmux`
- `/tools`
- `/tools/edit`
- `/tui`
- `/usage`
- `/windows`
- `/workflows`
- `/workflows/api-reference`
- `/workflows/authoring`
- `/workflows/builtins`
- `/workflows/operations`
- `/workflows/reliable-design`
