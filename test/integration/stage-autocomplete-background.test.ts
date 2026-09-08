import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { CustomEditor } from "@bastani/atomic";
import { setKeybindings } from "@earendil-works/pi-tui";
import { Terminal } from "@xterm/headless";
import { test, vi } from "vitest";
import { KeybindingsManager } from "../../packages/coding-agent/src/core/keybindings.js";
import { createSessionSkillAutocompleteProvider } from "../../packages/coding-agent/src/modes/interactive/skill-command-autocomplete.js";
import { getEditorTheme, initTheme, theme } from "../../packages/coding-agent/src/modes/interactive/theme/theme.js";
import { deriveGraphThemeFromPiTheme } from "../../packages/workflows/src/tui/graph-theme.js";
import { createStageSkillFixture } from "../fixtures/stage-chat-skill-session.js";
import { makeTestTui } from "../support/fake-tui.js";

test.each(["dark", "light", "catppuccin-mocha"])(
	"%s stage skill suggestions keep main-chat default backgrounds and selected accent",
	async (name) => {
		const fixture = await createStageSkillFixture();
		initTheme(name, false);
		const keys = new KeybindingsManager();
		setKeybindings(keys);
		const graphTheme = deriveGraphThemeFromPiTheme(theme);
		const tui = makeTestTui(40);
		const main = new CustomEditor(tui, getEditorTheme(), keys);
		main.setAutocompleteProvider(createSessionSkillAutocompleteProvider(async () => fixture.stage.session));
		const view = fixture.mount({ piTui: tui, piKeybindings: keys, graphTheme });
		const width = 120;
		try {
			view.focused = true;
			main.focused = true;
			view.render(width);
			main.render(width);
			for (const character of "/skill:fi") {
				main.handleInput(character);
				view.handleInput(character);
			}
			const suggestions = (lines: string[]) =>
				lines.filter(
					(line) =>
						stripVTControlCharacters(line).includes("stage-project fixture") ||
						stripVTControlCharacters(line).includes("stage-user fixture"),
				);
			await vi.waitFor(() => {
				assert.equal(suggestions(main.render(width)).length, 3);
				assert.equal(suggestions(view.render(width)).length, 3);
			});
			for (let selection = 0; selection < 2; selection++) {
				const mainRows = suggestions(main.render(width));
				const stageRows = suggestions(view.render(width));
				const reference = `\x1b[38;2;${graphTheme.accent
					.slice(1)
					.match(/../g)!
					.map((part) => parseInt(part, 16))
					.join(";")}m→\x1b[0m`;
				const rows = [reference, ...mainRows, ...stageRows];
				const terminal = new Terminal({ cols: width, rows: rows.length, allowProposedApi: true });
				try {
					await new Promise<void>((resolve) =>
						terminal.write(rows.map((line) => `${line}\x1b[0m`).join("\r\n"), resolve),
					);
					for (let row = 1; row < rows.length; row++) {
						const line = terminal.buffer.active.getLine(row)!;
						for (let column = 0; column < width; column++) {
							assert.ok(
								line.getCell(column)?.isBgDefault(),
								`${name}, selection ${selection}, row ${row}, column ${column}: autocomplete uses terminal default background`,
							);
						}
						const selectedColumn = line.translateToString().indexOf("→");
						if (selectedColumn >= 0 && row > mainRows.length) {
							const selected = line.getCell(selectedColumn)!;
							assert.equal(
								selected.getFgColor(),
								terminal.buffer.active.getLine(0)!.getCell(0)!.getFgColor(),
								"selected workflow suggestion retains the theme accent",
							);
							assert.ok(!selected.isInverse(), "selection does not invert the default background");
						}
					}
				} finally {
					terminal.dispose();
				}
				main.handleInput("\x1b[B");
				view.handleInput("\x1b[B");
			}
		} finally {
			main.handleInput("\x1b");
			await fixture.cleanup();
		}
	},
);
