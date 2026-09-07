# Task experience evidence archive

These seven documents are verbatim historical design inputs preserved from the original `research/` directory. Their instructions, approvals, source observations, issue states and validation receipts describe the original design sessions, not current execution instructions or implementation promises. The [RFC](../2026-09-05-agent-task-experience.md), including its final [governing amendments](../2026-09-05-agent-task-experience.md#governing-decision-record), governs the proposed contract where these inputs differ.

In particular, the original mockup M17 describes a polling watchdog and an already-exceeded spool limit. The amended RFC instead requires write-time enforcement before exceeding the hard cap. Historical requests to keep embedded frames identical do not override that correction. Earlier frame counts and approval receipts in the research are historical, not validation of this revision.

## Preserved inputs

- [Agreed product brief](2026-09-05-agent-task-experience-brief.md)
- [Complete terminal mockups](2026-09-05-agent-task-mockups.md)
- [Design notes and acceptance matrix](2026-09-05-agent-task-design-notes.md)
- [Runtime research](2026-09-05-agent-task-runtime.md)
- [Intercom research](2026-09-05-agent-task-intercom.md)
- [UI research](2026-09-05-agent-task-ui-research.md)
- [UI fidelity review](2026-09-06-agent-task-ui-fidelity.md)

## Historical references and availability

The original files retain their original relative links and literal paths to preserve their bytes. Links between the seven files resolve here. The following relocated or unavailable references need this explicit map:

| Original reference | Current location or limitation |
| --- | --- |
| `../specs/2026-09-05-agent-task-experience.md` in mockups and design notes | Relocated. Read the [RFC](../2026-09-05-agent-task-experience.md). The original relative URL does not resolve from this archive. |
| `../DEV_SETUP.md` in runtime research | Relocated. The repository's [DEV_SETUP.md](../../DEV_SETUP.md) is available; its current contents are not the historical source snapshot. |
| `web/2026-08-04-codex-inprocess-subagent-design.md` in runtime research | Historical background not included in this archive and unavailable through that relative URL. Its contents were not reverified for this preservation. |
| `research/web/2026-07-19-pi-subagent-supervisor-detach-deadlock-bun-ipc.md` in Intercom research | Historical background not included in this archive. Its contents were not reverified for this preservation. |
| `research/2026-09-05-agent-task-validation.md` and the independent validation report mentioned in design notes | Historical validation receipt not included in this archive. Do not treat its reported approvals as review of the amended RFC. |
| Original absolute worktree paths, `research/` paths, source paths, line ranges and commands in prose or code blocks | Historical locators at the recorded snapshots, not runnable instructions or guaranteed current-checkout locations. The seven archived inputs are linked above. Other local artifacts are not preserved or verified by this archive. |
| GitHub and DeepWiki URLs | External historical references, not fetched or reverified by this preservation. Availability and source claims remain subject to each document's stated limitations. |

This archive preserves the normative brief and full mockups without asserting that every transitive source is available or verified. Runtime behavior, cross-platform cleanup and current CI require separate validation.
