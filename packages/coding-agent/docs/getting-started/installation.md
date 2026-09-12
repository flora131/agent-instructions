---
title: Installation
description: Install Atomic with a package manager or a release archive, and uninstall it cleanly.
---

# Installation

**Outcome:** Atomic is on your `PATH` and `atomic --version` prints a version.

**Prerequisites:** A supported shell. See [Prerequisites](/quickstart#prerequisites).

## Install

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

Embedded PostgreSQL is available without install scripts or a first-run download on Linux x64/ARM64 (glibc and musl), macOS x64/ARM64, and Windows x64/ARM64. npm-compatible package managers select the matching `@bastani/atomic-natives` leaf containing the runtime; standalone archives carry a target-selected runtime and resolve its binaries directly from the extracted installation. Keep the complete archive directory, including `node_modules`, libraries and licenses. Older upstream optional packages may also remain in npm installations for compatibility, but the native leaf takes precedence. Windows ARM64 uses Windows x64 PostgreSQL under Windows 11's x64 emulation, not native PostgreSQL ARM64, and requires the Microsoft Visual C++ x64 v14 Redistributable. Windows 10 on ARM cannot run this x64 runtime; Windows ARM64 execution still needs hardware validation.

### Release archive

Alternatively, install the self-contained release archive, which needs no Node.js or package manager.

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/bastani-inc/atomic/main/install.sh | sh
```

On Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/bastani-inc/atomic/main/install.ps1 | iex
```

The installer downloads only the matching GitHub Release archive and `SHA256SUMS`, verifies the checksum, and keeps the complete payload in a versioned directory.

On macOS or Linux, the default paths are `~/.local/share/atomic` for versioned payloads and `~/.local/bin/atomic` for the launcher. The installer prints a paste-safe `export PATH=...` command if needed.

On Windows, the defaults are `%LOCALAPPDATA%\atomic` for payloads and `%LOCALAPPDATA%\atomic\bin\atomic.cmd` for the launcher. The installer updates the User PATH and current process, then asks you to restart the terminal.

The installer accepts these environment variables:

#### ATOMIC_VERSION

Pin an exact release tag instead of the latest release, or pass a flag that overrides it. On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/bastani-inc/atomic/main/install.sh | sh -s -- --ref 0.9.11
```

On Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/bastani-inc/atomic/main/install.ps1))) -Ref 0.9.11
```

Pins use Atomic's `MAJOR.MINOR.PATCH` or `MAJOR.MINOR.PATCH-alpha.REVISION` release tag form and are honored literally: if GitHub answers with a different release tag, the installer stops before downloading anything rather than installing a version you did not ask for.

#### ATOMIC_INSTALL_DIR

Override the install root that holds the versioned payloads (default `~/.local/share/atomic` on macOS/Linux, `%LOCALAPPDATA%\atomic` on Windows). On macOS/Linux, a relative value resolves against the physical directory where the installer starts and is used exactly as given, including any trailing whitespace or newline. The install root cannot equal or sit inside the launcher path (`ATOMIC_BIN_DIR/atomic`); impossible layouts fail before any download or filesystem change.

#### ATOMIC_BIN_DIR

Override the launcher directory (default `~/.local/bin` on macOS/Linux, `%LOCALAPPDATA%\atomic\bin` on Windows). Relative values resolve the same way as `ATOMIC_INSTALL_DIR`. It cannot sit inside the install root's `current` or `versions` directories, which the installer replaces on every install. A Unix value containing `:` cannot be one PATH entry, so the installer prints direct-run guidance instead of editing PATH.

#### GITHUB_TOKEN / GH_TOKEN

Optional; raises GitHub API limits on shared networks. Curl and GNU Wget keep the token in a protected temporary file instead of process arguments. BusyBox Wget remains supported without a token, and with a token when the latest-release redirect avoids the API; if an authenticated API fallback is needed, install curl or GNU Wget rather than exposing the token.

### Which runtime runs your workflows

How you install Atomic decides which runtime hosts it: a package-manager install runs under Node, while the standalone binaries are Bun-compiled and run under Bun. Authored workflows execute inside whichever host is active, so a workflow that reaches for a `Bun.*` global runs only under the standalone binary and fails with `Bun is not defined` under an npm install. Installing Bun separately does not change that — the npm install still runs on Node. Write workflow code against APIs both hosts provide, such as `node:child_process` and `node:fs`; see [Custom Workflow Authoring](/workflows/authoring) for the rule and worked examples.

### Alpine and musl Linux archives

The shell installer detects Alpine and selects `atomic-linux-x64-musl.tar.gz` or `atomic-linux-arm64-musl.tar.gz`. Each archive includes its matching native search and PTY bindings plus payload-local `libgcc` and `libstdc++` runtimes, so stock Alpine needs no runtime package install.

Two features work differently on musl:

- **Clipboard:** the musl archives omit a clipboard native binding because `@mariozechner/clipboard` 0.3.9 publishes metadata-only musl stubs without a `.node` payload; Atomic uses Linux clipboard commands and OSC52 fallback instead.
- **Durable workflows:** the archives omit the glibc-linked `@embedded-postgres/*` binary packages and instead carry a checksum-pinned Alpine/musl PostgreSQL 18.6 runtime, so durable workflows provision offline without external Postgres or Docker. If no durable backend can be provisioned at all, Atomic still uses a loud non-durable in-memory fallback.

Then start Atomic in the project directory you want it to work on:

```bash
cd /path/to/project
atomic
```

## Uninstall

On macOS or Linux, for a default archive install, remove `~/.local/share/atomic` and the `~/.local/bin/atomic` link.

On Windows, remove `%LOCALAPPDATA%\atomic`. If you set `ATOMIC_BIN_DIR`, also remove `atomic.cmd` and the `atomic-current` junction from that directory, then remove the directory from your User PATH.

For a package install, remove the global package with the same package manager. With npm:

```bash
npm uninstall -g @bastani/atomic
```

With pnpm:

```bash
pnpm remove -g @bastani/atomic
```

With Bun:

```bash
bun remove -g @bastani/atomic
```

These commands remove the CLI only. User configuration, auth, sessions, and packages remain under `~/.atomic/agent/` unless you delete that directory yourself.

## Verify the install

Run:

```bash
atomic --version
```

Expected output is a single version line, for example:

```text
0.9.14-alpha.2
```

If the shell reports `command not found`, the launcher directory is not on your `PATH` yet. Open a new shell, or add the bin directory the installer printed to your `PATH` and try again.

## Next step

Continue to [Authentication](/getting-started/authentication).
