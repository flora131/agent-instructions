import assert from "node:assert/strict";
import type { WorkflowRootActivity } from "@bastani/atomic";
import { test } from "vitest";
import type { RunSnapshot, StageSnapshot, ToolNodeSnapshot } from "../../packages/workflows/src/shared/store-types.js";
import {
	projectWorkflowActivity,
	type WorkflowActivityOwnership,
	workflowActivityNodeKey,
} from "../../packages/workflows/src/shared/workflow-activity.js";

function stage(id: string, status: StageSnapshot["status"] = "running", parentIds: string[] = []): StageSnapshot {
	return { id, name: id, status, parentIds, toolEvents: [] };
}

function tool(id = "tool"): ToolNodeSnapshot {
	return {
		kind: "tool",
		id,
		name: id,
		argsHash: "hash",
		ordinal: 0,
		parentIds: [],
		status: "running",
		attachable: false,
	};
}

function run(patch: Partial<RunSnapshot> = {}): RunSnapshot {
	return { id: "root", name: "workflow", inputs: {}, status: "running", startedAt: 0, stages: [], ...patch };
}

function ownership(patch: Partial<WorkflowActivityOwnership> = {}): WorkflowActivityOwnership {
	return {
		ownerSessionId: "session",
		executingStageIds: new Set<string>(),
		executingToolNodeIds: new Set<string>(),
		stoppingRunIds: new Set<string>(),
		retryingStageIds: new Set<string>(),
		acknowledgedFailureRunIds: new Set<string>(),
		...patch,
	};
}

function project(runs: RunSnapshot[], patch: Partial<WorkflowActivityOwnership> = {}): WorkflowRootActivity[] {
	return projectWorkflowActivity({ snapshot: { runs, notices: [], version: 0 }, ownership: ownership(patch) });
}

function activity(patch: Partial<WorkflowRootActivity> = {}): WorkflowRootActivity {
	return {
		rootRunId: "root",
		ownerSessionId: "session",
		state: "idle",
		reason: "quiescent",
		activeExecutionCount: 0,
		actionableBlockCount: 0,
		needsAttention: false,
		...patch,
	};
}

const prompt = { id: "prompt", kind: "confirm" as const, message: "Private prompt", createdAt: 0 };
const executing = { state: "working", reason: "executing", activeExecutionCount: 1 } as const;
const waiting = { state: "blocked", reason: "awaiting_input", actionableBlockCount: 1, needsAttention: true } as const;

// #2891: a tool-only workflow contributes execution without an agent stage.
test("workflow activity projects owned tool-only execution", () => {
	assert.deepEqual(
		project([run({ toolNodes: [tool()] })], {
			executingToolNodeIds: new Set([workflowActivityNodeKey("root", "tool")]),
		}),
		[activity(executing)],
	);
});

