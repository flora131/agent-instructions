import assert from "node:assert/strict";
import * as native from "@bastani/atomic-natives";
import { test } from "vitest";
import {
	COMMAND_DETAIL_TAIL_BYTES,
	COMMAND_DISK_OUTPUT_CAP_BYTES,
	COMMAND_FOREGROUND_BUDGET_MS,
	COMMAND_FOREGROUND_SPILL_BYTES,
	COMMAND_LIVE_PREVIEW_BYTES,
	commandSpoolExceedsCap,
} from "../../packages/coding-agent/src/core/tasks/command-output.js";
import { sleep } from "../helpers/runtime.js";

// RFC #2884: the disk cap is 5 GiB, not a signed or unsigned 32-bit byte count.
test("command supervision exposes the selected output and observation limits", () => {
	assert.equal(COMMAND_LIVE_PREVIEW_BYTES, 1048576);
	assert.equal(COMMAND_FOREGROUND_SPILL_BYTES, 8388608);
	assert.equal(COMMAND_DISK_OUTPUT_CAP_BYTES, 5368709120);
	assert.equal(COMMAND_DETAIL_TAIL_BYTES, 8192);
	assert.equal(COMMAND_FOREGROUND_BUDGET_MS, 10000);
});

test("file spool overflow is strictly beyond the real 5 GiB boundary", () => {
	assert.equal(commandSpoolExceedsCap(5368709119n), false);
	assert.equal(commandSpoolExceedsCap(5368709120n), false);
	assert.equal(commandSpoolExceedsCap(5368709121n), true);
	assert.equal(commandSpoolExceedsCap(4294967296n), false);
});

// RFC #2884: admitted input is delivered once; empty bytes do not close stdin.
test.runIf(process.platform !== "win32")(
	"supervised stdin preserves bytes, empty writes, replay, EOF and backpressure",
	async () => {
		const supervisor = new native.TaskSupervisor();
		const scope = { kind: "session" as const, sessionId: crypto.randomUUID() };
		const host = supervisor.bindHostSession(scope);
		const owner = supervisor.openTaskOwner(host, scope);
		assert.ok(owner.ok);
		try {
			const started = await supervisor.startCommandTask(
				owner.value,
				{ kind: "command", command: "cat", terminal: { kind: "pipe" } },
				"stdin",
			);
			assert.ok(started.ok);
			const input = supervisor.taskStdin(started.value);
			assert.ok(input.ok);
			const empty = await supervisor.writeTaskInput(input.value, "empty", { kind: "bytes", bytes: Buffer.alloc(0) });
			assert.deepEqual(empty, { ok: true, value: { operationId: "empty", acceptedBytes: 0, kind: "bytes" } });
			for (const operationId of ["", "\ud800", "\ud801"]) {
				const receipt = await supervisor.writeTaskInput(input.value, operationId, {
					kind: "bytes",
					bytes: Buffer.alloc(0),
				});
				assert.deepEqual(receipt, { ok: true, value: { operationId, acceptedBytes: 0, kind: "bytes" } });
			}
			const data = { kind: "bytes" as const, bytes: Buffer.from(" raw\u0000é\n") };
			const first = await supervisor.writeTaskInput(input.value, "bytes", data);
			assert.deepEqual(await supervisor.writeTaskInput(input.value, "bytes", data), first);
			const conflict = await supervisor.writeTaskInput(input.value, "bytes", { kind: "eof" });
			assert.equal(!conflict.ok && conflict.error.code, "OperationConflict");
			const full = await supervisor.writeTaskInput(input.value, "full", {
				kind: "bytes",
				bytes: Buffer.alloc(65537),
			});
			assert.equal(!full.ok && full.error.code, "InputBackpressure");
			assert.deepEqual(await supervisor.writeTaskInput(input.value, "eof", { kind: "eof" }), {
				ok: true,
				value: { operationId: "eof", acceptedBytes: 0, kind: "eof" },
			});
			const wait = supervisor.waitForTask(started.value, 5000);
			assert.ok(wait.ok);
			const outcome = await supervisor.observeTaskWait(wait.value);
			assert.ok(outcome.ok && outcome.value.kind === "settled");
			const output = await supervisor.readTaskOutput(started.value, { start: "0", maximumBytes: 8192 });
			assert.ok(output.ok);
			assert.deepEqual(Buffer.concat(output.value.chunks.map((chunk) => chunk.bytes)), data.bytes);
		} finally {
			const closed = await supervisor.closeTaskOwner(owner.value, "session-close");
			assert.ok(closed.ok, JSON.stringify(closed));
		}
	},
);

