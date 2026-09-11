import assert from "node:assert/strict";
import { test } from "vitest";
import { bashToolSystemPromptContribution } from "../src/core/tools/bash.js";
import { powershellToolSystemPromptContribution } from "../src/core/tools/powershell.js";

for (const [name, contribution] of Object.entries({
	bash: bashToolSystemPromptContribution,
	powershell: powershellToolSystemPromptContribution,
})) {
	test(`${name} recommends owner waits rather than premature yields or repeated short polls`, () => {
		const guidance = contribution.guidelines.join("\n");
		assert.ok(guidance.includes("For ordinary commands, omit wait"));
		assert.ok(guidance.includes('Use { action: "wait", id: taskId }'));
		assert.ok(guidance.includes("Avoid repeated short polls"));
		assert.ok(guidance.includes("Use a short budget only"));
		assert.ok(guidance.includes("Never relaunch a yielded command"));
		assert.doesNotMatch(guidance, /budgetMs:\s*1000\b/);
	});
}
