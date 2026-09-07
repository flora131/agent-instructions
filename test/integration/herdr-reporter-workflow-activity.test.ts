import assert from "node:assert/strict";
import { test } from "vitest";
import { createEventBus } from "../../packages/coding-agent/src/core/event-bus.js";
import {
	createExtensionRuntime,
	loadExtensionFromFactory,
} from "../../packages/coding-agent/src/core/extensions/loader.js";
import { ExtensionRunner } from "../../packages/coding-agent/src/core/extensions/runner.js";
import { noOpUIContext } from "../../packages/coding-agent/src/core/extensions/runner-ui.js";
import { SessionManager } from "../../packages/coding-agent/src/core/session-manager.js";
import { createHerdrExtension } from "../../packages/coding-agent/src/extensions/herdr/index.js";
import type { HerdrDiagnostic } from "../../packages/coding-agent/src/extensions/herdr/transport.js";
import { arg, fakeHerdr } from "../../packages/coding-agent/test/helpers/herdr.js";
import { workflow } from "../../packages/workflows/src/authoring/workflow.js";
import { InMemoryDurableBackend } from "../../packages/workflows/src/durable/backend.js";
import { run } from "../../packages/workflows/src/engine/run.js";
import { createWorkflowObservation } from "../../packages/workflows/src/extension/workflow-observation.js";
import { createStore } from "../../packages/workflows/src/shared/store.js";

