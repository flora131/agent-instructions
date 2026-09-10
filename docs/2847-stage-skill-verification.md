# Stage-skill terminal verification

This active maintainer recipe is retained from `packages/coding-agent/docs/workflows/verification.md` at `c075c61a7dcae05a767db7372d991f421b3fc507`. The upstream guide at `7b2bf523216448ad4efb4b2e1c1e52fbcf0c2e12` now teaches general verification; this source-checkout procedure remains separate from that user-facing guide.

### Reproduce stage skill terminal evidence

From an Atomic source checkout, install dependencies with `npm ci --ignore-scripts` and run `npm run build`. With Node, Bun, tmux and a POSIX shell on PATH, run the committed driver:

```sh
node test/fixtures/stage-chat-skill-driver.mjs --evidence-dir /tmp/stage-skills-80 --columns 80 --rows 24
node test/fixtures/stage-chat-skill-driver.mjs --evidence-dir /tmp/stage-skills-48 --columns 48 --rows 16
```

Use a fresh evidence directory for each run; existing directories are refused. The driver executes `test/fixtures/stage-chat-skill-terminal.ts` directly with Bun, not `bun build`. No provider credentials are needed. It waits for the real editor to clear and the notice to render after each `/tasks` command before typing the next command, then verifies stage-local skill selection and invocation. Captures, assertions, render barriers and session events stay in the requested directory. Failures retain diagnostics and clean up the dedicated tmux session.

The small driver contract tests run in the normal unit suite. The actual tmux scenario is an explicit local verification command, not an automatic CI terminal test. This POSIX driver does not establish Windows coverage.
