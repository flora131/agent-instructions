# Historical settings documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: settings::001 -->

Source: `packages/coding-agent/docs/settings.md` lines 1–11 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/settings.md#settings`.

# Settings

Atomic uses JSON settings files with project settings overriding global settings.

| Location | Scope |
|----------|-------|
| `~/.atomic/agent/settings.json` | Global (all projects) |
| `.atomic/settings.json` | Project (current directory) |

Edit directly or use `/settings` for common options. To save startup model defaults interactively, use `/model` and press Ctrl+S on the desired model; to save the startup thinking level, use `/thinking` and press Ctrl+S. Atomic also reads legacy `~/.pi/agent/settings.json` and `.pi/settings.json` as compatibility fallbacks, with `.atomic` paths taking precedence.

<!-- baseline-block: settings::002 -->

Source: `packages/coding-agent/docs/settings.md` lines 12–27 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/settings.md#project-trust`.

## Project Trust

On interactive startup, Atomic asks before trusting a project folder that contains trust-gated project inputs and has no saved decision for the folder or a parent folder in `~/.atomic/agent/trust.json`. Trusting a project allows Atomic to load project-local `.atomic/settings.json` and `.atomic` resources, legacy `.pi/settings.json` and `.pi` resources, project-local context files, install missing project packages, and execute project extensions.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, they use `defaultProjectTrust` from global settings: `ask` (default) and `never` ignore trust-gated project inputs, while `always` trusts them. Pass `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

If no extension or saved decision applies, `defaultProjectTrust` controls the fallback behavior. Set it to `"ask"`, `"always"`, or `"never"` in `~/.atomic/agent/settings.json`, or change it with `/settings`.

`atomic config` and package commands use the same project trust flow. Pass `--approve` to trust project-local settings for one command or `--no-approve` to ignore them.

Use `/trust` in interactive mode to save a project trust decision for future sessions, including trust for the immediate parent folder. It writes `~/.atomic/agent/trust.json` only; the current session is not reloaded, so restart Atomic for changes to take effect.

If a bare directory starts without trust-gated inputs, Atomic may run the interactive session as implicitly trusted. Inert state directories such as `.atomic/todos/` and `.atomic/sessions/` do not require trust and do not disable deferred resource startup. On the normal interactive TTY fast path, Atomic paints the shell and makes the input editor responsive before scanning bundled extension packages, skills, prompts, themes, context files, and system-prompt files. After the input handler is ready, Atomic starts extension/resource loading in the background. If the first submitted prompt arrives before that loading settles, Atomic keeps the prompt spinner visible and waits at the readiness gate before calling the model so extension tools, prompt templates, skills, resources, and extension-registered provider updates are available on that first turn. Deferred loading uses async discovery and cooperative yields around resource-loading work, so visible typing, Enter, Ctrl+C, rendering, and the normal prompt spinner remain responsive while the background work finishes. Startup does not show a resource-loading spinner before the user submits a prompt. Explicit provider/model selection, explicit resource flags, system-prompt inputs, metadata commands, non-TTY modes, and unresolved project-trust prompts stay on the synchronous path because those operations need complete resources before the session is created. When resources finish loading, Atomic shows the normal resources disclosure so newly added skills, prompts, themes, and extensions are visible. If trust-requiring config appears later, Atomic prompts again on the next launch until you explicitly save a persistent trust decision; the only automatic persistence of implicit startup trust is the existing `/reload` flow after reload discovers trust-requiring resources in an already-trusted session.

Settings and trust JSON files may start with a UTF-8 BOM, as commonly written by older Windows tools; Atomic strips that leading marker before parsing.

<!-- baseline-block: settings::004 -->

Source: `packages/coding-agent/docs/settings.md` lines 30–44 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/settings.md#model-&-thinking`.

