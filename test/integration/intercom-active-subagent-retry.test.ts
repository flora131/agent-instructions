import assert from "node:assert/strict";
import { fauxAssistantMessage } from "@bastani/pi-ai/compat";
import { test, vi } from "vitest";
import type { ExtensionContext } from "../../packages/coding-agent/src/core/extensions/index.js";
import { createHarness, getMessageText } from "../../packages/coding-agent/test/suite/harness.js";
import intercomHeavy from "../../packages/intercom/index-heavy.js";
import type { IntercomExtensionTestOverrides } from "../../packages/intercom/intercom-test-seams.js";
import type { Message, SessionInfo } from "../../packages/intercom/types.js";
import { createDispatchCounter } from "../helpers/intercom-interrupt-probe.js";

const sender: SessionInfo = {
	id: "retry-peer",
	name: "retry-peer",
	cwd: "/retry-peer",
	model: "faux",
	pid: 1,
	startedAt: 1,
	lastActivity: 1,
};
async function endpoint() {
	const ended = new AbortController();
	let inbound!: Parameters<NonNullable<IntercomExtensionTestOverrides["captureInboundHandler"]>>[0];
	let context!: ExtensionContext;
	const h = await createHarness({
		subagentPolicy: {
			managementActions: "restricted",
			fanoutAuthorized: false,
			inheritProjectContext: false,
			inheritSkills: false,
			executionEnded: ended.signal,
			depth: 1,
		},
		extensionFactories: [
			(pi) => {
				intercomHeavy(pi, {
					captureInboundHandler: (handler) => {
						inbound = handler;
					},
				});
				pi.on("session_start", (_event, ctx) => {
					context = ctx;
				});
			},
		],
	});
	await h.session.bindExtensions({ mode: "print" });
	return {
		...h,
		ended,
		deliver: (message: Message) => inbound(context, sender, message),
		async close() {
			ended.abort();
			await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			h.session.pauseQueuedMessages();
			h.cleanup();
		},
	};
}
function message(id: string): Message {
	return { id, timestamp: Date.now(), content: { text: `RETRY-${id}` } };
}

// R2: FIFO belongs to the logical inbound operation, including retry delays.
test("a failed first append keeps its FIFO position through retry and duplicate arrival", async () => {
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const h = await endpoint();
	const observed: string[] = [];
	const dispatches = createDispatchCounter(
		Array.from({ length: 2 }, () => (context: { messages: object[] }) => {
			for (const id of ["first", "second"])
				if (!observed.includes(id) && context.messages.some((m) => getMessageText(m).includes(`RETRY-${id}`)))
					observed.push(id);
			return fauxAssistantMessage("amended");
		}),
	);
	h.setResponses([
		async () => {
			started.resolve();
			await release.promise;
			return fauxAssistantMessage("original");
		},
		...dispatches.steps(5),
	]);
	const append = h.sessionManager.appendCustomMessageEntry.bind(h.sessionManager);
	let failed = false;
	const storage = vi.spyOn(h.sessionManager, "appendCustomMessageEntry").mockImplementation((...args) => {
		if (args[0] === "intercom_message" && String(args[1]).includes("RETRY-first") && !failed) {
			failed = true;
			throw new Error("transient first append failure");
		}
		return append(...args);
	});
	const execution = h.session.prompt("original task");
	try {
		await started.promise;
		await h.deliver(message("first"));
		await h.deliver(message("second"));
		await h.deliver(message("first"));
		await vi.waitFor(() =>
			assert.equal(
				h.sessionManager
					.getEntries()
					.filter((e) => e.type === "custom_message" && e.customType === "intercom_message").length,
				2,
			),
		);
		release.resolve();
		await execution;
		const keys = h.sessionManager
			.getEntries()
			.flatMap((e) =>
				e.type === "custom_message" && e.customType === "intercom_message" ? [e.stageAdmissionKey] : [],
			);
		assert.deepEqual(keys, ["intercom:first", "intercom:second"]);
		assert.deepEqual(observed, ["first", "second"]);
		assert.ok(
			dispatches.counts.valid >= 1 && dispatches.counts.valid <= 2,
			`valid dispatches ${dispatches.counts.valid}`,
		);
		assert.equal(
			h.session.messages.filter((m) => m.role === "user" && getMessageText(m) === "original task").length,
			1,
		);
	} finally {
		storage.mockRestore();
		release.resolve();
		await execution;
		await h.close();
	}
});

for (const cancel of [false, true]) {
	test(`a reserved retry ${cancel ? "ends on cancellation without restarting" : "drains before the original task settles"}`, async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const failed = Promise.withResolvers<void>();
		const h = await endpoint();
		let amended = 0;
		let attempts = 0;
		const dispatches = createDispatchCounter([
			(context) => {
				assert.ok(context.messages.some((m) => getMessageText(m).includes("RETRY-settlement")));
				amended++;
				return fauxAssistantMessage("amended result");
			},
		]);
		h.setResponses([
			async () => {
				started.resolve();
				await release.promise;
				return fauxAssistantMessage("original result");
			},
			...dispatches.steps(3),
		]);
		const append = h.sessionManager.appendCustomMessageEntry.bind(h.sessionManager);
		const storage = vi.spyOn(h.sessionManager, "appendCustomMessageEntry").mockImplementation((...args) => {
			if (args[0] === "intercom_message" && ++attempts === 1) {
				failed.resolve();
				throw new Error("transient append failure before settlement");
			}
			return append(...args);
		});
		const execution = h.session.prompt("original task");
		try {
			await started.promise;
			await h.deliver(message("settlement"));
			await failed.promise;
			let abort: Promise<void> | undefined;
			if (cancel) {
				h.ended.abort();
				abort = h.session.abort();
			}
			release.resolve();
			await execution;
			await abort;
			assert.equal(attempts, cancel ? 1 : 2);
			assert.equal(amended, cancel ? 0 : 1);
			assert.equal(dispatches.counts.valid, cancel ? 0 : 1);
			assert.equal(
				h.session.messages.filter((m) => m.role === "user" && getMessageText(m) === "original task").length,
				1,
			);
			if (!cancel) assert.equal(getMessageText(h.session.messages.at(-1)), "amended result");
		} finally {
			storage.mockRestore();
			release.resolve();
			await execution;
			await h.close();
		}
	});
}
