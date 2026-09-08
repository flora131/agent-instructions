import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { TaskSupervisor } from "../../packages/natives/native/index.js";

const value = (result) => {
	assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error));
	return result.value;
};
const actor = new TaskSupervisor();
const scope = { kind: "session", sessionId: "shutdown" };
const owner = value(actor.openTaskOwner(actor.bindHostSession(scope), scope));
// Disposed watches must not leave native callback destructors racing environment cleanup.
for (let index = 0; index < 256; index++) {
	const watch = value(actor.watchOwnerTasks(owner, () => {}));
	actor.disposeSubscription(watch.lease);
}
// Also leave a live subscription and an observation timer for the environment hook to seal.
value(actor.watchOwnerTasks(owner, () => {}));
const task = value(actor.startAgentTask(owner, { kind: "agent", agent: "", task: "" }, "shutdown"));
value(actor.waitForTask(task, 30000));
// Exercise both sides of the native 10ms wake without forcing process.exit or draining it away.
await sleep(Number(process.argv[2] ?? 0));
console.log("SUBSCRIPTION SHUTDOWN READY");