### Model & Thinking

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultProvider` | string | - | Startup provider (e.g., `"anthropic"`, `"openai"`; saved with Ctrl+S in `/model`, or edited manually) |
| `defaultModel` | string | - | Startup model ID (saved with Ctrl+S in `/model`, or edited manually) |
| `defaultThinkingLevel` | string | - | Startup thinking level (saved with Ctrl+S in `/thinking`, or edited manually): `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`; the active model must support the selected level |
| `modelThinkingLevels` | object | - | Per-model startup thinking levels keyed by `"provider/modelId"`; configure from `/settings` → Default thinking level per model, or edit manually |
| `hideThinkingBlock` | boolean | `false` | Hide thinking blocks in output |
| `thinkingBudgets` | object | - | Custom token budgets per thinking level. Anthropic, Google, and Bedrock use these natively. OpenAI-compatible models use them when `compat.thinkingTokenBudgetField` (or `supportsThinkingTokenBudget`) is set. |
| `showCacheMissNotices` | boolean | `false` | Show transcript notices for significant prompt-cache misses, billed compaction or branch-summary usage, and provider recovery diagnostics such as dropped Anthropic thinking blocks, including when a persisted transcript is resumed |
| `fallbackModels` | string[] | - | Ordered fallback models, written as `"provider/model"` with optional model-supported reasoning suffixes such as `:high`, `:xhigh`, or `:max`. Used by main-chat turns and, since compaction fallback rungs, borrowed for compaction planner requests |

`defaultProvider` and `defaultModel` form one exact saved selection when both are present. Atomic waits for built-in, configured, and extension provider registration before classifying that provider. If it remains unsupported, Atomic does not silently switch providers: interactive mode stays live with a generic configuration warning; print and JSON modes write the warning to stderr and exit nonzero before prompting (with JSON stdout remaining JSONL-clean); and RPC rejects `prompt` until a successful explicit `set_model` selects an available model or an explicit model cycle returns a different available model. A null or unchanged cycle does not clear the condition. If the provider is supported but its saved model is unknown or lacks configured authentication, normal automatic selection of an available authenticated model remains enabled; the same is true when either field is omitted. Valid extension-provider defaults can resolve after deferred extension loading. Update an unsupported pair or choose a model with `/model`.

<!-- baseline-block: settings::008 -->

Source: `packages/coding-agent/docs/settings.md` lines 105–136 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/settings.md#ui-&-display`.

### UI & Display

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `theme` | string | `"dark"` | Theme name (`"dark"`, `"light"`, a Catppuccin built-in, or custom) |
| `fullscreenScrollbar` | string | `"auto"` | Fullscreen transcript scrollbar: `"auto"` shows it temporarily while scrolling, `"always"` reserves the rightmost transcript column and keeps it visible, and `"hidden"` hides it. The thumb can be dragged when shown. |
| `fullscreenExitOutput` | string | `"transcript"` | Fullscreen exit output: `"transcript"` prints the final transcript and session resume hint, while `"resume-hint"` restores the terminal's previous screen and prints only the resume hint. Settable from `/settings` |
| `fullscreenCopyOnSelect` | boolean | `true` | Copy fullscreen text selections automatically on mouse release. When `false`, the selection remains highlighted and main-editor Ctrl+X copies it; Ctrl+X falls back to the last assistant message when there is no selection. Settable from `/settings` |
| `quietStartup` | boolean | `false` | Hide startup header |
| `defaultProjectTrust` | string | `"ask"` | Fallback project trust behavior: `"ask"`, `"always"`, or `"never"`. Global setting only |
| `collapseChangelog` | boolean | `false` | Show condensed changelog after updates |
| `enableInstallTelemetry` | boolean | `true` | Send an anonymous install/update version ping after first install or changelog-detected updates. This does not control update checks |
| `firstRunOnboardingStartedVersion` | string | - | Internal first-run onboarding start marker used when no prior Atomic startup state identifies the user as returning |
| `onboardedVersion` | string | - | Internal one-time first-run onboarding completion marker. Returning-user detection from prior startup state or displaying the first-run workflow-engine explanation sets it |
| `enableAnalytics` | boolean | `false` | Opt in to analytics during first-run setup |
| `trackingId` | string | - | Locally generated analytics identifier when analytics is enabled |
| `doubleEscapeAction` | string | `"tree"` | Action for double-escape: `"tree"`, `"fork"`, or `"none"` |
| `treeFilterMode` | string | `"default"` | Default filter for `/tree`: `"default"`, `"no-tools"`, `"user-only"`, `"labeled-only"`, `"all"` |
| `editorPaddingX` | number | `0` | Horizontal padding for input editor (0-3) |
| `outputPad` | number | `1` | Horizontal padding for chat message output (user messages, assistant messages, thinking blocks). `0` or `1` |
| `externalEditor` | string | - | Command for the Ctrl+G external editor; takes precedence over `$VISUAL`/`$EDITOR`. Defaults to Notepad on Windows and `nano` elsewhere |
| `autocompleteMaxVisible` | number | `5` | Max visible items in the default editor and custom editors installed through `ctx.ui.setEditorComponent()` (3-20) |
| `showHardwareCursor` | boolean | `false` | Show the terminal cursor while TUI positions it for IME support |

