import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import type { AssistantMessage } from "@bastani/pi-ai/compat";
import { getKeybindings, setKeybindings } from "@earendil-works/pi-tui";
import { test } from "vitest";
import type { AgentSessionEvent } from "../../packages/coding-agent/src/core/agent-session.js";
import { KeybindingsManager } from "../../packages/coding-agent/src/core/keybindings.js";
import { SessionManager } from "../../packages/coding-agent/src/core/session-manager.js";
import { TaskInspector } from "../../packages/coding-agent/src/modes/interactive/components/task-inspector.js";
import { initTheme } from "../../packages/coding-agent/src/modes/interactive/theme/theme.js";
import { taskFixture } from "../helpers/task-projection.js";

const assistant = (text: string): AssistantMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-responses",
	provider: "openai",
	model: "fixture",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: 1,
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("open agent transcript streams text and tool results without task activity or reopening", async () => {
	initTheme("dark");
	const keys = getKeybindings();
	setKeybindings(new KeybindingsManager());
	const fixture = taskFixture();
	const session = SessionManager.inMemory();
	session.appendMessage({ role: "user", content: "Inspect streaming", timestamp: 0 });
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	const emit = (event: AgentSessionEvent) => {
		for (const listener of listeners) listener(event);
	};
	let renders = 0;
	const inspector = new TaskInspector(
		fixture.store,
		() => {
			renders++;
		},
		() => {},
	);
	const text = () => stripVTControlCharacters(inspector.renderViewport(100, 100).join("\n"));
	try {
		await fixture.start();
		fixture.runners[0].context.bindTranscript({
			getSessionId: () => session.getSessionId(),
			getEntries: () => session.getEntries(),
			getStreamingMessage: () => assistant("Already streaming"),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		});
		inspector.handleInput("\r");
		await flush();
		inspector.handleInput("\r");
		await flush();
		assert.equal(listeners.size, 1);
		assert.match(text(), /Already streaming/);
		const before = renders;
		emit({
			type: "message_update",
			message: assistant(""),
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " live delta", partial: assistant("") },
		});
		assert.ok(renders > before);
		assert.match(text(), /Already streaming live delta/);
		emit({ type: "message_end", message: assistant("Final response") });
		emit({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "echo test" } });
		emit({
			type: "tool_execution_update",
			toolCallId: "call-1",
			toolName: "bash",
			args: {},
			partialResult: { content: [{ type: "text", text: "Partial tool output" }] },
		});
		assert.match(text(), /Partial tool output/);
		emit({
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "bash",
			result: { content: [{ type: "text", text: "Final tool output" }] },
			isError: false,
		});
		assert.match(text(), /Final tool output/);
		assert.doesNotMatch(text(), /Partial tool output/);
		assert.equal((text().match(/Final response/g) ?? []).length, 1);
		await fixture.settle();
		assert.match(text(), /Final tool output/);
		inspector.handleInput("\x1b");
		assert.equal(listeners.size, 0);
		const closedRenders = renders;
		emit({ type: "agent_end", messages: [] });
		assert.equal(renders, closedRenders);
	} finally {
		inspector.dispose();
		await fixture.dispose();
		setKeybindings(keys);
	}
});

test("live transcript keeps earlier pages and scroll position while new state arrives", async () => {
	initTheme("dark");
	const keys = getKeybindings();
	setKeybindings(new KeybindingsManager());
	const fixture = taskFixture();
	const session = SessionManager.inMemory();
	for (let i = 0; i < 120; i++)
		session.appendMessage({ role: "user", content: `HISTORY-${String(i).padStart(3, "0")}`, timestamp: i });
	let listener: ((event: AgentSessionEvent) => void) | undefined;
	const inspector = new TaskInspector(
		fixture.store,
		() => {},
		() => {},
	);
	const text = () => stripVTControlCharacters(inspector.renderViewport(80, 12).join("\n"));
	try {
		await fixture.start();
		fixture.runners[0].context.bindTranscript({
			getSessionId: () => session.getSessionId(),
			getEntries: () => session.getEntries(),
			subscribe: (callback) => {
				listener = callback;
				return () => {
					listener = undefined;
				};
			},
		});
		inspector.handleInput("\r");
		await flush();
		inspector.handleInput("\r");
		await flush();
		inspector.handleInput("\x1b[5~");
		await flush();
		assert.match(text(), /HISTORY-000/);
		const before = text();
		listener?.({ type: "message_start", message: assistant("New live response") });
		assert.match(text(), /HISTORY-000/);
		assert.equal(text().split("Lines ")[0], before.split("Lines ")[0]);
		inspector.handleInput("\x1b[F");
		assert.match(text(), /New live response/);
		inspector.dispose();
		assert.equal(listener, undefined);
	} finally {
		inspector.dispose();
		await fixture.dispose();
		setKeybindings(keys);
	}
});
