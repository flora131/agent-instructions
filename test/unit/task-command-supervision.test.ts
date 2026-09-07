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
test("supervised stdin preserves bytes, empty writes, replay, EOF and backpressure", async () => {
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
		const data = { kind: "bytes" as const, bytes: Buffer.from(" raw\u0000é\n") };
		const first = await supervisor.writeTaskInput(input.value, "bytes", data);
		assert.deepEqual(await supervisor.writeTaskInput(input.value, "bytes", data), first);
		const conflict = await supervisor.writeTaskInput(input.value, "bytes", { kind: "eof" });
		assert.equal(!conflict.ok && conflict.error.code, "OperationConflict");
		const full = await supervisor.writeTaskInput(input.value, "full", { kind: "bytes", bytes: Buffer.alloc(65537) });
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
});
