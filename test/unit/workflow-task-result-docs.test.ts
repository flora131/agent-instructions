import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "vitest";
import { moduleDir, readText } from "../helpers/runtime.js";

// #1859: the API reference moved during rebase; keep the optional identity field discoverable.
test("public WorkflowTaskResult reference documents optional thinking identity", async () => {
	const root = resolve(moduleDir(import.meta.url), "../..");
	const reference = await readText(resolve(root, "packages/coding-agent/docs/workflows/api-reference.md"));
	const resultType = reference.match(/interface WorkflowTaskResult extends WorkflowTaskContext \{([^}]+)\}/)?.[1];
	assert.ok(resultType, "WorkflowTaskResult example must exist");
	assert.ok(resultType.includes("readonly thinkingLevel?: string;"));
});
