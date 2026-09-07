import assert from "node:assert/strict";
import { TaskSupervisor } from "../../packages/natives/native/index.js";

// RFC #2884, authorized amendment: 256 accepted identities, not indefinite activity replay.
const value = (result) => {
	assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error));
	return result.value;
};
const actor = new TaskSupervisor();
const scope = { kind: "session", sessionId: "retention" };
const owner = value(actor.openTaskOwner(actor.bindHostSession(scope), scope));
const intent = { kind: "agent", agent: "", task: " raw\ud800 " };
const task = value(actor.startAgentTask(owner, intent, "op"));
const runner = value(actor.claimTaskRunner(task));
const other = value(actor.startAgentTask(owner, intent, "other"));
const otherRunner = value(actor.claimTaskRunner(other));
const snapshot = () => {
	const watch = value(actor.watchOwnerTasks(owner, () => {}));
	actor.disposeSubscription(watch.lease);
	return watch.snapshot;
};
const report = (index) => ({ reportId: `${index}\udfff`, change: { kind: "action", tool: "", text: ` raw\ud800 ${index}` } });
const receipts = [];
for (let index = 0; index < 256; index++) receipts.push(value(actor.reportTaskActivity(runner, report(index))));
const beforeReplay = snapshot().cursor;
for (let index = 0; index < 256; index++) {
	assert.deepEqual(value(actor.reportTaskActivity(runner, report(index))), { ...receipts[index], disposition: "duplicate" });
	const conflict = { ...report(index), change: { ...report(index).change, text: ` raw\ufffd ${index}` } };
	assert.equal(actor.reportTaskActivity(runner, conflict).error?.code, "ReportConflict");
}
assert.deepEqual(snapshot().cursor, beforeReplay, "duplicate and conflict checks append no events");
assert.equal(value(actor.reportTaskActivity(otherRunner, report(0))).disposition, "accepted");
value(actor.reportTaskActivity(runner, report(256)));
const replay = value(actor.reportTaskActivity(runner, report(0)));
assert.equal(replay.disposition, "accepted", "257th identity evicts oldest even after duplicate checks");
assert.ok(BigInt(replay.cursor.sequence) > BigInt(receipts[0].cursor.sequence));
assert.deepEqual(snapshot().tasks[0].currentAction, { tool: "", text: report(0).change.text });
assert.equal(value(actor.reportTaskActivity(runner, report(1))).disposition, "accepted", "fresh replay evicts next oldest");
assert.equal(value(actor.reportTaskActivity(otherRunner, report(0))).disposition, "duplicate", "task windows are independent");
assert.deepEqual(value(actor.taskReference(value(actor.startAgentTask(owner, intent, "op")))), value(actor.taskReference(task)));
assert.equal(actor.startAgentTask(owner, { ...intent, task: " raw\ufffd " }, "op").error?.code, "OperationConflict");
const terminal = { reportId: "terminal\ud800", result: { kind: "failed", code: "", message: "raw\udfff", exitCode: -0 } };
const settlement = value(actor.reportTaskOutcome(runner, terminal));
// The settled task cannot churn its own window; live sibling activity must not affect its receipt.
for (let index = 1; index < 600; index++) value(actor.reportTaskActivity(otherRunner, report(index)));
assert.deepEqual(value(actor.reportTaskOutcome(runner, terminal)), settlement);
assert.equal(actor.reportTaskOutcome(runner, { ...terminal, result: { ...terminal.result, exitCode: 0 } }).error?.code, "ReportConflict");
assert.equal(actor.reportTaskActivity(runner, { ...report(0), reportId: terminal.reportId }).error?.code, "ReportConflict");
assert.equal(actor.reportTaskActivity(runner, report(2)).error?.code, "TaskTerminal", "evicted IDs cannot revive a terminal task");
value(actor.acknowledgeTaskCleanup(runner, { kind: "reaped" }));
value(actor.reportTaskOutcome(otherRunner, { reportId: "done", result: { kind: "cancelled", cause: "user" } }));
value(actor.acknowledgeTaskCleanup(otherRunner, { kind: "reaped" }));
value(await actor.closeTaskOwner(owner, "session-close"));
assert.deepEqual(value(actor.reportTaskOutcome(runner, terminal)), settlement);
assert.equal(value(actor.reportTaskActivity(runner, report(0))).disposition, "duplicate");
assert.equal(actor.reportTaskActivity(runner, report(2)).error?.code, "TaskTerminal");
console.log("RETENTION VERIFIED 256 duplicates 256 conflicts eviction replay isolation terminal closure operation identity");
