import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import * as native from "@bastani/atomic-natives";
import type * as C from "../../packages/coding-agent/src/core/tasks/contracts.js";
import { TaskSupervisor } from "../../packages/coding-agent/src/core/tasks/supervisor.js";

function value<T, E>(result: C.Result<T, E>): T {
	assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error));
	if (!result.ok) throw new Error("refused");
	return result.value;
}
function refused<T>(result: C.Result<T, native.TaskFailure>, code: string): void {
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, code);
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
	const OBSERVATION_LIMIT_MS = 2000;
	let timer!: ReturnType<typeof setTimeout>;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error("collision settlement/cleanup did not finish")), OBSERVATION_LIMIT_MS);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
const unhandled: string[] = [];
const onUnhandled = (error: Error) => unhandled.push(String(error));
process.on("unhandledRejection", onUnhandled);
const candidate = (index: number): string => (index === 0 ? "runner-outcome" : `runner-outcome-${index}`);
const report = (reportId: string): C.ActivityReport => ({
	reportId,
	change: { kind: "action", tool: "", text: " raw\u0000\ud800 " },
});
const rawIds = ["", "\u0000", "\ud800", "\udfff", "__proto__", "constructor", "runner-outcome-256"];
function collide(context: {
	reportActivity(activity: C.ActivityReport): C.Result<native.ReportReceipt, native.TaskFailure>;
}): void {
	// RFC #2884: no caller ID is reserved, normalized or silently rewritten.
	for (const id of [...rawIds, ...Array.from({ length: 256 }, (_unused, index) => candidate(index))]) {
		const activity = report(id);
		const receipt = value(context.reportActivity(activity));
		assert.equal(receipt.reportId, id);
		assert.equal(receipt.disposition, "accepted");
		assert.deepEqual(value(context.reportActivity(activity)), { ...receipt, disposition: "duplicate" });
		const conflict = context.reportActivity({ reportId: id, change: { kind: "action", tool: "", text: "changed" } });
		assert.equal(!conflict.ok && conflict.error.code, "ReportConflict");
	}
}

// RFC #2884: exercise the real facade and binding; no replacement runner/report authority.
async function facadeScenario(mode: "completed" | "failed" | "rejected" | "setup" | "cancelled", cleanupFirst: boolean) {
	const supervisor = new TaskSupervisor();
	const scope: C.OwnerScope = { kind: "session", sessionId: `${mode}-${cleanupFirst}` };
	const result = deferred<C.TaskResult>();
	const cleanup = deferred<C.Cleanup>();
	let executions = 0;
	const host = supervisor.bindHostSession({
		scope,
		tasks: { wait: { kind: "until-settled" } },
		authorizeLaunch() {},
		createRunner(context) {
			executions++;
			collide(context);
			if (mode === "setup") throw new Error(" setup\ud800 ");
			return { result: result.promise, cleanup: cleanup.promise };
		},
	});
	const owner = value(supervisor.openTaskOwner(host, scope));
	const intent: C.AgentIntent = { kind: "agent", agent: "", task: " raw\udfff " };
	const operation = "" as C.OperationId;
	const task = value(await supervisor.startAgentTask(owner, intent, operation));
	assert.equal(value(await supervisor.startAgentTask(owner, intent, operation)), task);
	assert.equal(executions, 1);
	const ref = supervisor.taskReference(task);
	const watch = value(supervisor.watchOwnerTasks(owner));
	const output: C.OutputRef = {
		ownerId: ref.ownerId,
		taskId: ref.taskId,
		artifactId: "",
		byteCount: "0",
		omittedRanges: [{ start: "0", end: "0" }, { start: "0", end: "0" }],
	};
	const natural: C.TaskResult = { kind: "completed", output, exitCode: -0 };
	const expected: C.TaskResult =
		mode === "completed"
			? natural
			: mode === "cancelled"
				? { kind: "cancelled", cause: "user", ...(cleanupFirst ? {} : { output }) }
				: { kind: "failed", code: mode === "setup" ? "SpawnFailed" : mode === "rejected" ? "RunnerFailed" : "", message: ` ${mode}\ud800 ` };
	try {
		if (mode !== "setup") {
			assert.equal(watch.snapshot.tasks[0].execution.kind, "running");
			assert.equal(value(await supervisor.initialObservation(task)).kind, "yielded");
			if (cleanupFirst) {
				cleanup.resolve({ kind: "reaped" });
				await setImmediate();
				watch.drain();
				assert.equal(watch.snapshot.tasks[0].execution.kind, "running");
				assert.equal(watch.snapshot.tasks[0].cleanup.kind, "active", "natural reaping waits for the result");
			}
		}
		const waiting = supervisor.waitForTask(task);
		if (mode === "cancelled") {
			assert.equal(value(await supervisor.cancelTask(task, "user")).decision, "cancellation-requested");
			if (cleanupFirst) {
				// Cancellation can settle/close without a result; a late natural result cannot replace it.
				assert.deepEqual(value(await bounded(waiting)), { kind: "settled", taskId: ref.taskId, result: expected });
				assert.equal(value(await bounded(supervisor.closeTaskOwner(owner, "session-close"))).state, "closed");
			}
			result.resolve(natural);
		} else if (mode === "rejected") result.reject(new Error(" rejected\ud800 "));
		else if (mode !== "setup") result.resolve(expected);
		if (mode === "cancelled" && !cleanupFirst) {
			await setImmediate();
			watch.drain();
			assert.equal(watch.snapshot.tasks[0].execution.kind, "cancelling");
			cleanup.resolve({ kind: "reaped" });
		}
		assert.deepEqual(value(await bounded(waiting)), { kind: "settled", taskId: ref.taskId, result: expected });
		await setImmediate();
		watch.drain();
		if (mode !== "setup" && !cleanupFirst && mode !== "cancelled") {
			assert.equal(watch.snapshot.tasks[0].cleanup.kind, "active", "a terminal result is not cleanup evidence");
			cleanup.resolve({ kind: "reaped" });
		}
		const closing = await bounded(supervisor.closeTaskOwner(owner, "session-close"));
		if (mode === "setup") {
			assert.equal(!closing.ok && closing.error.code, "CleanupFailed");
			watch.drain();
			assert.equal(watch.snapshot.state, "closing");
			assert.equal(watch.snapshot.tasks[0].cleanup.kind, "failed");
		} else {
			const closed = value(closing);
			assert.equal(closed.state, "closed");
			assert.deepEqual(closed.tasks[0].execution, { kind: "settled", result: expected });
			assert.equal(closed.tasks[0].cleanup.kind, "reaped");
		}
		assert.deepEqual(supervisor.taskReference(task), ref);
		assert.equal(executions, 1);
		console.log(`FACADE ${mode} cleanupFirst=${cleanupFirst} settled; close=${closing.ok ? "closed" : closing.error.code}`);
	} finally {
		watch.dispose();
	}
}
for (const mode of ["completed", "failed", "rejected", "cancelled"] as const) {
	for (const cleanupFirst of [true, false]) await facadeScenario(mode, cleanupFirst);
}
await facadeScenario("setup", true);

