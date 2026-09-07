import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "vitest";
import type { OperationId, Result } from "../../packages/coding-agent/src/core/tasks/contracts.js";
import { TaskSupervisor } from "../../packages/coding-agent/src/core/tasks/supervisor.js";
import { fileExists, readJson, sleep } from "../helpers/runtime.js";

function value<T, E>(result: Result<T, E>): T {
	assert.equal(result.ok, true, result.ok ? "accepted" : JSON.stringify(result.error));
	return result.value;
}
function setup() {
	const supervisor = new TaskSupervisor();
	const scope = { kind: "session" as const, sessionId: crypto.randomUUID() };
	const host = supervisor.bindHostSession({
		scope,
		authorizeLaunch() {},
		createRunner() {
			throw new Error("Command must not dispatch an agent");
		},
	});
	return { supervisor, owner: value(supervisor.openTaskOwner(host, scope)) };
}
async function until(predicate: () => Promise<boolean>) {
	const deadline = Date.now() + 5000;
	while (!(await predicate())) {
		assert.ok(Date.now() < deadline, "lifecycle barrier deadline");
		await sleep(10);
	}
}
function alive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
// RFC #2884: ordinary observation expiry never kills the owned process tree.
test("command wait yields while parent and grandchild live, then owner close reaps both", async () => {
	assert.equal(process.platform, "linux", "This process identity scenario requires the Linux native host");
	const directory = await mkdtemp(join(tmpdir(), "task-tree-"));
	const identitiesPath = join(directory, "identities.json");
	const { supervisor, owner } = setup();
	try {
		const task = value(
			await supervisor.startCommandTask(
				owner,
				{
					kind: "command",
					command: `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(resolve("test/fixtures/task-process-tree.mjs"))} ${JSON.stringify(identitiesPath)}`,
					terminal: { kind: "pipe" },
				},
				"tree" as OperationId,
			),
		);
		await until(() => fileExists(identitiesPath));
		const identities = await readJson<{ parent: { pid: number }; grandchild: { pid: number } }>(identitiesPath);
		assert.equal(value(await supervisor.waitForTask(task, 0)).kind, "yielded");
		assert.ok(alive(identities.parent.pid));
		assert.ok(alive(identities.grandchild.pid));
		await until(async () =>
			value(await supervisor.readTaskOutput(task, { start: "0", maximumBytes: 8192 })).chunks.some((chunk) =>
				new TextDecoder().decode(chunk.bytes).includes("parent output"),
			),
		);
		const closed = value(await supervisor.closeTaskOwner(owner, "session-close"));
		assert.equal(closed.tasks[0].cleanup.kind, "reaped");
		assert.equal(alive(identities.parent.pid), false);
		assert.equal(alive(identities.grandchild.pid), false);
		const again = value(await supervisor.cancelTask(task, "user"));
		assert.equal(again.cleanup.kind, "reaped");
	} finally {
		await supervisor.closeTaskOwner(owner, "session-close");
		await rm(directory, { recursive: true, force: true });
	}
});

test("execution timeout kills separately and spawn failures are refused", async () => {
	const { supervisor, owner } = setup();
	try {
		const task = value(
			await supervisor.startCommandTask(
				owner,
				{ kind: "command", command: "sleep 30", terminal: { kind: "pipe" }, executionTimeoutMs: 40 },
				"timeout" as OperationId,
			),
		);
		assert.equal(value(await supervisor.waitForTask(task, 0)).kind, "yielded");
		const outcome = value(await supervisor.waitForTask(task, 5000));
		assert.equal(outcome.kind, "settled");
		if (outcome.kind === "settled")
			assert.deepEqual(outcome.result.kind === "cancelled" && outcome.result.cause, "execution-timeout");
		const failed = await supervisor.startCommandTask(
			owner,
			{ kind: "command", command: "true", cwd: "/atomic-path-that-does-not-exist", terminal: { kind: "pipe" } },
			"spawn-failed" as OperationId,
		);
		assert.equal(failed.ok, false);
		if (!failed.ok) assert.equal(failed.error.code, "SpawnFailed");
	} finally {
		value(await supervisor.closeTaskOwner(owner, "session-close"));
	}
});
