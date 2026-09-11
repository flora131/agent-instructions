import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { InMemoryDurableBackend } from "../../packages/workflows/src/durable/backend.js";
import { setDurableBackend } from "../../packages/workflows/src/durable/factory.js";
import { createToolAdmissionBoundary } from "../../packages/workflows/src/engine/run-tool-admission-boundary.js";
import { createToolControlRegistry } from "../../packages/workflows/src/engine/run-tool-control-registry.js";
import { quitRun } from "../../packages/workflows/src/runs/background/quit.js";
import { resumeRun } from "../../packages/workflows/src/runs/background/status.js";
import { createStageControlRegistry } from "../../packages/workflows/src/runs/foreground/stage-control-registry.js";
import { createStore } from "../../packages/workflows/src/shared/store.js";

const runId = "903719d0-65fd-487a-89dc-de184902cf06";
afterEach(() => setDurableBackend(undefined));

function setup(options: { pause?: () => Promise<void>; resume?: () => Promise<void> } = {}) {
	setDurableBackend(new InMemoryDurableBackend());
	const store = createStore();
	store.recordRunStart({ id: runId, name: "quit-resume", inputs: {}, status: "running", stages: [], startedAt: 1 });
	store.recordStageStart(runId, { id: "stage", name: "stage", status: "running", parentIds: [], toolEvents: [] });
	const stageControlRegistry = createStageControlRegistry();
	const toolControlRegistry = createToolControlRegistry();
	const boundary = createToolAdmissionBoundary();
	toolControlRegistry.registerAdmissionBoundary(runId, boundary);
	let status: "running" | "paused" = "running";
	let resumes = 0;
	stageControlRegistry.register({
		runId,
		stageId: "stage",
		stageName: "stage",
		get status() {
			return status;
		},
		sessionId: undefined,
		sessionFile: undefined,
		isStreaming: false,
		messages: [],
		async ensureAttached() {},
		async prompt() {},
		async steer() {},
		async followUp() {},
		async pause() {
			status = "paused";
			store.recordStagePaused(runId, "stage");
			await options.pause?.();
		},
		async resume(_message, beforeResume) {
			await options.resume?.();
			beforeResume?.();
			status = "running";
			resumes += 1;
		},
		subscribe: () => () => {},
	});
	return { store, stageControlRegistry, toolControlRegistry, boundary, resumes: () => resumes };
}

