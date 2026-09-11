/** Owned, disposable DBOS fixture for measuring workflow resume latency. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { Type } from "typebox";
import { workflow } from "../packages/workflows/src/authoring/workflow.js";
import { configureDbosDurableBackend } from "../packages/workflows/src/durable/dbos-backend.js";
import { setDurableBackend } from "../packages/workflows/src/durable/factory.js";
import { createExtensionRuntime } from "../packages/workflows/src/extension/runtime.js";
import { handleRunControlCommand } from "../packages/workflows/src/extension/workflow-run-control-command.js";
import { jobTracker } from "../packages/workflows/src/runs/background/job-tracker.js";
import { quitRun } from "../packages/workflows/src/runs/background/quit.js";
import { runDetached } from "../packages/workflows/src/runs/background/runner.js";
import { store } from "../packages/workflows/src/shared/store.js";

const [mode, directory, countArgument = "500", samplesArgument = "3"] = process.argv.slice(2);
assert.ok(mode === "seed" || mode === "resume", "mode must be seed or resume");
assert.ok(directory, "pass an owned fixture directory");
const databaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL?.trim();
assert.ok(databaseUrl, "an explicit disposable DBOS_SYSTEM_DATABASE_URL is required");
const url = new URL(databaseUrl);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "use an isolated loopback PostgreSQL cluster");
assert.match(url.pathname, /^\/atomic_resume_probe_[a-z0-9_]+$/, "use a fresh atomic_resume_probe_* database");
// Never record credentials. Bind this directory to the explicitly selected fixture database.
const databaseIdentity = `${url.hostname}:${url.port || "5432"}${url.pathname}`;
const root = resolve(directory);
const count = Number(countArgument);
const samples = Number(samplesArgument);
assert.ok(Number.isSafeInteger(count) && count > 0);
assert.ok(Number.isSafeInteger(samples) && samples > 0);
mkdirSync(root, { recursive: true });
const manifestPath = join(root, "manifest.json");
interface Manifest {
	owner: "atomic-workflow-resume-benchmark-v1";
	databaseIdentity: string;
	runIds: string[];
	count: number;
	checkpointIds: Record<string, string[]>;
}
const manifest: Manifest =
	mode === "seed"
		? {
				owner: "atomic-workflow-resume-benchmark-v1",
				databaseIdentity,
				runIds: Array.from({ length: samples }, () => crypto.randomUUID()),
				count,
				checkpointIds: {},
			}
		: JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.owner, "atomic-workflow-resume-benchmark-v1");
assert.equal(manifest.databaseIdentity, databaseIdentity, "fixture database must match its seed manifest");
assert.ok(Number.isSafeInteger(manifest.count) && manifest.count > 0);
assert.ok(manifest.runIds.length > 0);
for (const runId of manifest.runIds) {
	assert.match(runId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
	if (mode === "resume") {
		assert.ok(manifest.checkpointIds[runId]?.length, "seed must have finished before resume");
		assert.ok(!existsSync(join(root, `${runId}.useful`)), "each target may be measured only once");
	}
}
assert.ok(!existsSync(join(root, `${mode}.json`)), "refuse to overwrite a report");
if (mode === "seed") assert.ok(!existsSync(manifestPath), "refuse to overwrite an existing fixture");
const preflight = new pg.Client({ connectionString: databaseUrl });
await preflight.connect();
let postgresVersion: string;
try {
	postgresVersion = (await preflight.query("SHOW server_version")).rows[0].server_version;
	if (mode === "seed") {
		const tables = await preflight.query(
			"SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')",
		);
		assert.equal(tables.rows.length, 0, "seed requires a newly created empty disposable database");
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
	}
} finally {
	await preflight.end();
}
let queryCount = 0;
const originalQuery = pg.Client.prototype.query;
Object.defineProperty(pg.Client.prototype, "query", {
	value: function (this: pg.Client, ...args: Parameters<typeof originalQuery>) {
		queryCount += 1;
		return Reflect.apply(originalQuery, this, args);
	},
});
const readyAt = performance.now();
const configured = await configureDbosDurableBackend();
await configured.launch();
const readyMs = performance.now() - readyAt;
const readyQueries = queryCount;
setDurableBackend(configured.backend);
let activeRunId = "";
let usefulAt = 0;
let usefulQueries = 0;
let entered = Promise.withResolvers<void>();
const childOutput = { text: ["", "raw  text", "raw  text"], nil: null, zero: 0, no: false };
const child = workflow({
	name: "resume-probe-child",
	description: "Owned durable nested checkpoint fixture",
	inputs: {},
	outputs: { text: Type.Array(Type.String()), nil: Type.Null(), zero: Type.Number(), no: Type.Boolean() },
	run: async (ctx) =>
		await ctx.tool("nested-effect", {}, async () => {
			appendFileSync(join(root, `${activeRunId}.effects`), "nested\n");
			return childOutput;
		}),
});
const definition = workflow({
	name: "windows-resume-probe",
	description: "Owned durable side-effect replay fixture",
	inputs: {},
	outputs: { done: Type.Boolean() },
	heartbeatIntervalMinutes: 0,
	run: async (ctx) => {
		for (let index = 0; index < manifest.count; index++) {
			const value = await ctx.tool("effect", { index }, async () => {
				appendFileSync(join(root, `${activeRunId}.effects`), `${index}\n`);
				return { index, text: " raw  text ", empty: "", zero: 0, no: false, nil: null };
			});
			assert.deepEqual(value, { index, text: " raw  text ", empty: "", zero: 0, no: false, nil: null });
		}
		const childResult = await ctx.workflow(child);
		assert.equal(childResult.exited, false);
		assert.deepEqual(childResult.outputs, childOutput);
		await ctx.tool("continue", {}, async ({ signal }) => {
			if (mode === "seed") {
				entered.resolve();
				await new Promise<void>((resolveAbort) => {
					if (signal.aborted) resolveAbort();
					else signal.addEventListener("abort", () => resolveAbort(), { once: true });
				});
				signal.throwIfAborted();
			}
			appendFileSync(join(root, `${activeRunId}.useful`), "continued\n");
			usefulAt = performance.now();
			usefulQueries = queryCount;
			return "continued";
		});
		return { done: true };
	},
});
const runtime = createExtensionRuntime({ definitions: [definition], store, cwd: root });
const results: object[] = [];
const checkpointIds = (runId: string) =>
	configured.backend.listCheckpoints(runId).map((checkpoint) => `${checkpoint.kind}:${checkpoint.checkpointId}`);
try {
	for (const [index, runId] of manifest.runIds.entries()) {
		usefulAt = 0;
		activeRunId = runId;
		store.clear();
		if (mode === "seed") {
			entered = Promise.withResolvers<void>();
			runDetached(definition, {}, { runId, store, cwd: root, durableBackend: configured.backend });
			const job = jobTracker.get(runId);
			assert.ok(job);
			const reachedPause = await Promise.race([entered.promise.then(() => true), job.promise.then(() => false)]);
			assert.ok(reachedPause, store.runs().find((run) => run.id === runId)?.error ?? "seed ended before pause");
			const result = await quitRun(runId, { store });
			assert.ok(result.ok, JSON.stringify(result));
			await job.promise;
			await configured.backend.flush();
			assert.equal(configured.backend.getWorkflow(runId)?.status, "paused");
			assert.equal(store.runs().find((run) => run.id === runId)?.status, "paused");
			manifest.checkpointIds[runId] = checkpointIds(runId);
			results.push({ runId, status: "paused", checkpointCount: manifest.checkpointIds[runId].length });
		} else {
			const info: string[] = [];
			const errors: string[] = [];
			const queryStart = queryCount;
			const begin = performance.now();
			await handleRunControlCommand(
				"resume",
				[runId],
				{ hasUI: false } as never,
				{ info: (message) => info.push(message), error: (message) => errors.push(message) },
				{
					pi: {} as never,
					overlay: {} as never,
					runtimeForContext: () => runtime,
					ensureWorkflowResourcesLoaded: () => {},
				},
			);
			const acknowledgementMs = performance.now() - begin;
			const acknowledgementQueries = queryCount - queryStart;
			assert.deepEqual(errors, []);
			assert.ok(
				info.some((message) => message.includes(`(${runId})`)),
				JSON.stringify(info),
			);
			const job = jobTracker.get(runId);
			assert.ok(job, "resume must dispatch the exact seeded run");
			await job.promise;
			await configured.backend.flush();
			const completedMs = performance.now() - begin;
			const queries = queryCount - queryStart;
			const snapshot = store.runs().find((run) => run.id === runId);
			assert.equal(snapshot?.status, "completed", snapshot?.error);
			assert.equal(configured.backend.getWorkflow(runId)?.status, "completed");
			assert.ok(usefulAt >= begin && usefulAt > 0, "resume must reach the interrupted side effect");
			assert.equal(readFileSync(join(root, `${runId}.useful`), "utf8"), "continued\n");
			const completedIds = checkpointIds(runId);
			const seededIds = manifest.checkpointIds[runId]!;
			assert.ok(
				seededIds.every((id) => completedIds.includes(id)),
				"all seeded checkpoints must survive replay",
			);
			const addedCheckpoints = configured.backend
				.listCheckpoints(runId)
				.filter((checkpoint) => !seededIds.includes(`${checkpoint.kind}:${checkpoint.checkpointId}`));
			for (const checkpoint of addedCheckpoints) {
				assert.ok(
					(checkpoint.kind === "tool" &&
						(checkpoint.name === "continue" ||
							(checkpoint.name === "workflow-run-timing" &&
								checkpoint.checkpointId.startsWith("run-timing:")))) ||
						(checkpoint.kind === "stage" &&
							checkpoint.name === "workflow:resume-probe-child" &&
							checkpoint.checkpointId.startsWith("stage-replay-meta:")),
					`unexpected checkpoint added by replay: ${checkpoint.kind}:${checkpoint.checkpointId}`,
				);
			}
			assert.equal(
				addedCheckpoints.filter((checkpoint) => checkpoint.kind === "tool" && checkpoint.name === "continue")
					.length,
				1,
				"exactly one interrupted tool checkpoint must be completed",
			);
			results.push({
				runId,
				processState: index === 0 ? "cold-resume" : "warm-resume",
				acknowledgementMs,
				usefulWorkMs: usefulAt - begin,
				completedMs,
				seededCheckpointCount: seededIds.length,
				checkpointCount: completedIds.length,
				addedCheckpoints: addedCheckpoints.map(({ kind, checkpointId, name }) => ({ kind, checkpointId, name })),
				message: info,
				acknowledgementQueries,
				usefulWorkQueries: usefulQueries - queryStart,
				queries,
			});
		}
		assert.equal(
			readFileSync(join(root, `${runId}.effects`), "utf8"),
			`${Array.from({ length: manifest.count }, (_, n) => n).join("\n")}\nnested\n`,
			"completed checkpoint side effects must not repeat or reorder",
		);
	}
	if (mode === "seed") writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	const repository = resolve(import.meta.dir, "..");
	const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
	const report = {
		mode,
		measuredAt: new Date().toISOString(),
		platform: process.platform,
		osRelease: release(),
		arch: process.arch,
		runtime: process.version,
		bunVersion: Bun.version,
		postgresVersion,
		pid: process.pid,
		fixture: root,
		databaseIdentity,
		gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
		sourceSha256: Object.fromEntries(
			[
				"scripts/benchmark-workflow-resume.ts",
				"packages/workflows/src/durable/dbos-sdk-handle.ts",
				"package-lock.json",
			].map((path) => [path, sha256(join(repository, path))]),
		),
		manifestSha256: sha256(manifestPath),
		count: manifest.count,
		readyMs,
		readyQueries,
		results,
	};
	writeFileSync(join(root, `${mode}.json`), JSON.stringify(report, null, 2), { flag: "wx" });
	console.log(JSON.stringify(report, null, 2));
} finally {
	await configured.shutdown();
	setDurableBackend(undefined);
	store.clear();
}
