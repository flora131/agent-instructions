---
title: TUI API reference
sidebarTitle: "TUI API"
description: Component and focusable interfaces, keyboard input, line width, invalidation, logging, and performance contracts.
---

# TUI API reference

## Component Interface

All components implement:

```typescript
interface Component {
  render(width: number): string[];
  handleInput?(data: string): boolean | void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

| Method | Description |
|--------|-------------|
| `render(width)` | Return array of strings (one per line). Each line **must not exceed `width`**. |
| `handleInput?(data)` | Receive keyboard input when the component has focus. A focused overlay also receives mouse input before the fullscreen viewport. Return `true` when it consumes input; return `false`, `undefined`, or `void` when a matching fullscreen viewport key or overlay mouse event should fall through to viewport handling. Non-overlay focused components leave mouse input with pi-tui so transcript scrolling, scrollbar interaction, and drag selection remain available. |
| `wantsKeyRelease?` | If true, component receives key release events (Kitty protocol). Default: false. |
| `invalidate()` | Clear cached render state. Called on theme changes. |

The installed pi-tui type still permits handlers that return `void`; Atomic treats a missing or `undefined` result as unhandled only for a matching fullscreen viewport key or a mouse event deferred to a focused overlay. Components that mutate state for such an input must return `true` so the viewport does not apply it a second time.

Omitting `handleInput` altogether is the same answer as declining: a focused overlay with no handler still lets fullscreen viewport keys and mouse wheel reports reach the transcript, so a notice or progress panel does not freeze scrolling behind it. An asynchronous handler is judged when it settles — only a promise that resolves `true` consumes the input, while `false`, `undefined`, and a rejection all fall through to the viewport. Input that moved focus while such a promise was pending is left to whatever holds focus when it settles.

The TUI appends a full SGR reset and OSC 8 reset at the end of each rendered line. Styles do not carry across lines. If you emit multi-line text with styling, reapply styles per line or use `wrapTextWithAnsi()` so styles are preserved for each wrapped line.

Bundled MCP tools render their server name in the call header before results arrive. Direct calls use the registered server; gateway calls use the explicit target or an unambiguous match in available metadata or configured prefixes. Unresolved calls still show the tool or operation without guessing a server. This display does not open connections or expose tool arguments.

## Focusable Interface (IME Support)

Components that display a text cursor and need IME (Input Method Editor) support should implement the `Focusable` interface:

```typescript
import { CURSOR_MARKER, type Component, type Focusable } from "@earendil-works/pi-tui";

class MyInput implements Component, Focusable {
  focused: boolean = false;  // Set by TUI when focus changes
  
  render(width: number): string[] {
    const marker = this.focused ? CURSOR_MARKER : "";
    // Emit marker right before the fake cursor
    return [`> ${beforeCursor}${marker}\x1b[7m${atCursor}\x1b[27m${afterCursor}`];
  }
}
```

When a `Focusable` component has focus, TUI:
1. Sets `focused = true` on the component
2. Scans rendered output for `CURSOR_MARKER` (a zero-width APC escape sequence)
3. Positions the hardware terminal cursor at that location
4. Shows the hardware cursor only when `showHardwareCursor` is enabled

The cursor remains hidden by default. This keeps the fake cursor rendering, while still positioning the hardware cursor for terminals that track IME candidate windows with hidden cursors. Some terminals require a visible hardware cursor for IME positioning; enable it with `showHardwareCursor`, `setShowHardwareCursor(true)`, or `ATOMIC_HARDWARE_CURSOR=1`. The `Editor` and `Input` built-in components already implement this interface.

### Container Components with Embedded Inputs

When a container component (dialog, selector, etc.) contains an `Input` or `Editor` child, the container must implement `Focusable` and propagate the focus state to the child. Otherwise, the hardware cursor won't be positioned correctly for IME input.

```typescript
import { Container, type Focusable, Input } from "@earendil-works/pi-tui";

class SearchDialog extends Container implements Focusable {
  private searchInput: Input;

  // Focusable implementation - propagate to child input for IME cursor positioning
  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor() {
    super();
    this.searchInput = new Input();
    this.addChild(this.searchInput);
  }
}
```

Without this propagation, typing with an IME (Chinese, Japanese, Korean, etc.) will show the candidate window in the wrong position on screen.

## Keyboard Input

Use `matchesKey()` for key detection:

```typescript
import { matchesKey, Key } from "@earendil-works/pi-tui";

