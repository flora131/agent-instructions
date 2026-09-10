# Historical usage documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: usage::004 -->

Source: `packages/coding-agent/docs/usage.md` lines 26–40 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/usage.md#editor-features`.

### Editor Features

| Feature | How |
|---------|-----|
| File reference | Type `@` to fuzzy-search project files |
| Path completion | Press Tab to complete paths |
| Multi-line input | SHIFT+Enter, or CTRL+Enter on Windows Terminal |
| Images | Paste with CTRL+V, ALT+V on Windows, or drag into the terminal |
| Shell command | `!command` runs and sends output to the model |
| Hidden shell command | `!!command` runs without sending output to the model |
| External editor | CTRL+G opens `$VISUAL` or `$EDITOR` |
| Copy selection/message | Ctrl+X copies a retained fullscreen selection when `fullscreenCopyOnSelect` is disabled; otherwise it copies the last assistant message |

See [Keybindings](/keybindings) for all shortcuts and customization.

<!-- baseline-block: usage::005 -->

Source: `packages/coding-agent/docs/usage.md` lines 41–69 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/usage.md#slash-commands`.

## Slash Commands

Type `/` in the editor to open command completion. Extensions can register custom commands, skills are available as `/skill:name`, and prompt templates expand via `/templatename`.

| Command | Description |
|---------|-------------|
| `/login`, `/logout` | Manage OAuth or API-key credentials |
| `/model` | Switch models; Ctrl+S in the picker saves the startup default |
| `/thinking` | Switch thinking level; Ctrl+S in the picker saves the startup default |
| `/scoped-models` | Enable/disable models for CTRL+P cycling |
| `/workflow` | List/run workflows; manage runs (connect/inspect/pause/interrupt/quit/resume); reload workflow resources |
| `/settings` | Theme, message delivery, transport, and other preferences |
| `/resume` | Pick from previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set session display name |
| `/session` | Show session file, ID, messages, tokens, and cost |
| `/tree` | Jump to any point in the session and continue from there |
| `/fork` | Create a new session from a previous user message |
| `/clone` | Duplicate the current active branch into a new session |
| `/compact` | Run Verbatim Compaction with transcript-bound deletion tools |
| `/copy` | Copy last assistant message to clipboard |
| `/export [file]` | Export session to HTML |
| `/share` | Upload as private GitHub gist with shareable HTML link |
| `/reload` | Reload keybindings, extensions, skills, prompts, and context files |
| `/hotkeys` | Show all keyboard shortcuts |
| `/changelog` | Display version history |
| `/exit` | Exit Atomic |
| `/quit` | Quit Atomic |

<!-- baseline-block: usage::014 -->

Source: `packages/coding-agent/docs/usage.md` lines 226–245 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/reference/cli.md#modes`.

### Modes

| Flag | Description |
|------|-------------|
| default | Interactive mode (fullscreen TUI) |
| `-p`, `--print` | Print response and exit |
| `--mode json` | Output all events as JSON lines; see [JSON mode](/json) |
| `--mode rpc` | RPC mode over stdin/stdout; see [RPC mode](/rpc) |
| `--export <in> [out]` | Export a session to HTML |

Interactive sessions always use fullscreen: the transcript scrolls independently above a sticky dock containing the editor, status line, usage meter, extension widgets, and footer. Wheel and trackpad gestures go first to a focused workflow graph or stage chat overlay; events those overlays do not consume fall through to the alternate-screen viewport. Non-overlay focused components do not block pi-tui's mouse path, so transcript scrolling, scrollbar interaction, and drag selection still work. Selection copies automatically by default; disable `fullscreenCopyOnSelect` to retain it for Ctrl+X. Ctrl+X closes workflow tool detail to the graph, clears a scoped-model selection, returns stage chat to its graph, or returns a workflow graph to main chat before the main editor may copy. `/copy` always copies the last assistant message. The `fullscreenExitOutput` setting controls what exiting prints: `"transcript"` (the default) paints the final transcript plus a session resume hint on the main screen, while `"resume-hint"` restores the previous screen and prints only the resume hint. See [Settings](/settings) and [Terminal setup](/terminal-setup).

In print mode, Atomic also reads piped stdin and merges it into the initial prompt:

```bash
cat README.md | atomic -p "Summarize this text"
```

When a print-mode turn correctly finishes by calling an opt-in terminating structured-output tool created with `createStructuredOutputTool` (for example from an extension, SDK caller, or workflow item with a schema), Atomic ends after that tool result without an extra follow-up assistant turn. Print-mode stdout contains the terminating structured JSON payload, so `atomic -p` remains script-friendly while the same value is also available through the SDK `capture` sink, tool `details`, a configured file sink, or workflow `result.structured`. This also works for custom factory names such as `final_decision`. Non-terminating or unrelated tool results are not printed as the final response.
