import assert from "node:assert/strict";
import { setKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { test } from "vitest";
import { KeybindingsManager } from "../../packages/coding-agent/src/core/keybindings.js";
import {
	renderTaskFooter,
	TaskList,
	taskListSections,
} from "../../packages/coding-agent/src/modes/interactive/components/task-list.js";
import { TaskRow } from "../../packages/coding-agent/src/modes/interactive/components/task-row.js";
import { initTheme } from "../../packages/coding-agent/src/modes/interactive/theme/theme.js";
import { taskFixture } from "../helpers/task-projection.js";

initTheme();
setKeybindings(new KeybindingsManager());
const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");

// RFC #2884: compact rendering preserves identities and raw text, including zero metrics.
test("compact rows show states, zero counts and display-only truncation", async () => {
	const fixture = taskFixture();
	try {
		await fixture.start("\n first raw line \n second", "");
		const task = fixture.store.tasks[0];
		assert.match(task.title, /first raw line/);
		const rawTitle = "same description ".repeat(20);
		const sample = { ...task, title: rawTitle, metrics: { toolCount: 0 } };
		const lines = new TaskRow(sample, { duplicate: true }).render(40);
		assert.ok(lines.every((line) => visibleWidth(line) <= 40));
		assert.equal(sample.title, rawTitle);
		assert.match(plain(lines), /∀ worker:/);
		assert.match(plain(lines), /0 tool uses/);
		for (const kind of ["completed", "failed", "cancelled"] as const) {
			const result =
				kind === "completed"
					? { kind, output: task.output }
					: kind === "failed"
						? { kind, code: "failure", message: "failure" }
						: { kind, cause: "user" as const };
			const text = plain(new TaskRow({ ...task, execution: { kind: "settled", result } }).render(80));
			assert.match(text, new RegExp(kind));
			assert.doesNotMatch(text, /background|foreground/);
		}
		assert.match(plain(new TaskRow({ ...task, execution: { kind: "queued" } }).render(80)), /queued/);
		assert.match(
			plain(
				new TaskRow({
					...task,
					attention: {
						kind: "input-needed",
						requestId: "q",
						prompt: "",
						route: { sessionId: "s", promptId: "q" },
					},
				}).render(80),
			),
			/input-needed/,
		);
		assert.doesNotMatch(plain(new TaskRow(task).render(80)), /tool uses|tokens|elapsed/);
		assert.match(plain(new TaskRow(task, { expanded: true }).render(80)), /Prompt[\s\S]*Activity[\s\S]*Response/);
	} finally {
		await fixture.dispose();
	}
});

// RFC #2884: complete projections are not limited to the mounted viewport.
test("groups retain all tasks, one expansion hint and separate inspector type order", async () => {
	const fixture = taskFixture();
	try {
		for (let i = 0; i < 6; i++) await fixture.start("identical");
		const tasks = fixture.store.tasks.map((task) => ({ ...task, launchGroupId: "parallel" }));
		const text = plain(new TaskList(tasks).render(80));
		assert.match(text, /worker · 6 running/);
		assert.equal((text.match(/∀ worker:/g) ?? []).length, 6);
		assert.equal((text.match(/expand/g) ?? []).length, 1);
		assert.match(text, /├─/);
		assert.match(text, /└─/);
		assert.equal(new Set(tasks.map((task) => task.ref.taskId)).size, 6);
		const mixed = [tasks[0], { ...tasks[1], kind: "command" as const, agentName: undefined }, tasks[2]];
		assert.match(plain(new TaskList(mixed).render(80)), /Tasks · 3 running/);
		assert.deepEqual(
			taskListSections(mixed).map((section) => section.title),
			["Agents", "Shells"],
		);
		assert.deepEqual(taskListSections(mixed)[0].tasks, [mixed[0], mixed[2]]);
		assert.equal(plain(renderTaskFooter(tasks, 80)), "Tasks  6 agents running · /tasks");
		assert.deepEqual(renderTaskFooter([], 80), []);
	} finally {
		await fixture.dispose();
	}
});
