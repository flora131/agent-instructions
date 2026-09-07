import assert from "node:assert/strict";
import { test } from "vitest";
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
