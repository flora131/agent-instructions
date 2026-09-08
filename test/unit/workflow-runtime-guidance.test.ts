import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "vitest";
import { DEFAULT_PROMPT_GUIDANCE } from "../../packages/workflows/src/extension/workflow-prompts.js";
import { moduleDir, readText } from "../helpers/runtime.js";

const root = resolve(moduleDir(import.meta.url), "../..");
const guidance = DEFAULT_PROMPT_GUIDANCE.join("\n");

const contracts = [
	{
		name: "uses project timing evidence without benchmarking a full suite for an estimate",
		phrases: [
			"dependency-constrained task-scheduling problem",
			"historical runtimes from comparable CI jobs, test-suite reports, and prior workflow stages",
			"runner/cache differences",
			"resource contention",
		],
	},
	{
		name: "defers redundant full suites without deleting slice gates or repair reruns",
		phrases: [
			"focused tests and necessary build/type/contract checks at each implementation slice",
			"run the full suite once on the final candidate instead of after every stage",
			"Preserve mandatory per-slice checks, required CI contexts, approval gates, and repair reruns",
			"checked commit or artifact identity",
		],
	},
	{
		name: "overlaps independent work but joins candidate-specific CI results before acceptance",
		phrases: [
			"workflow-owned CI launch/wait/result checks in durable `ctx.tool` nodes",
			"finite timeouts and cancellation",
			"before acceptance, merge, or publication",
			"Background admission is not check completion",
			"end-turn/no-polling",
		],
	},
	{
		name: "reports source-backed launch estimates and actual duration without changing budgets",
		phrases: [
			"Immediately after a successful workflow launch",
			"estimated wall-clock completion range before ending the turn",
			"critical path",
			"low-confidence",
			"An estimate is not a `budget` override or a promise",
			"actual elapsed time against the estimate",
		],
	},
];

for (const contract of contracts) {
	test(contract.name, async () => {
		const docs = await readText(resolve(root, "packages/coding-agent/docs/workflows/reliable-design.md"));
		for (const phrase of contract.phrases) {
			assert.ok(guidance.includes(phrase), `model guidance missing: ${phrase}`);
			assert.ok(docs.includes(phrase), `design docs missing: ${phrase}`);
		}
	});
}

test("uses available question tools and continues autonomously when none is usable", () => {
	for (const phrase of [
		"When `ask_user_question` or an equivalent question tool is available",
		"all agent-authored questions to the user must use that tool instead of plain text",
		"Prefer `ask_user_question` when available; otherwise use the equivalent tool's supported schema",
		"never end a status or final message with a prose-only question",
		"This does not replace workflow-authored `ctx.ui` gates",
		"relaying an actual user response to a pending prompt",
		"no usable question tool exists",
		"continue fully autonomously on best judgment",
		"Tool unavailability alone is not a blocker",
		"Preserve explicit approval gates, safety, authorization, and budget limits",
	]) {
		assert.ok(guidance.includes(phrase), `model guidance missing: ${phrase}`);
	}
	assert.ok(!guidance.includes("prefer the `ask_user_question` tool"));
});
