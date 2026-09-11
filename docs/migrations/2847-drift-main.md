# #2847 / PR #2971: captured-main drift preservation

This is an additive sixth proof, not a replacement ledger. The immutable baseline remains `59586efd26afd32a27c999ac8bcce102777e40e4`. The complete prior replay is `fc2a511e6e6cf1f07053093b6c1a87a604d38702`; its selected main was `fadc434c561da387db764b53f41367fedf721a95`. The new captured main is `3cd994f59031c303c4534df447719a2be899461d`, not a claim about subsequently moving main. Twelve commits were replayed using `--rebase-merges`; their already-single-parent shape and earlier replay work remain intact.

## Exact source coverage and reader destinations

Twelve closed source spans reconstruct all eight changed upstream files completely. The full upstream file set and unchanged tree entries, including navigation and binary assets, must match. The JSON records exact old/new line ranges and hashes, reconstructed from Git rather than learned from reader snapshots.

- `compaction.md` per-model budget guidance, including its JSON example, exact-match keys, independent field fallback, validation, model-switch behavior and pi differences, lives verbatim in `compaction/reference.md` after the existing parameters explanation.
- `extensions.md` session-affinity paragraph lives in `extensions/api-reference.md` after `getApiKeyAndHeaders()` guidance. The complete Fireworks deferred-tool section lives in `extensions/authoring.md` before “Overriding Built-in Tools”, including SDK-only scope, loader naming and routing caveats.
- `intercom.md` receiving-message changes stay on the entry page. Its workflow-stage priority-input paragraph lives in `intercom/operations.md`, replacing the exact previous paragraph.
- Providers, settings, subagents, workflow builtins and workflow operations keep their source additions and replacements on those same reader pages. These include revised model preferences, exact per-model compaction settings, priority child messages and the complete Windows Postgres launcher guidance.

The verifier reverses these exact spans and the four reader repairs below, then runs the unchanged earlier rebase proof on both the immutable prior replay and restored current view. Forward reconstruction and reverse comparison cover every predecessor reader page, asset, navigation file, migration artifact, original bundle part and retained maintainer recipe byte. No updated destination hash can authorize unrelated changes or historical-only coverage of current guidance. All older ledgers and the original transport stay byte-identical.

## Four reader-only repairs

1. Before `## When compaction runs` on the compaction hub, insert exactly `### Per-model budgets`, a blank line, `Moved to [Compaction reference](/compaction/reference#per-model-budgets).`, and a blank line.
2. Before `### Overriding Built-in Tools` on the extensions hub, insert exactly `### Fireworks deferred tool loading`, a blank line, `Moved to [Writing extensions](/extensions/authoring#fireworks-deferred-tool-loading).`, and a blank line.
3. Change only the stage-skill recipe URL's commit from `d99113320267d1a6b6e5df284d2aee9743e0abf5` to its new replay counterpart `e59fd2cfa485d8798c31861e9d9920d96c072cc6`: `https://github.com/bastani-inc/atomic/blob/e59fd2cfa485d8798c31861e9d9920d96c072cc6/docs/2847-stage-skill-verification.md#reproduce-stage-skill-terminal-evidence`. Its full recipe bytes equal the prior replay. The old remote SHA becomes unreachable after force-push; the new URL uses a retained ancestor. Hosted URL availability remains a postpush obligation.
4. Correct the retained `workflows/authoring.md` external-traffic paragraph: Intercom is now priority input cancelling the current model call or cancellable tool in the same stage generation; completion notices still use native steering/follow-up. Cancellation and delivery wait inside the admitted reservation until the foreground owner's handshake completes or falls back. The remaining sibling ownership, terminal drain and structured-output caveats remain verbatim. This paragraph was unchanged upstream but contradicted the new dispatch contract in `packages/intercom/index-heavy.ts` and `workflow-stage-admission.ts`; exact before/after bytes are disclosed in the JSON and restored for the predecessor proof.

## Twelve replay counterparts

These are the exact matching-subject counterparts, oldest first. The extensions/intercom hub conflicts required subsequent reader repairs recorded above; this table does not claim pure tree equality before those repairs. The previous replay and its original-history bundle remain independently verifiable.

| Prior replay | New replay |
| --- | --- |
| `8847b56a45e7286d7780dfa9a21bbe8e2f97b3f2` | `95702d2834140ee84eb09ed2b540e38b24a74201` |
| `277545052a33ec554d67c838cd1ff1a4a68b46ec` | `d8480e2ae94a4cd2d29ee49a23db3ac51beeb4b1` |
| `c7c7bc4fe2195a59c204dbec453ab5714e3d127e` | `1a3f580ee0b87d1dc72811d1334e4368f0df183b` |
| `104c74b9cbfbfff59d6035756f0644a644b310f0` | `4cf8169362e7729f4f1834637a1e9a89c9ac8631` |
| `411f5cd563b2779bfe8f0a773c7119fc540b5435` | `93fae28039023b1c80d02deee09094c3bc67f98a` |
| `d6bf6c4b44536479c669083d9dd46be661ee734f` | `0a86fff38e4c8459f9bdf131476ae45128537f31` |
| `d99113320267d1a6b6e5df284d2aee9743e0abf5` | `e59fd2cfa485d8798c31861e9d9920d96c072cc6` |
| `e035c96571d7c0eef132665e55566ea1a6afba88` | `e8519590aa3296b09cdc02d37cddf4ddb796bf92` |
| `fd339f3357943753c66fa1e9309b83724ada6b33` | `2196f63a08db6202c5d83fc550671535821cc06f` |
| `edcbfda41b54d90a713f0fbcef654c37334cf8d3` | `4a26df3498b5917c2d8bfaa05027f0e7ae5a888e` |
| `16a4224e6191b1ce113dc4d774a1b0b43dc0ec36` | `5212f6b0fc36f18e7a45dbed61d7afa4cec92aea` |
| `fc2a511e6e6cf1f07053093b6c1a87a604d38702` | `afaadb6b45c71ae7c34019b09983f060bc03d0ff` |

## Supplemental authentic history transport

Concatenate `test/fixtures/docs-preservation-history/prior-replay.bundle.part-1` through `.part-4` in order. The authentic Git bundle is 1913250 bytes, SHA-256 `b5b44c8c9994d603e4823c3d4107843921954031191538346be938d6c355992c`. Part sizes are 480000, 480000, 480000 and 473250 bytes; exact per-part checksums are in the supplemental JSON and verifier.

It advertises `fc2a511e6e6cf1f07053093b6c1a87a604d38702 refs/heads/prior-replay` and requires exactly `fadc434c561da387db764b53f41367fedf721a95`. It contains the authentic twelve prior replay commits, including the old recipe target, not synthetic reconstructions. It was created in a disposable bare repository with the existing object database as a read-only alternate, using `git bundle create prior-replay.bundle refs/heads/prior-replay ^fadc434c561da387db764b53f41367fedf721a95`. The old two-part original-local-history bundle is preserved separately, with its original checksum and prerequisites.

Verification requires both transports even with warm objects. Cold reads import objects only into an owned temporary object directory, never refs or the checkout Git database, and delete it in `finally`. Committed verification reads committed bundle bytes and works through a data URL with working-document reads forbidden. Historical verification can still use committed HEAD transport without changing historical proof rules.
