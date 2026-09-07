import type {
	AttemptId,
	Generation,
	OperationId,
	OwnerId,
	TaskId,
	TaskRecord,
} from "../../packages/coding-agent/src/core/tasks/contracts.js";

export function taskRecord(id: string, kind: "agent" | "command" = "agent"): TaskRecord {
	const taskId = id as TaskId;
	const ownerId = "owner" as OwnerId;
	return {
		ref: { taskId, ownerId, attemptId: "attempt" as AttemptId, generation: "generation" as Generation },
		launchOperationId: id as OperationId,
		launchOrdinal: 0,
		kind,
		title: `Task ${id}`,
		execution: { kind: "running" },
		observation: { kind: "background", reason: "explicit" },
		attention: { kind: "none" },
		cleanup: { kind: "active" },
		output: { ownerId, taskId, artifactId: "output", byteCount: "0", omittedRanges: [] },
	};
}
