import assert from "node:assert/strict";
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
