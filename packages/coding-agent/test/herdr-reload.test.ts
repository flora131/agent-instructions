import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, vi } from "vitest";
import { createExtensionRuntime } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import { noOpUIContext } from "../src/core/extensions/runner-ui.js";
import { ModelRuntime } from "../src/core/model-runtime.js";
import { createAgentSession } from "../src/core/sdk.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { createHerdrExtension } from "../src/extensions/herdr/index.js";
import { arg, fakeHerdr } from "./helpers/herdr.js";
import { createFauxStreamFn, fauxModel } from "./test-harness.js";
import { createTestExtensionsResult, createTestResourceLoader } from "./utilities.js";

// PR #2925: a supplied transactional loader may retain the loaded reporter closure.
test("SDK transactional reload retains the new reporter through retiring shutdown and final quit", async () => {
	const fake = await fakeHerdr();
	try {
		let loaded = await createTestExtensionsResult(
			[createHerdrExtension({ env: fake.env, enabled: () => true, clock: () => 100 })],
			fake.dir,
		);
		loaded.runtime.workflowActivityHub
			.registerWorkflowActivityPublisher()
			.publishSnapshot({ availability: "ready", roots: [] });
		let committed = false;
		const resourceLoader = {
			...createTestResourceLoader(),
			getExtensions: () => loaded,
			prepareReload: async () => {
				const candidate = { ...loaded, runtime: createExtensionRuntime() };
				candidate.runtime.workflowActivityHub
					.registerWorkflowActivityPublisher()
					.publishSnapshot({ availability: "ready", roots: [] });
				return {
					loader: createTestResourceLoader({ extensionsResult: candidate }),
					activate: () => {},
					commit: () => {
						loaded = candidate;
						committed = true;
					},
				};
			},
		};
		const modelRuntime = await ModelRuntime.create({ modelsPath: null, authPath: join(fake.dir, "auth.json") });
		const faux = createFauxStreamFn([
			{
				text: "Continued after reload",
				beforeEmit: async () => {
					await fake.waitFor(4);
				},
			},
		]);
		modelRuntime.registerProvider(fauxModel.provider, {
			baseUrl: fauxModel.baseUrl,
			apiKey: "faux-key",
			api: fauxModel.api,
			models: [fauxModel],
			streamSimple: faux.streamFn,
		});
		const sessionManager = SessionManager.create(fake.dir, fake.dir);
		const { session } = await createAgentSession({
			cwd: fake.dir,
			agentDir: fake.dir,
			resourceLoader,
			modelRuntime,
			sessionManager,
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: false },
				sessionSummary: { enabled: false },
			}),
			model: fauxModel,
			noTools: "all",
		});
		try {
			await session.bindExtensions({ mode: "tui", uiContext: { ...noOpUIContext } });
			await fake.waitFor(1);
			const retiring = session.extensionRunner;
			await session.reload({ failOnExtensionErrors: true });
			assert.equal(committed, true, "the real SDK transaction committed");
			assert.notEqual(session.extensionRunner, retiring);
			assert.equal(session.extensionRunner.createContext().sessionManager, sessionManager);
			await fake.waitFor(3);
			assert.deepEqual(
				(await fake.calls()).filter((call) => call.phase === "start").map((call) => call.args[1]),
				["report-agent", "release-agent", "report-agent"],
				"retiring runner shutdown must not release the candidate's claim",
			);
			await session.prompt("Continue working after reload");
			await fake.waitFor(5);
			assert.equal(session.agent.state.errorMessage, undefined);
			assert.deepEqual(session.messages.at(-1)?.content, [{ type: "text", text: "Continued after reload" }]);
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			await session.extensionRunner.emit({ type: "agent_start" });
			const records = await fake.calls();
			assert.deepEqual(
				records.map((call) => call.phase),
				Array.from({ length: 6 }, () => ["start", "end"]).flat(),
			);
			const states = ["idle", undefined, "idle", "working", "idle", undefined];
			const calls = records.filter((call) => call.phase === "start");
			for (const [index, call] of calls.entries()) {
				const seq = arg(call.args, "--seq")!;
				if (index) assert.ok(Number(seq) > Number(arg(calls[index - 1].args, "--seq")));
				assert.deepEqual(call.args, [
					"pane",
					states[index] ? "report-agent" : "release-agent",
					fake.environment.paneId,
					"--source",
					"custom:atomic",
					"--agent",
					"atomic",
					"--seq",
					seq,
					...(states[index] ? ["--state", states[index]] : []),
					...(index === 0 || index === 2
						? [
								"--agent-session-id",
								sessionManager.getSessionId(),
								"--agent-session-path",
								sessionManager.getSessionFile()!,
							]
						: []),
				]);
				assert.equal(call.socket, fake.environment.socketPath);
			}
		} finally {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		}
	} finally {
		await fake.dispose();
	}
});

