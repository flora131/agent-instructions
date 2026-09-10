import assert from "node:assert/strict";
import { test } from "vitest";
import { createRealDbosHandle, type DbosStatic } from "../../packages/workflows/src/durable/dbos-sdk-handle.js";
import type { WorkflowSerializableValue } from "../../packages/workflows/src/shared/types.js";

function sdkWithReads(reads: Pick<DbosStatic, "listWorkflows" | "retrieveWorkflow">): DbosStatic {
	const unused = (): never => {
		throw new Error("unexpected DBOS operation");
	};
	return {
		setConfig: unused,
		launch: unused,
		shutdown: unused,
		registerWorkflow: unused,
		startWorkflow: unused,
		resumeWorkflow: unused,
		cancelWorkflow: unused,
		deleteWorkflows: unused,
		...reads,
	};
}

const main = async () => null;
const checkpoint = async () => null;

// Issue #2897: checkpoint-heavy Windows resume must not reread bulk-loaded results.
test("reads completed checkpoint outputs from one DBOS listing without per-record requests", async () => {
	const outputs: WorkflowSerializableValue[] = [{ raw: " text ", ordered: ["a", "a", ""] }, null, false, 0, ""];
	const statuses = outputs.map((output, index) => ({
		workflowID: `root:checkpoint:step-${index}`,
		status: "SUCCESS",
		createdAt: index,
		output,
	}));
	let listings = 0;
	let resultReads = 0;
	const sdk = sdkWithReads({
		listWorkflows: async (input) => {
			listings += 1;
			assert.deepEqual(input, { workflow_id_prefix: "root:checkpoint:", loadOutput: true, sortDesc: false });
			return statuses;
		},
		retrieveWorkflow: (id) => ({
			getStatus: async () => null,
			getResult: async () => {
				resultReads += 1;
				return statuses.find((status) => status.workflowID === id)!.output;
			},
		}),
	});
	const records = await createRealDbosHandle(sdk, main, checkpoint).listStepRecords("root");
	assert.deepEqual(
		records,
		outputs.map((output, index) => ({ stepName: `step-${index}`, output, completedAt: index })),
	);
	assert.equal(records[0]!.output, outputs[0], "preserve the SDK's deserialized value");
	assert.equal(listings, 1);
	assert.equal(resultReads, 0, "bulk-loaded SUCCESS outputs must not be fetched again serially");
});

test("falls back to one result read only when the bulk listing omits an output", async () => {
	const statuses = [
		{ workflowID: "root:checkpoint:present", status: "SUCCESS", createdAt: 2, output: { kept: true } },
		{ workflowID: "root:checkpoint:missing", status: "SUCCESS", createdAt: 3 },
	];
	const resultReads: string[] = [];
	const sdk = sdkWithReads({
		listWorkflows: async () => statuses,
		retrieveWorkflow: (id) => ({
			getStatus: async () => null,
			getResult: async () => {
				resultReads.push(id);
				return "late";
			},
		}),
	});
	const records = await createRealDbosHandle(sdk, main, checkpoint).listStepRecords("root");
	assert.deepEqual(records, [
		{ stepName: "present", output: { kept: true }, completedAt: 2 },
		{ stepName: "missing", output: "late", completedAt: 3 },
	]);
	assert.deepEqual(resultReads, ["root:checkpoint:missing"]);
});

test("preserves falsy serialized outputs without falling back to another read", async () => {
	const statuses = [
		{ workflowID: "root:checkpoint:empty-string", status: "SUCCESS", createdAt: 1, output: "" },
		{ workflowID: "root:checkpoint:zero", status: "SUCCESS", createdAt: 2, output: 0 },
		{ workflowID: "root:checkpoint:false", status: "SUCCESS", createdAt: 3, output: false },
		{ workflowID: "root:checkpoint:null", status: "SUCCESS", createdAt: 4, output: null },
	];
	let resultReads = 0;
	const sdk = sdkWithReads({
		listWorkflows: async () => statuses,
		retrieveWorkflow: () => ({
			getStatus: async () => null,
			getResult: async () => {
				resultReads += 1;
				return "unexpected";
			},
		}),
	});
	const records = await createRealDbosHandle(sdk, main, checkpoint).listStepRecords("root");
	assert.deepEqual(
		records,
		statuses.map((status) => ({
			stepName: status.workflowID.slice("root:checkpoint:".length),
			output: status.output,
			completedAt: status.createdAt,
		})),
	);
	assert.equal(resultReads, 0, "a stored falsy output is a value, not a missing one");
});
