import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as poll } from "node:timers/promises";
import type { OperationId, Result } from "../../packages/coding-agent/src/core/tasks/contracts.js";
import { TaskSupervisor } from "../../packages/coding-agent/src/core/tasks/supervisor.js";

function value<T, E>(result: Result<T, E>): T {
 if (!result.ok) throw new Error(JSON.stringify(result.error));
 return result.value;
}
function alive(pid: number) {
 try { process.kill(pid, 0); return true; } catch { return false; }
}
const directory = await mkdtemp(join(tmpdir(), "task-s2-demo-"));
const supervisor = new TaskSupervisor();
const scope = { kind: "session" as const, sessionId: crypto.randomUUID() };
const host = supervisor.bindHostSession({ scope, authorizeLaunch() {}, createRunner() { throw new Error("No model runner in this demo"); } });
const owner = value(supervisor.openTaskOwner(host, scope));
try {
 const identitiesPath = join(directory, "identities.json");
 const task = value(await supervisor.startCommandTask(owner, { kind: "command", command: `exec node ${JSON.stringify(resolve(import.meta.dirname, "task-process-tree.mjs"))} ${JSON.stringify(identitiesPath)}`, terminal: { kind: "pipe" } }, "demo-tree" as OperationId));
 const deadline = Date.now() + 10000;
 let identities: { parent: { pid: number; birth?: string }; grandchild: { pid: number; birth?: string } } | undefined;
 while (!identities) {
  assert.ok(Date.now() < deadline, "identity barrier timed out");
  try { identities = JSON.parse(await readFile(identitiesPath, "utf8")); } catch { await poll(10); }
 }
 console.log(`PARENT pid=${identities.parent.pid} birth=${identities.parent.birth}`);
 console.log(`GRANDCHILD pid=${identities.grandchild.pid} birth=${identities.grandchild.birth}`);
 const before = value(await supervisor.readTaskOutput(task, { start: "0", maximumBytes: 8192 }));
 const offset = before.chunks.at(-1)?.offsets.end ?? "0";
 assert.equal(value(await supervisor.waitForTask(task, 0)).kind, "yielded");
 assert.ok(alive(identities.parent.pid) && alive(identities.grandchild.pid));
 console.log("WAIT YIELDED parent=alive grandchild=alive");
 let live = "";
 while (!live.includes("output")) {
  assert.ok(Date.now() < deadline, "post-yield output barrier timed out");
  const page = value(await supervisor.readTaskOutput(task, { start: offset, maximumBytes: 8192 }));
  live = page.chunks.map(chunk => new TextDecoder().decode(chunk.bytes)).join("");
  if (!live.includes("output")) await poll(10);
 }
 console.log(`LIVE AFTER YIELD ${live.split("\n").find(line => line.includes("output"))}`);
 const receipt = value(await supervisor.closeTaskOwner(owner, "session-close"));
 assert.equal(receipt.tasks[0].cleanup.kind, "reaped");
 assert.equal(alive(identities.parent.pid), false);
 assert.equal(alive(identities.grandchild.pid), false);
 console.log("CLEANUP reaped parent=exited grandchild=exited");
 console.log(`RECEIPT ${JSON.stringify(receipt)}`);
 console.log("DEMO COMPLETE");
} finally {
 value(await supervisor.closeTaskOwner(owner, "session-close"));
 await rm(directory, { recursive: true, force: true });
}
