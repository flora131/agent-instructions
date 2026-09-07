import assert from "node:assert/strict";
import type { ExtensionAPI, ToolDefinition } from "@bastani/atomic";
import { Type } from "typebox";
import { test } from "vitest";
import intercom from "../../packages/intercom/index.js";
import { executeHeavyTool } from "../../packages/intercom/lazy-tool-execution.js";
import { IntercomClientDisconnectedError } from "../../packages/intercom/recoverable-disconnect.js";
import { sleep } from "../helpers/runtime.js";

const context = { hasUI: false, sessionManager: { getSessionId: () => "retry-host" } };

function publicToolFixture(failures: number) {
	let tool: ToolDefinition | undefined;
	let loads = 0;
	let starts = 0;
	let executions = 0;
	const firstStartup = Promise.withResolvers<void>();
	const handlers = new Map<string, (event: { type: string; reason?: string }, ctx: typeof context) => Promise<void>>();
	const pi = {
		on(name: string, handler: (event: { type: string; reason?: string }, ctx: typeof context) => Promise<void>) {
			handlers.set(name, handler);
		},
		registerCommand() {},
		registerShortcut() {},
		events: { on() {} },
		registerTool(value: ToolDefinition) {
			if (value.name === "intercom") tool = value;
		},
	};
	intercom(pi as never, {
		async importHeavy() {
			loads += 1;
			return {
				default(heavyPi: ExtensionAPI) {
					heavyPi.on("session_start", async () => {
						starts += 1;
						firstStartup.resolve();
						if (starts <= failures) throw new IntercomClientDisconnectedError();
					});
					heavyPi.registerTool({
						name: "intercom",
						label: "Intercom",
						description: "test",
						parameters: Type.Object({}),
						async execute() {
							executions += 1;
							return { content: [{ type: "text", text: "sent" }], details: { delivered: true } };
						},
					});
				},
			};
		},
	});
	assert.ok(tool);
	return { tool, handlers, firstStartup: firstStartup.promise, counts: () => ({ loads, starts, executions }) };
}

test("public send retries recoverable startup replay before executing the heavy operation once", async () => {
	const { tool, counts } = publicToolFixture(1);
	const result = await tool.execute(
		"one-call",
		{ action: "send", to: "peer", message: "once" },
		undefined,
		undefined,
		context as never,
	);
	assert.deepEqual(result.details, { delivered: true });
	assert.deepEqual(counts(), { loads: 2, starts: 2, executions: 1 });
	assert.doesNotMatch(JSON.stringify(result), /retryToken/);
});

test("public initialization stops after three retries and truthfully reports no send", async () => {
	const { tool, counts } = publicToolFixture(4);
	const result = await tool.execute(
		"one-call",
		{ action: "reply", message: "once" },
		undefined,
		undefined,
		context as never,
	);
	assert.deepEqual(result.details, { error: true, terminal: true, automaticRetries: 3, outcome: "not_sent" });
	assert.deepEqual(counts(), { loads: 4, starts: 4, executions: 0 });
	assert.doesNotMatch(JSON.stringify(result), /retryToken/);
});

test("cancellation during lazy reconnect stops before heavy execution", async () => {
	const controller = new AbortController();
	let loads = 0;
	const result = await executeHeavyTool(
		async () => {
			loads += 1;
			controller.abort();
			throw new IntercomClientDisconnectedError();
		},
		"intercom",
		["call", { action: "ask", to: "peer", message: "once" }, controller.signal, undefined, context as never],
	);
	assert.equal(loads, 1);
	assert.deepEqual(result.details, { error: true, terminal: true, automaticRetries: 0, outcome: "not_sent" });
});

test("lazy recovery never retries an already-executed heavy operation", async () => {
	let executions = 0;
	let loads = 0;
	const disconnect = new IntercomClientDisconnectedError();
	const tool: ToolDefinition = {
		name: "intercom",
		label: "Intercom",
		description: "test",
		parameters: Type.Object({}),
		async execute() {
			executions += 1;
			throw disconnect;
		},
	};
	await assert.rejects(
		executeHeavyTool(
			async () => {
				loads += 1;
				return { heavy: { tools: new Map([["intercom", tool]]), commands: new Map() }, assertCurrent() {} };
			},
			"intercom",
			["call", { action: "send", to: "peer", message: "once" }, undefined, undefined, context as never],
		),
		disconnect,
	);
	assert.equal(loads, 1);
	assert.equal(executions, 1);
});

test("lazy retries cannot execute an old session's operation in a replacement lifecycle", async () => {
	const { tool, handlers, firstStartup, counts } = publicToolFixture(1);
	const execution = tool.execute(
		"old-session",
		{ action: "send", to: "peer", message: "once" },
		undefined,
		undefined,
		context as never,
	);
	// Register the rejection assertion before triggering shutdown.
	const rejected = assert.rejects(execution, /invalidated by session shutdown/);
	await firstStartup;
	await sleep(0);
	await handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "switch" }, context);
	const replacementContext = { hasUI: false, sessionManager: { getSessionId: () => "replacement-host" } };
	await handlers.get("session_start")?.({ type: "session_start" }, replacementContext);
	await rejected;
	assert.deepEqual(counts(), { loads: 1, starts: 1, executions: 0 });
});
