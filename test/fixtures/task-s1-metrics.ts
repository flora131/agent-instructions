import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as native from "@bastani/atomic-natives";
import type * as C from "../../packages/coding-agent/src/core/tasks/contracts.js";
import { TaskSupervisor } from "../../packages/coding-agent/src/core/tasks/supervisor.js";

function value<T, E>(result: C.Result<T, E>): T {
	assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error));
	if (!result.ok) throw new Error("refused");
	return result.value;
}
const actor = new native.TaskSupervisor();
const supervisor = new TaskSupervisor();
const scope: C.OwnerScope = { kind: "session", sessionId: randomUUID() };
const host = supervisor.bindHostSession({ scope, authorizeLaunch() {}, createRunner() {
	return { result: new Promise<C.TaskResult>(() => {}), cleanup: Promise.resolve<C.Cleanup>({ kind: "reaped" }) };
} });
const owner = value(supervisor.openTaskOwner(host, scope));
// Both facades share the real environment-local native actor, not a mock binding.
const nativeOwner = value(actor.openTaskOwner(actor.bindHostSession(scope), scope));
const task = value(actor.startAgentTask(nativeOwner, { kind: "agent", agent: "", task: " \r\n " }, ""));
const runner = value(actor.claimTaskRunner(task));
const watch = value(supervisor.watchOwnerTasks(owner));
const journal = value(actor.watchOwnerTasks(nativeOwner, () => {}));
const values = [undefined, NaN, -0, 0, 0.5, -0.5, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, 9007199254740994, Infinity, -Infinity, 4294967296];
const fields = ["elapsedMs", "toolCount", "tokenCount"] as const;
let expected: NonNullable<C.TaskRecord["metrics"]> = {};
let count = 0;
let conflicts = 0;
try {
	// RFC #2884: all optional-number combinations survive reports, deltas, snapshots and replay.
	for (const elapsedMs of values) for (const toolCount of values) for (const tokenCount of values) {
		const metrics = {
			...(elapsedMs === undefined ? {} : { elapsedMs }),
			...(toolCount === undefined ? {} : { toolCount }),
			...(tokenCount === undefined ? {} : { tokenCount }),
		};
		const report: C.ActivityReport = { reportId: ` metric ${count++} \n`, change: { kind: "metrics", ...metrics } };
		const receipt = value(actor.reportTaskActivity(runner, report));
		assert.equal(receipt.disposition, "accepted");
		assert.deepEqual(value(actor.reportTaskActivity(runner, report)), { ...receipt, disposition: "duplicate" });
		for (const field of fields) {
			for (const replacement of values) {
				if (Object.is(metrics[field], replacement)) continue;
				const changed = { ...metrics };
				if (replacement === undefined) delete changed[field]; else changed[field] = replacement;
				const refused = actor.reportTaskActivity(runner, { ...report, change: { kind: "metrics", ...changed } });
				assert.equal(!refused.ok && refused.error.code, "ReportConflict", `${field} must distinguish every numeric pair`);
				conflicts++;
			}
		}
		const drained = value(actor.drainOwnerTasks(journal.lease));
		assert.deepEqual(drained.cursor, receipt.cursor);
		assert.equal(drained.events.length, 1, "only the accepted report earns an event");
		const payload = drained.events[0].payload;
		assert.equal(payload.kind, "task-activity");
		if (payload.kind === "task-activity") assert.deepEqual(payload.activity, report);
		expected = { ...expected, ...metrics };
		watch.drain();
		assert.deepEqual(watch.snapshot.tasks[0].metrics, expected);
		const fresh = value(actor.watchOwnerTasks(nativeOwner, () => {}));
		try { assert.deepEqual(watch.snapshot, fresh.snapshot); } finally { actor.disposeSubscription(fresh.lease); }
		assert.deepEqual(watch.cursor, receipt.cursor);
	}
} finally {
	watch.dispose();
	actor.disposeSubscription(journal.lease);
	value(actor.cancelTask(task, "user"));
	value(actor.acknowledgeTaskCleanup(runner, { kind: "reaped" }));
	value(await supervisor.closeTaskOwner(owner, "session-close"));
}
console.log(`METRICS PRESERVED ${count} combinations ${conflicts} conflicts`);
