import assert from "node:assert/strict";
import { fauxAssistantMessage, fauxToolCall } from "@bastani/pi-ai/compat";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { test, vi } from "vitest";
import type { ExtensionContext } from "../../packages/coding-agent/src/core/extensions/index.js";
import { WorkflowStageAdmissionBoundary } from "../../packages/coding-agent/src/core/workflow-stage-admission.js";
import { createHarness, getMessageText } from "../../packages/coding-agent/test/suite/harness.js";
import intercomHeavy from "../../packages/intercom/index-heavy.js";
import type { IntercomExtensionTestOverrides } from "../../packages/intercom/intercom-test-seams.js";
import type { Message, SessionInfo } from "../../packages/intercom/types.js";
import { createDispatchCounter } from "../helpers/intercom-interrupt-probe.js";

type Receiver = "child" | "workflow-stage";
type Action = "send" | "ask";
type Inbound = Parameters<NonNullable<IntercomExtensionTestOverrides["captureInboundHandler"]>>[0];

const peer: SessionInfo = {
	id: "interrupt-peer",
	name: "interrupt-peer",
	cwd: "/peer",
	pid: 1,
	model: "faux",
	startedAt: 1,
	lastActivity: 1,
};
function message(id: string, action: Action, text = `PRIORITY-${id}`): Message {
	return { id, timestamp: Date.now(), content: { text }, ...(action === "ask" ? { expectsReply: true } : {}) };
}

async function receiver(kind: Receiver, tools: AgentTool[]) {
	const ended = new AbortController();
	const boundary = new WorkflowStageAdmissionBoundary();
	let inbound!: Inbound;
	let ctx!: ExtensionContext;
	const h = await createHarness({
		...(kind === "child"
			? {
					subagentPolicy: {
						managementActions: "restricted",
						fanoutAuthorized: false,
						inheritProjectContext: false,
						inheritSkills: false,
						executionEnded: ended.signal,
						depth: 1,
					},
				}
			: {
					orchestrationContext: {
						kind: "workflow-stage",
						workflowRunId: "interrupt-run",
						workflowStageId: "interrupt-stage",
						workflowStageName: "interrupt-stage",
						constraints: { disableWorkflowTool: true },
						messageAdmission: { boundary, extensionState: new Map(), isOpen: () => boundary.isOpen() },
					},
				}),
		tools,
		extensionFactories: [
			(pi) => {
				intercomHeavy(pi, {
					captureInboundHandler: (handler) => {
						inbound = handler;
					},
				});
				pi.on("session_start", (_event, context) => {
					ctx = context;
				});
			},
		],
	});
	await h.session.bindExtensions({ mode: "print" });
	return {
		...h,
		ended,
		boundary,
		deliver: (entry: Message) => inbound(ctx, peer, entry),
		async close(execution: Promise<void>) {
			ended.abort();
			void h.session.abort().catch(() => {});
			boundary.seal();
			await execution.catch(() => {});
			await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			h.session.pauseQueuedMessages();
			h.cleanup();
		},
	};
}

function cancellableTool(record: { calls: number; signal?: AbortSignal; completed: number }): {
	started: PromiseWithResolvers<void>;
	cleanup: PromiseWithResolvers<void>;
	tool: AgentTool;
} {
	const cleanup = Promise.withResolvers<void>();
	const started = Promise.withResolvers<void>();
	return {
		started,
		cleanup,
		tool: {
			name: "long_work",
			label: "Long work",
			description: "Runs until cancelled",
			parameters: Type.Object({}),
			async execute(_id, _args, signal) {
				record.calls += 1;
				record.signal = signal;
				started.resolve();
				await Promise.race([
					cleanup.promise,
					new Promise<void>((resolve) => {
						if (signal?.aborted) resolve();
						else signal?.addEventListener("abort", () => resolve(), { once: true });
					}),
				]);
				if (!signal?.aborted) record.completed += 1;
				return {
					content: [
						{ type: "text" as const, text: signal?.aborted ? "cancelled operation" : "completed operation" },
					],
					details: {},
				};
			},
		},
	};
}

// Amended 2x2 matrix: both actions and both receivers cancel supported active
// work immediately and continue the same task/stage with the message.
for (const kind of ["child", "workflow-stage"] as const) {
	for (const action of ["send", "ask"] as const) {
		test(`${action} to an active ${kind} cancels its long-running tool and continues the original task`, async () => {
			const record = { calls: 0, completed: 0 } as { calls: number; signal?: AbortSignal; completed: number };
			const work = cancellableTool(record);
			const h = await receiver(kind, [work.tool]);
			const seen: string[] = [];
			const dispatches = createDispatchCounter([
				() => fauxAssistantMessage(fauxToolCall("long_work", {}), { stopReason: "toolUse" }),
				(context) => {
					seen.push(
						...context.messages
							.filter((m) => getMessageText(m).includes("PRIORITY-"))
							.map((m) => getMessageText(m)),
					);
					return fauxAssistantMessage("amended result");
				},
			]);
			h.setResponses(dispatches.steps(4));
			const sessionId = h.session.sessionId;
			const execution = h.session.prompt("original task");
			try {
				await work.started.promise;
				await h.deliver(message(`${kind}-${action}`, action));
				await vi.waitFor(() =>
					assert.equal(record.signal?.aborted, true, "priority input must cancel the active cancellable tool"),
				);
				await execution;
				assert.equal(record.calls, 1, "the cancelled tool call is not replayed");
				assert.equal(record.completed, 0, "the tool did not need to finish naturally");
				assert.equal(seen.length, 1, "the amended turn sees the message once");
				assert.equal(dispatches.counts.valid, 2, "exactly one valid model dispatch after cancellation");
				assert.equal(h.session.sessionId, sessionId);
				assert.equal(
					h.session.messages.filter((m) => m.role === "user" && getMessageText(m) === "original task").length,
					1,
					"original task prompt is not repeated",
				);
				assert.equal(getMessageText(h.session.messages.at(-1)), "amended result");
				assert.equal(
					h.sessionManager
						.getEntries()
						.filter((e) => e.type === "custom_message" && e.customType === "intercom_message").length,
					1,
				);
				if (action === "ask") {
					const entry = h.sessionManager
						.getEntries()
						.find((e) => e.type === "custom_message" && e.customType === "intercom_message");
					assert.ok(
						entry &&
							entry.type === "custom_message" &&
							typeof entry.content === "string" &&
							entry.content.includes("To reply, use the intercom tool"),
					);
				}
				if (kind === "workflow-stage")
					assert.equal(h.boundary.isOpen(), true, "the stage generation stays open for its host");
			} finally {
				work.cleanup.resolve();
				await h.close(execution);
			}
		});
	}
}