Interactive sessions always use the fullscreen renderer. The transcript scrolls in its own viewport while the editor, status line, usage meter, extension widgets, and footer stay docked at the bottom. Wheel and trackpad gestures go first to a focused workflow overlay, including workflow graphs and stage chats. Events that overlay does not consume fall through to the alternate-screen viewport; non-overlay focused components leave mouse input with pi-tui so transcript scrolling, scrollbar interaction, and drag selection remain available. A selection made over a workflow overlay never copies during a hierarchy transition and is cleared when that overlay hides and the main chat repaints.

The fullscreen renderer keeps minimum sizes for nested layout stacks during resize, and transient fullscreen notices stack instead of replacing a notice that is still visible.

The alternate screen normally restores the terminal's prior contents on exit, so an interactive transcript does not remain in terminal scrollback. The `fullscreenExitOutput` setting changes what exiting prints: `"transcript"` (the default) paints the final transcript plus a session resume hint on the main screen, while `"resume-hint"` restores the previous screen and prints only the resume hint. Use `/export` before exit for an HTML copy, or resume the saved session later to review it in Atomic.

Ctrl+G in main chat, embedded chat, and extension editor dialogs uses one shared asynchronous launcher. Atomic chooses `externalEditor`, then `$VISUAL`, then `$EDITOR`, then Notepad on Windows or `nano` elsewhere. Each edit uses a private `atomic-editor-*` directory containing only `prompt.md`, removes the directory recursively afterward, and never scans the system temporary directory. A successful empty edit is preserved; a failed editor leaves the original text unchanged, and the TUI always restarts and renders after the editor exits.

<!-- baseline-block: settings::015 -->

Source: `packages/coding-agent/docs/settings.md` lines 207–236 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/settings.md#retry`.

### Retry

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `retry.enabled` | boolean | `true` | Enable automatic agent-level retry on transient errors |
| `retry.maxRetries` | number | `3` | Maximum agent-level retry attempts |
| `retry.baseDelayMs` | number | `2000` | Base delay for agent-level exponential backoff (2s, 4s, 8s) |
| `retry.provider.timeoutMs` | number | SDK default | Provider/SDK request timeout in milliseconds |
| `retry.provider.maxRetries` | number | `0` | Provider/SDK retry attempts. Leave unset/`0` to let Atomic's agent-level retry handle transient failures |
| `retry.provider.maxRetryDelayMs` | number | `60000` | Max server-requested delay before failing (60s) |

When a provider requests a retry delay longer than `retry.provider.maxRetryDelayMs` (e.g., Google's "quota will reset after 5h"), the request fails immediately with an informative error instead of waiting silently. Set to `0` to disable the cap.

`retry.provider.maxRetries` follows upstream Pi's behavior and defaults to `0` SDK/provider retries. Atomic still performs agent-level retries via `retry.maxRetries`; set `retry.provider.maxRetries` explicitly only when you want the underlying provider SDK to retry before Atomic observes the failure.

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "provider": {
      "timeoutMs": 3600000,
      "maxRetries": 0,
      "maxRetryDelayMs": 60000
    }
  }
}
```

<!-- baseline-block: settings::018 -->

Source: `packages/coding-agent/docs/settings.md` lines 275–292 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/settings.md#terminal-&-images`.

### Terminal & Images

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `terminal.showImages` | boolean | `true` | Show images in terminal (if supported) |
| `terminal.imageWidthCells` | number | `60` | Preferred inline image width in terminal cells |
| `terminal.clearOnShrink` | boolean | `false` | Clear empty rows when content shrinks (can cause flicker) |
| `terminal.showTerminalProgress` | boolean | `false` | Show OSC 9;4 progress indicators in the terminal tab bar |
| `images.autoResize` | boolean | `true` | Resize oversized images to a 2000x2000 maximum. Applies to `@file` attachments, `read`, and images returned by tools |
| `images.blockImages` | boolean | `false` | Block all images from being sent to LLM |
| `terminal.hyperlinks` | boolean or `"auto"` | `"auto"` | JSON-only hyperlink capability override. `true`/`false` overrides detection; `"auto"`, omitted, and invalid values preserve detection. Not shown in `/settings` |
| `terminal.images` | `"kitty"`, `"iterm2"`, `"auto"`, or `false` | `"auto"` | JSON-only inline-image protocol override. `false` disables terminal images; `"auto"`, omitted, and invalid values preserve detection. Not shown in `/settings` |
| `terminal.trueColor` | boolean or `"auto"` | `"auto"` | JSON-only truecolor capability override. `true`/`false` overrides detection; `"auto"`, omitted, and invalid values preserve detection. Not shown in `/settings` |


