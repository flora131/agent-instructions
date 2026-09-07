import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import { AgentTaskHost } from "../../packages/coding-agent/src/core/tasks/agent-adapter.js";
import type { Cleanup, OperationId, TaskResult } from "../../packages/coding-agent/src/core/tasks/contracts.js";
import { WorkflowStageAdmissionBoundary } from "../../packages/coding-agent/src/core/workflow-stage-admission.js";

const intent = { kind: "agent" as const, agent: "worker", task: "Work" };
const operation = () => randomUUID() as OperationId;
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function host() {
	return new AgentTaskHost({ scope: { kind: "session", sessionId: randomUUID() }, authorizeLaunch() {} });
}

// RFC #2884: yield is observation only; replay retains the original execution and signal.
test("agent host starts once, resolves within owner, and cancels original execution after yield", async () => {
	const owner = host();
	const other = host();
	const result = deferred<TaskResult>();
	const cleanup = deferred<Cleanup>();
	let signal: AbortSignal | undefined;
	let starts = 0;
	const op = operation();
	const started = await owner.startAgentTask(intent, op, (context) => {
		starts++;
		signal = context.signal;
		assert.equal(
			context.reportActivity({ reportId: "action", change: { kind: "action", tool: "read", text: "Working" } }).ok,
			true,
		);
		return { result: result.promise, cleanup: cleanup.promise };
	});
	assert.ok(started.ok);
	const id = started.value.taskId;
	const before = owner.watchOwnerTasks();
	assert.ok(before.ok);
	const originalRef = before.value.snapshot.tasks[0].ref;
	before.value.dispose();
	const observation = await owner.observeAgentLaunch(id);
	assert.ok(observation.ok);
	assert.equal(observation.value.kind, "yielded");
	const after = owner.watchOwnerTasks();
	assert.ok(after.ok);
	assert.deepEqual(after.value.snapshot.tasks[0].ref, originalRef);
	assert.equal(after.value.snapshot.tasks[0].execution.kind, "running");
	after.value.dispose();
	const replay = await owner.startAgentTask(intent, op, () => {
		throw new Error("second execution");
	});
	assert.deepEqual(replay, started);
	assert.equal(starts, 1);
	assert.equal(signal?.aborted, false);
	assert.equal(other.resolveTask(id).ok, false);
	assert.equal((await other.waitForTask(id, 0)).ok, false);
	const cancelled = await owner.cancelTask(id, "user");
	assert.ok(cancelled.ok);
	assert.notEqual(cancelled.value.cleanup.kind, "reaped");
	assert.equal(signal?.aborted, true);
	assert.equal(signal?.reason, "user");
	cleanup.resolve({ kind: "reaped" });
	// Cancellation cleanup must not depend on the deliberately unresolved result.
	assert.equal((await owner.close("session-close")).ok, true);
	assert.equal((await other.close("session-close")).ok, true);
});

// RFC #2884: a natural terminal result still arrives from the promise supplied before yielding.
test("yielded agent observes the original result without another start", async () => {
	const owner = host();
	const result = deferred<TaskResult>();
	const cleanup = deferred<Cleanup>();
	const started = await owner.startAgentTask(intent, operation(), () => ({
		result: result.promise,
		cleanup: cleanup.promise,
	}));
	assert.ok(started.ok);
	await owner.observeAgentLaunch(started.value.taskId);
	const terminal: TaskResult = { kind: "failed", code: "Expected", message: "Original result" };
	result.resolve(terminal);
	const waited = await owner.waitForTask(started.value.taskId);
	assert.deepEqual(waited, { ok: true, value: { kind: "settled", taskId: started.value.taskId, result: terminal } });
	cleanup.resolve({ kind: "reaped" });
	assert.equal((await owner.close("session-close")).ok, true);
});

// RFC #2884: stage replacement shares lifetime, but a fresh generation never does.
test("boundary replacement retains original owner and session while closure fences launches", async () => {
	const boundary = new WorkflowStageAdmissionBoundary();
	const fresh = new WorkflowStageAdmissionBoundary();
	const session = randomUUID();
	boundary.bindTaskIdentity(session, "run", "stage");
	fresh.bindTaskIdentity(session, "run", "stage");
	const binding = { authorizeLaunch() {} };
	const owner = boundary.bindAgentTaskHost(binding);
	boundary.bindTaskIdentity("replacement", "run", "stage");
	assert.equal(boundary.bindAgentTaskHost(binding), owner);
	const distinct = fresh.bindAgentTaskHost(binding);
	const first = owner.watchOwnerTasks();
	const second = distinct.watchOwnerTasks();
	assert.ok(first.ok && second.ok);
	assert.notEqual(first.value.snapshot.ownerId, second.value.snapshot.ownerId);
	assert.equal(first.value.snapshot.scope.sessionId, session);
	assert.notDeepEqual(first.value.snapshot.scope, second.value.snapshot.scope);
	first.value.dispose();
	second.value.dispose();
	await boundary.close();
	const rejected = await owner.startAgentTask(intent, operation(), () => {
		throw new Error("closed runner");
	});
	assert.ok(!rejected.ok);
	assert.equal(rejected.error.code, "OwnerClosing");
	assert.throws(() => boundary.bindAgentTaskHost(binding), /closed/);
	await fresh.close();
});

// RFC #2884: trusted adapter never bypasses the existing launch guard.
test("launch refusal precedes admission and runner setup", async () => {
	const owner = new AgentTaskHost({
		scope: { kind: "session", sessionId: randomUUID() },
		authorizeLaunch() {
			throw new Error("delegation refused");
		},
	});
	await assert.rejects(
		owner.startAgentTask(intent, operation(), () => {
			throw new Error("runner reached");
		}),
		/delegation refused/,
	);
	const watch = owner.watchOwnerTasks();
	assert.ok(watch.ok);
	assert.equal(watch.value.snapshot.tasks.length, 0);
	watch.value.dispose();
	await owner.close("session-close");
});

// RFC #2884: repeated live host binding converges without losing per-launch dispatch context.
test("same-scope hosts dispatch each original launch factory", async () => {
	const binding = { scope: { kind: "session" as const, sessionId: randomUUID() }, authorizeLaunch() {} };
	const first = new AgentTaskHost(binding);
	const second = new AgentTaskHost(binding);
	let starts = 0;
	const runner = () => {
		starts++;
		return {
			result: Promise.resolve<TaskResult>({ kind: "failed", code: "Done", message: "done" }),
			cleanup: Promise.resolve<Cleanup>({ kind: "reaped" }),
		};
	};
	const launches = await Promise.all([
		first.startAgentTask(intent, operation(), runner),
		second.startAgentTask(intent, operation(), runner),
	]);
	assert.equal(starts, 2);
	for (const launched of launches) {
		assert.ok(launched.ok);
		assert.equal(first.resolveTask(launched.value.taskId).ok, true);
		assert.equal(second.resolveTask(launched.value.taskId).ok, true);
	}
	assert.equal((await first.close("session-close")).ok, true);
});
