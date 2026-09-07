import assert from "node:assert/strict";
import { bindOwnerTaskStore, ChatSessionHost } from "@bastani/atomic";
import { test } from "vitest";
import { taskFixture, taskValue } from "../helpers/task-projection.js";
import { editorTheme, plainStyle } from "../unit/chat-session-host-working-lifecycle-fixture.js";
import {
	type AgentSessionEvent,
	createStore,
	deriveGraphTheme,
	fakeFooterAgentSession,
	makeHandle,
	StageChatView,
	setupRun,
	stripAnsi,
} from "../unit/stage-chat-view-helpers.js";

// RFC #2884: both real host components consume the same native task trace after turn end.
test("both chats retain the same task through tool end, agent end, background action and settlement", async () => {
	const fixture = taskFixture();
	const session = fakeFooterAgentSession();
	bindOwnerTaskStore(session, fixture.store);
	session.getToolDefinition = () => undefined;
	const main = new ChatSessionHost({ style: plainStyle, editorTheme, getAgentSession: () => session });
	const { handle, emit } = makeHandle(undefined, [], "running", session);
	const store = createStore();
	setupRun(store, "run-1", "stage-a");
	const stage = new StageChatView({
		store,
		graphTheme: deriveGraphTheme({}),
		runId: "run-1",
		stageId: "stage-a",
		workflowName: "S4",
		handle,
		onDetach() {},
		onClose() {},
	});
	const taskLines = (text: string) =>
		stripAnsi(text)
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => /worker:|running · background|completed$/.test(line));
	const assertParity = () => {
		assert.deepEqual(taskLines(main.renderBody(80, 100).join("\n")), taskLines(stage.render(80).join("\n")));
		assert.equal(main.entries().filter((entry) => entry.kind === "task").length, 1);
	};
	try {
		await fixture.start();
		assertParity();
		for (const event of [
			{ type: "tool_execution_start", toolCallId: "launch", toolName: "subagent", args: {} },
			{
				type: "tool_execution_end",
				toolCallId: "launch",
				toolName: "subagent",
				result: { content: [{ type: "text", text: "admitted" }], details: {} },
				isError: false,
			},
			{ type: "agent_end", messages: [] },
		] as AgentSessionEvent[]) {
			main.applyAgentEvent(event);
			emit(event);
			assertParity();
		}
		taskValue(
			fixture.runners[0].context.reportActivity({
				reportId: "after-turn",
				change: { kind: "action", tool: "read", text: "live background output" },
			}),
		);
		fixture.store.drain();
		assertParity();
		assert.match(stripAnsi(stage.render(80).join("\n")), /live background output/);
		const beforeMain = main.renderBody(80, 100);
		const beforeStage = stage.render(80);
		const hidden: AgentSessionEvent = {
			type: "message_start",
			message: {
				role: "custom",
				customType: "task-completion",
				display: false,
				content: "hidden completion",
				timestamp: 0,
			},
		};
		main.applyAgentEvent(hidden);
		emit(hidden);
		assert.deepEqual(main.renderBody(80, 100), beforeMain);
		assert.deepEqual(stage.render(80), beforeStage);
		const genuine: AgentSessionEvent = {
			type: "message_start",
			message: {
				role: "custom",
				customType: "intercom",
				display: true,
				content: "Genuine peer message",
				timestamp: 0,
			},
		};
		main.applyAgentEvent(genuine);
		emit(genuine);
		assert.equal((stripAnsi(stage.render(80).join("\n")).match(/Genuine peer message/g) ?? []).length, 1);
		await fixture.settle();
		assertParity();
		assert.doesNotMatch(main.renderFooter(80).join("\n"), /Tasks /);
	} finally {
		main.dispose();
		stage.dispose();
		await fixture.dispose();
	}
});