async function tick() {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

// Regression for #2700: paused stage publication is not a completed quit.
test("concurrent resume cannot discard quit's registration drain; retry resumes after quit settles", async () => {
	const state = setup();
	const admitted = state.boundary.admit();
	assert.ok(admitted.accepted);
	let settled = false;
	const quitting = quitRun(runId, state).then((result) => {
		settled = true;
		return result;
	});
	await tick();
	assert.equal(state.boundary.closed, true);
	const snapshot = structuredClone(state.store.runs()[0]);
	const resumed = await resumeRun(runId, state);
	assert.ok(resumed.ok);
	assert.equal(resumed.mode, "snapshot");
	assert.match(resumed.message ?? "", /quit is still in progress.*Retry resume after/);
	assert.deepEqual(resumed.snapshot, snapshot);
	assert.deepEqual(resumed.resumed, []);
	assert.equal(state.resumes(), 0);
	assert.equal(state.boundary.closed, true);
	assert.equal(state.boundary.admit().accepted, false);
	admitted.lease.release();
	admitted.lease.release();
	await tick();
	assert.equal(settled, true);
	assert.equal((await quitting).ok, true);
	assert.equal(state.store.runs()[0]?.status, "paused");
	assert.ok((await resumeRun(runId, state)).ok);
	assert.equal(state.resumes(), 1);
	assert.equal(state.store.runs()[0]?.status, "running");
	const next = state.boundary.admit();
	assert.ok(next.accepted);
	next.lease.release();
	assert.equal((await quitRun(runId, state)).ok, true);
});

test("resume during a stage pause acknowledgement reports the unchanged snapshot", async () => {
	const paused = Promise.withResolvers<void>();
	const state = setup({ pause: () => paused.promise });
	const quitting = quitRun(runId, state);
	const snapshot = structuredClone(state.store.runs()[0]);
	const resumed = await resumeRun(runId, state);
	assert.ok(resumed.ok);
	assert.deepEqual(resumed.snapshot, snapshot);
	assert.deepEqual(resumed.resumed, []);
	assert.match(resumed.message ?? "", /quit is still in progress/);
	assert.equal(state.resumes(), 0);
	paused.resolve();
	assert.equal((await quitting).ok, true);
	await resumeRun(runId, state);
	assert.equal(state.resumes(), 1);
});

test("resume after the registration drain still waits for quit's durable publication", async () => {
	const flushing = Promise.withResolvers<void>();
	const flushed = Promise.withResolvers<void>();
	class PendingFlushBackend extends InMemoryDurableBackend {
		async flush(): Promise<void> {
			flushing.resolve();
			await flushed.promise;
		}
	}
	const state = setup();
	const backend = new PendingFlushBackend();
	backend.registerWorkflow({ workflowId: runId, name: "quit-resume", inputs: {}, createdAt: 1, status: "running" });
	setDurableBackend(backend);
	const quitting = quitRun(runId, state);
	await flushing.promise;
	assert.equal(state.boundary.hasPendingAdmissions, false);
	const resumed = await resumeRun(runId, state);
	assert.ok(resumed.ok);
	assert.match(resumed.message ?? "", /quit is still in progress/);
	assert.equal(state.boundary.closed, true);
	assert.equal(state.resumes(), 0);
	flushed.resolve();
	assert.equal((await quitting).ok, true);
	await resumeRun(runId, state);
	assert.equal(state.resumes(), 1);
	assert.equal(backend.getWorkflow(runId)?.status, "running");
});

test("a quit started during an asynchronous resume acknowledgement keeps admissions closed", async () => {
	const acknowledged = Promise.withResolvers<void>();
	const state = setup({ resume: () => acknowledged.promise });
	await state.stageControlRegistry.get(runId, "stage")!.pause();
	state.store.recordRunPaused(runId);
	const admitted = state.boundary.admit();
	assert.ok(admitted.accepted);
	const resuming = resumeRun(runId, state);
	const rejected = assert.rejects(resuming, /quit is still in progress/);
	const quitting = quitRun(runId, state);
	await tick();
	acknowledged.resolve();
	await rejected;
	assert.equal(state.boundary.closed, true);
	assert.equal(state.resumes(), 0);
	admitted.lease.release();
	assert.equal((await quitting).ok, true);
	await resumeRun(runId, state);
	assert.equal(state.resumes(), 1);
});

test("failed quit releases the resume guard and does not guard the same id in another store", async () => {
	const paused = Promise.withResolvers<void>();
	const state = setup({ pause: () => paused.promise });
	const other = setup();
	await other.stageControlRegistry.get(runId, "stage")!.pause();
	const quitting = quitRun(runId, state);
	const rejected = assert.rejects(quitting, /pause failed/);
	await resumeRun(runId, other);
	assert.equal(other.resumes(), 1);
	paused.reject(new Error("pause failed"));
	await rejected;
	await resumeRun(runId, state);
	assert.equal(state.resumes(), 1);
});

test("nested stage resume cannot reopen its root's shared boundary during overlapping quits", async () => {
	const paused = Promise.withResolvers<void>();
	const state = setup({ pause: () => paused.promise });
	const childId = "4f911fa1-0049-428a-9d7f-65e8c8653b96";
	state.store.recordStageStart(runId, {
		id: "child-boundary",
		name: "child",
		status: "running",
		parentIds: [],
		toolEvents: [],
		workflowChildRun: { alias: "child", workflow: "child", runId: childId },
	});
	state.store.recordRunStart({
		id: childId,
		name: "child",
		inputs: {},
		status: "paused",
		stages: [],
		startedAt: 1,
		parentRunId: runId,
		parentStageId: "child-boundary",
		rootRunId: runId,
	});
	state.toolControlRegistry.registerAdmissionBoundary(childId, state.boundary);
	const first = quitRun(runId, state);
	const second = quitRun(runId, state);
	assert.equal((await second).ok, true);
	const resumed = await resumeRun(childId, state);
	assert.ok(resumed.ok);
	assert.equal(resumed.mode, "snapshot");
	assert.match(resumed.message ?? "", /quit is still in progress/);
	assert.equal(state.boundary.closed, true);
	paused.resolve();
	assert.equal((await first).ok, true);
	await resumeRun(childId, state);
	assert.equal(state.boundary.closed, false);
});

// A fast acknowledgement must not overwrite a newer quit while a sibling resumes.
for (const quitSettlesFirst of [false, true]) {
	test(`quit supersedes earlier stage acknowledgements (quit settles first: ${quitSettlesFirst})`, async () => {
		const slow = Promise.withResolvers<void>();
		const fast = Promise.withResolvers<void>();
		const state = setup({
			resume: async () => {
				fast.resolve();
			},
		});
		await state.stageControlRegistry.get(runId, "stage")!.pause();
		state.store.recordStageStart(runId, {
			id: "slow",
			name: "slow",
			status: "running",
			parentIds: [],
			toolEvents: [],
		});
		state.store.recordStagePaused(runId, "slow");
		state.store.recordRunPaused(runId);
		let slowStatus: "paused" | "running" = "paused";
		state.stageControlRegistry.register({
			runId,
			stageId: "slow",
			stageName: "slow",
			get status() {
				return slowStatus;
			},
			sessionId: undefined,
			sessionFile: undefined,
			isStreaming: false,
			messages: [],
			async ensureAttached() {},
			async prompt() {},
			async steer() {},
			async followUp() {},
			async pause() {
				slowStatus = "paused";
				state.store.recordStagePaused(runId, "slow");
			},
			async resume(_message, beforeResume) {
				await slow.promise;
				beforeResume?.();
				slowStatus = "running";
			},
			subscribe: () => () => {},
		});
		const admitted = state.boundary.admit();
		assert.ok(admitted.accepted);
		const resuming = resumeRun(runId, state);
		const rejected = assert.rejects(resuming, /quit.*Retry resume/);
		await fast.promise;
		await tick();
		assert.equal(state.resumes(), 1);
		const quitting = quitRun(runId, state);
		await tick();
		assert.equal(state.boundary.closed, true);
		if (quitSettlesFirst) {
			admitted.lease.release();
			await quitting;
		}
		slow.resolve();
		await rejected;
		admitted.lease.release();
		assert.equal((await quitting).ok, true);
		assert.ok(state.store.runs()[0]!.stages.every((stage) => stage.status === "paused"));
		assert.ok(
			state.stageControlRegistry
				.run(runId)
				.stages()
				.every((stage) => stage.status === "paused"),
		);
		assert.equal(state.boundary.closed, true);
		await resumeRun(runId, state);
		assert.equal(state.resumes(), 2);
		assert.equal(slowStatus, "running");
		assert.ok(state.store.runs()[0]!.stages.every((stage) => stage.status === "running"));
	});
}

for (const status of ["completed", "failed", "killed"] as const) {
	test(`an unsuccessful ${status} quit cannot invalidate a read-only resume snapshot`, async () => {
		const state = setup();
		state.store.recordRunEnd(runId, status);
		const snapshot = structuredClone(state.store.runs()[0]);
		const resuming = resumeRun(runId, state);
		assert.deepEqual(await quitRun(runId, state), { ok: false, runId, reason: "already_ended" });
		const resumed = await resuming;
		assert.ok(resumed.ok);
		assert.equal(resumed.mode, status === "killed" ? "not_resumable" : "snapshot");
		assert.deepEqual(resumed.snapshot, snapshot);
		assert.deepEqual(resumed.resumed, []);
	});
}

for (const missingPausedTarget of [false, true]) {
	test(`a snapshot without a resume target stays readable during quit (missing paused target: ${missingPausedTarget})`, async () => {
		const state = setup();
		if (missingPausedTarget) {
			await state.stageControlRegistry.get(runId, "stage")!.pause();
			state.store.recordRunPaused(runId);
		}
		const resuming = resumeRun(runId, { ...state, ...(missingPausedTarget ? { stageId: "missing" } : {}) });
		assert.equal((await quitRun(runId, state)).ok, true);
		const resumed = await resuming;
		assert.ok(resumed.ok);
		assert.equal(resumed.mode, "snapshot");
		assert.deepEqual(resumed.resumed, []);
		assert.equal(state.resumes(), 0);
		assert.equal(state.store.runs()[0]?.status, "paused");
	});
}

test("a node-less snapshot stays readable when concurrent quit has no active stages", async () => {
	setDurableBackend(new InMemoryDurableBackend());
	const store = createStore();
	store.recordRunStart({ id: runId, name: "empty", inputs: {}, status: "running", stages: [], startedAt: 1 });
	const opts = {
		store,
		stageControlRegistry: createStageControlRegistry(),
		toolControlRegistry: createToolControlRegistry(),
	};
	const resuming = resumeRun(runId, opts);
	assert.deepEqual(await quitRun(runId, opts), { ok: false, runId, reason: "no_active_stages" });
	const resumed = await resuming;
	assert.ok(resumed.ok);
	assert.equal(resumed.mode, "snapshot");
	assert.deepEqual(resumed.resumed, []);
	assert.equal(resumed.snapshot.status, "running");
});
