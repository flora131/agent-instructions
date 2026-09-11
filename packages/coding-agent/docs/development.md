# Development

See [AGENTS.md](https://github.com/bastani-inc/atomic/blob/main/AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/bastani-inc/atomic
cd atomic
npm ci --ignore-scripts
npm run build
```

Use npm for installs, builds, checks, and Vitest suites. Bun compiles standalone binaries and runs repository TypeScript scripts. Do not use yarn, pnpm, or `bun install`.

Atomic keeps the caller's current working directory when launched from development wrappers.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "atomicConfig": {
    "name": "atomic",
    "configDir": ".atomic"
  }
}
```

Change `name`, `configDir`, and the `bin` field for your fork. These control the CLI banner, config paths, and environment variable names. Legacy `piConfig` remains a compatibility fallback.

## Path Resolution

Three execution modes: package-manager install, standalone binary, and source checkout.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.atomic/agent/atomic-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

For startup measurements, see the [Windows startup benchmark](https://github.com/bastani-inc/atomic/blob/main/scripts/perf/windows-startup/README.md). Internal timing marks do not prove terminal first paint.

## PDF and engine diagnostics

PDF conversion and engine diagnostics appear as status messages in interactive sessions
and console output otherwise. Conversion failures also include diagnostic details in
their error result. Long or noisy diagnostics may be truncated.

Diagnostics are displayed as text, not terminal commands. RPC clients receive diagnostics
separately from JSON responses. No `atomic-engine-stderr.log` file is written; include the
displayed diagnostic and conversion error when reporting a PDF problem.

## Testing

```bash
npm run check                    # Typechecks and published-shrinkwrap validation
npm run test:unit                # Root unit tests
npm run test:integration         # Root integration tests
npm run test:all                 # All root test projects
npm run test:scripts             # Repository script tests under Node
npm run test --workspace=@bastani/atomic -- test/specific.test.ts
```

CI runs root unit and integration suites on Linux and Windows. See [CI documentation](https://github.com/bastani-inc/atomic/blob/main/docs/ci.md) for job details and release procedures.

### Installed package smoke test

After building, run:

```bash
ATOMIC_REQUIRE_INSTALLED_NODE_SMOKE=1 npx vitest --run --project integration test/integration/installed-package-node-extensions.test.ts
```

This checks Node startup and builtin extension loading outside the checkout.

Atomic ships an npm shrinkwrap. After dependency changes, regenerate it with `npm run shrinkwrap:coding-agent` and validate with `npm run check`.

## Project Structure

```text
packages/
  ai/           # Atomic's LLM provider fork
  coding-agent/ # CLI, interactive mode, and core runtime
  workflows/    # Workflow execution
  subagents/    # Subagent orchestration
  mcp/          # MCP adapter
  web-access/   # Web search and content extraction
  intercom/     # Cross-session coordination
```
