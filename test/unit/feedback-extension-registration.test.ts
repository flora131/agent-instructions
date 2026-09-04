import assert from "node:assert/strict";
import feedback, { FEEDBACK_COMMAND_DESCRIPTION } from "@bastani/feedback";
import { Check } from "typebox/value";
import { test } from "vitest";
import { BUNDLED_EXTENSION_SLASH_COMMANDS } from "../../packages/coding-agent/src/core/slash-commands.js";
import type { ExtensionAPI, RegisteredCommand, ToolDefinition } from "../../packages/coding-agent/src/index.js";
import { readText } from "../helpers/runtime.js";

test("feedback extension registration matches its bundled command advertisement", () => {
	let registeredDescription: string | undefined;
	let submissionParameters: ToolDefinition["parameters"] | undefined;
	const toolNames: string[] = [];
	const api = {
		registerCommand: ((name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
			if (name === "feedback") registeredDescription = options.description;
		}) as ExtensionAPI["registerCommand"],
		registerTool: ((tool: ToolDefinition) => {
			toolNames.push(tool.name);
			if (tool.name === "feedback_submit_issue") submissionParameters = tool.parameters;
		}) as ExtensionAPI["registerTool"],
	} as Pick<ExtensionAPI, "registerCommand" | "registerTool"> as ExtensionAPI;

	feedback(api);

	const advertised = BUNDLED_EXTENSION_SLASH_COMMANDS.find(({ name }) => name === "feedback");
	assert.equal(registeredDescription, FEEDBACK_COMMAND_DESCRIPTION);
	assert.equal(registeredDescription, advertised?.description);
	assert.deepEqual(toolNames, ["feedback_collect_diagnostics", "feedback_prepare_issue", "feedback_submit_issue"]);
	assert.ok(submissionParameters);
	const exact = { kind: "bug", title: "Reviewed", body: "Reviewed body" };
	assert.equal(Check(submissionParameters, exact), true);
	for (const extra of ["repository", "token", "rawContext"])
		assert.equal(Check(submissionParameters, { ...exact, [extra]: "must not pass" }), false, extra);
});

// Regression for #2799, review comment 3939724837: both advertised kinds need a draft path.
test("bundled feedback skill collects and prepares bug reports", async () => {
	const instructions = await readText("packages/feedback/skills/feedback/SKILL.md");
	assert.match(instructions, /For a bug, collect a title, what happened, and reproduction steps/);
	assert.match(instructions, /(?:Prepare the bug|When a bug is complete)[\s\S]*?`feedback_prepare_issue`/);
	assert.match(instructions, /(?:Display|display) the (?:tool's )?exact prepared (?:title and body|Markdown)/);
});

// #2799: bug reports must state extension activity even when the model omits that fact.
test("bug preparation defaults missing extension activity honestly at the tool boundary", async () => {
	let prepare: ToolDefinition | undefined;
	feedback({
		registerCommand: () => {},
		registerTool: (tool: ToolDefinition) => {
			if (tool.name === "feedback_prepare_issue") prepare = tool;
		},
	} as Pick<ExtensionAPI, "registerCommand" | "registerTool"> as ExtensionAPI);
	assert.ok(prepare);
	for (const extensions of [undefined, "", " \t\n", "user-extension", "None reported by user"]) {
		const result = await prepare.execute(
			"prepare-bug",
			{ kind: "bug", title: "Atomic crashes", description: "It crashed", repro: "Run atomic", extensions },
			undefined,
			undefined,
			{} as Parameters<ToolDefinition["execute"]>[4],
		);
		const text = result.content.find((part) => part.type === "text");
		assert.ok(text && text.type === "text");
		assert.ok(text.text.includes(`**Extension activity:** ${extensions?.trim() ? extensions : "Not reported"}`));
		assert.ok(text.text.includes("**Reproduction without extensions:** Not tested without extensions"));
	}
});

// #2799: diagnostic facts cannot substitute for required user report fields.
test("bug preparation rejects missing raw fields even with every diagnostic fact", async () => {
	let prepare: ToolDefinition | undefined;
	feedback({
		registerCommand: () => {},
		registerTool: (tool: ToolDefinition) => {
			if (tool.name === "feedback_prepare_issue") prepare = tool;
		},
	} as Pick<ExtensionAPI, "registerCommand" | "registerTool"> as ExtensionAPI);
	assert.ok(prepare);
	for (const field of ["description", "repro"] as const) {
		for (const value of ["", " \t\n"]) {
			await assert.rejects(
				prepare.execute(
					"prepare-incomplete-bug",
					{
						kind: "bug",
						title: "Atomic crashes",
						description: "It crashed",
						repro: "Run atomic",
						extensions: "example",
						isolation: "Not tested without extensions",
						evidence: "Crash observed",
						unknowns: "Cause unknown",
						debuggerPaths: "note.txt",
						[field]: value,
					},
					undefined,
					undefined,
					{} as Parameters<ToolDefinition["execute"]>[4],
				),
				{ message: field === "description" ? "What happened? is required" : "Steps to reproduce is required" },
			);
		}
	}
});
