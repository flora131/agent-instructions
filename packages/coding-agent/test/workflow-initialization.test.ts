import assert from "node:assert/strict";
import { test } from "vitest";
import { createEventBus } from "../src/core/event-bus.js";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import type { WorkflowActivityPublisher, WorkflowEvent } from "../src/core/extensions/workflow-events.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function publish(publisher: WorkflowActivityPublisher, runId: string): void {
	publisher.publishChanged({
		rootRunId: runId,
		ownerSessionId: "",
		state: "idle",
		reason: "quiescent",
		activeExecutionCount: 0,
		actionableBlockCount: 0,
		needsAttention: false,
	});
	publisher.publishLifecycle({
		type: "workflow_lifecycle",
		eventId: runId,
		runId,
		rootRunId: runId,
		ownerSessionId: "",
		occurredAt: 0,
		observedAt: 0,
		delivery: "live",
		target: { kind: "stage", runId, stageId: "nested/stage", stageName: " raw name ", status: "completed" },
	});
	const heartbeat = {
		type: "workflow_heartbeat" as const,
		runId,
		rootRunId: runId,
		ownerSessionId: "",
		scheduledAt: 0,
		intervalMinutes: 0,
	};
	publisher.publishHeartbeat(heartbeat);
	heartbeat.runId = "mutated after publication";
}

// #2891: factories publish before an ExtensionRunner binds the dispatcher.
test("factory publications reach all four hooks before later live publications", async () => {
	const runtime = createExtensionRuntime();
	const bus = createEventBus();
	let publisher!: WorkflowActivityPublisher;
	const source = await loadExtensionFromFactory(
		async (pi) => {
			publisher = pi.registerWorkflowActivityPublisher();
			publish(publisher, " before binding ");
			await flush();
		},
		process.cwd(),
		bus,
		runtime,
		"<source>",
	);
	const events: WorkflowEvent[] = [];
	const observer = await loadExtensionFromFactory(
		(pi) => {
			const receive = (event: WorkflowEvent) => {
				events.push(event);
			};
			pi.on("workflow_activity_changed", receive);
			pi.on("workflow_lifecycle", receive);
			pi.on("workflow_stage_completed", receive);
			pi.on("workflow_heartbeat", receive);
		},
		process.cwd(),
		bus,
		runtime,
		"<observer>",
	);
	assert.deepEqual(events, []);
	const runner = new ExtensionRunner([source, observer], runtime, process.cwd(), {} as never, {} as never);
	try {
		assert.deepEqual(events, []);
		publish(publisher, "after binding");
		await flush();
		assert.deepEqual(
			events.map((event) => [
				event.type,
				event.type === "workflow_activity_changed" ? event.root.rootRunId : event.runId,
			]),
			[" before binding ", "after binding"].flatMap((runId) =>
				["workflow_activity_changed", "workflow_lifecycle", "workflow_stage_completed", "workflow_heartbeat"].map(
					(type) => [type, runId],
				),
			),
		);
		const lifecycle = events[1];
		const completed = events[2];
		assert.ok(lifecycle.type === "workflow_lifecycle" && completed.type === "workflow_stage_completed");
		assert.deepEqual(completed, { ...lifecycle, type: "workflow_stage_completed" });
		assert.equal(completed.target.stageName, " raw name ");
		assert.equal("attribution" in completed, false);
		assert.deepEqual(events[3], {
			type: "workflow_heartbeat",
			runId: " before binding ",
			rootRunId: " before binding ",
			ownerSessionId: "",
			scheduledAt: 0,
			intervalMinutes: 0,
		});
	} finally {
		runner.invalidate();
	}
});

// #2891: retaining initialization events must not revive retired sources or runners.
for (const retirement of ["publisher disposal", "publisher replacement", "runtime invalidation"] as const) {
	test(`buffered factory publications are fenced after ${retirement}`, async () => {
		const runtime = createExtensionRuntime();
		const events: WorkflowEvent[] = [];
		const extension = await loadExtensionFromFactory(
			async (pi) => {
				const receive = (event: WorkflowEvent) => {
					events.push(event);
				};
				pi.on("workflow_activity_changed", receive);
				pi.on("workflow_lifecycle", receive);
				pi.on("workflow_stage_completed", receive);
				pi.on("workflow_heartbeat", receive);
				const publisher = pi.registerWorkflowActivityPublisher();
				publish(publisher, "retired");
				await flush();
				if (retirement === "publisher disposal") publisher.dispose();
				if (retirement === "publisher replacement") {
					publish(pi.registerWorkflowActivityPublisher(), "successor");
					await flush();
				}
			},
			process.cwd(),
			createEventBus(),
			runtime,
			"<retired-source>",
		);
		if (retirement === "runtime invalidation") runtime.invalidate();
		const runner = new ExtensionRunner([extension], runtime, process.cwd(), {} as never, {} as never);
		try {
			await flush();
			assert.deepEqual(
				events.map((event) => [
					event.type,
					event.type === "workflow_activity_changed" ? event.root.rootRunId : event.runId,
				]),
				retirement !== "publisher replacement"
					? []
					: [
							"workflow_activity_changed",
							"workflow_lifecycle",
							"workflow_stage_completed",
							"workflow_heartbeat",
						].map((type) => [type, "successor"]),
			);
		} finally {
			runner.invalidate();
		}
	});
}