handleInput(data: string): boolean {
  if (matchesKey(data, Key.up)) {
    this.selectedIndex--;
    return true;
  } else if (matchesKey(data, Key.enter)) {
    this.onSelect?.(this.selectedIndex);
    return true;
  } else if (matchesKey(data, Key.escape)) {
    this.onCancel?.();
    return true;
  } else if (matchesKey(data, Key.ctrl("c"))) {
    // CTRL+C
    return true;
  }
  return false;
}
```

**Key identifiers** (use `Key.*` for autocomplete, or string literals):
- Basic keys: `Key.enter`, `Key.escape`, `Key.tab`, `Key.space`, `Key.backspace`, `Key.delete`, `Key.home`, `Key.end`
- Arrow keys: `Key.up`, `Key.down`, `Key.left`, `Key.right`
- With modifiers: `Key.ctrl("c")`, `Key.shift("tab")`, `Key.alt("left")`, `Key.ctrlShift("p")`
- String format also works: `"enter"`, `"ctrl+c"`, `"shift+tab"`, `"ctrl+shift+p"`

## Line Width

**Critical:** Each line from `render()` must not exceed the `width` parameter.

```typescript
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

render(width: number): string[] {
  // Truncate long lines
  return [truncateToWidth(this.text, width)];
}
```

Utilities:
- `visibleWidth(str)` - Get display width (ignores ANSI codes)
- `truncateToWidth(str, width, ellipsis?)` - Truncate with optional ellipsis
- `wrapTextWithAnsi(str, width)` - Word wrap preserving ANSI codes

## Invalidation and Theme Changes

When the theme changes, the TUI calls `invalidate()` on all components to clear their caches. Components must properly implement `invalidate()` to ensure theme changes take effect.

### The Problem

If a component pre-bakes theme colors into strings (via `theme.fg()`, `theme.bg()`, etc.) and caches them, the cached strings contain ANSI escape codes from the old theme. Simply clearing the render cache isn't enough if the component stores the themed content separately.

**Wrong approach** (theme colors won't update):

```typescript
class BadComponent extends Container {
  private content: Text;

  constructor(message: string, theme: Theme) {
    super();
    // Pre-baked theme colors stored in Text component
    this.content = new Text(theme.fg("accent", message), 1, 0);
    this.addChild(this.content);
  }
  // No invalidate override - parent's invalidate only clears
  // child render caches, not the pre-baked content
}
```

### The Solution

Components that build content with theme colors must rebuild that content when `invalidate()` is called:

```typescript
class GoodComponent extends Container {
  private message: string;
  private content: Text;

  constructor(message: string) {
    super();
    this.message = message;
    this.content = new Text("", 1, 0);
    this.addChild(this.content);
    this.updateDisplay();
  }

  private updateDisplay(): void {
    // Rebuild content with current theme
    this.content.setText(theme.fg("accent", this.message));
  }

  override invalidate(): void {
    super.invalidate();  // Clear child caches
    this.updateDisplay(); // Rebuild with new theme
  }
}
```

### Pattern: Rebuild on Invalidate

For components with complex content:

```typescript
class ComplexComponent extends Container {
  private data: SomeData;

  constructor(data: SomeData) {
    super();
    this.data = data;
    this.rebuild();
  }

