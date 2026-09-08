import assert from "node:assert/strict";
import { test } from "vitest";
import { deriveSessionActivity } from "../src/extensions/herdr/activity.js";

// #2891: unknown workflow activity cannot produce false idle.
test("Herdr activity uses settled work and preserves unknown availability", () => {
	assert.deepEqual(
		deriveSessionActivity({ agentRunning: false, openPromptCount: 0, roots: [], availability: "ready" }),
		{ state: "idle", reason: "quiescent" },
	);
	for (const availability of ["unavailable", "recovering"] as const)
		assert.equal(
			deriveSessionActivity({ agentRunning: false, openPromptCount: 0, roots: [], availability }),
			undefined,
		);
	assert.deepEqual(
		deriveSessionActivity({ agentRunning: true, openPromptCount: 1, roots: [], availability: "ready" }),
		{ state: "blocked", reason: "awaiting_input", message: "Waiting for approval" },
	);
});
