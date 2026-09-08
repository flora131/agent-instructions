import assert from "node:assert/strict";
import { test } from "vitest";
import { createEventBus } from "../src/core/event-bus.js";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import { noOpUIContext } from "../src/core/extensions/runner-ui.js";
import { SessionManager } from "../src/core/session-manager.js";
import { createHerdrExtension } from "../src/extensions/herdr/index.js";
import { claimPaneReporting, releasePaneReporting, reportPaneActivity } from "../src/extensions/herdr/pane-owner.js";
import type { HerdrDiagnostic } from "../src/extensions/herdr/transport.js";
import { arg, fakeHerdr } from "./helpers/herdr.js";
import { createHarnessWithExtensions } from "./test-harness.js";

// A supplied resource loader can expose the same loaded extension to multiple runners.
// Eligibility at session_start must not grant a child's later shutdown parent authority.
test("shared reporter ignores child shutdown and keeps reporting for its parent", async () => {
	const fake = await fakeHerdr();
	const runtime = createExtensionRuntime();
	const publisher = runtime.workflowActivityHub.registerWorkflowActivityPublisher();
	publisher.publishSnapshot({ availability: "ready", roots: [] });
	const extension = await loadExtensionFromFactory(
		createHerdrExtension({ env: fake.env, enabled: () => true }),
		fake.dir,
		createEventBus(),
		runtime,
		"herdr",
	);
	const parentSession = SessionManager.create(fake.dir, fake.dir);
	const parent = new ExtensionRunner([extension], runtime, fake.dir, parentSession, {} as never);
	parent.setUIContext({ ...noOpUIContext }, "tui");
	const child = new ExtensionRunner(
		[extension],
		createExtensionRuntime(),
		fake.dir,
		SessionManager.inMemory(),
		{} as never,
		undefined,
		{ managementActions: "restricted", fanoutAuthorized: false, inheritProjectContext: true, inheritSkills: true },
	);
	child.setUIContext(undefined, "print");
	try {
		await parent.emit({ type: "session_start" });
		await fake.waitFor(1);
		await child.emit({ type: "session_start" });
		await child.emit({ type: "session_shutdown", reason: "quit" });
		assert.equal(
			(await fake.calls()).some((call) => call.args[1] === "release-agent"),
			false,
		);
		await parent.emit({ type: "agent_start" });
		const calls = await fake.waitFor(2);
		assert.equal(arg(calls[1].args, "--state"), "working");
		assert.equal(arg(calls[0].args, "--agent-session-id"), parentSession.getSessionId());
		assert.equal(arg(calls[0].args, "--agent-session-path"), parentSession.getSessionFile());
	} finally {
		await parent.emit({ type: "session_shutdown", reason: "quit" });
		parent.invalidate();
		child.invalidate();
		await fake.dispose();
	}
});

