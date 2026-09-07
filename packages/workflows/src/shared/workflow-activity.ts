/**
 * Pure root activity projection. Stage, tool and retry ownership uses
 * workflowActivityNodeKey(runId, nodeId), encoded as `${runId}:${nodeId}`;
 * stopping and acknowledgement ownership uses plain run ids.
 */

import type { WorkflowRootActivity } from "@bastani/atomic";
import type { RunSnapshot, StoreSnapshot } from "./store-types.js";

/**
 * Runtime execution ownership for one session. executingStageIds,
 * executingToolNodeIds and retryingStageIds contain run-qualified keys from
 * workflowActivityNodeKey; stoppingRunIds and acknowledgedFailureRunIds contain run ids.
 */
export interface WorkflowActivityOwnership {
	readonly ownerSessionId: string;
	/** Live executor ownership, absent for historical/recovered snapshots. */
	readonly liveRunIds?: ReadonlySet<string>;
	readonly executingStageIds: ReadonlySet<string>;
	readonly executingToolNodeIds: ReadonlySet<string>;
	readonly stoppingRunIds: ReadonlySet<string>;
	readonly retryingStageIds: ReadonlySet<string>;
	readonly acknowledgedFailureRunIds: ReadonlySet<string>;
}

export interface WorkflowActivityInput {
	readonly snapshot: StoreSnapshot;
	readonly ownership: WorkflowActivityOwnership;
}

/**
 * Build a node ownership key; callers must never use a bare run-local node id.
 * The first `:` delimits the runtime UUID run id; node ids may themselves contain `:`.
 */
export function workflowActivityNodeKey(runId: string, nodeId: string): string {
	return `${runId}:${nodeId}`;
}

function rootId(run: RunSnapshot, runs: ReadonlyMap<string, RunSnapshot>): string {
	if (run.rootRunId !== undefined) return run.rootRunId;
	if (run.parentRunId === undefined) return run.id;
	const parent = runs.get(run.parentRunId);
	return parent ? rootId(parent, runs) : run.parentRunId;
}

/** Check retained parent ids before the folded root fallback, including absent ancestor snapshots. */
function isStoppingRun(
	run: RunSnapshot,
	rootRunId: string,
	runs: ReadonlyMap<string, RunSnapshot>,
	stoppingRunIds: ReadonlySet<string>,
): boolean {
	let id: string | undefined = run.id;
	while (id !== undefined) {
		if (stoppingRunIds.has(id)) return true;
		id = runs.get(id)?.parentRunId;
	}
	return stoppingRunIds.has(rootRunId);
}

function projectRoot(
	rootRunId: string,
	runs: readonly RunSnapshot[],
	runById: ReadonlyMap<string, RunSnapshot>,
	ownership: WorkflowActivityOwnership,
): WorkflowRootActivity {
	let activeExecutionCount = 0;
	let humanWaits = 0;
	let manualWaits = 0;
	let retrying = false;
	let runnable = false;
	let paused = false;
	let stoppingExecutionCount = 0;
	let independentContinuation = false;
	for (const run of runs) {
		const runStopping = isStoppingRun(run, rootRunId, runById, ownership.stoppingRunIds);
		let runExecutionCount = (run.toolNodes ?? []).filter((tool) =>
			ownership.executingToolNodeIds.has(workflowActivityNodeKey(run.id, tool.id)),
		).length;
		const acceptsAttention =
			run.status === "running" || run.status === "pending" || run.status === "failed" || run.status === "blocked";
		if (acceptsAttention && run.pendingPrompt) humanWaits++;
		if (run.status === "paused") paused = true;
		if (
			acceptsAttention &&
			(run.status === "failed" ||
				run.status === "blocked" ||
				run.blockedAt !== undefined ||
				run.failureDisposition === "active_blocked") &&
			!ownership.acknowledgedFailureRunIds.has(run.id)
		)
			manualWaits++;
		const statuses = new Map([...run.stages, ...(run.toolNodes ?? [])].map((node) => [node.id, node.status]));
		for (const stage of run.stages) {
			if (run.status === "running" && stage.status === "paused") paused = true;
			if (stage.status === "awaiting_input" || stage.pendingPrompt) {
				if (acceptsAttention && stage.status !== "paused") humanWaits++;
				continue;
			}
			const key = workflowActivityNodeKey(run.id, stage.id);
			if (ownership.executingStageIds.has(key)) runExecutionCount++;
			if (ownership.retryingStageIds.has(key)) {
				retrying = true;
				if (!runStopping) independentContinuation = true;
			}
			if (
				run.status === "running" &&
				!runStopping &&
				stage.status === "pending" &&
				stage.parentIds.every((id) => statuses.get(id) === "completed")
			) {
				runnable = true;
				independentContinuation = true;
			}
		}
		// Author code can admit its successor only after the previous primitive
		// settles. Retain the live executor's continuation across that gap, but
		// never treat a parked node or historical running status as runnable work.
		if (
			ownership.liveRunIds?.has(run.id) &&
			run.status === "running" &&
			!runStopping &&
			!run.pendingPrompt &&
			run.blockedAt === undefined &&
			run.failureDisposition !== "active_blocked" &&
			run.stages.every(
				(stage) => !stage.pendingPrompt && (stage.status === "completed" || stage.status === "skipped"),
			) &&
			(run.toolNodes ?? []).every((tool) => tool.status === "completed")
		) {
			runnable = true;
			independentContinuation = true;
		}
		activeExecutionCount += runExecutionCount;
		if (runStopping) stoppingExecutionCount += runExecutionCount;
	}
	const actionableBlockCount = humanWaits + manualWaits;
	let state: WorkflowRootActivity["state"] = "idle";
	let reason: WorkflowRootActivity["reason"] = paused ? "paused" : "quiescent";
	if (activeExecutionCount > 0 || retrying || runnable) {
		state = "working";
		reason =
			activeExecutionCount > 0 && stoppingExecutionCount === activeExecutionCount && !independentContinuation
				? "stopping"
				: retrying
					? "retrying"
					: activeExecutionCount > 0
						? "executing"
						: "automatic_continuation";
	} else if (actionableBlockCount > 0) {
		state = "blocked";
		reason = humanWaits > 0 ? "awaiting_input" : "manual_intervention";
	}
	return {
		rootRunId,
		ownerSessionId: ownership.ownerSessionId,
		state,
		reason,
		activeExecutionCount,
		actionableBlockCount,
		needsAttention: actionableBlockCount > 0,
	};
}

/** Full root replacements in first-root-occurrence order; inputs and stored outcomes are unchanged. */
export function projectWorkflowActivity({ snapshot, ownership }: WorkflowActivityInput): WorkflowRootActivity[] {
	const byId = new Map(snapshot.runs.map((run) => [run.id, run]));
	const roots = new Map<string, RunSnapshot[]>();
	for (const run of snapshot.runs) {
		const id = rootId(run, byId);
		const group = roots.get(id);
		if (group) group.push(run);
		else roots.set(id, [run]);
	}
	return [...roots].map(([id, runs]) => projectRoot(id, runs, byId, ownership));
}
