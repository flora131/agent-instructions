# Historical tui documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: tui::003 -->

Source: `packages/coding-agent/docs/tui.md` lines 9–34 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/tui/reference.md#component-interface`.

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

<!-- baseline-block: tui::006 -->

Source: `packages/coding-agent/docs/tui.md` lines 91–107 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/tui.md#using-components`.

## Using Components

Use `ctx.ui.custom()` with a component factory. The factory receives `done(result)`, and `ctx.ui.custom()` resolves with that result when the component finishes:

```typescript
pi.on("session_start", async (_event, ctx) => {
  const result = await ctx.ui.custom((tui, theme, keybindings, done) => {
    return new MyComponent(done);
  });
  ctx.ui.notify(`Selected: ${result}`, "info");
});
```

Pass `{ signal }` to `ctx.ui.custom()` when the UI belongs to an abortable operation. If the signal aborts, Atomic dismisses the custom UI and rejects the returned promise with the signal reason. For overlays, use `options.onHandle` to receive an overlay handle for programmatic visibility control.

In Atomic's default interactive mode, the component instance remains in the isolated engine child. The terminal host caches rendered lines and forwards input asynchronously, so `render()` and `handleInput()` must not depend on direct access to host process objects. For a matching fullscreen viewport key, or for mouse input while a workflow overlay has focus, the host waits for the child's boolean input reply: `true` keeps the input local, while `false` lets the host transcript process it. Left-button selection events are also mirrored to pi-tui when an overlay handles them, so drag and multi-click selection stays available over fullscreen workflow overlays. Mouse input remains with pi-tui when a non-overlay component has focus, preserving transcript scrolling, scrollbar interaction, and drag selection. A stalled reply has a bounded fallback. The remote bridge preserves pi-tui's key-release contract: release events are filtered unless the child component sets `wantsKeyRelease = true`, matching a directly mounted component. Return values passed to `done()` must be JSON-safe.

<!-- baseline-block: tui::036 -->

Source: `packages/coding-agent/docs/tui.md` lines 819–850 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/tui.md#pattern-4b-working-indicator-customization`.

### Pattern 4b: Working Indicator Customization

Customize the inline Working indicator shown from accepted interactive prompt submission through the active agent turn.

```typescript
// Static indicator
ctx.ui.setWorkingIndicator({ frames: [ctx.ui.theme.fg("accent", "●")] });

// Custom animated indicator
ctx.ui.setWorkingIndicator({
  frames: [
    ctx.ui.theme.fg("dim", "·"),
    ctx.ui.theme.fg("muted", "•"),
    ctx.ui.theme.fg("accent", "●"),
    ctx.ui.theme.fg("muted", "•"),
  ],
  intervalMs: 120,
});

// Hide the indicator entirely
ctx.ui.setWorkingIndicator({ frames: [] });

// Restore Atomic's default one-cell identity pulse
ctx.ui.setWorkingIndicator();
```

This affects the normal Working indicator from accepted prompt submission through response streaming. It appears in a standalone status row by default; custom editors may opt into placing it in their top border. Newlines and terminal control characters in extension-supplied messages or frames remain stored verbatim, and the standalone row preserves their ordinary multi-line rendering. Working appears immediately during attachment and other pre-stream startup, then continues without a visible gap when the agent turn begins. A no-turn result, prompt failure, or turn completion removes it. An accepted manual retry clears stale status from the prior prompt before showing new pre-stream activity. Factual automatic retry and fallback status takes precedence while that transition is active; ordinary Working resumes only when a later Working lifecycle actually starts. With no extension override, Atomic renders the exact one-cell `∀` immediately before one of its 453 original randomized whimsical working verbs, selected once per turn. Every agent and SDK turn starts at regular weight with a fresh lifecycle-relative 88ms cadence, then follows a ten-frame, theme-aware dark → accent → bright/bold → accent → dark luminance ramp without changing glyph or geometry. Optional theme tone overrides control any desired phases exactly, including terminal palette indices 0–255; Atomic derives omitted tones from selected-surface, `accent`, and `text` roles. Dark, light, custom, and dynamically reloaded themes therefore retain their own palette. Under `NO_COLOR`, the same cadence remains visible through regular/bold weight without foreground-color escapes. Turn completion and terminal cleanup stop the timer cleanly. Restoring Atomic's default after an extension override also restarts at the dark regular phase; custom extension frames and intervals remain unchanged and render verbatim. `ATOMIC_REDUCED_MOTION=1` shows a static regular accent `∀` without an animation timer. The icon and longest message fit standard and 64-column widths. Factual status copy takes precedence. Compaction and retry loaders keep their plain built-in styling. During successful post-tool autocompaction, Atomic temporarily replaces the Working indicator with the compaction loader and restores it before the same stream continues; no additional user input is required.

Post-tool autocompaction is more precisely delimited by its own event pair. Pi opens the follow-up turn while the compaction is still unmatched, so the compaction status — not a generic Working message — owns the status surface from `compaction_start` until `compaction_end`, and the interposed turn does not take it back early. The status paints as soon as the compaction starts rather than on the next animation frame, in the main chat and in an attached workflow-stage chat alike. Ordinary Working then resumes for the continuing stream on any successful mid-turn completion, including a compaction that found nothing to compact and therefore reports no result. A cancelled or failed compaction stops all activity instead. The main chat reports automatic cancellation; an attached workflow-stage chat clears the transient status because the abort event carries no error text. Failures retain their event-provided error text.

**Examples:** [working-indicator.ts](https://github.com/bastani-inc/atomic/blob/main/packages/coding-agent/examples/extensions/working-indicator.ts)

<!-- baseline-block: tui::038 -->

Source: `packages/coding-agent/docs/tui.md` lines 884–907 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/tui.md#pattern-6-custom-footer`.

### Pattern 6: Custom Footer

Replace the footer. `footerData` exposes data not otherwise accessible to extensions.

```typescript
ctx.ui.setFooter((tui, theme, footerData) => ({
  invalidate() {},
  render(width: number): string[] {
    // footerData.getGitBranch(): string | null
    // footerData.getExtensionStatuses(): ReadonlyMap<string, string>
    return [`${ctx.model?.id} (${footerData.getGitBranch() || "no git"})`];
  },
  dispose: footerData.onBranchChange(() => tui.requestRender()), // reactive
}));

ctx.ui.setFooter(undefined); // restore default
```

`ctx.ui.getFooterDataProvider()` exposes the same read-only provider to embedded extension UIs. In isolated interactive mode Atomic maintains the provider inside the engine session, mirrors every `setStatus()` update into it, and uses the session cwd with the same cached Git-branch watcher, so synchronous renderers can read current status and branch data without an RPC round trip or per-render Git process.

Token stats available via `ctx.sessionManager.getBranch()` and `ctx.model`.

**Examples:** [custom-footer.ts](https://github.com/bastani-inc/atomic/blob/main/packages/coding-agent/examples/extensions/custom-footer.ts)
