import assert from "node:assert/strict";
import { FinishReason } from "@google/genai";
import { test } from "vitest";
import { mapStopReason } from "../src/api/google-shared.js";

test("Google consecutive tool-call limit maps to an error", () => {
	assert.equal(mapStopReason(FinishReason.TOO_MANY_TOOL_CALLS), "error");
});
