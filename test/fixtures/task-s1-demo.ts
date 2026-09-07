import assert from "node:assert/strict";
import type * as C from "../../packages/coding-agent/src/core/tasks/contracts.js";
import { type FakeRunnerContext, TaskSupervisor } from "../../packages/coding-agent/src/core/tasks/supervisor.js";

function value<T, E>(result: C.Result<T, E>): T {
	assert.equal(result.ok, true);
	return result.value;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

// RFC #2884: real native authority, one fake execution, no provider or process runner.
const supervisor = new TaskSupervisor();
const result = deferred<C.TaskResult>();
const cleanup = deferred<C.Cleanup>();
let runner!: FakeRunnerContext;
let starts = 0;
const scope: C.OwnerScope = { kind: "session", sessionId: "s1-terminal" };
const host = supervisor.bindHostSession({
	scope,
	authorizeLaunch() {},
	createRunner(context) {
		starts++;
		runner = context;
		return { result: result.promise, cleanup: cleanup.promise };
	},
});
const owner = value(supervisor.openTaskOwner(host, scope));
const watch = value(supervisor.watchOwnerTasks(owner));
const events: C.NativeEvent[] = [];
const collect = (async () => { for await (const event of watch.events) events.push(event); })();
try {
	const task = value(await supervisor.startAgentTask(owner, { kind: "agent", agent: "fake", task: "Inspect S1" }, "demo" as C.OperationId));
	const ref = supervisor.taskReference(task);
	const trace = (phase: string) => {
		assert.deepEqual(supervisor.taskReference(task), ref);
		console.log(`${phase} task=${ref.taskId} attempt=${ref.attemptId}`);
	};
	watch.drain();
	assert.equal(watch.snapshot.tasks[0].execution.kind, "running");
	trace("LAUNCH running");
	const initial = value(await supervisor.initialObservation(task));
	assert.equal(initial.kind === "yielded" && initial.reason, "default-background");
	trace("INITIAL default-background");
	const wait = value(supervisor.waitForTask(task, 0));
	const elapsed = value(await supervisor.observeTaskWait(wait));
	assert.equal(elapsed.kind === "yielded" && elapsed.reason, "elapsed");
	watch.drain();
	assert.equal(watch.snapshot.tasks[0].execution.kind, "running");
	trace("YIELD elapsed running");
	value(runner.reportActivity({ reportId: "action", change: { kind: "action", tool: "read", text: "Inspect S1" } }));
	watch.drain();
	assert.deepEqual(watch.snapshot.tasks[0].currentAction, { tool: "read", text: "Inspect S1" });
	trace("ACTIVITY read");
	const terminal = value(supervisor.waitForTask(task));
	result.resolve({ kind: "completed", output: watch.snapshot.tasks[0].output, exitCode: 0 });
	const settled = value(await supervisor.observeTaskWait(terminal));
	assert.equal(settled.kind === "settled" && settled.result.kind, "completed");
	trace("SETTLED completed");
	cleanup.resolve({ kind: "reaped" });
	const closed = value(await supervisor.closeTaskOwner(owner, "session-close"));
	assert.equal(closed.state, "closed");
	assert.equal(closed.tasks[0].cleanup.kind, "reaped");
	trace("CLOSE closed reaped");
	watch.drain();
	await collect;
	assert.equal(watch.snapshot.state, "closed");
	assert.equal(starts, 1);
	let previous = 0n;
	for (const event of events) {
		assert.equal(event.cursor.generation, ref.generation);
		assert.ok(BigInt(event.cursor.sequence) > previous);
		previous = BigInt(event.cursor.sequence);
		console.log(`CURSOR ${event.cursor.sequence} ${event.payload.kind}`);
	}
	assert.equal(events.at(-1)?.payload.kind, "owner-closed");
	console.log(`RUNNERS ${starts}`);
	console.log("DEMO COMPLETE");
} finally {
	watch.dispose();
	cleanup.resolve({ kind: "reaped" });
	value(await supervisor.closeTaskOwner(owner, "session-close"));
}
