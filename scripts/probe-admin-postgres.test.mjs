import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function probe(t, scenario) {
	const root = mkdtempSync(join(tmpdir(), "atomic-probe-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const observation = join(root, "observation.json");
	const result = spawnSync(
		process.execPath,
		[
			"--require",
			join(import.meta.dirname, "fixtures/probe-admin-postgres-preload.cjs"),
			join(import.meta.dirname, "probe-admin-postgres.mjs"),
		],
		{
			env: {
				...process.env,
				ATOMIC_EMBEDDED_POSTGRES_BIN_DIR: root,
				ATOMIC_PROBE_SCENARIO: scenario,
				ATOMIC_PROBE_OBSERVATION: observation,
			},
			encoding: "utf8",
			timeout: 10_000,
		},
	);
	assert.ifError(result.error);
	const state = JSON.parse(readFileSync(observation, "utf8"));
	// All processes in this fixture are substitutes. Remove preserved fake data
	// only after asserting what the real CLI did, never a real server's data.
	if (state.root) t.after(() => rmSync(state.root, { recursive: true, force: true }));
	return { ...state, ...result };
}

test("SQL failure closes the client and confirms retained shutdown before cluster deletion", (t) => {
	const result = probe(t, "sql-failure");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /INJECTED_SQL_FAILURE/);
	assert.deepEqual(
		result.events.filter((event) => !event.startsWith("wait:") && event !== "connect"),
		["spawn:9001", "client-end", "interrupt:9001", "release:9001", "remove-cluster"],
	);
	assert.equal(result.exists, false);
	assert.doesNotMatch(result.stdout, /PASS/);
});

test("readiness failure stops its retained child before removing data", (t) => {
	const result = probe(t, "readiness-failure");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /INJECTED_READINESS_FAILURE/);
	assert.deepEqual(result.events, ["spawn:9001", "interrupt:9001", "release:9001", "remove-cluster"]);
	assert.equal(result.exists, false);
});

test("unconfirmed shutdown retains the lease and data after SQL failure", (t) => {
	const result = probe(t, "failed-shutdown");
	assert.equal(result.status, 1);
	assert.equal(result.exists, true);
	assert(result.events.includes("client-end"));
	assert(result.events.includes("interrupt:9001"));
	assert(!result.events.some((event) => event.startsWith("release:") || event === "remove-cluster"));
	assert.match(result.stderr, /Preserving cluster/);
	assert.doesNotMatch(result.stdout, /PASS/);
});

test("a competing listener with a bind-failed owned child receives no SQL writes or PASS", (t) => {
	const result = probe(t, "bind-failure");
	assert.equal(result.status, 1);
	assert(result.events.includes("wait:9001"));
	assert(!result.events.some((event) => event.startsWith("query:")));
	assert.doesNotMatch(result.stdout, /PASS/);
});

test("a competing cluster is rejected by read-only identity before any writes", (t) => {
	const result = probe(t, "competing-identity");
	assert.equal(result.status, 1);
	const queries = result.events.filter((event) => event.startsWith("query:"));
	assert.equal(queries.length, 1);
	assert.match(queries[0], /SELECT .*data_directory/);
	assert(result.events.indexOf("client-end") < result.events.indexOf("interrupt:9001"));
	assert.doesNotMatch(result.stdout, /PASS/);
});

test("success verifies both postmasters, persists exact text, and stops before deleting", (t) => {
	const result = probe(t, "success");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /PASS/);
	assert.match(result.stdout, /quote' slash\\\\ trailing /);
	const actions = result.events
		.filter((event) => !event.startsWith("wait:") && event !== "connect")
		.map((event) =>
			event.startsWith("query:SELECT current_setting")
				? "identity"
				: event.startsWith("query:CREATE")
					? "create"
					: event.startsWith("query:INSERT")
						? "write"
						: event.startsWith("query:SELECT marker")
							? "read"
							: event,
		);
	assert.deepEqual(actions, [
		"spawn:9001",
		"identity",
		"create",
		"write",
		"client-end",
		"interrupt:9001",
		"release:9001",
		"spawn:9002",
		"identity",
		"read",
		"client-end",
		"interrupt:9002",
		"release:9002",
		"remove-cluster",
	]);
	assert.equal(result.exists, false);
});

test("natural child exit cannot count as owned shutdown and restart persistence", (t) => {
	const result = probe(t, "unsignaled");
	assert.equal(result.status, 1);
	assert.match(result.stderr, /exited before owned shutdown/);
	assert(!result.events.includes("spawn:9002"));
	assert.doesNotMatch(result.stdout, /PASS/);
});
