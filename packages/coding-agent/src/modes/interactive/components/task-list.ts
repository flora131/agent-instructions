import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { TaskRecord } from "../../../core/tasks/contracts.js";
import { theme } from "../theme/theme.js";
import { keyHintIfBound } from "./keybinding-hints.js";
import { TaskRow, taskLabel, taskState, taskTitle } from "./task-row.js";

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
		const lines: string[] = [];
		const grouped = new Set<string>();
		for (const task of this.tasks) {
			const group = task.launchGroupId;
			if (group && grouped.has(group)) continue;
			const siblings = group ? this.tasks.filter((item) => item.launchGroupId === group) : [task];
			if (group) {
				grouped.add(group);
				const labels = new Set(siblings.map(taskLabel));
				const counts = new Map<string, number>();
				for (const sibling of siblings) {
					const state = taskState(sibling);
					counts.set(state, (counts.get(state) ?? 0) + 1);
				}
				lines.push(
					theme.bold(
						truncateToWidth(
							`${labels.size === 1 ? taskLabel(task) : "Tasks"} · ${[...counts].map(([state, count]) => `${count} ${state}`).join(" · ")}`,
							width,
						),
					),
				);
			}
			for (const [index, sibling] of siblings.entries()) {
				const duplicate =
					this.tasks.filter(
						(item) => taskLabel(item) === taskLabel(sibling) && taskTitle(item) === taskTitle(sibling),
					).length > 1;
				const rows = new TaskRow(sibling, { expanded: this.expanded, duplicate, hint: !group }).render(
					Math.max(1, width - (group ? 2 : 0)),
				);
				lines.push(
					...rows.map((line, row) =>
						group
							? theme.fg("dim", row === 0 ? (index === siblings.length - 1 ? "└─" : "├─") : "  ") + line
							: line,
					),
				);
			}
			if (group) {
				const hint = keyHintIfBound("app.tools.expand", this.expanded ? "collapse" : "expand");
				if (hint) lines.push(theme.fg("dim", truncateToWidth(hint, width)));
			}
		}
		return lines;
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