test("shared reporter accepts activity only from the first eligible session", async () => {
	const fake = await fakeHerdr();
	const runtime = createExtensionRuntime();
	const publisher = runtime.workflowActivityHub.registerWorkflowActivityPublisher();
	publisher.publishSnapshot({ availability: "ready", roots: [] });
	const extension = await loadExtensionFromFactory(
		createHerdrExtension({ env: fake.env, enabled: () => true }),
		fake.dir,
		createEventBus(),
		runtime,
		"herdr",
	);
	const session = SessionManager.inMemory();
	const parent = new ExtensionRunner([extension], runtime, fake.dir, session, {} as never);
	parent.setUIContext({ ...noOpUIContext }, "tui");
	const foreign = new ExtensionRunner(
		[extension],
		createExtensionRuntime(),
		fake.dir,
		SessionManager.inMemory(),
		{} as never,
	);
	foreign.setUIContext({ ...noOpUIContext }, "tui");
	try {
		// Unstarted runners must not leave an approval contribution for the future owner.
		await foreign.emit({ type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm" });
		await parent.emit({ type: "session_start" });
		await fake.waitFor(1);
		await foreign.emit({ type: "session_start" });
		await foreign.emit({ type: "agent_start" });
		await foreign.emit({ type: "agent_settled" });
		await foreign.emit({ type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm" });
		await foreign.emit({ type: "ui_prompt_end", reason: "ui_prompt", kind: "confirm" });
		await foreign.emit({ type: "session_shutdown", reason: "quit" });
		await parent.emit({ type: "agent_start" });
		await fake.waitFor(2);
		await parent.emit({ type: "session_shutdown", reason: "quit" });
		// Quit is terminal: late state/prompt events must not reclaim authority.
		await parent.emit({ type: "agent_start" });
		await parent.emit({ type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm" });
		const calls = (await fake.calls()).filter((call) => call.phase === "start");
		assert.deepEqual(
			calls.map((call) => call.args[1]),
			["report-agent", "report-agent", "release-agent"],
		);
		assert.deepEqual(
			calls.map((call) => arg(call.args, "--state")),
			["idle", "working", undefined],
		);
		assert.equal(arg(calls[0].args, "--agent-session-id"), session.getSessionId());
	} finally {
		await parent.emit({ type: "session_shutdown", reason: "quit" });
		await foreign.emit({ type: "session_shutdown", reason: "quit" });
		parent.invalidate();
		foreign.invalidate();
		await fake.dispose();
	}
});

test("real compaction and continued prompts retain pane authority until quit", async () => {
	const fake = await fakeHerdr();
	const lifecycle: string[] = [];
	const harness = await createHarnessWithExtensions({
		settings: { compaction: { enabled: false }, sessionSummary: { enabled: false } },
		responses: [
			{
				text: "First answer\nKeep this context",
				beforeEmit: async () => {
					await fake.waitFor(2);
				},
			},
			{
				text: "Continued after compaction",
				beforeEmit: async () => {
					await fake.waitFor(4);
				},
			},
		],
		extensionFactories: [
			createHerdrExtension({ env: fake.env, enabled: () => true }),
			(pi) => {
				const publisher = pi.registerWorkflowActivityPublisher();
				publisher.publishSnapshot({ availability: "ready", roots: [] });
				pi.on("session_start", () => {
					lifecycle.push("start");
				});
				pi.on("session_shutdown", () => {
					lifecycle.push("shutdown");
				});
				pi.on("session_before_compact", (event) => ({ compactedText: event.preparation.region.lines.join("\n") }));
				pi.on("session_compact", () => {
					lifecycle.push("compact");
				});
			},
		],
	});
	try {
		await harness.session.bindExtensions({ mode: "tui", uiContext: { ...noOpUIContext } });
		await fake.waitFor(1);
		// Manual compaction requires at least twenty compactable transcript lines.
		await harness.session.prompt(Array.from({ length: 25 }, (_, index) => `Task detail ${index}`).join("\n"));
		await fake.waitFor(3);
		const identity = harness.sessionManager.getSessionId();
		const result = await harness.session.compact({ preserve_recent: 0 });
		assert.equal(result.rung, "extension");
		assert.equal(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction").length, 1);
		assert.deepEqual(lifecycle, ["start", "compact"]);
		assert.equal((await fake.calls()).filter((call) => call.phase === "start").length, 3);
		await harness.session.prompt("Continue working");
		await fake.waitFor(5);
		await harness.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		const calls = (await fake.calls()).filter((call) => call.phase === "start");
		assert.deepEqual(
			calls.map((call) => arg(call.args, "--state")),
			["idle", "working", "idle", "working", "idle", undefined],
		);
		assert.equal(calls.at(-1)?.args[1], "release-agent");
		assert.equal(arg(calls[0].args, "--agent-session-id"), identity);
		assert.equal(calls.filter((call) => call.args.includes("--agent-session-id")).length, 1);
		assert.deepEqual(lifecycle, ["start", "compact", "shutdown"]);
	} finally {
		await harness.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		harness.cleanup();
		await fake.dispose();
	}
});

test("child shutdown cannot cancel a parent claim waiting for a timed-out predecessor", async () => {
	const fake = await fakeHerdr('if (args.includes("predecessor")) setInterval(() => {}, 1000); else finish();');
	const diagnostics: HerdrDiagnostic[] = [];
	const previous = await claimPaneReporting(
		fake.environment,
		{ id: "predecessor" },
		{
			timeoutMs: 1500,
			diagnostic: (value) => diagnostics.push(value),
		},
	);
	const runtime = createExtensionRuntime();
	const extension = await loadExtensionFromFactory(
		createHerdrExtension({ env: fake.env, enabled: () => true }),
		fake.dir,
		createEventBus(),
		runtime,
		"herdr",
	);
	const parent = new ExtensionRunner([extension], runtime, fake.dir, SessionManager.inMemory(), {} as never);
	parent.setUIContext({ ...noOpUIContext }, "tui");
	const child = new ExtensionRunner(
		[extension],
		createExtensionRuntime(),
		fake.dir,
		SessionManager.inMemory(),
		{} as never,
	);
	try {
		reportPaneActivity(previous, { state: "working", reason: "executing" });
		const starting = parent.emit({ type: "session_start" });
		await child.emit({ type: "session_shutdown", reason: "quit" });
		await starting;
		await parent.emit({ type: "agent_start" });
		await fake.waitFor(2); // predecessor release, then parent working (hung report has no end)
		await parent.emit({ type: "session_shutdown", reason: "quit" });
		const calls = (await fake.calls()).filter((call) => call.phase === "start");
		assert.deepEqual(
			calls.map((call) => call.args[1]),
			["report-agent", "release-agent", "report-agent", "release-agent"],
		);
		assert.deepEqual(diagnostics, [{ kind: "timeout" }]);
		for (let index = 0; index < calls.length; index++) {
			const args = calls[index].args;
			const seq = arg(args, "--seq")!;
			if (index) assert.ok(Number(seq) > Number(arg(calls[index - 1].args, "--seq")));
			assert.deepEqual(args, [
				"pane",
				index % 2 ? "release-agent" : "report-agent",
				fake.environment.paneId,
				"--source",
				"custom:atomic",
				"--agent",
				"atomic",
				"--seq",
				seq,
				...(index % 2
					? []
					: [
							"--state",
							"working",
							"--agent-session-id",
							index === 0 ? "predecessor" : parent.createContext().sessionManager.getSessionId(),
						]),
			]);
			assert.equal(calls[index].socket, fake.environment.socketPath);
		}
	} finally {
		await parent.emit({ type: "session_shutdown", reason: "quit" });
		await releasePaneReporting(previous);
		parent.invalidate();
		child.invalidate();
		await fake.dispose();
	}
});
