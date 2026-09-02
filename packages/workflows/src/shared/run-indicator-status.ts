import { effectiveRunStatus } from "./returned-run-status.js";
import type { RunSnapshot, RunStatus } from "./store-types.js";
import { reciprocalWorkflowRootRunId } from "./workflow-run-ownership.js";

/** The status represented by a run's primary indicator. */
export type RunIndicatorStatus = RunStatus | "awaiting_input";

const TERMINAL_OR_BLOCKED = new Set<RunStatus>(["completed", "failed", "killed", "cancelled", "skipped", "blocked"]);

/**
 * Whether a run status is authoritative over any stale awaiting-input fields.
 * A terminal or blocked run never contributes human-input state to a visible
 * ancestor.
 */
function isTerminalOrBlockedRun(run: RunSnapshot): boolean {
	return TERMINAL_OR_BLOCKED.has(effectiveRunStatus(run));
}

/**
 * Resolve the status represented by a run's primary indicator.
 *
 * A live run with a pending run/stage prompt is awaiting input. When the
 * caller supplies the complete run collection, pending prompts in hidden
 * nested descendants are attributed only through reciprocal workflow
 * boundaries. Effective terminal and blocked statuses are authoritative,
 * even when a stale prompt marker remains in a snapshot.
 */
export function runIndicatorStatus(run: RunSnapshot, allRuns: readonly RunSnapshot[] = [run]): RunIndicatorStatus {
	const status = effectiveRunStatus(run);
	if (isTerminalOrBlockedRun(run)) return status;
	if (runHasPendingInput(run)) return "awaiting_input";

	for (const candidate of visibleRunTreeMembers(run, allRuns)) {
		if (candidate.id !== run.id && runHasPendingInput(candidate)) return "awaiting_input";
	}
	return status;
}

/**
 * Precompute the indicator status of each listed run against the complete
 * run collection. The result is plain serializable data, so a surface whose
 * payload is persisted and re-rendered after a session restore (e.g. the
 * `/workflow status` chat entry) keeps hidden-descendant prompt attribution
 * without serializing the hidden run snapshots themselves.
 */
export function resolveRunIndicatorStatuses(
	runs: readonly RunSnapshot[],
	allRuns: readonly RunSnapshot[],
): Readonly<Record<string, RunIndicatorStatus>> {
	const statuses: Record<string, RunIndicatorStatus> = {};
	for (const run of runs) statuses[run.id] = runIndicatorStatus(run, allRuns);
	return statuses;
}

function runHasPendingInput(run: RunSnapshot): boolean {
	if (run.pendingPrompt !== undefined) return true;
	return run.stages.some(
		(stage) =>
			stage.status === "awaiting_input" ||
			stage.awaitingInputSince !== undefined ||
			stage.pendingPrompt !== undefined ||
			stage.inputRequest !== undefined,
	);
}

/**
 * Apply the indicator-specific liveness rule after canonical ownership has
 * already established a complete, acyclic chain to the visible run.
 */
function hasLiveAncestry(
	candidate: RunSnapshot,
	visibleRun: RunSnapshot,
	runsById: ReadonlyMap<string, RunSnapshot>,
): boolean {
	let parentRunId = candidate.parentRunId;
	while (parentRunId !== visibleRun.id) {
		if (parentRunId === undefined) return false;
		const parent = runsById.get(parentRunId);
		if (parent === undefined || isTerminalOrBlockedRun(parent)) return false;
		parentRunId = parent.parentRunId;
	}
	return true;
}

/**
 * Return the live, non-terminal members attributed to a visible run.
 *
 * This is the shared ancestry boundary for run indicators and widget-local
 * projections. A terminal or blocked visible root is authoritative, so its
 * descendants cannot manufacture a stale awaiting-input state.
 */
export function visibleRunTreeMembers(
	visibleRun: RunSnapshot,
	allRuns: readonly RunSnapshot[] = [visibleRun],
): RunSnapshot[] {
	if (isTerminalOrBlockedRun(visibleRun)) return [];

	const runsById = new Map(allRuns.map((candidate) => [candidate.id, candidate]));
	const members: RunSnapshot[] = [visibleRun];
	for (const candidate of allRuns) {
		if (candidate.id === visibleRun.id || isTerminalOrBlockedRun(candidate)) continue;
		if (reciprocalWorkflowRootRunId(runsById, candidate.id) !== visibleRun.id) continue;
		if (hasLiveAncestry(candidate, visibleRun, runsById)) members.push(candidate);
	}
	return members;
}
