import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";
import { removeTempRootReleasingBroker, stopDetachedBroker } from "../helpers/detached-broker.js";
import { sleep, spawnProcess } from "../helpers/runtime.js";

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

test("stopDetachedBroker is a no-op when no broker pid is recorded", async () => {
	const root = mkdtempSync(join(tmpdir(), "atomic-broker-teardown-missing-"));
	mkdirSync(join(root, "agent"), { recursive: true });
	await stopDetachedBroker(join(root, "agent"));
	await removeTempRootReleasingBroker(root);
	assert.equal(existsSync(root), false);
});

test("removeTempRootReleasingBroker deletes a disposable agent tree", async () => {
	const root = mkdtempSync(join(tmpdir(), "atomic-broker-teardown-tree-"));
	mkdirSync(join(root, "agent", "intercom"), { recursive: true });
	writeFileSync(join(root, "agent", "intercom", "broker.log"), "held\n");
	await removeTempRootReleasingBroker(root);
	assert.equal(existsSync(root), false);
});

test("stopDetachedBroker terminates the pid recorded under the agent dir", async () => {
	const root = mkdtempSync(join(tmpdir(), "atomic-broker-teardown-pid-"));
	const agentDir = join(root, "agent");
	mkdirSync(join(agentDir, "intercom"), { recursive: true });
	const child = spawnProcess({
		cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	const pid = child.pid;
	try {
		assert.ok(pid !== undefined);
		writeFileSync(join(agentDir, "intercom", "broker.pid"), String(pid));
		assert.equal(processExists(pid), true);
		await stopDetachedBroker(agentDir);
		assert.equal(processExists(pid), false);
	} finally {
		if (pid !== undefined && processExists(pid)) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Already reaped.
			}
		}
		await removeTempRootReleasingBroker(root, agentDir);
	}
});

// Windows job 102616795865 (#2962): cleanup must wait for the detached file owner.
test("agent-tree cleanup waits for the broker process to exit", async () => {
	const root = mkdtempSync(join(tmpdir(), "atomic-broker-teardown-exit-"));
	const agentDir = join(root, "custom agent dir");
	const intercomDir = join(agentDir, "intercom");
	mkdirSync(intercomDir, { recursive: true });
	const child = spawnProcess({
		cmd: [
			process.execPath,
			"-e",
			`const fs = require("node:fs");
			fs.openSync("broker.log", "a");
			fs.writeFileSync("broker.pid", String(process.pid));
			setInterval(() => {}, 1000);`,
		],
		cwd: intercomDir,
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	try {
		assert.ok(child.pid !== undefined);
		const deadline = Date.now() + 5_000;
		while (!existsSync(join(intercomDir, "broker.pid")) && Date.now() < deadline) await sleep(20);
		assert.ok(existsSync(join(intercomDir, "broker.pid")), "the file-holding broker must be ready");
		await removeTempRootReleasingBroker(root, agentDir);
		assert.equal(processExists(child.pid), false, "cleanup returned before the broker exited");
		assert.equal(existsSync(root), false);
	} finally {
		child.kill("SIGKILL");
		await child.exited;
		await removeTempRootReleasingBroker(root, agentDir);
	}
});

test("agent-tree cleanup retains files until a pending termination is observed", async () => {
	const root = mkdtempSync(join(tmpdir(), "atomic-broker-teardown-pending-"));
	const intercomDir = join(root, "agent", "intercom");
	mkdirSync(intercomDir, { recursive: true });
	const pid = 123456;
	writeFileSync(join(intercomDir, "broker.pid"), String(pid));
	const logPath = join(intercomDir, "broker.log");
	writeFileSync(logPath, "held by the terminating broker");
	let exited = false;
	// Model the Windows OS boundary: successful signaling precedes handle release.
	const kill = vi.spyOn(process, "kill").mockImplementation((target) => {
		assert.equal(target, pid);
		if (exited) throw Object.assign(new Error("no such process"), { code: "ESRCH" });
		return true;
	});
	const cleanup = removeTempRootReleasingBroker(root);
	try {
		await sleep(0);
		assert.ok(existsSync(logPath), "do not delete files while the broker still exists");
		exited = true;
		await cleanup;
		assert.equal(existsSync(root), false);
	} finally {
		try {
			exited = true;
			await cleanup;
		} finally {
			kill.mockRestore();
			rmSync(root, { recursive: true, force: true });
		}
	}
});
