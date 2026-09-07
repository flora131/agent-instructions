import type { Container, TUI } from "@earendil-works/pi-tui";
import type { TaskId } from "../../core/tasks/contracts.js";
import { getOwnerTaskStore, type OwnerTaskStore, watchOwnerTaskStoreBinding } from "../../core/tasks/owner-store.js";
import { TaskRow } from "./components/task-row.js";

type InteractiveTaskHost = {
	session: object;
	chatContainer: Container;
	toolOutputExpanded: boolean;
	ui: Pick<TUI, "requestRender">;
};

const bindings = new WeakMap<InteractiveTaskHost, { store: OwnerTaskStore; dispose: () => void }>();
const sessionBindings = new WeakMap<InteractiveTaskHost, { session: object; dispose: () => void }>();
/** The launch tool's pending component is not the lifetime of a task anchor. */
export function refreshInteractiveTasks(mode: InteractiveTaskHost): void {
	if (sessionBindings.get(mode)?.session !== mode.session) {
		sessionBindings.get(mode)?.dispose();
		sessionBindings.set(mode, {
			session: mode.session,
			dispose: watchOwnerTaskStoreBinding(mode.session, () => refreshInteractiveTasks(mode)),
		});
	}
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
					return new TaskRow(current, {
						expanded: mode.toolOutputExpanded,
						duplicate,
						siblings: store.tasks,
						activity: store.recentActivity(current.ref.taskId),
						activityOmitted: store.activityOmitted(current.ref.taskId),
					}).render(width);
				},
			});
		}
		mode.ui.requestRender();
	};
	bindings.set(mode, { store, dispose: store.subscribe(update) });
	update();
}
export function disposeInteractiveTasks(mode: InteractiveTaskHost): void {
	sessionBindings.get(mode)?.dispose();
	sessionBindings.delete(mode);
	bindings.get(mode)?.dispose();
	bindings.delete(mode);
}
