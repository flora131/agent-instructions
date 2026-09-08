import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { ExtensionUIContext } from "../../core/extensions/index.js";
import type { TaskId } from "../../core/tasks/contracts.js";
import { getOwnerTaskStore, type OwnerTaskStore, watchOwnerTaskStoreBinding } from "../../core/tasks/owner-store.js";
import { TaskInspector } from "../interactive/components/task-inspector.js";
import { isActiveBackgroundTask, renderTaskFooter } from "../interactive/components/task-list.js";
import { isPhysicalCtrlC } from "../interactive/interactive-key-identity.ts";

const widgetVisibility = new WeakMap<AgentSession, (visible: boolean) => void>();

/** Render against the engine's owner. Native capabilities never cross the UI bridge. */
export function bindEngineTaskWidget(session: AgentSession, ui: ExtensionUIContext): () => void {
	const key = "atomic.background-tasks";
	let unsubscribe = () => {};
	let disposed = false;
	let mounted = false;
	let visible = true;
	const connect = () => {
		unsubscribe();
		if (mounted) ui.setWidget(key, undefined);
		mounted = false;
		const store = getOwnerTaskStore(session);
		const update = () => {
			if (disposed) return;
			if (!visible || !store?.backgroundTasks.some(isActiveBackgroundTask)) {
				if (mounted) ui.setWidget(key, undefined);
				mounted = false;
				return;
			}
			if (!mounted) {
				mounted = true;
				ui.setWidget(
					key,
					() => ({
						invalidate() {},
						render(width: number) {
							return renderTaskFooter(store?.backgroundTasks ?? [], width);
						},
					}),
					{ placement: "belowEditor" },
				);
			}
			ui.requestRender();
		};
		unsubscribe = store?.subscribe(update) ?? (() => {});
		update();
	};
	const unwatch = watchOwnerTaskStoreBinding(session, connect);
	const unwatchWidget = ui.onWidgetRelease?.(key, () => {
		mounted = false;
	});
	widgetVisibility.set(session, (value) => {
		visible = value;
		connect();
	});
	connect();
	return () => {
		disposed = true;
		widgetVisibility.delete(session);
		unwatch();
		unwatchWidget?.();
		unsubscribe();
		if (mounted) ui.setWidget(key, undefined);
	};
}

export async function showEngineTaskInspector(
	session: AgentSession,
	ui: Pick<ExtensionUIContext, "custom">,
	taskId?: string,
): Promise<void> {
	session.getAgentTaskHost();
	const store = getOwnerTaskStore(session);
	if (!store) throw new Error("Task owner is unavailable");
	try {
		widgetVisibility.get(session)?.(false);
		await showTaskInspector(ui, store, taskId);
	} finally {
		widgetVisibility.get(session)?.(true);
	}
}

/** Main CLI mount, shared by the local host and its isolated engine. */
export async function showTaskInspector(
	ui: Pick<ExtensionUIContext, "custom">,
	store: OwnerTaskStore,
	taskId?: string,
): Promise<void> {
	let inspector: TaskInspector | undefined;
	try {
		await ui.custom<void>(
			(tui, _theme, _keys, done) => {
				inspector = new TaskInspector(
					store,
					() => tui.requestRender(),
					() => done(),
				);
				inspector.open(taskId as TaskId | undefined);
				return {
					invalidate: () => inspector?.invalidate(),
					render: (width: number) => {
						const height = Math.max(1, tui.terminal.rows);
						const lines = inspector?.renderViewport(width, height) ?? [];
						// Overlay maxHeight is only a cap. Pad short views so no parent
						// chat or prompt cells remain visible beneath the inspector.
						return Array.from({ length: height }, (_, row) => {
							const line = truncateToWidth(lines[row] ?? "", width);
							return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
						});
					},
					handleInput: (data: string) => {
						// Local overlays receive safety keys directly. The isolated host
						// dismisses this remote view through its ordinary Ctrl+C route.
						if (isPhysicalCtrlC(data)) done();
						else inspector?.handleInput(data);
						// A declined key is replayed into the main transcript by the host.
						// The fullscreen inspector owns even keys its current view ignores.
						return true;
					},
				};
			},
			{
				overlay: true,
				deferInlineCustomUiFocus: true,
				handlesInternalUiAction: true,
				overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 },
			},
		);
	} finally {
		inspector?.dispose();
	}
}
