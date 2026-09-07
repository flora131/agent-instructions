import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "vitest";
import { makeTempDirectory, moduleDir, removeTempDirectory, spawnSyncCollect } from "../helpers/runtime.js";

const driver = join(moduleDir(import.meta.url), "../fixtures/task-s1-driver.mjs");
// RFC #2884: refusals occur before terminal launch and never reuse evidence.
test("task S1 driver offers help without terminal tooling", () => {
	const result = spawnSyncCollect([process.execPath, driver, "--help"], { env: { ...process.env, PATH: "" } });
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout.toString(), /--evidence-dir <fresh-directory>/);
});
test("task S1 driver rejects missing and invalid arguments before launch", () => {
	for (const args of [
		[],
		["--evidence-dir", "unused", "--columns", "NaN"],
		["--evidence-dir", "unused", "--rows", "0"],
	]) {
		const result = spawnSyncCollect([process.execPath, driver, ...args], { env: { ...process.env, PATH: "" } });
		assert.notEqual(result.exitCode, 0);
		assert.match(result.stderr.toString(), /Usage:|must be an integer/);
	}
});
test("task S1 driver refuses existing evidence directories before launch", () => {
	const directory = makeTempDirectory("task-s1-driver-");
	try {
		const result = spawnSyncCollect([process.execPath, driver, "--evidence-dir", directory], {
			env: { ...process.env, PATH: "" },
		});
		assert.notEqual(result.exitCode, 0);
		assert.match(result.stderr.toString(), /EEXIST/);
	} finally {
		removeTempDirectory(directory);
	}
});
