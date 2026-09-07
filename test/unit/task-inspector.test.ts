import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { getKeybindings, setKeybindings } from "@earendil-works/pi-tui";
import { test } from "vitest";
import { KeybindingsManager } from "../../packages/coding-agent/src/core/keybindings.js";
import { TaskInspector } from "../../packages/coding-agent/src/modes/interactive/components/task-inspector.js";
import { initTheme } from "../../packages/coding-agent/src/modes/interactive/theme/theme.js";
import { taskFixture } from "../helpers/task-projection.js";

// RFC #2884: real owner tasks remain inspectable and cancellation needs target confirmation.
test("inspector keeps selected live task reachable in a short viewport and confirms cancellation", async () => {
	initTheme("dark");
	const previous = getKeybindings();
	setKeybindings(new KeybindingsManager());
	const fixture = taskFixture();
	let closed = false;
	const inspector = new TaskInspector(
		fixture.store,
		() => {},
		() => {
			closed = true;
		},
	);
	try {
		assert.match(inspector.render(48).join("\n"), /Launched agents and shells/);
		await fixture.start("first");
		await fixture.start("second");
		inspector.handleInput("\x1b[B");
		inspector.handleInput("\r");
		inspector.handleInput("\x1b[B");
		inspector.handleInput("\x1b[B");
		assert.match(stripVTControlCharacters(inspector.renderViewport(48, 4).join("\n")), /› Cancel task/);
		assert.match(inspector.renderViewport(48, 4).join("\n"), /\/tasks/);
		inspector.handleInput("\r");
		assert.match(inspector.render(80).join("\n"), new RegExp(fixture.store.tasks[1].ref.taskId));
		inspector.handleInput("n");
		assert.equal(fixture.store.tasks[1].execution.kind, "running");
		inspector.handleInput("\x1b");
		inspector.handleInput("\x1b");
		assert.equal(closed, true);
	} finally {
		inspector.dispose();
		await fixture.dispose();
		setKeybindings(previous);
	}
});
