# Historical themes documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: themes::005 -->

Source: `packages/coding-agent/docs/themes.md` lines 30–43 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/themes.md#selecting-a-theme`.

## Selecting a Theme

Select a theme via `/settings` or in `settings.json`:

```json
{
  "theme": "my-theme"
}
```

Use `"theme": "light-theme/dark-theme"` for automatic mode. Atomic chooses the first theme when the terminal reports a light color scheme and the second theme for dark terminals, and it follows terminal color-scheme changes when supported.

On first run, Atomic detects your terminal background and defaults to `dark` or `light`.
