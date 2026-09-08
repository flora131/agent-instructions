import type { WorkflowActivityPublisher, WorkflowRootActivity } from "@bastani/atomic";
import type { Store } from "../shared/store.js";
import { workflowObservationRuntime } from "../shared/store-factory.js";
import { subscribeStoreInvalidation } from "../shared/store-observation.js";
import { projectWorkflowActivity } from "../shared/workflow-activity.js";
import type { WorkflowRuntimeEvent } from "../shared/workflow-observation-runtime.js";

/** One bridge per extension activation, attached to its concrete adopted store. */
export function createWorkflowObservation(
	store: Store,
	publisher: WorkflowActivityPublisher,
	ownerSessionId: string,
): { dispose(): void } {
	const runtime = workflowObservationRuntime(store);
	let roots = new Map<string, WorkflowRootActivity>();
	const project = (): WorkflowRootActivity[] =>
		projectWorkflowActivity({ snapshot: store.graphSnapshot(), ownership: { ...runtime, ownerSessionId } });
	const snapshot = (): void => {
		if (runtime.recovering) publisher.publishSnapshot({ availability: "recovering" });
		else {
			const current = project();
			roots = new Map(current.map((root) => [root.rootRunId, root]));
			publisher.publishSnapshot({ availability: "ready", roots: current });
		}
	};
	const unsubscribe = subscribeStoreInvalidation(store, () => {
		if (runtime.recovering) return;
		const current = project();
		const next = new Map(current.map((root) => [root.rootRunId, root]));
		for (const root of current) {
			if (JSON.stringify(roots.get(root.rootRunId)) !== JSON.stringify(root)) publisher.publishChanged(root);
		}
		for (const id of roots.keys()) if (!next.has(id)) publisher.publishRemoved(id);
		roots = next;
	});
	const observeRuntime = (event: WorkflowRuntimeEvent): void => {
		if (event.kind === "availability") snapshot();
		else if (event.kind === "lifecycle") publisher.publishLifecycle({ ...event.event, ownerSessionId });
		else publisher.publishHeartbeat({ ...event.event, ownerSessionId });
	};
	runtime.listeners.add(observeRuntime);
	snapshot();
	return {
		dispose() {
			unsubscribe();
			runtime.listeners.delete(observeRuntime);
			publisher.dispose();
		},
	};
}
