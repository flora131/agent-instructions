import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

// #2847 / PR #2971: typecheck the reader's actual image prompt, not a duplicated fixture.
test("SDK image prompt example matches the built session API", () => {
	const docs = readFileSync(resolve(repoRoot, "packages/coding-agent/docs/sdk.md"), "utf8");
	const specimen = /\/\/ With images\n([\s\S]*?)\n\n/u.exec(docs)?.[1];
	assert.ok(specimen, "SDK image prompt example is missing");
	const directory = mkdtempSync(join(tmpdir(), "atomic-sdk-image-"));
	try {
		const path = join(directory, "image.ts");
		const sdk = resolve(repoRoot, "packages/coding-agent/dist/index.js").replaceAll("\\", "/");
		writeFileSync(
			path,
			`import type { AgentSession } from ${JSON.stringify(sdk)};\ndeclare const session: AgentSession;\n${specimen}\n`,
		);
		const result = spawnSync(
			process.execPath,
			[
				resolve(repoRoot, "node_modules/typescript/bin/tsc"),
				"--noEmit",
				"--strict",
				"--skipLibCheck",
				"--moduleResolution",
				"bundler",
				"--module",
				"esnext",
				"--target",
				"esnext",
				path,
			],
			{ cwd: directory, encoding: "utf8", timeout: 30_000 },
		);
		assert.ifError(result.error);
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