test("a message during model streaming cancels the stream for both receiver kinds", async () => {
	for (const kind of ["child", "workflow-stage"] as const) {
		const h = await receiver(kind, []);
		const streaming = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let amended = false;
		const dispatches = createDispatchCounter([
			(context) => {
				amended = context.messages.some((m) => getMessageText(m).includes("PRIORITY-stream"));
				return fauxAssistantMessage("amended");
			},
		]);
		h.setResponses([
			async (_context, options) => {
				streaming.resolve();
				await release.promise;
				assert.equal(options?.signal?.aborted, true);
				return fauxAssistantMessage("slow original");
			},
			...dispatches.steps(3),
		]);
		const execution = h.session.prompt("original task");
		try {
			await streaming.promise;
			await h.deliver(message(`stream-${kind}`, "send", "PRIORITY-stream"));
			await vi.waitFor(() => assert.equal(h.session.agent.signal?.aborted ?? true, true));
			release.resolve();
			await execution;
			assert.equal(amended, true);
			assert.equal(dispatches.counts.valid, 1);
		} finally {
			release.resolve();
			await h.close(execution);
		}
	}
});

test("multiple arrivals keep FIFO and dedup while the first cancellation is settling", async () => {
	const record = { calls: 0, completed: 0 } as { calls: number; signal?: AbortSignal; completed: number };
	const work = cancellableTool(record);
	const h = await receiver("child", [work.tool]);
	const observed: string[] = [];
	const dispatches = createDispatchCounter([
		() => fauxAssistantMessage(fauxToolCall("long_work", {}), { stopReason: "toolUse" }),
		...Array.from({ length: 3 }, () => (context: { messages: object[] }) => {
			for (const id of ["one", "two", "three"])
				if (!observed.includes(id) && context.messages.some((m) => getMessageText(m).includes(`PRIORITY-${id}`)))
					observed.push(id);
			return fauxAssistantMessage("amended");
		}),
	]);
	h.setResponses(dispatches.steps(8));
	const execution = h.session.prompt("original task");
	try {
		await work.started.promise;
		await Promise.all([
			h.deliver(message("one", "send")),
			h.deliver(message("two", "ask")),
			h.deliver(message("one", "send")),
			h.deliver(message("three", "send")),
		]);
		await execution;
		assert.deepEqual(observed, ["one", "two", "three"]);
		const keys = h.sessionManager
			.getEntries()
			.flatMap((e) =>
				e.type === "custom_message" && e.customType === "intercom_message" ? [e.stageAdmissionKey] : [],
			);
		assert.deepEqual(keys, ["intercom:one", "intercom:two", "intercom:three"]);
		assert.equal(record.calls, 1);
	} finally {
		work.cleanup.resolve();
		await h.close(execution);
	}
});

test("an explicit abort wins: later priority input never restarts a cancelled child", async () => {
	const record = { calls: 0, completed: 0 } as { calls: number; signal?: AbortSignal; completed: number };
	const work = cancellableTool(record);
	const h = await receiver("child", [work.tool]);
	const dispatches = createDispatchCounter([
		() => fauxAssistantMessage(fauxToolCall("long_work", {}), { stopReason: "toolUse" }),
		() => fauxAssistantMessage("must not run"),
	]);
	h.setResponses(dispatches.steps(4));
	const execution = h.session.prompt("original task");
	try {
		await work.started.promise;
		h.ended.abort();
		const abort = h.session.abort();
		await Promise.resolve(h.deliver(message("late", "ask")));
		await abort;
		await execution;
		assert.equal(dispatches.counts.valid, 1);
		assert.equal(h.session.agent.state.isStreaming, false);
		assert.equal(
			h.sessionManager.getEntries().filter((e) => e.type === "custom_message" && e.customType === "intercom_message")
				.length,
			0,
			"a terminal child does not admit the late ask",
		);
	} finally {
		work.cleanup.resolve();
		await h.close(execution);
	}
});

test("a terminal workflow generation does not reopen for priority input", async () => {
	const h = await receiver("workflow-stage", []);
	const dispatches = createDispatchCounter([
		() => fauxAssistantMessage("stage done"),
		() => fauxAssistantMessage("must not run"),
	]);
	h.setResponses(dispatches.steps(3));
	const execution = h.session.prompt("stage task");
	await execution;
	try {
		h.boundary.seal();
		await Promise.resolve(h.deliver(message("closed", "send"))).catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(dispatches.counts.valid, 1);
		assert.equal(h.session.agent.state.isStreaming, false);
	} finally {
		await h.close(execution);
	}
});
