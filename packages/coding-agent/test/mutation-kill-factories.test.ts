import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { FileMutationConflict } from "../src/core/tools/file-mutation-coordinator.js";
import {
	createAllToolDefinitions,
	createAllTools,
	createCodingToolDefinitions,
	createCodingTools,
} from "../src/core/tools/index.js";

for (const factory of [createCodingToolDefinitions, createCodingTools, createAllToolDefinitions, createAllTools]) {
	// PR #2482: merging shell kill registration must retain requester and observation wiring in every factory.
	test(`${factory.name} preserves mutation requester and observations alongside kill`, async () => {
		const cwd = await mkdtemp(join(tmpdir(), "mutation-kill-factory-"));
		try {
			const path = join(cwd, "target.txt");
			await writeFile(path, "original\n");
			let sessionId = "first-session";
			const result = factory(cwd, { resolveMutationRequester: () => ({ sessionId }) });
			const tools = Array.isArray(result) ? result : Object.values(result);
			const read = tools.find((tool) => tool?.name === "read")!;
			const write = tools.find((tool) => tool?.name === "write")!;
			const edit = tools.find((tool) => tool?.name === "edit")!;
			const kill = tools.find((tool) => tool?.name === "kill")!;
			assert.ok(read && write && edit && kill);
			assert.equal(tools.filter((tool) => tool?.name === "kill").length, 1);
			await assert.rejects(write.execute("unobserved", { path, content: "replacement\n" }), (error) => {
				assert.ok(error instanceof FileMutationConflict);
				assert.equal(error.reason, "no_prior_observation");
				assert.match(error.message, /session=first-session/);
				return true;
			});
			await read.execute("observe", { path });
			await writeFile(path, "external\n");
			sessionId = "second-session";
			await assert.rejects(write.execute("stale", { path, content: "replacement\n" }), (error) => {
				assert.ok(error instanceof FileMutationConflict);
				assert.equal(error.reason, "changed_since_observation");
				assert.match(error.message, /session=second-session/);
				return true;
			});
			assert.equal(await readFile(path, "utf8"), "external\n");
			await assert.rejects(kill.execute("kill", { id: "not-owned" }), /requires a supported task owner/);
			await read.execute("recover", { path });
			await write.execute("recovered", { path, content: "recovered\n" });
			assert.equal(await readFile(path, "utf8"), "recovered\n");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
}
