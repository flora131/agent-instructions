import assert from "node:assert/strict";
import { test } from "vitest";
import { claimPaneReporting, releasePaneReporting, reportPaneActivity } from "../src/extensions/herdr/pane-owner.js";
import { executeHerdr, HERDR_TIMEOUT_MS, type HerdrDiagnostic } from "../src/extensions/herdr/transport.js";
import { arg, fakeHerdr } from "./helpers/herdr.js";

// #2891: all subprocess tests use disposable executables, never Herdr.
test("pane ownership serializes and coalesces reports across replacement and clock rollback", async () => {
	const fake = await fakeHerdr("setTimeout(finish, 40);");
	const environment = { ...fake.environment, paneId: "w1:p1; rm -rf /" };
	const diagnostics: HerdrDiagnostic[] = [];
	let clock = 1000;
	const options = { clock: () => clock, diagnostic: (value: HerdrDiagnostic) => diagnostics.push(value) };
	const owner = await claimPaneReporting(environment, { id: "parent", path: `${fake.dir}/parent.jsonl` }, options);
	try {
		reportPaneActivity(owner, { state: "working", reason: "executing" });
		reportPaneActivity(owner, { state: "blocked", reason: "awaiting_input", message: "Waiting for approval" });
		reportPaneActivity(owner, { state: "idle", reason: "quiescent" });
		await owner.flush();
		clock = 1;
		const successor = await claimPaneReporting(environment, { id: "parent2", path: "relative.jsonl" }, options);
		try {
			reportPaneActivity(owner, { state: "working", reason: "executing" });
			await releasePaneReporting(owner);
			reportPaneActivity(successor, { state: "working", reason: "executing" });
			reportPaneActivity(successor, { state: "blocked", reason: "awaiting_input" });
			// Retirement discards the pending blocked report but drains working first.
			await releasePaneReporting(successor);
		} finally {
			await releasePaneReporting(successor);
		}
		const lifetime = await fake.calls();
		assert.deepEqual(
			lifetime.map((call) => call.phase),
			Array.from({ length: 5 }, () => ["start", "end"]).flat(),
		);
		const calls = lifetime.filter((call) => call.phase === "start").map((call) => call.args);
		assert.deepEqual(
			calls.map((args) => args[1]),
			["report-agent", "report-agent", "release-agent", "report-agent", "release-agent"],
		);
		assert.deepEqual(
			calls.filter((args) => args[1] === "report-agent").map((args) => arg(args, "--state")),
			["working", "idle", "working"],
		);
		for (const args of calls) {
			assert.equal(args[2], "w1:p1; rm -rf /");
			assert.equal(arg(args, "--source"), "custom:atomic");
			assert.equal(arg(args, "--agent"), "atomic");
		}
		const seq = calls.map((args) => Number(arg(args, "--seq")));
		assert.ok(seq[1] > seq[0] && seq[3] > seq[2]);
		assert.equal(seq[2], seq[1]);
		assert.equal(seq[4], seq[3]);
		assert.equal(calls.filter((args) => args.includes("--agent-session-id")).length, 2);
		assert.equal(arg(calls[3], "--agent-session-path"), undefined);
		assert.ok(diagnostics.some((value) => value.kind === "stale_owner"));
	} finally {
		await releasePaneReporting(owner);
		await fake.dispose();
	}
});

// #2891: raw child output never becomes a diagnostic body.
test("transport distinguishes spawn, timeout and protocol failures without exposing output", async () => {
	assert.equal(HERDR_TIMEOUT_MS, 5_000);
	const fake = await fakeHerdr(
		'if (args.includes("hang")) setInterval(() => {}, 1000); else { process.stderr.write("secret error body"); finish(1); }',
	);
	try {
		assert.deepEqual(await executeHerdr({ ...fake.environment, bin: `${fake.dir}/missing` }, [], 50), {
			kind: "spawn_failed",
		});
		assert.deepEqual(await executeHerdr(fake.environment, [], 1000), { kind: "protocol_rejected" });
		assert.deepEqual(await executeHerdr(fake.environment, ["hang"], 50), { kind: "timeout" });
		assert.deepEqual(await executeHerdr({ ...fake.environment, bin: "invalid\0path" }, []), { kind: "spawn_failed" });
	} finally {
		await fake.dispose();
	}
});
