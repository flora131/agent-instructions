import assert from "node:assert/strict";
import * as native from "@bastani/atomic-natives";
import { test, vi } from "vitest";
import type { TaskWaitConfiguration } from "../../packages/coding-agent/src/core/tasks/contracts.js";
import { TaskSupervisor } from "../../packages/coding-agent/src/core/tasks/supervisor.js";
import { executeSupervisedCommand } from "../../packages/coding-agent/src/core/tools/bash-pty-native.js";

// #2905: command adapters must retain owner wait policy instead of imposing 10 seconds.
test.runIf(process.platform !== "win32")(
	"command adapter applies owner wait policy and discloses output gaps",
	async () => {
		const waitDoor = vi.spyOn(native.TaskSupervisor.prototype, "waitForTask");
		try {
			for (const [wait, expected] of [
				[{ kind: "automatic", commandBudgetMs: 0 }, 0],
				[{ kind: "until-settled" }, undefined],
			] satisfies Array<[TaskWaitConfiguration, number | undefined]>) {
				const supervisor = new TaskSupervisor();
				const scope = { kind: "session" as const, sessionId: crypto.randomUUID() };
				const host = supervisor.bindHostSession({
					scope,
					tasks: { wait },
					authorizeLaunch() {},
					createRunner() {
						throw new Error("not an agent");
					},
				});
				const opened = supervisor.openTaskOwner(host, scope);
				assert.ok(opened.ok);
				const owner = opened.value;
				const output: Buffer[] = [];
				// Reproduce a retained page with a prefix, a missing range, and a tail at the output API boundary.
				const read = vi.spyOn(supervisor, "readTaskOutput").mockImplementation(async (_task, range) => ({
					ok: true,
					value:
						range.start === "0"
							? {
									requested: { start: "0", end: "6" },
									chunks: [
										{ offsets: { start: "0", end: "1" }, bytes: new Uint8Array([65]) },
										{ offsets: { start: "4", end: "5" }, bytes: new Uint8Array([66]) },
									],
									omittedRanges: [
										{ start: "1", end: "4" },
										{ start: "5", end: "6" },
									],
								}
							: { requested: { start: range.start, end: range.start }, chunks: [], omittedRanges: [] },
				}));
				try {
					await executeSupervisedCommand(
						"printf done",
						process.cwd(),
						{ taskOwner: { supervisor, owner }, onData: (data) => output.push(data) },
						false,
					);
					assert.equal(waitDoor.mock.lastCall?.[1], expected);
					assert.ok(
						waitDoor.mock.lastCall?.[2],
						"initial shell wait is designated to the host so yielding updates background status",
					);
					assert.equal(
						Buffer.concat(output).toString(),
						"A\n[Output omitted: bytes 1-4]\nB\n[Output omitted: bytes 5-6]\n",
					);
					assert.ok(
						read.mock.calls.slice(1).every((call) => call[1].start === "6"),
						"trailing gaps advance the read cursor",
					);
				} finally {
					read.mockRestore();
					assert.ok((await supervisor.closeTaskOwner(owner, "session-close")).ok);
				}
			}
		} finally {
			waitDoor.mockRestore();
		}
	},
);
