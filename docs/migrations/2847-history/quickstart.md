# Historical quickstart documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: quickstart::002 -->

Source: `packages/coding-agent/docs/quickstart.md` lines 5–10 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/quickstart.md#prerequisites`.

## Prerequisites

- **Package install:** Node.js 22.19 or newer plus npm, pnpm, Yarn, or Bun. Use Bun 1.4.0+ for Bun installs or workflow-authoring examples.
- **Release archive install:** macOS and Linux need `tar` and either `curl` or `wget`; Windows uses built-in PowerShell commands. This path does not need Node.js or a package manager.
- **Model-provider access** — use a supported subscription login or API key. Run `/login` after startup.

<!-- baseline-block: quickstart::004 -->

Source: `packages/coding-agent/docs/quickstart.md` lines 13–34 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/getting-started/installation.md#package-managers`.

### Package managers

Install with npm:

```bash
npm install -g @bastani/atomic
```

With pnpm:

```bash
pnpm add -g @bastani/atomic
```

With Bun:

```bash
bun add -g @bastani/atomic
```

Atomic does not require package install scripts. Add `--ignore-scripts` if you want to disable dependency lifecycle scripts during a package install.

<!-- baseline-block: quickstart::011 -->

Source: `packages/coding-agent/docs/quickstart.md` lines 91–106 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/getting-started/installation.md#alpine-and-musl-linux-archives`.

### Alpine and musl Linux archives

The shell installer detects Alpine and selects `atomic-linux-x64-musl.tar.gz` or `atomic-linux-arm64-musl.tar.gz`. Each archive includes its matching native search and PTY bindings plus payload-local `libgcc` and `libstdc++` runtimes, so stock Alpine needs no runtime package install.

Two features work differently on musl:

- **Clipboard:** the musl archives omit a clipboard native binding because `@mariozechner/clipboard` 0.3.9 publishes metadata-only musl stubs without a `.node` payload; Atomic uses Linux clipboard commands and OSC52 fallback instead.
- **Durable workflows:** the archives omit the glibc-linked `@embedded-postgres/*` binary packages, so durable workflows on Alpine require external Postgres via `DBOS_SYSTEM_DATABASE_URL` or Docker. Without a durable backend, Atomic uses a loud non-durable in-memory fallback.

Then start Atomic in the project directory you want it to work on:

```bash
cd /path/to/project
atomic
```

<!-- baseline-block: quickstart::019 -->

Source: `packages/coding-agent/docs/quickstart.md` lines 230–249 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/getting-started/first-session.md#top-skills-to-invoke-directly`.

### Top skills to invoke directly

Skills are reusable expert instructions. Trigger one with `/skill:<name>` followed by a request:

| Skill | When to use | Example |
|---|---|---|
| `research-codebase` | Scoped research that writes a grounded artifact for one subsystem or question. | `/skill:research-codebase how the rate limiter works in src/middleware/` |
| `create-spec` | Turn research into an implementation-ready plan. | `/skill:create-spec from research/docs/2026-03-rate-limit.md` |
| `prompt-engineer` | Create, optimize, evaluate, or troubleshoot prompts for GPT-5.6, Claude Opus 5, and Claude Fable 5. | `/skill:prompt-engineer Draft a sharper repo-research prompt for payment retries end to end.` |
| `tdd` | Test-first feature or bug work. | `/skill:tdd` |
| `impeccable` | Critique or refine web/native frontend and product UI; includes detector hooks, framework-aware live review, and mount-failure recovery. | `/skill:impeccable` |
| `playwright-cli` | Drive a real browser for end-to-end UI checks, screenshots, and reviewable proof videos. | `/skill:playwright-cli` |
| `qlty` | Lint, auto-format, and measure code quality — complexity, duplication, and code smells — through one CLI across the repository's languages. | `/skill:qlty check this branch before I hand it off` |
| `liteparse` | Pull text, tables, or values out of PDF, DOCX, PPTX, XLSX, and image files locally. | `/skill:liteparse` |
| `show-me` | Explain a topic visually with concise diagrams, code-shape sketches, or focused HTML artifacts. HumanLayer, MIT licensed. | `/skill:show-me` |

Impeccable 4.1.1 resolves Live sessions to the selected app root, supports SvelteKit, Nuxt, TanStack Start, Astro, Next.js, Vite, and static HTML injection, and rejects absolute, traversing, or symlinked configured write targets. Its concept roll may contact `impeccable.style`; set `IMPECCABLE_NO_TELEMETRY=1` or `DO_NOT_TRACK=1` to disable the anonymous choice ping. The image fallback runs only with `OPENAI_API_KEY`, sends prompts and optional reference images to OpenAI, and spends that account's API credit. Generated image prompts are embedded in the image or a sidecar, so do not include secrets.

Use `/skill:research-codebase` for a focused subsystem or question. For repository-wide research, use `fan-out-and-synthesize` with distinct repository partitions and an artifact synthesis barrier. Use Goal for ledger-backed bounded orchestration and Ralph for research-first delegated implementation with iterative review; task size alone does not select either workflow.
