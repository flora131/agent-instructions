import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type FauxResponseFactory, fauxAssistantMessage, fauxToolCall } from "@bastani/pi-ai/compat";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterAll, beforeAll, test, vi } from "vitest";
import type { ExtensionContext, ToolDefinition } from "../../packages/coding-agent/src/core/extensions/index.js";
import type { Attachment } from "../../packages/intercom/types.js";
import { IntercomBrokerFixture } from "../helpers/intercom-broker-fixture.js";

const root = resolve(import.meta.dirname, "../..");
const brokerFixture = new IntercomBrokerFixture(mkdtempSync(join(tmpdir(), "intercom-active-child-")));
brokerFixture.overrideAgentDir();
// Intercom's spawn module snapshots paths at import time. No ambient broker is used.
const { getBrokerSocketPath } = await import("../../packages/intercom/broker/paths.js");
const { getJitiCliPath } = await import("../../packages/intercom/broker/spawn.js");
const { default: intercomHeavy } = await import("../../packages/intercom/index-heavy.js");
const { createHarness, getMessageText } = await import("../../packages/coding-agent/test/suite/harness.js");

beforeAll(async () => {
	const extensionDir = join(root, "packages/intercom");
	brokerFixture.trackBroker(
		spawn(process.execPath, [getJitiCliPath(extensionDir), join(extensionDir, "broker/broker.ts")], {
			env: { ...process.env, ATOMIC_CODING_AGENT_DIR: brokerFixture.agentDir },
			stdio: "ignore",
		}),
	);
	await vi.waitFor(
		async () => {
			brokerFixture.assertRunning();
			const connected = await new Promise<boolean>((resolveConnected) => {
				const socket = net.createConnection(getBrokerSocketPath(process.platform, brokerFixture.agentDir));
				socket.once("connect", () => {
					socket.destroy();
					resolveConnected(true);
				});
				socket.once("error", () => resolveConnected(false));
			});
			assert.ok(connected);
		},
		{ timeout: 10_000, interval: 20 },
	);
});
afterAll(() => brokerFixture.cleanup());

async function endpoint(name: string, child = false, tools: AgentTool[] = []) {
	const ended = new AbortController();
	let context!: ExtensionContext;
	const harness = await createHarness({
		tools,
		fauxProvider: { provider: `faux-${name}` },
		...(child
			? {
					subagentPolicy: {
						managementActions: "restricted" as const,
						fanoutAuthorized: false,
						inheritProjectContext: false,
						inheritSkills: false,
						depth: 1,
						executionEnded: ended.signal,
					},
				}
			: {}),
		extensionFactories: [
			(pi) => {
				intercomHeavy(pi);
				pi.on("session_start", (_event, ctx) => {
					context = ctx;
				});
			},
		],
	});
	harness.session.setSessionName(name);
	await harness.session.bindExtensions({ mode: "print" });
	const tool = harness.session.extensionRunner
		.getAllRegisteredTools()
		.find((item) => item.definition.name === "intercom")?.definition;
	assert.ok(tool);
	let calls = 0;
	const execute = async (
		params: {
			action: string;
			to?: string;
			message?: string;
			replyTo?: string;
			group?: string;
			attachments?: Attachment[];
		},
		signal?: AbortSignal,
	): Promise<AgentToolResult<unknown> & { isError?: boolean }> =>
		(tool as ToolDefinition).execute(`${name}-${++calls}`, params, signal, undefined, context);
	const status = await execute({ action: "status" });
	assert.notEqual(status.isError, true, JSON.stringify(status));
	const id = getMessageText(status).match(/Session ID: ([^\n]+)/)?.[1];
	assert.ok(id);
	return {
		...harness,
		ended,
		execute,
		id,
		async close() {
			ended.abort();
			await harness.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			harness.cleanup();
		},
	};
}

