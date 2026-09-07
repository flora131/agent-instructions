import assert from "node:assert/strict";
import { test } from "vitest";
import { AgentTaskHost } from "../../packages/coding-agent/src/core/tasks/agent-adapter.js";
import type { OperationId, TaskResult } from "../../packages/coding-agent/src/core/tasks/contracts.js";
import { InMemoryDurableBackend } from "../../packages/workflows/src/durable/backend.js";
import { createToolPrimitive } from "../../packages/workflows/src/durable/tool-primitive.js";
import { sleep } from "../helpers/runtime.js";

// RFC PR #2884: observation yield must never complete a durable DAG node.
test("a live admitted task prevents durable node completion and yielded checkpoints", async () => {
	const host = new AgentTaskHost({ scope: { kind: "session", sessionId: "durable-task" }, authorizeLaunch() {} });
	const result = Promise.withResolvers<TaskResult>();
	const yielded = Promise.withResolvers<void>();
	let ended = false;
	const tool = createToolPrimitive({
		workflowId: "task-durable",
		backend: new InMemoryDurableBackend(),
		nextCheckpointId: () => "one",
		throwIfCancelled() {},
		onNodeEnd() {
			ended = true;
		},
	});
	const execution = tool("agent", {}, async () => {
		const admitted = await host.startAgentTask(
			{ kind: "agent", agent: "fake", task: " raw " },
			"durable" as OperationId,
			() => ({ result: result.promise, cleanup: result.promise.then(() => ({ kind: "reaped" as const })) }),
		);
		assert.ok(admitted.ok);
		const observed = await host.observeAgentLaunch(admitted.value.taskId);
		assert.ok(observed.ok);
		yielded.resolve();
		return observed.value;
	});
	try {
		await yielded.promise;
		await sleep(1);
		assert.equal(ended, false, "live task cannot complete its DAG node");
		result.resolve({ kind: "failed", code: "fixture", message: "terminal" });
		const terminal = await execution;
		assert.equal(terminal.kind, "settled");
		assert.equal(ended, true);
	} finally {
		result.resolve({ kind: "failed", code: "fixture", message: "terminal" });
		await execution;
		await host.close("session-close");
	}
});
