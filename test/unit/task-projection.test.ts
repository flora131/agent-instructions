import assert from "node:assert/strict";
import { test } from "vitest";
import type { Generation } from "../../packages/coding-agent/src/core/tasks/contracts.js";
import { TASK_ACTIVITY_BYTES, TASK_ACTIVITY_LIMIT } from "../../packages/coding-agent/src/core/tasks/owner-store.js";
import { taskFixture, taskValue } from "../helpers/task-projection.js";

// RFC #2884: a task anchor belongs to the owner, not the launching tool/turn.
test("owner projection keeps one anchor across activity, disposal, overflow and terminal reattachment", async () => {
	const fixture = taskFixture();
	try {
		await fixture.start("\n raw task \n", "");
		const [task] = fixture.store.tasks;
		const anchor = fixture.store.anchors.get(task.ref.taskId);
		const context = fixture.runners[0].context;
		const report = { reportId: "action", change: { kind: "action" as const, tool: "bash", text: " raw command " } };
		taskValue(context.reportActivity(report));
		fixture.store.drain();
		const cursor = fixture.store.cursor;
		assert.equal(taskValue(context.reportActivity(report)).disposition, "duplicate");
		fixture.store.drain();
		assert.deepEqual(fixture.store.cursor, cursor);
		assert.equal(fixture.store.tasks[0].currentAction?.text, " raw command ");
		fixture.store.dispose();
		for (let index = 0; index < 350; index++)
			taskValue(
				context.reportActivity({
					reportId: `overflow-${index}`,
					change: { kind: "action", tool: "read", text: `line ${index} ${"x".repeat(8192)}` },
				}),
			);
		taskValue(fixture.store.connect());
		fixture.store.drain();
		assert.equal(fixture.store.tasks.length, 1);
		assert.equal(fixture.store.anchors.get(task.ref.taskId), anchor);
		assert.match(fixture.store.tasks[0].currentAction?.text ?? "", /^line 349 /);
		await fixture.settle();
		assert.equal(fixture.store.tasks[0].execution.kind, "settled");
		assert.equal(
			context.reportActivity({ reportId: "late", change: { kind: "action", tool: "bash", text: "late" } }).ok,
			false,
		);
		fixture.store.dispose();
		taskValue(fixture.store.connect());
		assert.equal(fixture.store.tasks[0].execution.kind, "settled");
		assert.equal(fixture.store.anchors.size, 1);
	} finally {
		await fixture.dispose();
	}
});

// RFC #2884 D1: an SDK wait must not claim or release the host designation.
test("projection uses designated observation and preserves known zero metrics", async () => {
	const fixture = taskFixture();
	try {
		const lease = await fixture.start();
		const foreground = fixture.supervisor.waitForTask(lease, 10000, fixture.host);
		fixture.store.drain();
		assert.equal(fixture.store.tasks[0].observation.kind, "foreground");
		const sdk = await fixture.supervisor.waitForTask(lease, 0);
		taskValue(sdk);
		taskValue(
			fixture.runners[0].context.reportActivity({ reportId: "zero", change: { kind: "metrics", toolCount: 0 } }),
		);
		fixture.store.drain();
		assert.equal(fixture.store.tasks[0].observation.kind, "foreground");
		fixture.store.dispose();
		taskValue(fixture.store.connect());
		assert.equal(fixture.store.tasks[0].observation.kind, "foreground");
		assert.deepEqual(fixture.store.tasks[0].metrics, { toolCount: 0 });
		await fixture.settle();
		taskValue(await foreground);
		fixture.store.drain();
		assert.equal(fixture.store.tasks[0].observation.kind, "none");
	} finally {
		await fixture.dispose();
	}
});

// RFC #2884: cursor capability scope is refused, and preview retention stays bounded.
test("stale generation cannot reconnect and retained activity has explicit bounds", async () => {
	const fixture = taskFixture();
	try {
		await fixture.start();
		const cursor = fixture.store.cursor;
		assert.ok(cursor);
		const generation = cursor.generation;
		cursor.generation = "stale-generation" as Generation;
		const rejected = fixture.store.connect();
		assert.equal(rejected.ok, false);
		if (!rejected.ok) assert.equal(rejected.error.code, "StaleGeneration");
		cursor.generation = generation;
		taskValue(fixture.store.connect());
		for (let index = 0; index < 80; index++) {
			taskValue(
				fixture.runners[0].context.reportActivity({
					reportId: `bounded-${index}`,
					change: { kind: "action", tool: "read", text: `retained ${index}` },
				}),
			);
			fixture.store.drain();
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
		const task = fixture.store.tasks[0];
		const retained = fixture.store.recentActivity(task.ref.taskId);
		assert.ok(retained.length > 0 && retained.length <= TASK_ACTIVITY_LIMIT);
		assert.ok(Buffer.byteLength(JSON.stringify(retained)) <= TASK_ACTIVITY_BYTES);
		assert.equal(fixture.store.activityOmitted(task.ref.taskId), true);
		assert.equal(retained.at(-1)?.report.reportId, "bounded-79");
	} finally {
		await fixture.dispose();
	}
});
