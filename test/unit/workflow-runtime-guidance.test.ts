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
		name: "reports source-backed estimates before launch without confidence markers",
		phrases: [
			"Before launching a workflow, give the user an estimated wall-clock completion range",
			"without confidence labels or scores",
			"critical path",
			"If history is missing, state that briefly rather than inventing metrics",
			"An estimate is not a `budget` override or a promise",
			"actual elapsed time against the estimate",
		],
	},
	{
		name: "asks for a budget after the estimate but before launch and waits for a decision",
		phrases: [
			"After sharing the estimate and before calling `workflow run`",
			"use `ask_user_question` or an equivalent usable question tool",
			"ask whether the user wants an explicit budget",
			'Offer "Proceed with inherited limits", "Set an explicit budget", and "Do not launch"',
			"Wait for the answer; a cancelled or unanswered question is not approval to launch or set a cap",
			"collect the desired duration, token, or cost limit before launch",
		],
	},
	{
		name: "honors existing choices and avoids repeated questions for inline work or nested children",
		phrases: [
			"Skip this question when the user already supplied a budget choice",
			"including an explicit choice to inherit limits",
			"share per-item estimates and ask once with clear per-run budget scope, not between launches",
			"This pre-launch step does not apply to inline work or each nested child",
		],
	},
	{
		name: "continues autonomously without a question tool but preserves limits and approval gates",
		phrases: [
			"If no usable question tool exists, proceed autonomously on best judgment",
			"briefly state the assumption",
			"preserve existing budget limits and approval gates",
			"Never convert an estimate into a cap",
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

test("removes contradictory post-launch estimate and unanswered-question fallback instructions", async () => {
	const docs = await readText(resolve(root, "packages/coding-agent/docs/workflows/reliable-design.md"));
	for (const text of [guidance, docs]) {
		assert.ok(!text.includes("Immediately after a successful workflow launch"));
		assert.ok(!text.includes("estimate as low-confidence"));
		assert.ok(!text.includes("or nobody answers, do not stall"));
		assert.ok(!text.includes("assuming no budget is always the correct default"));
		assert.ok(text.indexOf("Before launching a workflow, give") < text.indexOf("After sharing the estimate"));
	}
});
