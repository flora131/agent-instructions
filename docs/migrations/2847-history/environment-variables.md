# Historical environment-variables documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: environment-variables::002 -->

Source: `packages/coding-agent/docs/environment-variables.md` lines 5–23 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/environment-variables.md#application-configuration`.

## Application configuration

| Atomic variable | Legacy alias | Purpose |
|---|---|---|
| `ATOMIC_CODING_AGENT_DIR` | `PI_CODING_AGENT_DIR` | Agent/config directory; default `~/.atomic/agent` |
| `ATOMIC_CODING_AGENT_SESSION_DIR` | `PI_CODING_AGENT_SESSION_DIR` | Session directory; `--session-dir` takes precedence |
| `ATOMIC_PACKAGE_DIR` | `PI_PACKAGE_DIR` | Package directory override |
| `ATOMIC_OFFLINE` | `PI_OFFLINE` | Disable startup network operations |
| `ATOMIC_SKIP_VERSION_CHECK` | `PI_SKIP_VERSION_CHECK` | Skip automatic startup version checks; explicit self-update still checks |
| `ATOMIC_TELEMETRY` | `PI_TELEMETRY` | Enable/disable install/update telemetry |
| `ATOMIC_REDUCED_MOTION` | `PI_REDUCED_MOTION` | Use static reduced-motion presentation |
| `ATOMIC_EXPERIMENTAL` | `PI_EXPERIMENTAL` | Set to `1` to enable experimental features: built-in tool definitions request strict JSON-schema constrained sampling (`prefer`), and the footer shows an `xp` badge |

`PI_CACHE_RETENTION=long` is a provider/upstream prompt-cache option and intentionally has no Atomic-prefixed alias. `VISUAL` and `EDITOR` select the Ctrl+G external editor when `externalEditor` is unset.

`PI_TUI_ESC_TIMEOUT` belongs to the installed pi-tui renderer and also keeps its upstream name: it sets how long the renderer waits after a lone `ESC` before treating it as the Escape key, in milliseconds. The default is `100` over SSH and `10` otherwise; increase it if Alt-key input is misread as Escape.

The renderer also owns `PI_HYPERLINKS`, `PI_IMAGE_PROTOCOL`, and `PI_TRUE_COLOR`. `PI_HYPERLINKS=1|0|auto` and `PI_TRUE_COLOR=1|0|auto` override or preserve detection; `PI_IMAGE_PROTOCOL=kitty|iterm2|none|auto` selects, disables, or preserves image-protocol detection. Explicit JSON values under `terminal.hyperlinks`, `terminal.images`, and `terminal.trueColor` take precedence. These renderer-owned names intentionally have no `ATOMIC_*` aliases.
