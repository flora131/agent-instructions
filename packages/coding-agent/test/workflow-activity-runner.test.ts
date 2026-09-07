import assert from "node:assert/strict";
import { test } from "vitest";
import { createEventBus } from "../src/core/event-bus.js";
import type { ExtensionAPI } from "../src/core/extensions/index.js";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import type {
	WorkflowActivityFrame,
	WorkflowEvent,
	WorkflowStageStatus,
} from "../src/core/extensions/workflow-events.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function setup() {
	const runtime = createExtensionRuntime();
	const events: WorkflowEvent[] = [];
	let api!: ExtensionAPI;
	const extension = await loadExtensionFromFactory(
		(pi) => {
			api = pi;
			pi.on("workflow_lifecycle", (event) => {
				events.push(event);
			});
			pi.on("workflow_activity_changed", (event) => {
				events.push(event);
			});
			pi.on("workflow_stage_completed", (event) => {
				events.push(event);
			});
			pi.on("workflow_heartbeat", (event) => {
				events.push(event);
			});
		},
		process.cwd(),
		createEventBus(),
		runtime,
		"<workflow-observer>",
	);
	const runner = new ExtensionRunner([extension], runtime, process.cwd(), {} as never, {} as never);
	return { runner, api, events, runtime };
}

// #2891: only completed stage outcomes produce the convenience hook.
test("real runner dispatches all four workflow hooks and only completed stages", async () => {
	const { runner, api, events } = await setup();
	const frames: WorkflowActivityFrame[] = [];
	runner.createContext().observeWorkflowActivity((frame) => {
		frames.push(frame);
	});
	const publisher = api.registerWorkflowActivityPublisher();
	publisher.publishSnapshot({ availability: "ready", roots: [] });
	publisher.publishChanged({
		rootRunId: "root",
		ownerSessionId: "owner",
		state: "idle",
		reason: "quiescent",
		activeExecutionCount: 0,
		actionableBlockCount: 0,
		needsAttention: false,
	});
	const statuses: WorkflowStageStatus[] = [
		"pending",
		"running",
		"awaiting_input",
		"paused",
		"blocked",
		"failed",
		"skipped",
		"completed",
	];
	for (const status of statuses)
		publisher.publishLifecycle({
			type: "workflow_lifecycle",
			eventId: status,
			runId: "nested",
			rootRunId: "root",
			ownerSessionId: "owner",
			occurredAt: 0,
			observedAt: 1,
			delivery: "live",
			target: { kind: "stage", runId: "nested", stageId: "parent/child", stageName: " raw name ", status },
		});
	for (const status of ["cancelled", "killed", "completed"] as const)
		publisher.publishLifecycle({
			type: "workflow_lifecycle",
			eventId: `run-${status}`,
			runId: "nested",
			rootRunId: "root",
			ownerSessionId: "owner",
			occurredAt: 0,
			observedAt: 1,
			delivery: "replay",
			target: { kind: "run", runId: "nested", status },
		});
	publisher.publishHeartbeat({
		type: "workflow_heartbeat",
		runId: "nested",
		rootRunId: "root",
		ownerSessionId: "owner",
		scheduledAt: 0,
		intervalMinutes: 0,
	});
	await flush();
	assert.deepEqual([...new Set(events.map((event) => event.type))].sort(), [
		"workflow_activity_changed",
		"workflow_heartbeat",
		"workflow_lifecycle",
		"workflow_stage_completed",
	]);
	const completed = events.filter((event) => event.type === "workflow_stage_completed");
	assert.equal(completed.length, 1);
	assert.equal(completed[0].eventId, "completed");
	assert.equal(completed[0].target.stageId, "parent/child");
	assert.equal(completed[0].target.stageName, " raw name ");
	assert.equal("attribution" in completed[0], false);
	const changed = events.find((event) => event.type === "workflow_activity_changed")!;
	assert.deepEqual(changed.cursor, frames.find((frame) => frame.kind === "changed")?.cursor);
	runner.invalidate();
});

