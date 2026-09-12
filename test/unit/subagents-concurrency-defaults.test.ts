import assert from "node:assert/strict";
import { test } from "vitest";
import { resolveTopLevelParallelConcurrency } from "../../packages/subagents/src/shared/types-runtime.js";

test("subagent parallel concurrency defaults to three and explicit overrides win", () => {
	assert.equal(resolveTopLevelParallelConcurrency(undefined, undefined), 3);
	assert.equal(resolveTopLevelParallelConcurrency(undefined, 6), 6);
	assert.equal(resolveTopLevelParallelConcurrency(8, 6), 8);
	assert.equal(resolveTopLevelParallelConcurrency(1, 6), 1);
});