// #2891: RFC 5.3 state precedence and ownership, rather than historical status.
test("workflow activity state table", () => {
	const cases: {
		name: string;
		run: RunSnapshot;
		ownership?: Partial<WorkflowActivityOwnership>;
		expected: Partial<WorkflowRootActivity>;
	}[] = [
		{
			name: "owned agent",
			run: run({ stages: [stage("agent")] }),
			ownership: { executingStageIds: new Set([workflowActivityNodeKey("root", "agent")]) },
			expected: executing,
		},
		{ name: "historical running stage", run: run({ stages: [stage("agent")] }), expected: {} },
		{ name: "historical running tool", run: run({ toolNodes: [tool()] }), expected: {} },
		{
			name: "runnable handoff",
			run: run({ stages: [stage("done", "completed"), stage("next", "pending", ["done"])] }),
			expected: { state: "working", reason: "automatic_continuation" },
		},
		{
			name: "initial runnable stage",
			run: run({ stages: [stage("next", "pending")] }),
			expected: { state: "working", reason: "automatic_continuation" },
		},
		{
			name: "incomplete parent",
			run: run({ stages: [stage("parent"), stage("next", "pending", ["parent"])] }),
			expected: {},
		},
		{ name: "missing parent", run: run({ stages: [stage("next", "pending", ["missing"])] }), expected: {} },
		{
			name: "tool parent completed",
			run: run({ stages: [stage("next", "pending", ["tool"])], toolNodes: [{ ...tool(), status: "completed" }] }),
			expected: { state: "working", reason: "automatic_continuation" },
		},
		{
			name: "retry backoff",
			run: run({ stages: [stage("agent")] }),
			ownership: { retryingStageIds: new Set([workflowActivityNodeKey("root", "agent")]) },
			expected: { state: "working", reason: "retrying" },
		},
		{
			name: "stop drain",
			run: run({ status: "cancelled", toolNodes: [tool()] }),
			ownership: {
				executingToolNodeIds: new Set([workflowActivityNodeKey("root", "tool")]),
				stoppingRunIds: new Set(["root"]),
			},
			expected: { ...executing, reason: "stopping" },
		},
		{
			name: "stop drained",
			run: run({ status: "cancelled", stages: [stage("next", "pending")] }),
			ownership: { stoppingRunIds: new Set(["root"]) },
			expected: {},
		},
		{
			name: "parked own prompt",
			run: run({ stages: [{ ...stage("agent", "awaiting_input"), pendingPrompt: prompt }] }),
			ownership: { executingStageIds: new Set([workflowActivityNodeKey("root", "agent")]) },
			expected: waiting,
		},
		{
			name: "prompt alone without status change",
			run: run({ stages: [{ ...stage("agent"), pendingPrompt: prompt }] }),
			ownership: { executingStageIds: new Set([workflowActivityNodeKey("root", "agent")]) },
			expected: waiting,
		},
		{ name: "stage awaiting input", run: run({ stages: [stage("agent", "awaiting_input")] }), expected: waiting },
		{ name: "run prompt", run: run({ pendingPrompt: prompt }), expected: waiting },
		{
			name: "independent parallel branch",
			run: run({ stages: [stage("wait", "awaiting_input"), stage("agent")] }),
			ownership: {
				executingStageIds: new Set([
					workflowActivityNodeKey("root", "wait"),
					workflowActivityNodeKey("root", "agent"),
				]),
			},
			expected: { ...executing, actionableBlockCount: 1, needsAttention: true },
		},
		{
			name: "run prompt and independent tool",
			run: run({ pendingPrompt: prompt, toolNodes: [tool()] }),
			ownership: { executingToolNodeIds: new Set([workflowActivityNodeKey("root", "tool")]) },
			expected: { ...executing, actionableBlockCount: 1, needsAttention: true },
		},
		{
			name: "failed",
			run: run({ status: "failed" }),
			expected: { state: "blocked", reason: "manual_intervention", actionableBlockCount: 1, needsAttention: true },
		},
		{
			name: "blocked",
			run: run({ status: "blocked" }),
			expected: { state: "blocked", reason: "manual_intervention", actionableBlockCount: 1, needsAttention: true },
		},
		{
			name: "failure acknowledged",
			run: run({ status: "failed" }),
			ownership: { acknowledgedFailureRunIds: new Set(["root"]) },
			expected: {},
		},
		{
			name: "paused",
			run: run({ status: "paused", stages: [stage("next", "pending")] }),
			expected: { reason: "paused" },
		},
		{
			name: "paused still draining",
			run: run({ status: "paused", toolNodes: [tool()] }),
			ownership: { executingToolNodeIds: new Set([workflowActivityNodeKey("root", "tool")]) },
			expected: executing,
		},
		{ name: "completed", run: run({ status: "completed" }), expected: {} },
		{ name: "cancelled", run: run({ status: "cancelled" }), expected: {} },
		{ name: "killed", run: run({ status: "killed" }), expected: {} },
		{ name: "skipped stage", run: run({ stages: [stage("skip", "skipped")] }), expected: {} },
		{
			name: "skipped parent is not completed",
			run: run({ stages: [stage("skip", "skipped"), stage("next", "pending", ["skip"])] }),
			expected: {},
		},
	];
	for (const scenario of cases) {
		assert.deepEqual(project([scenario.run], scenario.ownership), [activity(scenario.expected)], scenario.name);
	}
});

// #2891: descendants contribute once to their root, not separate root reports.
test("workflow activity folds nested descendants into roots in snapshot order", () => {
	const root = run();
	const child = run({ id: "child", parentRunId: "root", stages: [stage("wait", "awaiting_input")] });
	const grandchild = run({ id: "grandchild", parentRunId: "child", stages: [stage("agent")] });
	const explicit = run({ id: "explicit", rootRunId: "root", toolNodes: [tool()] });
	const other = run({ id: " other root ", status: "completed" });
	assert.deepEqual(
		project([grandchild, other, child, root, explicit], {
			executingStageIds: new Set([workflowActivityNodeKey("grandchild", "agent")]),
			executingToolNodeIds: new Set([workflowActivityNodeKey("explicit", "tool")]),
		}),
		[
			activity({ ...executing, activeExecutionCount: 2, actionableBlockCount: 1, needsAttention: true }),
			activity({ rootRunId: " other root " }),
		],
	);
});

// #2891: parked execution resumes only when its human wait is answered.
test("workflow activity follows prompt answer, pause, stop drain and acknowledgement transitions", () => {
	const agent: StageSnapshot = { ...stage("agent", "awaiting_input"), pendingPrompt: prompt };
	const current = run({ stages: [agent] });
	const owned = { executingStageIds: new Set([workflowActivityNodeKey("root", "agent")]) };
	assert.deepEqual(project([current], owned), [activity(waiting)]);
	agent.pendingPrompt = undefined;
	agent.status = "running";
	assert.deepEqual(project([current], owned), [activity(executing)]);
	current.status = "paused";
	assert.deepEqual(project([current]), [activity({ reason: "paused" })]);
	current.status = "running";
	assert.deepEqual(project([current], owned), [activity(executing)]);
	current.status = "cancelled";
	assert.deepEqual(project([current], { ...owned, stoppingRunIds: new Set(["root"]) }), [
		activity({ ...executing, reason: "stopping" }),
	]);
	assert.deepEqual(project([current], { stoppingRunIds: new Set(["root"]) }), [activity()]);
	current.status = "failed";
	assert.equal(project([current])[0].state, "blocked");
	assert.deepEqual(project([current], { acknowledgedFailureRunIds: new Set(["root"]) }), [activity()]);
	assert.equal(current.status, "failed", "acknowledgement must not rewrite the outcome");
});

