import assert from "node:assert/strict";
import { test } from "vitest";
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
		assert.deepEqual(fixture.store.tasks[0].metrics, { toolCount: 0 });
		await fixture.settle();
		taskValue(await foreground);
		fixture.store.drain();
		assert.equal(fixture.store.tasks[0].observation.kind, "none");
	} finally {
		await fixture.dispose();
	}
});
