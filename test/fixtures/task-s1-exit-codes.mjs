import assert from "node:assert/strict";
import { TaskSupervisor } from "../../packages/natives/native/index.js";

// RFC #2884: exercise the real generated boundary, including exact replay comparisons.
const value = (result) => {
	assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error));
	return result.value;
};
const actor = new TaskSupervisor();
const scope = { kind: "session", sessionId: "exit-codes" };
const owner = value(actor.openTaskOwner(actor.bindHostSession(scope), scope));
const codes = [undefined, 0, -0, 2147483648, 4294967296, 0.5, -0.5, Number.MAX_VALUE, Number.MIN_VALUE,
	Number.MAX_SAFE_INTEGER + 1, Infinity, -Infinity, NaN];
let cases = 0;
for (const kind of ["completed", "failed"]) {
	for (const exitCode of codes) {
		const task = value(actor.startAgentTask(owner, { kind: "agent", agent: "", task: " \n " }, String(cases++)));
		const runner = value(actor.claimTaskRunner(task));
		const ref = value(actor.taskReference(task));
		const output = { ownerId: ref.ownerId, taskId: ref.taskId, artifactId: "", byteCount: "0", omittedRanges: [] };
		const result = { ...(kind === "completed" ? { kind, output } : { kind, code: "", message: " \n " }),
			...(exitCode === undefined ? {} : { exitCode }) };
		const report = { reportId: "", result };
		const receipt = value(actor.reportTaskOutcome(runner, report));
		assert.deepEqual(receipt.result, result, `${kind}: ${String(exitCode)} must round-trip exactly`);
		assert.deepEqual(value(actor.reportTaskOutcome(runner, report)), receipt);
		// Values that formerly narrowed to the same i32 must still conflict; omission and -0 differ from 0.
		const conflicting = { ...report, result: { ...result, exitCode: Object.is(exitCode, 0) ? 4294967296 : 0 } };
		assert.equal(actor.reportTaskOutcome(runner, conflicting).error?.code, "ReportConflict");
		const watch = value(actor.watchOwnerTasks(owner, () => {}));
		assert.deepEqual(watch.snapshot.tasks.at(-1).execution, { kind: "settled", result });
		actor.disposeSubscription(watch.lease);
		value(actor.acknowledgeTaskCleanup(runner, { kind: "reaped" }));
	}
}
value(await actor.closeTaskOwner(owner, "session-close"));
console.log(`EXIT CODES PRESERVED ${cases} result round-trips and conflicts`);
