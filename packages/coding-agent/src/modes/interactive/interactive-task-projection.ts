import type { TaskId } from "../../core/tasks/contracts.js";
import { getOwnerTaskStore, type OwnerTaskStore } from "../../core/tasks/owner-store.js";
import { TaskRow } from "./components/task-row.js";
import type { InteractiveModeBase } from "./interactive-mode-base.js";

const bindings = new WeakMap<InteractiveModeBase, { store: OwnerTaskStore; dispose: () => void }>();
/** The launch tool's pending component is not the lifetime of a task anchor. */
export function refreshInteractiveTasks(mode: InteractiveModeBase): void {
	const store = getOwnerTaskStore(mode.session);
	if (!store || bindings.get(mode)?.store === store) return;
	bindings.get(mode)?.dispose();
	const mounted = new Set<TaskId>();
	const update = () => {
		for (const task of store.tasks) {
			if (mounted.has(task.ref.taskId)) continue;
			mounted.add(task.ref.taskId);
			mode.chatContainer.addChild({
				invalidate() {},
				render(width: number) {
					const current = store.tasks.find((item) => item.ref.taskId === task.ref.taskId) ?? task;
					const duplicate =
						store.tasks.filter((item) => item.agentName === current.agentName && item.title === current.title)
							.length > 1;
					return new TaskRow(current, { expanded: mode.toolOutputExpanded, duplicate }).render(width);
				},
			});
		}
		mode.ui.requestRender();
	};
	bindings.set(mode, { store, dispose: store.subscribe(update) });
	update();
}
export function disposeInteractiveTasks(mode: InteractiveModeBase): void {
	bindings.get(mode)?.dispose();
	bindings.delete(mode);
}