// #2891: the full path from workflow execution through the host activity hub to the
// built-in reporter's `herdr` CLI invocations, against a fake executable capturing argv.
//
// Observed argv sequence (each prefixed `pane report-agent <pane> --source custom:atomic --agent atomic --seq N`):
//   1. `--state idle --agent-session-id <id>` (ready snapshot with no roots, parent identity sent once)
//   2. `--state idle`     (the new root appears before its first execution)
//   3. `--state working`  (tool-only execution)
//   4. `--state blocked --message "Workflow needs attention"` (HIL prompt open)
//   5. `--state working`  (execution resumed after the prompt was answered)
//   6. `--state idle`     (run completed)
// followed by `pane release-agent ... --seq N` on session_shutdown, with N strictly greater than the last report
// (Herdr 0.8.2 ignores an equal or older `--seq`).
// Between two nodes of the run body no stage or tool is executing, so the projection may publish a
// momentary idle root (as in 2.). The reporter keeps only the newest pending state while a CLI child is
// in flight, so such boundary idles are normally coalesced away; the assertion drops any idle that is
// immediately followed by another state and checks the remaining phase order exactly.
test("reporter reports working, blocked, working, idle for a real workflow with increasing --seq", async () => {
	const fake = await fakeHerdr();
	const runtime = createExtensionRuntime();
	const diagnostics: HerdrDiagnostic[] = [];
	const extension = await loadExtensionFromFactory(
		createHerdrExtension({ env: fake.env, enabled: () => true, diagnostic: (value) => diagnostics.push(value) }),
		fake.dir,
		createEventBus(),
		runtime,
		"herdr",
	);
	const runner = new ExtensionRunner([extension], runtime, fake.dir, SessionManager.inMemory(), {} as never);
	runner.setUIContext({ ...noOpUIContext }, "tui");
	const store = createStore();
	let observation: { dispose(): void } | undefined;
	try {
		let seen = 0;
		const waitForReport = async (state: string) => {
			const deadline = Date.now() + 5_000;
			while (Date.now() < deadline) {
				const done = (await fake.calls()).filter((call) => call.phase === "end");
				const index = done.findIndex((call, i) => i >= seen && arg(call.args, "--state") === state);
				if (index >= 0) {
					seen = index + 1;
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			assert.fail(`Expected a ${state} report: ${JSON.stringify(await fake.calls())}`);
		};
		await runner.emit({ type: "session_start", reason: "startup" });
		observation = createWorkflowObservation(
			store,
			runtime.workflowActivityHub.registerWorkflowActivityPublisher(),
			"owner",
		);
		await waitForReport("idle");

		const firstToolEntered = Promise.withResolvers<void>();
		const firstToolRelease = Promise.withResolvers<void>();
		const secondToolEntered = Promise.withResolvers<void>();
		const secondToolRelease = Promise.withResolvers<void>();
		const prompted = Promise.withResolvers<void>();
		const unsubscribe = store.subscribe(() => {
			if (store.runs().some((item) => item.stages.some((stage) => stage.pendingPrompt))) prompted.resolve();
		});
		const execution = run(
			workflow({
				name: "herdr-activity",
				description: "",
				inputs: {},
				outputs: {},
				run: async (ctx) => {
					await ctx.tool("first", {}, async () => {
						firstToolEntered.resolve();
						await firstToolRelease.promise;
						return "done";
					});
					await ctx.ui.confirm("Continue?");
					await ctx.tool("second", {}, async () => {
						secondToolEntered.resolve();
						await secondToolRelease.promise;
						return "done";
					});
					return {};
				},
			}),
			{},
			{
				store,
				durableBackend: new InMemoryDurableBackend(),
				usePromptNodesForUi: true,
				adapters: { complete: { complete: async (text) => text } },
			},
		);
		await firstToolEntered.promise;
		await waitForReport("working");
		firstToolRelease.resolve();
		await prompted.promise;
		unsubscribe();
		await waitForReport("blocked");
		const waitingRun = store.runs().find((item) => item.stages.some((stage) => stage.pendingPrompt))!;
		const promptStage = waitingRun.stages.find((item) => item.pendingPrompt)!;
		store.resolveStagePendingPrompt(waitingRun.id, promptStage.id, promptStage.pendingPrompt!.id, true);
		await secondToolEntered.promise;
		await waitForReport("working");
		secondToolRelease.resolve();
		assert.equal((await execution).status, "completed");
		await waitForReport("idle");
		await runner.emit({ type: "session_shutdown", reason: "quit" });
		const calls = await fake.waitFor(seen + 1);

		const reports = calls.filter((call) => call.args[0] === "pane" && call.args[1] === "report-agent");
		const states = reports
			.map((call) => arg(call.args, "--state"))
			.filter((state, index, all) => index === 0 || state !== all[index - 1]);
		const phases = states.filter((state, index) => state !== "idle" || index === states.length - 1);
		assert.deepEqual(phases, ["working", "blocked", "working", "idle"]);
		assert.equal(states.at(0), "idle");
		for (const call of reports) {
			assert.equal(
				arg(call.args, "--message"),
				arg(call.args, "--state") === "blocked" ? "Workflow needs attention" : undefined,
			);
		}
		for (const call of calls) {
			assert.equal(call.args[2], fake.environment.paneId);
			assert.equal(arg(call.args, "--source"), "custom:atomic");
			assert.equal(arg(call.args, "--agent"), "atomic");
			assert.equal(call.socket, fake.environment.socketPath);
		}
		const seqs = reports.map((call) => Number(arg(call.args, "--seq")));
		assert.ok(
			seqs.every((seq) => Number.isInteger(seq) && seq > 0),
			JSON.stringify(seqs),
		);
		for (let index = 1; index < seqs.length; index++) assert.ok(seqs[index] > seqs[index - 1], JSON.stringify(seqs));
		const release = calls.at(-1)!;
		assert.equal(release.args[1], "release-agent");
		assert.equal(calls.length, reports.length + 1);
		assert.ok(Number(arg(release.args, "--seq")) > seqs.at(-1)!);
		assert.equal(arg(reports[0].args, "--agent-session-id"), runner.createContext().sessionManager.getSessionId());
		assert.ok(reports.slice(1).every((call) => arg(call.args, "--agent-session-id") === undefined));
		assert.deepEqual(diagnostics, []);
	} finally {
		observation?.dispose();
		runner.invalidate();
		await fake.dispose();
	}
});
