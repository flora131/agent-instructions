import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { WorkflowStageAdmissionBoundary } from "../../packages/coding-agent/src/core/workflow-stage-admission.js";
import { retryStableDelivery } from "../../packages/intercom/stable-delivery-retry.js";
import { admitWorkflowStageInbound } from "../../packages/intercom/workflow-stage-admission.js";
import { sleep } from "../helpers/runtime.js";

const stageContext = {
	isIdle: () => true,
	orchestrationContext: {
		kind: "workflow-stage" as const,
		workflowRunId: "run-1",
		workflowStageId: "stage-1",
		workflowStageName: "schema-review",
		constraints: { disableWorkflowTool: true as const },
	},
};

describe("Intercom workflow-stage admission", () => {
	test("a message received during a schema-backed structured_output tool turn is surfaced synchronously", async () => {
		const events: string[] = ["structured_output:start"];
		const admitted = admitWorkflowStageInbound(stageContext, () => {
			events.push("agent-session:queue-follow-up");
		});
		events.push("structured_output:end");

		assert.ok(admitted);
		await admitted;
		assert.deepEqual(events, ["structured_output:start", "agent-session:queue-follow-up", "structured_output:end"]);
	});

	test("a busy workflow stage admits before waiting for exact foreground-owner first refusal", async () => {
		const events: string[] = [];
		const firstRefusal = Promise.withResolvers<void>();
		const admitted = admitWorkflowStageInbound(
			{ ...stageContext, isIdle: () => false },
			async (admissionBarrier) => {
				events.push("agent-session:generation-admission");
				await admissionBarrier?.();
				events.push("agent-session:queue-delivery");
			},
			async () => {
				events.push("foreground-owner:probe");
				await firstRefusal.promise;
				events.push("foreground-owner:commit");
				return "delivered";
			},
		);

		assert.ok(admitted);
		assert.deepEqual(events, ["agent-session:generation-admission", "foreground-owner:probe"]);
		firstRefusal.resolve();
		await admitted;
		assert.deepEqual(events, [
			"agent-session:generation-admission",
			"foreground-owner:probe",
			"foreground-owner:commit",
			"agent-session:queue-delivery",
		]);
	});

	test("a retried stage delivery executes foreground first refusal exactly once", async () => {
		let claims = 0;
		const admitted = admitWorkflowStageInbound(
			{ ...stageContext, isIdle: () => false },
			async (admissionBarrier) => {
				await admissionBarrier?.();
				await admissionBarrier?.();
			},
			async () => {
				claims += 1;
				return "unclaimed";
			},
		);

		assert.ok(admitted);
		await admitted;
		assert.equal(claims, 1);
	});
	test("unclaimed busy workflow traffic falls back inside the admitted generation", async () => {
		const events: string[] = [];
		const admitted = admitWorkflowStageInbound(
			{ ...stageContext, isIdle: () => false },
			async (admissionBarrier) => {
				events.push("agent-session:generation-admission");
				await admissionBarrier?.();
				events.push("agent-session:queue-delivery");
			},
			async () => {
				events.push("foreground-owner:unclaimed");
				return "unclaimed";
			},
		);

		assert.ok(admitted);
		await admitted;
		assert.deepEqual(events, [
			"agent-session:generation-admission",
			"foreground-owner:unclaimed",
			"agent-session:queue-delivery",
		]);
	});
	test("a retired generation reports failure before its admitted delivery settles", async () => {
		let delivered = false;
		let settled = false;
		const failureReported = Promise.withResolvers<void>();
		const admitted = admitWorkflowStageInbound(
			{ ...stageContext, isIdle: () => false },
			async (admissionBarrier) => {
				await Promise.all([admissionBarrier?.(), admissionBarrier?.()]);
				delivered = true;
			},
			async () => "abandoned",
			async () => {
				await failureReported.promise;
			},
		);

		assert.ok(admitted);
		void admitted
			.finally(() => {
				settled = true;
			})
			.catch(() => {});
		await sleep(0);
		assert.equal(settled, false, "correlated failure reporting remains inside admitted work");
		failureReported.resolve();
		await assert.rejects(admitted, /retired during foreground-owner admission/);
		assert.equal(delivered, false);
	});

	test("stage close drains the reserved retry and queued successor into their original destination", async () => {
		const boundary = new WorkflowStageAdmissionBoundary();
		const ctx = {
			...stageContext,
			orchestrationContext: {
				...stageContext.orchestrationContext,
				messageAdmission: { boundary, extensionState: new Map(), isOpen: () => boundary.isOpen() },
			},
		};
		const retryReady = Promise.withResolvers<void>();
		const retryGate = Promise.withResolvers<void>();
		const events: string[] = [];
		let firstAttempts = 0;
		const first = admitWorkflowStageInbound(ctx, () =>
			retryStableDelivery({
				deliver: () =>
					boundary.admit(
						"first",
						() => {
							if (++firstAttempts === 1) throw new Error("one-shot append failure");
							events.push("stage:first");
						},
						() => {
							events.push("late:first");
						},
					).completion,
				isCurrent: () => true,
				schedule: (retry) => {
					retryReady.resolve();
					void retryGate.promise.then(retry);
				},
			}),
		);
		await retryReady.promise;
		const second = admitWorkflowStageInbound(
			ctx,
			() =>
				boundary.admit(
					"second",
					() => {
						events.push("stage:second");
					},
					() => {
						events.push("late:second");
					},
				).completion,
		);
		let closed = false;
		const close = boundary.close().then(() => {
			closed = true;
		});
		await Promise.resolve();
		assert.equal(closed, false, "close waits for the full reserved operation");
		retryGate.resolve();
		await Promise.all([first, second, close]);
		assert.deepEqual(events, ["stage:first", "stage:second"]);
		assert.equal(firstAttempts, 2);
		assert.equal(boundary.isOpen(), false, "draining admitted input does not reopen the stage");
		await admitWorkflowStageInbound(
			ctx,
			() =>
				boundary.admit(
					"after-close",
					() => {
						events.push("stage:after-close");
					},
					() => {
						events.push("late:after-close");
					},
				).completion,
		);
		assert.deepEqual(events, ["stage:first", "stage:second", "late:after-close"]);
	});
	for (const fails of [false, true]) {
		test(`a ${fails ? "failed" : "completed"} reserved stage delivery cannot authorize detached work after close`, async () => {
			const boundary = new WorkflowStageAdmissionBoundary();
			const ctx = {
				...stageContext,
				orchestrationContext: {
					...stageContext.orchestrationContext,
					messageAdmission: { boundary, extensionState: new Map(), isOpen: () => boundary.isOpen() },
				},
			};
			const release = Promise.withResolvers<void>();
			let detached: Promise<void> | undefined;
			const events: string[] = [];
			const delivery = admitWorkflowStageInbound(ctx, async () => {
				detached = release.promise.then(
					() =>
						boundary.admit(
							"detached",
							() => {
								events.push("stage");
							},
							() => {
								events.push("late");
							},
						).completion,
				);
				if (fails) throw new Error("producer failed");
			});
			assert.ok(delivery);
			if (fails) await assert.rejects(delivery, /producer failed/);
			else await delivery;
			await boundary.close();
			release.resolve();
			await detached;
			assert.deepEqual(events, ["late"]);
		});
	}

	test("ordinary sessions retain Intercom's existing idle routing", () => {
		let delivered = false;
		const admitted = admitWorkflowStageInbound({}, () => {
			delivered = true;
		});

		assert.equal(admitted, false);
		assert.equal(delivered, false);
	});
});
