import { type Component, Text } from "@earendil-works/pi-tui";
import type { Attention, Execution, TaskRecord } from "../../../core/tasks/contracts.js";
import { theme } from "../theme/theme.ts";
import { keyHintIfBound } from "./keybinding-hints.ts";

export type TaskDetailAction = "transcript" | "foreground" | "cancel" | "input" | "question";

export function taskDetailActions(
	execution: Execution,
	attention: Attention,
	stdinAvailable: boolean,
): TaskDetailAction[] {
	if (execution.kind === "settled") return ["transcript"];
	return [
		"transcript",
		"foreground",
		"cancel",
		...(stdinAvailable ? ["input" as const] : []),
		...(attention.kind === "input-needed" ? ["question" as const] : []),
	];
}

const labels: Record<TaskDetailAction, string> = {
	transcript: "Inspect transcript",
	foreground: "Foreground wait",
	cancel: "Cancel task…",
	input: "Input",
	question: "Open question",
};

/** A focused view of the same record, never another lifecycle transcript anchor. */
export class TaskDetail implements Component {
	private task: TaskRecord;
	private content: { prompt?: string; output?: string; stdinAvailable: boolean };
	constructor(task: TaskRecord, content: { prompt?: string; output?: string; stdinAvailable: boolean }) {
		this.task = task;
		this.content = content;
	}

	update(task: TaskRecord, content = this.content): void {
		this.task = task;
		this.content = content;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const task = this.task;
		const state = task.execution.kind === "settled" ? task.execution.result.kind : task.execution.kind;
		const lines = [
			theme.bold(task.title),
			state,
			theme.fg("dim", `Owner ${task.ref.ownerId}\nTask ${task.ref.taskId}`),
		];
		const metrics = task.metrics;
		if (metrics) {
			const values = [
				metrics.elapsedMs === undefined ? "" : `${metrics.elapsedMs}ms`,
				metrics.toolCount === undefined ? "" : `${metrics.toolCount} tools`,
				metrics.tokenCount === undefined ? "" : `${metrics.tokenCount} tokens`,
			].filter(Boolean);
			if (values.length) lines.push(theme.fg("dim", values.join(" · ")));
		}
		if (this.content.prompt !== undefined) lines.push("Prompt", this.content.prompt);
		if (this.content.output !== undefined) lines.push("Output", this.content.output);
		if (task.currentAction)
			lines.push("Recent activity", theme.fg("muted", `· ${task.currentAction.tool} ${task.currentAction.text}`));
		lines.push("Actions");
		for (const action of taskDetailActions(task.execution, task.attention, this.content.stdinAvailable)) {
			const hint =
				action === "foreground" || action === "cancel" || action === "input"
					? keyHintIfBound(`app.tasks.${action}`, labels[action])
					: "";
			lines.push(hint || labels[action]);
		}
		return new Text(lines.join("\n"), 0, 0).render(width);
	}
}