The installed pi-tui 0.84.4 renderer owns the matching environment overrides: `PI_HYPERLINKS=1|0|auto`, `PI_IMAGE_PROTOCOL=kitty|iterm2|none|auto`, and `PI_TRUE_COLOR=1|0|auto`. Explicit JSON booleans/protocols take precedence over those environment values. Use `"auto"` or omit a JSON value to leave environment and terminal detection in control.
When `images.autoResize` is enabled, Atomic normalizes images before sending them to the model. Tool-result images are normalized after `tool_result` extension handlers run, so images an extension inserts receive the same limit; if processing fails, Atomic keeps the original image. Set it to `false` to preserve source dimensions.

<!-- baseline-block: settings::019 -->

Source: `packages/coding-agent/docs/settings.md` lines 293–329 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/settings.md#shell`.

### Shell

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `shellPath` | string | - | Custom shell path (e.g., for Cygwin on Windows) |
| `shellCommandPrefix` | string | - | Prefix for every bash command (e.g., `"shopt -s expand_aliases"`) |
| `bashInterceptor.enabled` | boolean | `false` | When true, block shell commands that have dedicated tools and offer remaining `bash` tool calls to `user_bash` extension handlers before local execution. Also available in `/settings` as **Bash Interceptor**. |
| `search.contextBefore` | number | `1` | Number of context lines before each `search` match. |
| `search.contextAfter` | number | `3` | Number of context lines after each `search` match. |
| `npmCommand` | string[] | - | Command argv used for npm package lookup/install operations (e.g., `["mise", "exec", "node@20", "--", "npm"]`) |

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

`bashInterceptor.enabled` is intentionally `false` unless configured. Enable it from `/settings` or set it to `true` in JSON when you want Atomic to steer shell anti-patterns to `read`/`search`/`find`/`edit`/`write` and let extensions intercept model `bash` tool calls through the same `user_bash` event used by interactive `!` commands.

`npmCommand` is used for all npm package-manager operations, including installs, uninstalls, and dependency installs inside git packages. Use argv-style entries exactly as the process should be launched. When `npmCommand` is configured, git package dependency installs use plain `install` to avoid npm-specific flags in wrappers or alternate package managers.

Normally the package manager's global modules location is queried using `root -g`. As a special case, if the first element of `npmCommand` is `"bun"`, the modules location will instead be queried with `pm bin -g`.

On Windows, JSON paths must use forward slashes or escaped backslashes:

```json
{
  "shellPath": "C:/Program Files/Git/bin/bash.exe"
}
```

```json
{
  "shellPath": "C:\\Program Files\\Git\\bin\\bash.exe"
}
```

<!-- baseline-block: settings::023 -->

Source: `packages/coding-agent/docs/settings.md` lines 381–392 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/settings.md#markdown`.

### Markdown

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `markdown.codeBlockIndent` | string | `"  "` | Indentation for code blocks |
| `markdown.mermaid` | string | `"streaming"` | Mermaid rendering mode: `"off"`, `"final"`, or `"streaming"` |
| `markdown.latex` | boolean | `true` | Render LaTeX expressions as terminal-friendly Unicode math |

Mermaid code blocks render as themed Unicode diagrams in interactive transcripts when they fit the available width. `"off"` keeps the Markdown fence, `"final"` renders only finalized responses, and `"streaming"` also renders partial assistant responses. Invalid or too-wide diagrams remain as code, and rendering is display-only: stored messages and model context keep the original Markdown. LaTeX rendering is also display-only and converts supported expressions to terminal-friendly Unicode math; set `markdown.latex` to `false` to keep the source form.

The installed pi-tui 0.84.4 LaTeX renderer also handles whitespace and matrix layouts correctly.