// #2891: every call returns a complete replacement, never mutable accumulated deltas.
test("workflow activity is deterministic and returns independent full replacements", () => {
	for (let count = 0; count < 24; count++) {
		const stages = Array.from({ length: count }, (_, index) =>
			stage(` raw stage ${index} `, index % 3 === 0 ? "awaiting_input" : "running"),
		);
		const snapshot = {
			runs: [run({ stages }), run({ id: "other", status: "completed" })],
			notices: [],
			version: count,
		};
		const owned = ownership({
			ownerSessionId: " session raw ",
			executingStageIds: new Set(stages.map((stage) => workflowActivityNodeKey("root", stage.id))),
		});
		const before = structuredClone({ snapshot, ownership: owned });
		const first = projectWorkflowActivity({ snapshot, ownership: owned });
		const second = projectWorkflowActivity({ snapshot, ownership: owned });
		assert.deepEqual(first, second);
		assert.notEqual(first, second);
		assert.notEqual(first[0], second[0]);
		assert.equal(first[0].activeExecutionCount, count - Math.ceil(count / 3));
		assert.equal(first[0].actionableBlockCount, Math.ceil(count / 3));
		assert.equal(first[0].ownerSessionId, " session raw ");
		first[0].activeExecutionCount = 999;
		assert.deepEqual(projectWorkflowActivity({ snapshot, ownership: owned }), second);
		assert.deepEqual({ snapshot, ownership: owned }, before);
	}
	assert.deepEqual(project([]), []);
});

// #2891: retained prompts in inactive snapshots do not create new attention obligations.
test("paused and terminal roots stay idle without draining execution", () => {
	for (const status of ["paused", "completed", "cancelled", "killed"] as const) {
		assert.deepEqual(project([run({ status, pendingPrompt: prompt, stages: [stage("wait", "awaiting_input")] })]), [
			activity({ reason: status === "paused" ? "paused" : "quiescent" }),
		]);
	}
});

// #2891: recoverable blocks retain run.status=running in the real store.
test("workflow activity recognizes recoverable manual intervention without rewriting run status", () => {
	const blocked = run({ blockedAt: 0, failureDisposition: "active_blocked", stages: [stage("agent", "blocked")] });
	assert.deepEqual(project([blocked]), [
		activity({ state: "blocked", reason: "manual_intervention", actionableBlockCount: 1, needsAttention: true }),
	]);
	assert.deepEqual(project([blocked], { acknowledgedFailureRunIds: new Set(["root"]) }), [activity()]);
	assert.equal(blocked.status, "running");
});

// #2891: tool hashes are run-local, so ownership must include the run id.
test("workflow activity isolates identical tool ids in different roots", () => {
	const first = run({ id: "first", toolNodes: [tool("tool:hash")] });
	const historical = run({ id: "historical", toolNodes: [tool("tool:hash")] });
	assert.deepEqual(project([first, historical], { executingToolNodeIds: new Set(["tool:hash"]) }), [
		activity({ rootRunId: "first" }),
		activity({ rootRunId: "historical" }),
	]);
	assert.equal(workflowActivityNodeKey("first", "tool:hash"), "first:tool:hash");
	assert.equal(workflowActivityNodeKey(" raw run ", " raw:node "), " raw run : raw:node ");
	assert.equal(workflowActivityNodeKey("", ""), ":");
	assert.deepEqual(project([first, historical], { executingToolNodeIds: new Set(["first:tool:hash"]) }), [
		activity({ ...executing, rootRunId: "first" }),
		activity({ rootRunId: "historical" }),
	]);
});

// #2891: stage execution and backoff use the same run-qualified addressing as tools.
test("workflow activity qualifies stage execution and retry ownership", () => {
	const first = run({ id: "first", stages: [stage("agent")] });
	const historical = run({ id: "historical", stages: [stage("agent")] });
	for (const field of ["executingStageIds", "retryingStageIds"] as const) {
		assert.deepEqual(project([first, historical], { [field]: new Set(["agent"]) }), [
			activity({ rootRunId: "first" }),
			activity({ rootRunId: "historical" }),
		]);
		assert.deepEqual(
			project([first, historical], { [field]: new Set([workflowActivityNodeKey("first", "agent")]) }),
			[
				activity({
					rootRunId: "first",
					state: "working",
					reason: field === "executingStageIds" ? "executing" : "retrying",
					activeExecutionCount: field === "executingStageIds" ? 1 : 0,
				}),
				activity({ rootRunId: "historical" }),
			],
		);
	}
});
