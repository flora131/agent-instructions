import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, test } from "vitest";
import {
	bunExecutable,
	makeTempDirectory,
	moduleDir,
	removeTempDirectory,
	spawnSyncCollect,
	symlinkSync,
} from "../helpers/runtime.js";

const root = resolve(moduleDir(import.meta.url), "../..");
let directory: string;
const entries = {
	host: "packages/coding-agent/src/core/extensions/runner.ts",
	builtin: "packages/intercom/index.ts",
};

beforeAll(() => {
	directory = makeTempDirectory("intercom-owner-bundles-");
	// Only dependency resolution is linked; host and builtin local graphs are
	// independently bundled, so a module-local identity WeakMap cannot pass.
	symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "junction");
	for (const [name, entry] of Object.entries(entries)) {
		const result = spawnSyncCollect(
			[
				bunExecutable(),
				"build",
				entry,
				"--target=node",
				"--packages=external",
				"--outfile",
				join(directory, `${name}.mjs`),
			],
			{ cwd: root },
		);
		assert.equal(result.exitCode, 0, `${name} bundle failed:\n${result.stdout}\n${result.stderr}`);
	}
});

afterAll(() => {
	if (directory) removeTempDirectory(directory);
});

for (const runtime of ["node", "bun"] as const) {
	test(`separate host and builtin bundles preserve diagnostic owner identity under ${runtime}`, () => {
		const result = spawnSyncCollect(
			[
				runtime === "node" ? process.execPath : bunExecutable(),
				join(root, "test/fixtures/intercom-owner-bundle-probe.mjs"),
				join(directory, "host.mjs"),
				join(directory, "builtin.mjs"),
			],
			{ cwd: directory },
		);
		assert.equal(result.exitCode, 0, `cross-bundle ${runtime} probe failed:\n${result.stdout}\n${result.stderr}`);
		const receipt = JSON.parse(result.stdout.toString()) as { passed: number; runtime: string };
		assert.equal(receipt.passed, 80);
		assert.equal(receipt.runtime, runtime);
	});
}
