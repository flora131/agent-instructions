/**
 * Stop a detached Intercom broker that outlived a disposable test agent dir.
 *
 * Ordinary Intercom is mandatory, so fixture CLI processes can start a broker.
 * It holds log and SQLite handles, so signaling it is not sufficient: Windows
 * cleanup must wait for exit before removing its agent directory.
 */
import { join } from "node:path";
import { fileExistsSync, readTextSync, removePath, sleep } from "./runtime.js";

const BROKER_EXIT_TIMEOUT_MS = 5_000;

/** Terminate and await the broker recorded at `{agentDir}/intercom/broker.pid`, if any. */
export async function stopDetachedBroker(agentDir: string): Promise<void> {
	const pidPath = join(agentDir, "intercom", "broker.pid");
	if (!fileExistsSync(pidPath)) return;
	const pid = Number.parseInt(readTextSync(pidPath, "utf8").trim(), 10);
	if (!Number.isFinite(pid) || pid <= 0) return;
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		// Already exited.
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// SIGTERM was enough, or the process was already gone.
	}
	const deadline = Date.now() + BROKER_EXIT_TIMEOUT_MS;
	for (;;) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
			throw error;
		}
		if (Date.now() >= deadline) throw new Error(`Broker ${pid} did not exit; keeping ${agentDir}`);
		await sleep(20);
	}
}

/**
 * Stop the broker under `{root}/agent` (or `agentDir`) and delete `root`.
 *
 * Async removal re-enumerates on ENOTEMPTY while inherited Windows handles close;
 * Node 22's sync removal retries only rmdir after its first directory listing.
 */
export async function removeTempRootReleasingBroker(root: string, agentDir = join(root, "agent")): Promise<void> {
	await stopDetachedBroker(agentDir);
	await removePath(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}