// RFC #2884: private support and caller reports share native terminal/replay authority.
const actor = new native.TaskSupervisor();
const scope: native.OwnerScope = { kind: "session", sessionId: "native-collisions" };
const owner = value(actor.openTaskOwner(actor.bindHostSession(scope), scope));
const intent: native.AgentIntent = { kind: "agent", agent: "", task: "" };
const task = value(actor.startAgentTask(owner, intent, ""));
const runner = value(actor.claimTaskRunner(task));
collide({ reportActivity: (activity) => actor.reportTaskActivity(runner, activity) });
const watch = value(actor.watchOwnerTasks(owner, () => {}));
const terminal: native.TaskResult = { kind: "failed", code: "", message: " raw\udfff ", exitCode: -0 };
refused(actor.reportTaskOutcome(runner, { reportId: candidate(0), result: terminal }), "ReportConflict");
const receipt = value(actor.reportRunnerOutcome(runner, terminal));
const accepted = { reportId: candidate(256), result: terminal };
assert.deepEqual(value(actor.reportTaskOutcome(runner, accepted)), receipt, "all first 256 candidates really collided");
const events = value(actor.drainOwnerTasks(watch.lease)).events;
assert.deepEqual(events.map((event) => event.payload.kind), ["host-observation-changed", "task-settled"], "allocation emits no candidate facts");
assert.equal(BigInt(receipt.cursor.sequence) - BigInt(watch.cursor.sequence), 2n);
assert.deepEqual(value(actor.reportRunnerOutcome(runner, terminal)), receipt);
refused(actor.reportRunnerOutcome(runner, { ...terminal, exitCode: 0 }), "ReportConflict");
refused(actor.reportTaskOutcome(runner, { reportId: "different", result: terminal }), "ReportConflict");
refused(actor.reportTaskActivity(runner, report(candidate(256))), "ReportConflict");
for (let index = 0; index < 256; index++) {
	assert.equal(value(actor.reportTaskActivity(runner, report(candidate(index)))).disposition, "duplicate", "selection does not evict activity identities");
}
assert.equal(value(actor.drainOwnerTasks(watch.lease)).events.length, 0, "replay and conflict emit no facts");
value(actor.acknowledgeTaskCleanup(runner, { kind: "reaped" }));
// A caller's prior terminal ID may itself be empty or an unpaired surrogate.
for (const id of rawIds) {
	const priorTask = value(actor.startAgentTask(owner, intent, `prior-${id}`));
	const priorRunner = value(actor.claimTaskRunner(priorTask));
	const prior: native.SettlementReceipt = value(actor.reportTaskOutcome(priorRunner, { reportId: id, result: terminal }));
	assert.deepEqual(value(actor.reportRunnerOutcome(priorRunner, terminal)), prior);
	refused(actor.reportRunnerOutcome(priorRunner, { kind: "cancelled", cause: "user" }), "ReportConflict");
	assert.deepEqual(value(actor.reportTaskOutcome(priorRunner, { reportId: id, result: terminal })), prior);
	value(actor.acknowledgeTaskCleanup(priorRunner, { kind: "reaped" }));
}
value(await bounded(actor.closeTaskOwner(owner, "session-close")));
assert.deepEqual(value(actor.reportRunnerOutcome(runner, terminal)), receipt);
assert.deepEqual(value(actor.reportTaskOutcome(runner, accepted)), receipt);
actor.disposeSubscription(watch.lease);
await setImmediate();
await setImmediate();
assert.deepEqual(unhandled, [], "no result, setup, late cancellation or cleanup path leaks a rejection");
process.off("unhandledRejection", onUnhandled);
console.log("REPORT COLLISIONS SETTLED 256 forced candidates; 9 facade scenarios; native replay and 7 prior terminal IDs");
