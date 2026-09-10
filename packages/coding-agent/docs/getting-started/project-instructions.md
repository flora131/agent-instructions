---
title: Project instructions
description: Give Atomic durable, repository-specific instructions with AGENTS.md.
---

# Project instructions

**Outcome:** Atomic loads your repository's conventions automatically in every session.

**Prerequisites:** [First session](/getting-started/first-session) is complete.

## Give Atomic project instructions

Atomic loads context files at startup. Add an `AGENTS.md` file to tell it how to work in a project:

```markdown
# Project Instructions

- Run `bun run typecheck` after code changes.
- Do not run production migrations locally.
- Keep responses concise.
```

Atomic loads:

- `~/.atomic/agent/AGENTS.override.md`, `AGENTS.md`, or `CLAUDE.md` for global instructions (legacy `~/.pi/agent/` also works)
- `AGENTS.override.md`, `AGENTS.md`, or `CLAUDE.md` from parent directories and the current directory

An `AGENTS.override.md` file replaces the other context files in its directory. Restart Atomic, or run `/reload`, after changing context files.

## Verify Atomic loaded them

With `AGENTS.md` saved, run `/reload` (or restart Atomic), then ask:

```text
What project instructions are you following in this repository?
```

Expected result: the answer restates your own rules — the `bun run typecheck` line above, or whatever you wrote — rather than generic advice. A generic answer means the file was not picked up: confirm it is named `AGENTS.md`, that it sits in the directory you started Atomic from or one of its parents, and that no `AGENTS.override.md` in the same directory is replacing it.

## Next step

Continue to [Interactive use](/usage), then [Configuration](/guides/configuration).