  private rebuild(): void {
    this.clear();  // Remove all children

    // Build UI with current theme
    this.addChild(new Text(theme.fg("accent", theme.bold("Title")), 1, 0));
    this.addChild(new Spacer(1));

    for (const item of this.data.items) {
      const color = item.active ? "success" : "muted";
      this.addChild(new Text(theme.fg(color, item.label), 1, 0));
    }
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuild();
  }
}
```

### When This Matters

This pattern is needed when:

1. **Pre-baking theme colors** - Using `theme.fg()` or `theme.bg()` to create styled strings stored in child components
2. **Syntax highlighting** - Using `highlightCode()` which applies theme-based syntax colors
3. **Complex layouts** - Building child component trees that embed theme colors

This pattern is NOT needed when:

1. **Using theme callbacks** - Passing functions like `(text) => theme.fg("accent", text)` that are called during render
2. **Simple containers** - Just grouping other components without adding themed content
3. **Stateless render** - Computing themed output fresh in every `render()` call (no caching)

## Debug logging

Set `PI_TUI_WRITE_LOG` to capture the raw ANSI stream written to stdout. The
variable is read by the vendored `@earendil-works/pi-tui` terminal, so it keeps
its upstream name; a directory path writes one `tui-<timestamp>-<pid>.log` file
per process.

```bash
PI_TUI_WRITE_LOG=/tmp/tui-ansi.log atomic
```

Atomic vendors TUI components through the installed `@earendil-works/pi-tui` dependency.

## Performance

Cache rendered output when possible:

```typescript
class CachedComponent {
  private cachedWidth?: number;
  private cachedLines?: string[];

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    // ... compute lines ...
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
```

Call `invalidate()` when state changes, then `ctx.ui.requestRender()` from the extension context or `tui.requestRender()` from a `ctx.ui.custom()` factory to trigger re-render.

## Host integration

These runtime contracts moved here from the [TUI components guide](/tui), which keeps the runnable `ctx.ui.custom()` example and the common interaction patterns.

### Host terminal modes from an isolated component

Because the component runs in the engine child — whose stdout is the JSONL transport, not a TTY — writing raw terminal escape sequences to `process.stdout` from `render()`/`handleInput()` is a no-op and never reaches the real host terminal. For the host autowrap mode an overlay may need, the factory `tui.terminal` exposes a typed, allowlisted setter that the host applies to the real TTY over the engine protocol:

```typescript
await ctx.ui.custom((tui, theme, keybindings, done) => {
  tui.terminal.setAutowrap?.(false); // disable autowrap (DECAWM) — Windows terminals only
  return new MyOverlay({ onClose: done });
}, { overlay: true });
```

This is the only terminal control exposed; arbitrary child bytes are never forwarded to the terminal. The host resets the mode when a component hides, closes, is disposed, or when the engine child crashes or restarts. In fullscreen, pi-tui owns its baseline mouse and autowrap modes; non-isolated overlay fallbacks do not disable that baseline. On regular non-isolated hosts and test seams the setter is absent, and callers may fall back to writing escape sequences to their own `process.stdout`.

### Host-native session picker

Remote-rendered components pay one host⇄child round trip per keypress under engine isolation. For session-style list pickers, the `ctx.ui.hostSessionPicker(request)` capability avoids that entirely: the terminal host mounts the real built-in `SessionSelectorComponent` and feeds it JSON-safe rows, so arrow-key navigation and search stay host-local and survive extension event-loop stalls. Only semantic events cross the host⇄extension boundary: the extension pushes row `update`s and `error`s (and may `close()` the picker); the host reports selection, cancel, and confirmed Ctrl+D deletes.

Every interactive host implements the same API — non-isolated mode mounts the selector directly in-process (no IPC at all), isolated mode routes it over the engine session-picker protocol channel — so callers never branch on the mode. The member is absent only on non-interactive surfaces (headless RPC, print); fail with an actionable error there instead of degrading to a hand-rolled picker.

```typescript
const picker = ctx.ui.hostSessionPicker?.({
  sessions: rows, // HostSessionPickerRow[]: SessionInfo with createdAt/modifiedAt epoch millis
  showRenameHint: false,
  onDelete: async (path) => {
    // Deletion is extension-owned: the host keeps the row until you reply.
    const outcome = await remove(path);
    if (outcome.ok) picker!.update(rowsWithout(path));
    else picker!.error(outcome.message);
  },
});
if (!picker) throw new Error("This command requires an interactive session picker");
picker.update(await loadMoreRows()); // merge late rows into the open picker
const path = await picker.result;    // selected row's path, or undefined on cancel
```

The bundled workflows extension's `/workflow resume` picker is built exclusively on this channel.

### Host-native input form

Use `ctx.ui.hostInputForm(request)` for structured inline forms whose keyboard handling must remain responsive under interactive-engine isolation. The terminal host mounts and focuses the real form in the bottom editor slot (`overlay: false`); Tab/Shift+Tab, arrows, text editing, configured keybindings, Enter, Escape, and Ctrl+C are handled entirely in the host process. In isolated mode only the JSON-safe open request and the final submit/cancel event cross the engine boundary. Non-isolated mode mounts the same component directly.

```typescript
const values = await ctx.ui.hostInputForm?.({
  title: "Release",
  fields: [
    { name: "version", type: "string", required: true, initialValue: "" },
    { name: "channel", type: "select", choices: ["stable", "beta"], initialValue: "stable" },
  ],
});
if (values === undefined) return; // Escape, Ctrl+C, teardown, or close
```

Field types are `string`, `text`, `number`, `integer`, `boolean`, and `select`. Initial and returned values are raw strings; the caller owns domain coercion. Every current interactive Atomic host exposes the optional capability, while headless RPC and print surfaces omit it. Keep a legacy fallback only when compatibility with older hosts is required.

The bundled `/workflow <name>` input picker uses this channel and retains its older custom-editor/`ctx.ui.custom()` paths only as compatibility fallbacks.
