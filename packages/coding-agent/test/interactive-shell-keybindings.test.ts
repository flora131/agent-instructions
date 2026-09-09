import { expect, test } from "vitest";
import { KEYBINDINGS } from "../src/core/keybindings.ts";

test("suspend has a platform binding that does not steal Windows editor undo", () => {
	expect(KEYBINDINGS["app.suspend"].defaultKeys).toBe(process.platform === "win32" ? "alt+z" : "ctrl+z");
	if (process.platform === "win32") {
		expect(KEYBINDINGS["tui.editor.undo"].defaultKeys).toBe("ctrl+z");
	}
});
