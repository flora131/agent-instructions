import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createEventBus } from "../src/core/event-bus.js";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import { noOpUIContext } from "../src/core/extensions/runner-ui.js";
import { SessionManager } from "../src/core/session-manager.js";
import { AgentTaskHost } from "../src/core/tasks/agent-adapter.js";
import type { TaskResult } from "../src/core/tasks/contracts.js";
import { deriveSessionActivity } from "../src/extensions/herdr/activity.js";
import { createHerdrExtension } from "../src/extensions/herdr/index.js";
import { arg, fakeHerdr } from "./helpers/herdr.js";

test("independent subagents keep Herdr working while the parent is settled or awaiting approval", () => {
	for (const availability of ["ready", "recovering", "unavailable"] as const) {
		for (const openPromptCount of [0, 1]) {
			assert.deepEqual(
				deriveSessionActivity({
					agentRunning: false,
					tasksRunning: true,
					openPromptCount,
					roots: [],
					availability,
				}),
				{ state: "working", reason: "executing" },
			);
		}
	}
});

test("Herdr observes overlapping owner tasks and reattaches without losing running subagents", async () => {
	const fake = await fakeHerdr();
	const runtime = createExtensionRuntime();
	const publisher = runtime.workflowActivityHub.registerWorkflowActivityPublisher();
	publisher.publishSnapshot({ availability: "ready", roots: [] });
	const session = SessionManager.inMemory();
	const host = new AgentTaskHost({
		scope: { kind: "session", sessionId: session.getSessionId() },
		authorizeLaunch() {},
	});
	const extension = await loadExtensionFromFactory(
		createHerdrExtension({ env: fake.env, enabled: () => true }),
		fake.dir,
		createEventBus(),
		runtime,
		"herdr",
	);
	const runner = new ExtensionRunner([extension], runtime, fake.dir, session, {} as never);
	runner.bindTaskHost(() => host);
	runner.setUIContext({ ...noOpUIContext }, "tui");
	let finishFirst!: (result: TaskResult) => void;
	let finishSecond!: (result: TaskResult) => void;
	try {
		await runner.emit({ type: "session_start" });
		await fake.waitFor(1);
		const first = await host.startAgentTask({ kind: "agent", agent: "first", task: "test" }, "first", () => ({
			result: new Promise<TaskResult>((resolve) => {
				finishFirst = resolve;
			}),
			cleanup: Promise.resolve({ kind: "reaped" }),
		}));
		assert.equal(first.ok, true);
		assert.equal(arg((await fake.waitFor(2))[1].args, "--state"), "working");
		const second = await host.startAgentTask({ kind: "agent", agent: "second", task: "test" }, "second", () => ({
			result: new Promise<TaskResult>((resolve) => {
				finishSecond = resolve;
			}),
			cleanup: Promise.resolve({ kind: "reaped" }),
		}));
		assert.equal(second.ok, true);
		finishFirst({ kind: "failed", code: "test", message: "test" });
		if (first.ok) await host.waitForTask(first.value.taskId);
		await runner.emit({ type: "agent_settled" });
		await runner.emit({ type: "session_shutdown", reason: "reload" });
		const beforeReload = (await fake.calls()).filter((call) => call.phase === "end");
		assert.equal(
			beforeReload.some((call) => call.args[1] === "release-agent"),
			false,
		);
		await runner.emit({ type: "session_start" });
		const reloadCalls = await fake.waitFor(beforeReload.length + 1);
		assert.equal(reloadCalls[beforeReload.length].args[1], "report-agent");
		assert.equal(arg(reloadCalls[beforeReload.length].args, "--state"), "working");
		for (const call of reloadCalls.slice(1).filter((call) => call.args[1] === "report-agent")) {
			assert.equal(arg(call.args, "--state"), "working", "no false idle while the second task is running");
		}
		finishSecond({ kind: "cancelled", cause: "user" });
		if (second.ok) await host.waitForTask(second.value.taskId);
		await vi.waitFor(
			async () => {
				const calls = (await fake.calls()).filter((call) => call.phase === "end");
				assert.ok(calls.length > reloadCalls.length);
				assert.equal(arg(calls.at(-1)!.args, "--state"), "idle");
			},
			{ timeout: 5_000 },
		);
	} finally {
		finishFirst?.({ kind: "cancelled", cause: "shutdown" });
		finishSecond?.({ kind: "cancelled", cause: "shutdown" });
		await runner.emit({ type: "session_shutdown", reason: "quit" });
		runner.invalidate();
		await host.close("session-close");
		await fake.dispose();
	}
});
