import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as native from "@bastani/atomic-natives";
import { test, vi } from "vitest";
import type { OperationId } from "../../packages/coding-agent/src/core/tasks/contracts.js";
import { createHarness } from "../../packages/coding-agent/test/suite/harness.js";
import { StageSessionPause } from "../../packages/workflows/src/runs/foreground/stage-runner-pause.js";
import type { StageSessionRuntime } from "../../packages/workflows/src/runs/foreground/stage-runner-types.js";
import { sleep } from "../helpers/runtime.js";

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// Native setup is an external asynchronous boundary: hold it before the task lease
// exists, then let the real native implementation spawn and reap the actual shell.
test.runIf(process.platform !== "win32")(
	"stage pause drains preexisting native command admissions before confirming cleanup",
	async () => {
		const harness = await createHarness();
		const host = harness.session.getAgentTaskHost();
		const { supervisor, owner } = host.ownerBinding;
		const pause = new StageSessionPause(() => harness.session as StageSessionRuntime);
		const allowSetup = Promise.withResolvers<void>();
		const pidFile = join(harness.tempDir, "inflight-shell.pid");
		let pid = 0;
		const start = native.TaskSupervisor.prototype.startCommandTask;
		const nativeStart = vi
			.spyOn(native.TaskSupervisor.prototype, "startCommandTask")
			.mockImplementation(async function (this: native.TaskSupervisor, ...args) {
				await allowSetup.promise;
				const admitted = await start.apply(this, args);
				assert.ok(admitted.ok);
				await vi.waitFor(() => {
					pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
					assert.ok(pid > 0 && alive(pid));
				});
				return admitted;
			});
		try {
			const intent = {
				kind: "command" as const,
				command: `printf $$ > '${pidFile.replaceAll("'", "'\\''")}'; read value`,
				terminal: { kind: "pipe" as const },
				executionTimeoutMs: 15000,
			};
			const starting = supervisor.startCommandTask(owner, intent, randomUUID() as OperationId);
			const pausing = pause.requestPause();
			await assert.rejects(supervisor.startCommandTask(owner, intent, randomUUID() as OperationId), /paused/);
			await sleep(0);
			assert.equal(pause.isConfirmedPaused(), false, "an empty snapshot cannot prove pending setup has drained");
			allowSetup.resolve();
			const admitted = await starting;
			assert.ok(admitted.ok);
			await pausing;
			assert.equal(pause.isConfirmedPaused(), true);
			assert.equal(alive(pid), false, "pause completion waits for the in-flight shell to be reaped");
			const watched = host.watchOwnerTasks();
			assert.ok(watched.ok);
			assert.equal(watched.value.snapshot.tasks.length, 1);
			assert.deepEqual(
				watched.value.snapshot.tasks.map((task) => [task.execution.kind, task.cleanup.kind]),
				[["settled", "reaped"]],
			);
			watched.value.dispose();
			const outcome = await supervisor.waitForTask(admitted.value);
			assert.ok(outcome.ok && outcome.value.kind === "settled" && outcome.value.result.kind === "cancelled");
		} finally {
			allowSetup.resolve();
			nativeStart.mockRestore();
			await host.close("session-close");
			harness.cleanup();
		}
	},
);
