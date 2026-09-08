import { describe } from "vitest";
import { assert, resolveInputs, Type, test } from "./executor-shared.js";

describe("resolveInputs", () => {
	test("applies defaults for missing optional inputs", () => {
		const result = resolveInputs(
			{
				foo: Type.String({ default: "bar" }),
				count: Type.Number({ default: 42 }),
			},
			{},
		);
		assert.equal(result.foo, "bar");
		assert.equal(result.count, 42);
	});

	test("passes through provided values", () => {
		const result = resolveInputs({ foo: Type.String({ default: "bar" }) }, { foo: "override" });
		assert.equal(result.foo, "override");
	});

	test("does not override provided value with default", () => {
		const result = resolveInputs({ flag: Type.Boolean({ default: false }) }, { flag: true });
		assert.equal(result.flag, true);
	});

	test("throws for missing required input", () => {
		assert.throws(() => resolveInputs({ prompt: Type.String() }, {}), {
			message: 'atomic-workflows: required input "prompt" not provided',
		});
	});

	test("does not throw when required input is provided", () => {
		const result = resolveInputs({ prompt: Type.String() }, { prompt: "hello" });
		assert.equal(result.prompt, "hello");
	});

	// Regression: https://github.com/bastani-inc/atomic/issues/2936
	test("applies nested defaults to a resolver-owned copy of a frozen input", () => {
		const setup = Object.freeze({
			summaryMarkdown: "saved setup",
			artifacts: Object.freeze([Object.freeze({ path: "report.md" })]),
		});

		const resolved = resolveInputs(
			{
				setup: Type.Object({
					summaryMarkdown: Type.String(),
					mode: Type.String({ default: "plan" }),
					artifacts: Type.Array(Type.Object({ path: Type.String(), kind: Type.String({ default: "file" }) })),
				}),
			},
			{ setup },
		);

		assert.deepEqual(resolved.setup, {
			summaryMarkdown: "saved setup",
			mode: "plan",
			artifacts: [{ path: "report.md", kind: "file" }],
		});
		assert.notStrictEqual(resolved.setup, setup);
		assert.deepEqual(setup, { summaryMarkdown: "saved setup", artifacts: [{ path: "report.md" }] });
	});
});

// ---------------------------------------------------------------------------
// executor.run
// ---------------------------------------------------------------------------
