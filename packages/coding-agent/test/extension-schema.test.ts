import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadExtensions } from "../src/core/extensions/loader.ts";

test("extension registration rejects non-object schemas but preserves object schemas (#9300)", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "atomic-schema-"));
	try {
		for (const schema of [
			"undefined",
			"null",
			"[]",
			"true",
			"false",
			"42",
			'"object"',
			"{}",
			'{ type: "string" }',
			'{ anyOf: [{ type: "object" }, { type: "object" }] }',
		]) {
			const path = join(cwd, "extension.js");
			writeFileSync(
				path,
				`export default function(pi) { pi.registerTool({ name: "noop", label: "No-op", description: "Nothing", parameters: ${schema}, execute: async () => ({ content: [] }) }); }`,
			);
			const result = await loadExtensions([path], cwd);
			if (schema.startsWith("{")) {
				assert.equal(result.extensions.length, 1, schema);
				assert.deepEqual(result.errors, []);
			} else {
				assert.equal(result.extensions.length, 0, schema);
				assert.deepEqual(result.errors, [
					{
						path,
						error: `Failed to load extension: Tool "noop" registered by extension "${path}" must define an object parameter schema.`,
					},
				]);
			}
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
