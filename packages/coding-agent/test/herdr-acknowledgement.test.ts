import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createEventBus } from "../src/core/event-bus.js";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import { noOpUIContext } from "../src/core/extensions/runner-ui.js";
import type { WorkflowRootActivity } from "../src/core/extensions/workflow-events.js";
import { SessionManager } from "../src/core/session-manager.js";
import { createHerdrExtension } from "../src/extensions/herdr/index.js";
import { arg, fakeHerdr } from "./helpers/herdr.js";

test("interactive input acknowledges old workflow blocks without suppressing fresh blocks or approvals", async () => {
	const fake = await fakeHerdr();
	const runtime = createExtensionRuntime();
	const publisher = runtime.workflowActivityHub.registerWorkflowActivityPublisher();
	const root: WorkflowRootActivity = {
		rootRunId: "run",
		ownerSessionId: "owner",
		state: "blocked",
		reason: "manual_intervention",
		activeExecutionCount: 0,
		actionableBlockCount: 1,
		needsAttention: true,
	};
	publisher.publishSnapshot({ availability: "ready", roots: [root] });
	const extension = await loadExtensionFromFactory(
		createHerdrExtension({ env: fake.env, enabled: () => true }),
		fake.dir,
		createEventBus(),
		runtime,
		"herdr",
	);
	const runner = new ExtensionRunner([extension], runtime, fake.dir, SessionManager.inMemory(), {} as never);
	runner.setUIContext({ ...noOpUIContext }, "tui");
	const expectState = async (state: string) => {
		await vi.waitFor(async () => {
			const calls = (await fake.calls()).filter((call) => call.phase === "end");
			assert.equal(arg(calls.at(-1)?.args ?? [], "--state"), state);
		});
	};
	try {
		await runner.emit({ type: "session_start" });
		await expectState("blocked");
		await runner.emitInput("notice", undefined, "extension");
		await runner.emit({ type: "agent_start" });
		await expectState("working");
		await runner.emit({ type: "agent_settled" });
		await expectState("blocked");
		await runner.emitInput("continue here", undefined, "interactive");
		await expectState("idle");
		publisher.publishSnapshot({ availability: "ready", roots: [{ ...root }] });
		await runner.emit({ type: "agent_start" });
		await expectState("working");
		await runner.emit({ type: "agent_settled" });
		await expectState("idle");
		await runner.emit({ type: "ui_prompt_start" });
		await expectState("blocked");
		await runner.emitInput("another message", undefined, "interactive");
		await runner.emit({ type: "ui_prompt_end" });
		await expectState("idle");
		publisher.publishChanged({ ...root, state: "working", reason: "executing", activeExecutionCount: 1 });
		await expectState("working");
		publisher.publishChanged({ ...root });
		await expectState("blocked");
		await runner.emitInput("acknowledged", undefined, "interactive");
		await expectState("idle");
		await runner.emit({
			type: "workflow_lifecycle",
			cursor: { epoch: "test", revision: 2 },
			eventId: "new-prompt",
			runId: "run",
			rootRunId: "run",
			ownerSessionId: "owner",
			occurredAt: 1,
			observedAt: 1,
			delivery: "live",
			target: { kind: "prompt", runId: "run", promptId: "second", status: "opened" },
		});
		await expectState("blocked");
	} finally {
		await runner.emit({ type: "session_shutdown", reason: "quit" });
		runner.invalidate();
		publisher.dispose();
		await fake.dispose();
	}
});