test("public same-group asks steer a busy child and correlate concurrent replies without changing its execution", async () => {
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let activeSignal: AbortSignal | undefined;
	const working: AgentTool = {
		name: "working",
		label: "Working",
		description: "Hold child work",
		parameters: Type.Object({}),
		async execute(_id, _args, signal) {
			activeSignal = signal;
			started.resolve();
			await release.promise;
			return { content: [{ type: "text", text: "finished work" }], details: {} };
		},
	};
	const child = await endpoint("active-child", true, [working]);
	const peer = await endpoint("peer");
	const attachments: Attachment[] = [
		{ type: "snippet", name: "same", content: "  first\n", language: "ts" },
		{ type: "snippet", name: "same", content: "  first\n", language: "ts" },
	];
	const contexts: string[][] = [];
	let replyNumber = 0;
	const respond: FauxResponseFactory = async (context) => {
		contexts.push(context.messages.map(getMessageText));
		const reply = await child.execute({ action: "reply", message: `answer-${++replyNumber}` });
		assert.notEqual(reply.isError, true, JSON.stringify(reply));
		return fauxAssistantMessage(`handled-${replyNumber}`);
	};
	child.setResponses([fauxAssistantMessage(fauxToolCall("working", {}), { stopReason: "toolUse" }), respond, respond]);
	const execution = child.session.prompt("original child task");
	const asks = new AbortController();
	try {
		await started.promise;
		const first = peer.execute(
			{ action: "ask", to: child.id, message: "  FIRST-QUESTION\n", attachments },
			asks.signal,
		);
		await vi.waitFor(() =>
			assert.equal(
				child.session.messages.filter((message) => getMessageText(message).includes("FIRST-QUESTION")).length,
				1,
			),
		);
		const second = peer.execute({ action: "ask", to: child.id, message: "SECOND-QUESTION" }, asks.signal);
		await vi.waitFor(() =>
			assert.equal(
				child.session.messages.filter((message) => getMessageText(message).includes("SECOND-QUESTION")).length,
				1,
			),
		);
		assert.equal(activeSignal?.aborted, false);
		release.resolve();
		const [firstReply, secondReply] = await Promise.all([first, second]);
		await execution;
		assert.notEqual(firstReply.isError, true, JSON.stringify(firstReply));
		assert.notEqual(secondReply.isError, true, JSON.stringify(secondReply));
		assert.match(getMessageText(firstReply), /answer-1/);
		assert.match(getMessageText(secondReply), /answer-2/);
		assert.equal(child.eventsOfType("agent_start").length, 1);
		assert.equal(child.eventsOfType("agent_end").length, 1);
		assert.equal(replyNumber, 2);
		assert.ok(contexts[0]!.some((text) => text.includes("  FIRST-QUESTION\n")));
		const received = child.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom_message" && entry.customType === "intercom_message");
		assert.equal(received.length, 2);
		const details =
			received[0]?.type === "custom_message"
				? (received[0].details as { message: { content: { attachments: Attachment[] } } })
				: undefined;
		assert.deepEqual(details?.message.content.attachments, attachments);
		const pending = await child.execute({ action: "pending" });
		assert.equal(getMessageText(pending), "No unresolved inbound asks.");
	} finally {
		asks.abort();
		release.resolve();
		await execution;
		await Promise.all([peer.close(), child.close()]);
	}
});

test("public Intercom keeps exact-ID group restrictions and terminal-child ask rejection", async () => {
	const child = await endpoint("group-child", true);
	const peer = await endpoint("group-peer");
	try {
		assert.notEqual((await child.execute({ action: "join", group: "isolated-child" })).isError, true);
		assert.notEqual((await child.execute({ action: "leave", group: "default" })).isError, true);
		const forbidden = await peer.execute({ action: "send", to: child.id, message: "CROSS-GROUP-MUST-NOT-ARRIVE" });
		assert.equal(forbidden.isError, true);
		assert.match(getMessageText(forbidden), /different intercom group|not found/i);
		assert.equal(
			child.session.messages.some((message) => getMessageText(message).includes("CROSS-GROUP-MUST-NOT-ARRIVE")),
			false,
		);
		assert.notEqual((await peer.execute({ action: "join", group: "isolated-child" })).isError, true);
		child.setResponses([fauxAssistantMessage("finished")]);
		await child.session.prompt("original task");
		child.ended.abort();
		const terminal = await peer.execute({ action: "ask", to: child.id, message: "DO-NOT-REOPEN" });
		assert.equal(terminal.isError, true);
		assert.match(getMessageText(terminal), /terminal.*cannot reply/);
		const late = await peer.execute({ action: "send", to: child.id, message: "DO-NOT-REOPEN" });
		assert.notEqual(late.isError, true, "send transport semantics are not model acceptance");
		await new Promise<void>((resolveDone) => setImmediate(resolveDone));
		assert.equal(child.eventsOfType("agent_start").length, 1);
		assert.equal(
			child.session.messages.some((message) => getMessageText(message).includes("DO-NOT-REOPEN")),
			false,
		);
	} finally {
		await Promise.all([peer.close(), child.close()]);
	}
});

test("a child sealed at task settlement refuses a racing ask with a child-specific exact-thread error", async () => {
	const child = await endpoint("closing-child", true);
	const peer = await endpoint("closing-peer");
	try {
		child.setResponses([fauxAssistantMessage("finished")]);
		await child.session.prompt("original task");
		assert.equal(child.ended.signal.aborted, false, "probe the gap before the runner publishes terminal capability");
		const result = await peer.execute({ action: "ask", to: child.id, message: "racing ask" });
		assert.equal(result.isError, true);
		assert.match(getMessageText(result), /Subagent.*cannot accept messages/);
		assert.doesNotMatch(getMessageText(result), /workflow stage/);
		assert.equal(child.eventsOfType("agent_start").length, 1);
	} finally {
		await Promise.all([peer.close(), child.close()]);
	}
});
