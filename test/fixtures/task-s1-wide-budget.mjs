import assert from "node:assert/strict";
import { TaskSupervisor } from "../../packages/natives/native/index.js";

// RFC #2884: the same generated number boundary must preserve 2^32 on Node and Bun.
const value = (result) => { assert.ok(result.ok, JSON.stringify(result)); return result.value; };
const actor = new TaskSupervisor();
const scope = { kind: "session", sessionId: "wide-budget" };
const host = actor.bindHostSession(scope);
const owner = value(actor.openTaskOwner(host, scope));
const task = value(actor.startAgentTask(owner, { kind: "agent", agent: "", task: "" }, ""));
const runner = value(actor.claimTaskRunner(task));
const waits = [value(actor.waitForTask(task, 4294967296)), value(actor.foregroundTask(task, host, 4294967296))];
const outcomes = waits.map((wait) => actor.observeTaskWait(wait));
let resolved = 0;
for (const outcome of outcomes) outcome.then(() => { resolved++; });
try {
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(resolved, 0, "2^32 ms must not narrow to a zero-budget yield");
	console.log("WIDE BUDGET PRESERVED waitForTask foregroundTask");
} finally {
	value(actor.reportTaskOutcome(runner, { reportId: "done", result: { kind: "failed", code: "", message: "", exitCode: 0 } }));
	value(actor.acknowledgeTaskCleanup(runner, { kind: "reaped" }));
	for (const outcome of await Promise.all(outcomes)) assert.equal(value(outcome).kind, "settled");
	value(await actor.closeTaskOwner(owner, "session-close"));
}
