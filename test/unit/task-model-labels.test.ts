import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { getKeybindings, setKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { test } from "vitest";
import { KeybindingsManager } from "../../packages/coding-agent/src/core/keybindings.js";
import { taskCompletionNotice } from "../../packages/coding-agent/src/core/tasks/completion.js";
import {
	completionNoticeFromDetails,
	TaskCompletionMessage,
} from "../../packages/coding-agent/src/modes/interactive/components/task-completion-message.js";
import { TaskDetail } from "../../packages/coding-agent/src/modes/interactive/components/task-detail.js";
import { TaskInspector } from "../../packages/coding-agent/src/modes/interactive/components/task-inspector.js";
import { TaskRow } from "../../packages/coding-agent/src/modes/interactive/components/task-row.js";
import { initTheme, theme } from "../../packages/coding-agent/src/modes/interactive/theme/theme.js";
import { renderSubagentToolResult } from "../../packages/subagents/src/extension/tool-rendering.js";
import { taskToolResult } from "../../packages/subagents/src/runs/foreground/task-execution.js";
import { taskFixture, taskValue } from "../helpers/task-projection.js";

for (const background of [false, true]) {
	test(`${background ? "background" : "foreground"} model settings survive fallback, settlement and snapshots`, async () => {
		initTheme("dark");
		const keys = getKeybindings();
		setKeybindings(new KeybindingsManager());
		const fixture = taskFixture();
		try {
			await fixture.start("Review", undefined, background);
			const context = fixture.runners[0].context;
			const report = {
				reportId: "model",
				change: { kind: "model" as const, model: "provider/first", thinking: "high" },
			};
			taskValue(context.reportActivity(report));
			assert.equal(taskValue(context.reportActivity(report)).disposition, "duplicate");
			assert.equal(context.reportActivity({ ...report, change: { ...report.change, thinking: "low" } }).ok, false);
			taskValue(
				context.reportActivity({
					reportId: "fallback",
					change: { kind: "model", model: "provider/fallback", thinking: "off" },
				}),
			);
			fixture.store.drain();
			for (const completed of [false, true]) {
				if (completed) await fixture.settle();
				const task = fixture.store.tasks[0];
				assert.equal(task.model, "provider/fallback");
				assert.equal(task.thinking, "off");
				const snapshot = taskValue(fixture.supervisor.watchOwnerTasks(fixture.owner));
				assert.equal(snapshot.snapshot.tasks[0].model, task.model);
				assert.equal(snapshot.snapshot.tasks[0].thinking, task.thinking);
				snapshot.dispose();
				const result = taskToolResult({
					kind: "admitted",
					observation: completed
						? { kind: "settled", taskId: task.ref.taskId, result: { kind: "completed", output: task.output } }
						: {
								kind: "yielded",
								taskId: task.ref.taskId,
								waitId: "wait" as import("../../packages/coding-agent/src/core/tasks/contracts.js").WaitId,
								reason: "explicit",
							},
				});
				result.details!.taskRecords = [task];
				const notification = taskCompletionNotice(
					{
						completionId: "completion",
						ownerId: task.ref.ownerId,
						taskId: task.ref.taskId,
						terminalSequence: "1" as import("../../packages/coding-agent/src/core/tasks/contracts.js").Sequence,
						result: { kind: "completed", output: task.output },
						display: false,
					},
					task,
				);
				const restored = completionNoticeFromDetails(JSON.parse(JSON.stringify({ notification })));
				assert.ok(restored);
				for (const expanded of [false, true]) {
					const row = new TaskRow(task, { expanded });
					const receipt = renderSubagentToolResult(result, { expanded, isPartial: false }, theme, {
						toolCallId: "fixture",
						state: {},
						invalidate() {},
					});
					for (const component of [
						row,
						receipt,
						new TaskDetail(task, { stdinAvailable: false }),
						new TaskCompletionMessage(restored, expanded),
					]) {
						const text = stripVTControlCharacters(component.render(100).join("\n"));
						assert.match(text, /provider\/fallback/);
						assert.match(text, /thinking off/);
						assert.doesNotMatch(text, /provider\/first/);
					}
					for (const width of [20, 48, 100])
						assert.ok(row.render(width).every((line) => visibleWidth(line) <= width));
				}
				if (background) {
					const inspector = new TaskInspector(
						fixture.store,
						() => {},
						() => {},
					);
					assert.match(
						stripVTControlCharacters(inspector.renderPicker(100, 24).join("\n")),
						/provider\/fallback.*thinking off/,
					);
					inspector.dispose();
				}
			}
		} finally {
			await fixture.dispose();
			setKeybindings(keys);
		}
	});
}
