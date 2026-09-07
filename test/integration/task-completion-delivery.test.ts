import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";
import { getAgentTaskHost } from "../../packages/coding-agent/src/core/agent-session-tasks.js";
import { SessionManager } from "../../packages/coding-agent/src/core/session-manager.js";
import { AgentTaskHost } from "../../packages/coding-agent/src/core/tasks/agent-adapter.js";
import { TaskCompletionOutbox } from "../../packages/coding-agent/src/core/tasks/completion.js";
import type { OperationId, TaskResult } from "../../packages/coding-agent/src/core/tasks/contracts.js";

// RFC PR #2884: task settlement is separate from persisted model delivery.
test("completion intent precedes admission and retries a lost acknowledgement with the same identity", async () => {
	const session = SessionManager.inMemory();
	const completed = Promise.withResolvers<TaskResult>();
	let admissions = 0;
	let loseAck = true;
	const outbox = new TaskCompletionOutbox(
		session,
		() => true,
		async (envelope) => {
			admissions++;
			assert.equal(envelope.display, false);
			assert.ok(
				session
					.getEntries()
					.some((entry) => entry.type === "custom" && entry.customType === "task-completion-intent"),
			);
			if (loseAck) {
				loseAck = false;
				throw new Error("lost acknowledgement");
			}
		},
	);
	const host = new AgentTaskHost({
		scope: { kind: "session", sessionId: session.getSessionId() },
		authorizeLaunch() {},
		onTaskSettled: (ref, receipt) => outbox.record(ref.ownerId, receipt),
	});
	const started = await host.startAgentTask(
		{ kind: "agent", agent: "fake", task: " read " },
		"completion" as OperationId,
		() => ({ result: completed.promise, cleanup: completed.promise.then(() => ({ kind: "reaped" as const })) }),
	);
	assert.equal(started.ok, true);
	if (!started.ok) return;
	assert.equal((await host.observeAgentLaunch(started.value.taskId)).ok, true);
	assert.equal(outbox.pending.length, 0);
	completed.resolve({ kind: "failed", code: "fixture", message: "done" });
	await host.waitForTask(started.value.taskId);
	await outbox.flush();
	assert.equal(outbox.pending.length, 1);
	const id = outbox.pending[0]!.completionId;
	await outbox.flush();
	assert.equal(outbox.pending.length, 0);
	assert.equal(admissions, 2);
	assert.ok(
		session
			.getEntries()
			.some(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === "task-completion-ack" &&
					JSON.stringify(entry.data).includes(id),
			),
	);
	await host.close("session-close");
});

// PR #2906: restored terminal intents must not wait for another task to settle.
test("restored completion intents begin delivery without a new settlement", async () => {
	const session = SessionManager.inMemory();
	const envelope = {
		completionId: "restored-completion",
		ownerId: "historical-owner",
		taskId: "historical-task",
		terminalSequence: 7,
		result: { kind: "completed" },
		display: false,
	};
	session.appendCustomEntry("task-completion-intent", envelope);
	session.appendCustomEntry("task-completion-intent", { ...envelope, completionId: "already-acked" });
	session.appendCustomEntry("task-completion-ack", { completionId: "already-acked" });
	const release = Promise.withResolvers<void>();
	const admitted: string[] = [];
	const outbox = new TaskCompletionOutbox(
		session,
		() => true,
		async (restored) => {
			admitted.push(restored.completionId);
			assert.deepEqual(restored, envelope);
			await release.promise;
		},
	);
	await vi.waitFor(() => assert.deepEqual(admitted, [envelope.completionId]));
	const concurrentFlush = outbox.flush();
	release.resolve();
	await concurrentFlush;
	assert.deepEqual(outbox.pending, []);
	new TaskCompletionOutbox(
		session,
		() => true,
		async (restored) => {
			admitted.push(restored.completionId);
		},
	);
	await Promise.resolve();
	assert.deepEqual(admitted, [envelope.completionId]);
});

test("restored completion retry respects closed admission and retains failed delivery", async () => {
	const session = SessionManager.inMemory();
	session.appendCustomEntry("task-completion-intent", {
		completionId: "retry-completion",
		ownerId: "historical-owner",
		taskId: "historical-task",
		terminalSequence: 7,
		result: { kind: "completed" },
		display: false,
	});
	let open = false;
	let fail = true;
	const admitted: string[] = [];
	const outbox = new TaskCompletionOutbox(
		session,
		() => open,
		async (envelope) => {
			admitted.push(envelope.completionId);
			if (fail) throw new Error("admission unavailable");
		},
	);
	await outbox.flush();
	assert.deepEqual(admitted, []);
	assert.equal(outbox.pending.length, 1);
	open = true;
	await outbox.flush();
	assert.equal(outbox.pending.length, 1);
	fail = false;
	await outbox.flush();
	assert.deepEqual(admitted, ["retry-completion", "retry-completion"]);
	assert.deepEqual(outbox.pending, []);
	assert.equal(
		session.getEntries().filter((entry) => entry.type === "custom" && entry.customType === "task-completion-intent")
			.length,
		1,
	);
	assert.equal(
		session.getEntries().filter((entry) => entry.type === "custom" && entry.customType === "task-completion-ack")
			.length,
		1,
	);
});

test("session task initialization deduplicates persisted delivery after a crash before acknowledgement", async () => {
	const directory = mkdtempSync(join(tmpdir(), "task-completion-restart-"));
	try {
		const original = SessionManager.create(directory, directory);
		const envelope = {
			completionId: "delivered-before-crash",
			ownerId: "historical-owner",
			taskId: "historical-task",
			terminalSequence: 7,
			result: { kind: "completed" },
			display: false,
		};
		original.appendCustomEntry("task-completion-intent", envelope);
		original.appendCustomMessageEntry(
			"task-completion",
			JSON.stringify(envelope),
			false,
			envelope,
			undefined,
			undefined,
			envelope.completionId,
		);
		original.flush();
		const restored = SessionManager.open(original.getSessionFile()!);
		let deliveries = 0;
		const session = {
			sessionManager: restored,
			async sendCustomMessage() {
				deliveries++;
			},
		} as unknown as ThisParameterType<typeof getAgentTaskHost>;
		const host = getAgentTaskHost.call(session);
		try {
			await vi.waitFor(() =>
				assert.equal(
					restored
						.getEntries()
						.filter((entry) => entry.type === "custom" && entry.customType === "task-completion-ack").length,
					1,
				),
			);
			assert.equal(deliveries, 0);
			restored.flush();
			const restarted = SessionManager.open(restored.getSessionFile()!);
			assert.equal(
				restarted
					.getEntries()
					.filter((entry) => entry.type === "custom_message" && entry.stageAdmissionKey === envelope.completionId)
					.length,
				1,
			);
		} finally {
			await host.close("session-close");
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
