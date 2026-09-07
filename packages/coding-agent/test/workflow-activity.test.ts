import assert from "node:assert/strict";
import { test } from "vitest";
import { WorkflowActivityHub } from "../src/core/extensions/workflow-activity-hub.js";
import type { WorkflowActivityFrame, WorkflowRootActivity } from "../src/core/extensions/workflow-events.js";

const root: WorkflowRootActivity = {
	rootRunId: " root ",
	ownerSessionId: "",
	state: "working",
	reason: "executing",
	activeExecutionCount: 0,
	actionableBlockCount: 0,
	needsAttention: false,
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

// #2891: attaching before the workflow source exists must not imply idle.
test("observer receives unavailable then ready snapshots", async () => {
	const hub = new WorkflowActivityHub();
	const frames: WorkflowActivityFrame[] = [];
	hub.observeWorkflowActivity((frame) => {
		frames.push(frame);
	});
	assert.equal(frames.length, 0);
	await flush();
	assert.equal(frames[0].kind, "snapshot");
	assert.equal("availability" in frames[0] && frames[0].availability, "unavailable");
	const publisher = hub.registerWorkflowActivityPublisher();
	publisher.publishSnapshot({ availability: "ready", roots: [root] });
	await flush();
	assert.deepEqual(frames.at(-1), {
		kind: "snapshot",
		cursor: hub.getSnapshotFrame().cursor,
		availability: "ready",
		roots: [root],
	});
});

// #2891: the asynchronous snapshot boundary serializes concurrent publication.
test("concurrent registration keeps snapshot before every changed frame", async () => {
	const hub = new WorkflowActivityHub();
	const publisher = hub.registerWorkflowActivityPublisher();
	publisher.publishSnapshot({ availability: "ready", roots: [] });
	const frames: WorkflowActivityFrame[] = [];
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	hub.observeWorkflowActivity(async (frame) => {
		frames.push(frame);
		if (frame.kind === "snapshot") {
			publisher.publishChanged({ ...root, activeExecutionCount: 2 });
			await pending;
		}
	});
	publisher.publishChanged(root);
	await flush();
	assert.deepEqual(
		frames.map((frame) => frame.kind),
		["snapshot"],
	);
	release();
	await flush();
	assert.deepEqual(
		frames.map((frame) => frame.kind),
		["snapshot", "changed", "changed"],
	);
	assert.deepEqual(
		frames.map((frame) => frame.cursor.revision),
		[1, 2, 3],
	);
});

// #2891: observer rejections never become publisher failures.
test("rejected observers are diagnosed without affecting another observer", async () => {
	const hub = new WorkflowActivityHub();
	const frames: WorkflowActivityFrame[] = [];
	hub.observeWorkflowActivity(async () => {
		throw new Error("observer failed");
	});
	hub.observeWorkflowActivity((frame) => {
		frames.push(frame);
	});
	const publisher = hub.registerWorkflowActivityPublisher();
	assert.doesNotThrow(() => publisher.publishSnapshot({ availability: "ready", roots: [] }));
	await flush();
	assert.equal(frames.at(-1)?.kind, "snapshot");
	assert.ok(hub.diagnostics().some((item) => item.kind === "ObserverDeliveryFailed"));
	publisher.publishChanged(root);
	await flush();
	assert.equal(frames.at(-1)?.kind, "changed");
});

// #2891: overflow invalidates continuity instead of silently dropping updates.
test("overflow clears pending frames and redelivers a current snapshot", async () => {
	const hub = new WorkflowActivityHub();
	const publisher = hub.registerWorkflowActivityPublisher();
	publisher.publishSnapshot({ availability: "ready", roots: [] });
	const frames: WorkflowActivityFrame[] = [];
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	hub.observeWorkflowActivity(async (frame) => {
		frames.push(frame);
		await pending;
	});
	await flush();
	for (let i = 0; i < 257; i++) publisher.publishChanged({ ...root, activeExecutionCount: i });
	assert.ok(hub.diagnostics().some((item) => item.kind === "ObserverOverflow"));
	release();
	await flush();
	assert.equal(frames.length, 2);
	assert.deepEqual(frames[1], hub.getSnapshotFrame());
});

// #2891: disposal fences queued and in-flight continuations.
test("observer disposal is idempotent and fences late frames", async () => {
	const hub = new WorkflowActivityHub();
	const publisher = hub.registerWorkflowActivityPublisher();
	const frames: WorkflowActivityFrame[] = [];
	const lease = hub.observeWorkflowActivity((frame) => {
		frames.push(frame);
	});
	lease.dispose();
	lease.dispose();
	publisher.publishChanged(root);
	await flush();
	assert.equal(frames.length, 0);
	assert.equal(hub.diagnostics().filter((item) => item.kind === "ObserverDisposed").length, 1);
});

// #2891: a replaced publisher cannot affect its successor.
test("publisher replacement starts an unavailable epoch and fences old methods", async () => {
	const hub = new WorkflowActivityHub();
	const old = hub.registerWorkflowActivityPublisher();
	old.publishSnapshot({ availability: "ready", roots: [root] });
	const previous = hub.getSnapshotFrame();
	const publisher = hub.registerWorkflowActivityPublisher();
	assert.notEqual(previous.cursor.epoch, hub.getSnapshotFrame().cursor.epoch);
	assert.equal(hub.getSnapshotFrame().availability, "unavailable");
	assert.equal(hub.getSnapshotFrame().cursor.revision, 0);
	publisher.publishSnapshot({ availability: "recovering" });
	old.publishChanged(root);
	old.publishSnapshot({ availability: "ready", roots: [root] });
	old.dispose();
	assert.equal(hub.getSnapshotFrame().availability, "recovering");
	assert.ok(hub.diagnostics().some((item) => item.kind === "PublisherFenced"));
	assert.ok(hub.diagnostics().some((item) => item.kind === "SourceRecovering"));
	publisher.dispose();
	publisher.dispose();
	assert.equal(hub.getSnapshotFrame().availability, "unavailable");
	const frame = hub.getSnapshotFrame();
	publisher.publishChanged(root);
	assert.deepEqual(hub.getSnapshotFrame(), frame);
	assert.ok(hub.diagnostics().some((item) => item.kind === "SourceUnavailable"));
});

// #2891: roots are keyed full replacements, with raw IDs and stable insertion order.
test("snapshots preserve raw fields and key duplicate roots, changes replace and removals delete", async () => {
	const hub = new WorkflowActivityHub();
	const publisher = hub.registerWorkflowActivityPublisher();
	const other = { ...root, rootRunId: "other" };
	const replacement = { ...root, state: "blocked" as const, reason: "awaiting_input" as const };
	publisher.publishSnapshot({ availability: "ready", roots: [root, other, replacement] });
	let frame = hub.getSnapshotFrame();
	assert.ok(frame.availability === "ready");
	assert.deepEqual(frame.roots, [replacement, other]);
	assert.ok(Array.isArray(frame.roots));
	frame.roots[0].rootRunId = "tampered";
	assert.notDeepEqual(hub.getSnapshotFrame(), frame);
	const frames: WorkflowActivityFrame[] = [];
	hub.observeWorkflowActivity((item) => {
		frames.push(item);
	});
	publisher.publishRemoved(root.rootRunId);
	publisher.publishRemoved("absent");
	await flush();
	assert.deepEqual(
		frames.map((item) => item.kind),
		["snapshot", "removed", "removed"],
	);
	frame = hub.getSnapshotFrame();
	assert.ok(frame.availability === "ready");
	assert.deepEqual(frame.roots, [other]);
	publisher.publishSnapshot({ availability: "ready", roots: [] });
	assert.deepEqual(hub.getSnapshotFrame(), {
		kind: "snapshot",
		cursor: hub.getSnapshotFrame().cursor,
		availability: "ready",
		roots: [],
	});
	publisher.publishSnapshot({ availability: "recovering" });
	publisher.publishChanged(root);
	assert.equal(hub.getSnapshotFrame().availability, "recovering");
	assert.equal("roots" in hub.getSnapshotFrame(), false);
	publisher.dispose();
	for (let i = 0; i < 1000; i++) publisher.publishRemoved("");
	assert.equal(hub.diagnostics().length, 256);
});