// RFC #2884: the PTY uses the same owner lifetime and preserves terminal sizing.
test.runIf(process.platform !== "win32")("supervised PTY resizes, streams and reaps through the owner", async () => {
	const supervisor = new native.TaskSupervisor();
	const scope = { kind: "session" as const, sessionId: crypto.randomUUID() };
	const owner = supervisor.openTaskOwner(supervisor.bindHostSession(scope), scope);
	assert.ok(owner.ok);
	try {
		const started = await supervisor.startCommandTask(
			owner.value,
			{
				kind: "command",
				command: "while true; do stty size; sleep 0.02; done",
				terminal: { kind: "pty", columns: 80, rows: 24 },
			},
			"pty",
		);
		assert.ok(started.ok, JSON.stringify(started));
		assert.ok(supervisor.resizeTaskTerminal(started.value, 100, 30).ok);
		const deadline = Date.now() + 5000;
		let text = "";
		while (!text.includes("30 100")) {
			assert.ok(Date.now() < deadline, "PTY resize output deadline");
			const page = await supervisor.readTaskOutput(started.value, { start: "0", maximumBytes: 8192 });
			assert.ok(page.ok);
			text = Buffer.concat(page.value.chunks.map((chunk) => chunk.bytes)).toString();
			if (!text.includes("30 100")) await sleep(10);
		}
		const wait = supervisor.waitForTask(started.value, 0);
		assert.ok(wait.ok);
		const observation = await supervisor.observeTaskWait(wait.value);
		assert.ok(observation.ok && observation.value.kind === "yielded");
	} finally {
		const receipt = await supervisor.closeTaskOwner(owner.value, "session-close");
		assert.ok(receipt.ok, JSON.stringify(receipt));
		for (const task of receipt.value.tasks) assert.equal(task.cleanup.kind, "reaped");
	}
});

// RFC #2884: real streams use injected caps; no 5 GiB fixture is allocated.
test.runIf(process.platform !== "win32")(
	"drained command keeps running beyond its cap and exposes original-offset omissions",
	async () => {
		const supervisor = new native.TaskSupervisor();
		const scope = { kind: "session" as const, sessionId: crypto.randomUUID() };
		const owner = supervisor.openTaskOwner(supervisor.bindHostSession(scope), scope);
		assert.ok(owner.ok);
		try {
			const script = 'setInterval(()=>process.stdout.write("0123456789éabcdefghij"),10)';
			const task = await supervisor.startCommandTask(
				owner.value,
				{ kind: "command", command: `exec node -e '${script}'`, terminal: { kind: "pipe" } },
				"drained",
				{ sink: "drained", diskCapBytes: 11, livePreviewBytes: 8, foregroundSpillBytes: 8, background: true },
			);
			assert.ok(task.ok);
			const deadline = Date.now() + 5000;
			let omitted = false;
			while (!omitted) {
				assert.ok(Date.now() < deadline, "drained output barrier");
				const page = await supervisor.readTaskOutput(task.value, { start: "0", maximumBytes: 8192 });
				assert.ok(page.ok);
				omitted = page.value.omittedRanges.length > 0;
				if (omitted) {
					assert.equal(page.value.omittedRanges[0].start, "11");
					assert.equal(page.value.chunks[0].bytes[10], 0xc3);
				} else await sleep(10);
			}
			const wait = supervisor.waitForTask(task.value, 0);
			assert.ok(wait.ok);
			const result = await supervisor.observeTaskWait(wait.value);
			assert.ok(result.ok && result.value.kind === "yielded");
		} finally {
			assert.ok((await supervisor.closeTaskOwner(owner.value, "session-close")).ok);
		}
	},
);

test.runIf(process.platform !== "win32")(
	"file spool watchdog starts only after foreground collection yields",
	async () => {
		const supervisor = new native.TaskSupervisor();
		const scope = { kind: "session" as const, sessionId: crypto.randomUUID() };
		const owner = supervisor.openTaskOwner(supervisor.bindHostSession(scope), scope);
		assert.ok(owner.ok);
		try {
			const task = await supervisor.startCommandTask(
				owner.value,
				{
					kind: "command",
					command: `exec node -e 'setInterval(()=>process.stdout.write("abcdefgh"),25)'`,
					terminal: { kind: "pipe" },
				},
				"spool",
				{ diskCapBytes: 4 },
			);
			assert.ok(task.ok);
			const foreground = supervisor.waitForTask(task.value, 5200);
			assert.ok(foreground.ok);
			const yielded = await supervisor.observeTaskWait(foreground.value);
			assert.ok(yielded.ok && yielded.value.kind === "yielded", "initial collection must not start the watchdog");
			const background = supervisor.waitForTask(task.value, 8000);
			assert.ok(background.ok);
			const settled = await supervisor.observeTaskWait(background.value);
			assert.ok(settled.ok && settled.value.kind === "settled");
			assert.equal(settled.value.result.kind, "failed");
			if (settled.value.result.kind === "failed") {
				assert.equal(settled.value.result.code, "OutputLimitExceeded");
				assert.equal(settled.value.result.message, "Background command killed: output file exceeded 5 GiB");
			}
		} finally {
			assert.ok((await supervisor.closeTaskOwner(owner.value, "session-close")).ok);
		}
	},
);
