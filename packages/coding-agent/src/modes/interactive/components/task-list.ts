import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { TaskRecord } from "../../../core/tasks/contracts.js";
import { theme } from "../theme/theme.ts";
import { TaskRow, taskLabel, taskTitle } from "./task-row.js";

/** Complete projection; viewport owners, not this list, decide how much to mount. */
export class TaskList implements Component {
	private readonly tasks: readonly TaskRecord[];
	private readonly expanded: boolean;
	constructor(tasks: readonly TaskRecord[], expanded = false) {
		this.tasks = tasks;
		this.expanded = expanded;
	}
	invalidate(): void {}
	render(width: number): string[] {
		return this.tasks.flatMap((task) => {
			const duplicate =
				this.tasks.filter((item) => taskLabel(item) === taskLabel(task) && taskTitle(item) === taskTitle(task))
					.length > 1;
			return new TaskRow(task, { expanded: this.expanded, duplicate, siblings: this.tasks }).render(width);
		});
	}
}
export function taskListSections(tasks: readonly TaskRecord[]): Array<{ title: string; tasks: TaskRecord[] }> {
	return (["agent", "command"] as const).flatMap((kind) => {
		const selected = tasks.filter((task) => task.kind === kind);
		return selected.length ? [{ title: kind === "agent" ? "Agents" : "Shells", tasks: selected }] : [];
	});
}
export function renderTaskFooter(tasks: readonly TaskRecord[], width: number): string[] {
	const background = tasks.filter(
		(task) =>
			task.observation.kind === "background" &&
			(task.execution.kind === "running" || task.execution.kind === "queued"),
	);
	const attention = tasks.filter((task) => task.attention.kind !== "none");
	if (!background.length && !attention.length) return [];
	const parts: string[] = [];
	if (attention.length) parts.push(`${attention.length} need attention`);
	const agents = background.filter((task) => task.kind === "agent" && task.execution.kind === "running").length;
	const shells = background.filter((task) => task.kind === "command" && task.execution.kind === "running").length;
	const queued = background.filter((task) => task.execution.kind === "queued").length;
	if (agents) parts.push(`${agents} agents running`);
	if (shells) parts.push(`${shells} shells running`);
	if (queued) parts.push(`${queued} queued`);
	const route = " · /tasks";
	return [theme.fg("dim", truncateToWidth(`Tasks  ${parts.join(" · ")}`, Math.max(1, width - route.length)) + route)];
}
