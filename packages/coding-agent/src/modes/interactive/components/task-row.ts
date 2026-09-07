import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { TaskRecord } from "../../../core/tasks/contracts.js";
import { theme } from "../theme/theme.js";
import { keyHintIfBound as keyHint } from "./keybinding-hints.js";

/** Control removal and truncation apply only to terminal display, never task identity. */
export function taskDisplayText(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}
export function taskState(task: TaskRecord): string {
	if (task.execution.kind === "settled") return task.execution.result.kind;
	if (task.execution.kind === "cancelling") return "cancelling";
	if (task.attention.kind === "input-needed") return "input-needed";
	return task.execution.kind;
}
export function taskLabel(task: TaskRecord): string {
	return task.agentName ?? "bash";
}
export function taskTitle(task: TaskRecord): string {
	return task.title || taskLabel(task);
}
export function taskShortId(task: TaskRecord): string {
	return task.ref.taskId.slice(-6);
}
export class TaskRow implements Component {
	private readonly task: TaskRecord;
	private readonly options: { expanded?: boolean; duplicate?: boolean; hint?: boolean };
	constructor(task: TaskRecord, options: { expanded?: boolean; duplicate?: boolean; hint?: boolean } = {}) {
		this.task = task;
		this.options = options;
	}
	invalidate(): void {}
	render(width: number): string[] {
		const task = this.task;
		const state = taskState(task);
		const live = task.execution.kind === "running" || task.execution.kind === "queued";
		const badge = live && task.observation.kind !== "none" ? ` · ${task.observation.kind}` : "";
		const glyph = live ? "∀" : state === "completed" ? "✓" : state === "failed" ? "✗" : "·";
		const suffix = this.options.duplicate ? ` [${taskShortId(task)}]` : "";
		const title = `${glyph} ${taskDisplayText(taskLabel(task))}: ${taskDisplayText(taskTitle(task))}`;
		const lines = [theme.bold(truncateToWidth(title, Math.max(1, width - suffix.length))) + theme.fg("dim", suffix)];
		const action =
			live && task.currentAction
				? ` · ${taskDisplayText(task.currentAction.tool)} ${taskDisplayText(task.currentAction.text)}`
				: "";
		const tools = task.metrics?.toolCount === undefined ? "" : ` · ${task.metrics.toolCount} tool uses`;
		lines.push(truncateToWidth(`  ${state}${badge}${tools}${action}`, width));
		if (this.options.expanded) {
			lines.push(theme.fg("dim", truncateToWidth(`  ${task.ref.taskId} · owner ${task.ref.ownerId}`, width)));
			if (task.metrics?.elapsedMs !== undefined)
				lines.push(theme.fg("dim", `  elapsed ${task.metrics.elapsedMs} ms`));
			if (task.metrics?.tokenCount !== undefined) lines.push(theme.fg("dim", `  ${task.metrics.tokenCount} tokens`));
			lines.push("  Prompt", theme.fg("dim", "    Transcript unavailable"));
			lines.push(
				"  Activity",
				theme.fg(
					"dim",
					truncateToWidth(
						task.currentAction
							? `    ${taskDisplayText(task.currentAction.tool)} ${taskDisplayText(task.currentAction.text)}`
							: "    No retained activity",
						width,
					),
				),
			);
			lines.push("  Response", theme.fg("dim", "    Transcript unavailable"));
			if (task.execution.kind === "settled" && task.execution.result.kind === "failed")
				lines.push(truncateToWidth(`    ${taskDisplayText(task.execution.result.message)}`, width));
		}
		if (this.options.hint !== false) {
			const hint = keyHint("app.tools.expand", this.options.expanded ? "collapse" : "expand");
			if (hint) lines.push(theme.fg("dim", hint));
		}
		return lines.map((line) => truncateToWidth(line, width));
	}
}