// #2891: reload retirement fences observer queues and producer callbacks.
test("runner invalidation disposes leases and fences old publisher callbacks", async () => {
	const { runner, api, events } = await setup();
	const publisher = api.registerWorkflowActivityPublisher();
	const frames: WorkflowActivityFrame[] = [];
	runner.createContext().observeWorkflowActivity((frame) => {
		frames.push(frame);
	});
	runner.invalidate();
	runner.invalidate();
	publisher.publishHeartbeat({
		type: "workflow_heartbeat",
		runId: "",
		rootRunId: "",
		ownerSessionId: "",
		scheduledAt: 0,
		intervalMinutes: 0,
	});
	publisher.publishSnapshot({ availability: "ready", roots: [] });
	await flush();
	assert.deepEqual(frames, []);
	assert.deepEqual(events, []);
	const next = await setup();
	const nextFrames: WorkflowActivityFrame[] = [];
	next.runner.createContext().observeWorkflowActivity((frame) => {
		nextFrames.push(frame);
	});
	await flush();
	assert.equal(nextFrames[0].kind === "snapshot" && nextFrames[0].availability, "unavailable");
	next.runner.invalidate();
});

// #2891: retiring a publisher fences every method, including queued hook delivery.
test("publisher disposal twice fences all late publication methods and queued hooks", async () => {
	const { runner, api, events, runtime } = await setup();
	const publisher = api.registerWorkflowActivityPublisher();
	const heartbeat = {
		type: "workflow_heartbeat" as const,
		runId: "",
		rootRunId: "",
		ownerSessionId: "",
		scheduledAt: 0,
		intervalMinutes: 0,
	};
	publisher.publishHeartbeat(heartbeat);
	publisher.dispose();
	const before = runtime.workflowActivityHub.getSnapshotFrame();
	publisher.dispose();
	assert.deepEqual(runtime.workflowActivityHub.getSnapshotFrame(), before);
	publisher.publishSnapshot({ availability: "ready", roots: [] });
	publisher.publishChanged({
		rootRunId: "",
		ownerSessionId: "",
		state: "idle",
		reason: "paused",
		activeExecutionCount: 0,
		actionableBlockCount: 0,
		needsAttention: false,
	});
	publisher.publishRemoved("");
	publisher.publishLifecycle({
		type: "workflow_lifecycle",
		eventId: "",
		runId: "",
		rootRunId: "",
		ownerSessionId: "",
		occurredAt: 0,
		observedAt: 0,
		delivery: "replay",
		target: { kind: "prompt", runId: "", promptId: "", status: "opened" },
	});
	publisher.publishHeartbeat(heartbeat);
	await flush();
	assert.deepEqual(events, []);
	assert.deepEqual(runtime.workflowActivityHub.getSnapshotFrame(), before);
	assert.equal(runtime.workflowActivityHub.diagnostics().filter((item) => item.kind === "PublisherFenced").length, 5);
	runner.invalidate();
});

// #2891: an in-flight observer cannot resume delivery into a retired generation.
test("runner retirement fences an observer continuation and a successor starts separately", async () => {
	const { runner, api, runtime } = await setup();
	const publisher = api.registerWorkflowActivityPublisher();
	publisher.publishSnapshot({ availability: "recovering" });
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const frames: WorkflowActivityFrame[] = [];
	runner.createContext().observeWorkflowActivity(async (frame) => {
		frames.push(frame);
		await pending;
	});
	await flush();
	publisher.publishSnapshot({ availability: "ready", roots: [] });
	const epoch = runtime.workflowActivityHub.getSnapshotFrame().cursor.epoch;
	runner.invalidate();
	release();
	await flush();
	assert.equal(frames.length, 1);
	assert.equal(frames[0].kind === "snapshot" && frames[0].availability, "recovering");
	const next = await setup();
	assert.notEqual(next.runtime.workflowActivityHub.getSnapshotFrame().cursor.epoch, epoch);
	next.runner.invalidate();
});
