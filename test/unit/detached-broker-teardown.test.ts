import assert from "node:assert/strict";
import { join } from "node:path";
import { test, vi } from "vitest";
import { removeTempRootReleasingBroker, stopDetachedBroker } from "../helpers/detached-broker.js";
import {
	fileExistsSync,
	makeDirectorySync,
	makeTempDirectory,
	readTextSync,
	removePathSync,
	sleep,
	spawnProcess,
	writeTextSync,
} from "../helpers/runtime.js";

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

test("stopDetachedBroker is a no-op when no broker pid is recorded", async () => {
	const root = makeTempDirectory("atomic-broker-teardown-missing-");
	makeDirectorySync(join(root, "agent"), { recursive: true });
	await stopDetachedBroker(join(root, "agent"));
	await removeTempRootReleasingBroker(root);
	assert.equal(fileExistsSync(root), false);
});

test("removeTempRootReleasingBroker deletes a disposable agent tree", async () => {
	const root = makeTempDirectory("atomic-broker-teardown-tree-");
	makeDirectorySync(join(root, "agent", "intercom"), { recursive: true });
	writeTextSync(join(root, "agent", "intercom", "broker.log"), "held\n");
	await removeTempRootReleasingBroker(root);
	assert.equal(fileExistsSync(root), false);
});

test("stopDetachedBroker terminates the pid recorded under the agent dir", async () => {
	const root = makeTempDirectory("atomic-broker-teardown-pid-");
	const agentDir = join(root, "agent");
	makeDirectorySync(join(agentDir, "intercom"), { recursive: true });
	const child = spawnProcess({
		cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	const pid = child.pid;
	try {
		assert.ok(pid !== undefined);
		writeTextSync(join(agentDir, "intercom", "broker.pid"), String(pid));
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
	const root = makeTempDirectory("atomic-broker-teardown-exit-");
	const agentDir = join(root, "custom agent dir");
	const intercomDir = join(agentDir, "intercom");
	makeDirectorySync(intercomDir, { recursive: true });
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
		while (!fileExistsSync(join(intercomDir, "broker.pid")) && Date.now() < deadline) await sleep(20);
		assert.ok(fileExistsSync(join(intercomDir, "broker.pid")), "the file-holding broker must be ready");
		await removeTempRootReleasingBroker(root, agentDir);
		assert.equal(processExists(child.pid), false, "cleanup returned before the broker exited");
		assert.equal(fileExistsSync(root), false);
	} finally {
		child.kill("SIGKILL");
		await child.exited;
		await removeTempRootReleasingBroker(root, agentDir);
	}
});

test("agent-tree cleanup retains files until a pending termination is observed", async () => {
	const root = makeTempDirectory("atomic-broker-teardown-pending-");
	const intercomDir = join(root, "agent", "intercom");
	makeDirectorySync(intercomDir, { recursive: true });
	const pid = 123456;
	writeTextSync(join(intercomDir, "broker.pid"), String(pid));
	const logPath = join(intercomDir, "broker.log");
	writeTextSync(logPath, "held by the terminating broker");
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
		assert.ok(fileExistsSync(logPath), "do not delete files while the broker still exists");
		exited = true;
		await cleanup;
		assert.equal(fileExistsSync(root), false);
	} finally {
		try {
			exited = true;
			await cleanup;
		} finally {
			kill.mockRestore();
			removePathSync(root, { recursive: true, force: true });
		}
	}
});

// #2963 / Greptile 3972841199: a broker that never exits must retain diagnostics.
test("agent-tree cleanup rejects at the broker deadline and preserves diagnostics", async () => {
	const root = makeTempDirectory("atomic-broker-teardown-timeout-");
	const agentDir = join(root, "custom agent dir");
	const intercomDir = join(agentDir, "intercom");
	makeDirectorySync(intercomDir, { recursive: true });
	const pid = 123456;
	const pidPath = join(intercomDir, "broker.pid");
	const logPath = join(intercomDir, "broker.log");
	const pidContents = `${pid}\n`;
	const logContents = "broker still holds its files\n";
	writeTextSync(pidPath, pidContents);
	writeTextSync(logPath, logContents);
	// Keep the OS liveness boundary successful through the real five-second deadline.
	const kill = vi.spyOn(process, "kill").mockImplementation((target) => {
		assert.equal(target, pid);
		return true;
	});
	try {
		const started = Date.now();
		await assert.rejects(removeTempRootReleasingBroker(root, agentDir), {
			message: `Broker ${pid} did not exit; keeping ${agentDir}`,
		});
		assert.ok(Date.now() - started >= 5_000, "the live broker must get the full exit grace period");
		assert.equal(readTextSync(pidPath, "utf8"), pidContents);
		assert.equal(readTextSync(logPath, "utf8"), logContents);
	} finally {
		kill.mockRestore();
		removePathSync(root, { recursive: true, force: true });
	}
});