// PR #2925: exercise stale events before runner invalidation can reject their contexts.
test("same-session retiring runner cannot cancel a pending claim or reclaim the active successor", async () => {
	const fake = await fakeHerdr(`
if (args[1] === "release-agent") {
	const timer = setInterval(() => {
		if (fs.existsSync(require("node:path").join(args[2], "allow-release"))) {
			clearInterval(timer);
			finish();
		}
	}, 5);
} else finish();`);
	const loaded = await createTestExtensionsResult(
		[createHerdrExtension({ env: fake.env, enabled: () => true, clock: () => 100 })],
		fake.dir,
	);
	loaded.runtime.workflowActivityHub
		.registerWorkflowActivityPublisher()
		.publishSnapshot({ availability: "ready", roots: [] });
	const sessionManager = SessionManager.create(fake.dir, fake.dir);
	const [retiring, successor] = [0, 1].map(() => {
		const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, fake.dir, sessionManager, {} as never);
		runner.setUIContext({ ...noOpUIContext }, "tui");
		return runner;
	});
	let starting: Promise<undefined> | undefined;
	let stopping: Promise<undefined> | undefined;
	try {
		await retiring.emit({ type: "session_start" });
		await fake.waitFor(1);
		starting = successor.emit({ type: "session_start", reason: "reload" });
		await vi.waitFor(async () => assert.equal((await fake.calls()).at(-1)?.args[1], "release-agent"));
		await retiring.emit({ type: "agent_start" });
		await retiring.emit({ type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm" });
		stopping = retiring.emit({ type: "session_shutdown", reason: "reload" });
		assert.equal((await fake.calls()).length, 3, "candidate transport waits for predecessor release");
		await writeFile(join(fake.dir, "allow-release"), "");
		await Promise.all([starting, stopping]);
		await fake.waitFor(3);
		assert.deepEqual(
			(await fake.calls()).filter((call) => call.phase === "start").map((call) => call.args[1]),
			["report-agent", "release-agent", "report-agent"],
		);
		await successor.emit({ type: "agent_start" });
		await fake.waitFor(4);
		await successor.emit({ type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm" });
		await fake.waitFor(5);
		await retiring.emit({ type: "session_start", reason: "reload" });
		await retiring.emit({ type: "agent_start" });
		await retiring.emit({ type: "agent_settled" });
		await retiring.emit({ type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm" });
		await retiring.emit({ type: "ui_prompt_end", reason: "ui_prompt", kind: "confirm" });
		await retiring.emit({ type: "session_shutdown", reason: "quit" });
		await successor.emit({ type: "ui_prompt_end", reason: "ui_prompt", kind: "confirm" });
		await fake.waitFor(6);
		await successor.emit({ type: "agent_settled" });
		await fake.waitFor(7);
		await successor.emit({ type: "session_shutdown", reason: "quit" });
		// Neither retired runner can start again even after the successor's final release.
		for (const runner of [retiring, successor]) {
			await runner.emit({ type: "session_start", reason: "reload" });
			await runner.emit({ type: "agent_start" });
			await runner.emit({ type: "session_shutdown", reason: "quit" });
		}
		const records = await fake.calls();
		assert.deepEqual(
			records.map((call) => call.phase),
			Array.from({ length: 8 }, () => ["start", "end"]).flat(),
		);
		const calls = records.filter((call) => call.phase === "start");
		const states = ["idle", undefined, "idle", "working", "blocked", "working", "idle", undefined];
		for (const [index, call] of calls.entries()) {
			const seq = arg(call.args, "--seq")!;
			if (index) assert.ok(Number(seq) > Number(arg(calls[index - 1].args, "--seq")));
			assert.deepEqual(call.args, [
				"pane",
				states[index] ? "report-agent" : "release-agent",
				fake.environment.paneId,
				"--source",
				"custom:atomic",
				"--agent",
				"atomic",
				"--seq",
				seq,
				...(states[index] ? ["--state", states[index]] : []),
				...(index === 4 ? ["--message", "Waiting for approval"] : []),
				...(index === 0 || index === 2
					? [
							"--agent-session-id",
							sessionManager.getSessionId(),
							"--agent-session-path",
							sessionManager.getSessionFile()!,
						]
					: []),
			]);
			assert.equal(call.socket, fake.environment.socketPath);
		}
	} finally {
		await writeFile(join(fake.dir, "allow-release"), "");
		await Promise.all([starting, stopping]);
		for (const runner of [retiring, successor]) await runner.emit({ type: "session_shutdown", reason: "quit" });
		for (const runner of [retiring, successor]) runner.invalidate();
		await fake.dispose();
	}
});
