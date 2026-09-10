export type WorkflowActivityState = "working" | "idle" | "blocked";
export type WorkflowActivityReason =
	| "executing"
	| "automatic_continuation"
	| "retrying"
	| "stopping"
	| "awaiting_input"
	| "manual_intervention"
	| "paused"
	| "quiescent";

// Kept in sync with workflows/shared/store-types without a host runtime dependency.
export type WorkflowRunStatus =
	| "pending"
	| "running"
	| "paused"
	| "completed"
	| "skipped"
	| "cancelled"
	| "blocked"
	| "failed"
	| "killed";
export type WorkflowStageStatus =
	| "pending"
	| "running"
	| "awaiting_input"
	| "paused"
	| "blocked"
	| "completed"
	| "failed"
	| "skipped";
export type WorkflowToolNodeStatus = "pending" | "running" | "completed" | "failed" | "cached" | "cancelled";
export type WorkflowControlAction = "quit" | "kill" | "pause" | "resume";

export interface WorkflowRootActivity {
	rootRunId: string;
	ownerSessionId: string;
	state: WorkflowActivityState;
	reason: WorkflowActivityReason;
	activeExecutionCount: number;
	actionableBlockCount: number;
	needsAttention: boolean;
}
export interface WorkflowObservationCursor {
	epoch: string;
	revision: number;
}
export type WorkflowActivitySnapshotInput =
	| { availability: "ready"; roots: readonly WorkflowRootActivity[] }
	| { availability: "recovering" | "unavailable" };
export type WorkflowActivitySnapshotFrame = WorkflowActivitySnapshotInput & {
	kind: "snapshot";
	cursor: WorkflowObservationCursor;
};
export type WorkflowActivityFrame =
	| WorkflowActivitySnapshotFrame
	| { kind: "changed"; cursor: WorkflowObservationCursor; root: WorkflowRootActivity }
	| { kind: "removed"; cursor: WorkflowObservationCursor; rootRunId: string };
export type WorkflowActivityObserver = (frame: WorkflowActivityFrame) => void | Promise<void>;
export interface WorkflowActivitySubscription {
	dispose(): void;
}
export type WorkflowLifecycleDelivery = "live" | "replay";
export type WorkflowLifecycleTarget =
	| {
			kind: "run";
			runId: string;
			previousStatus?: WorkflowRunStatus;
			status: WorkflowRunStatus;
			action?: WorkflowControlAction;
	  }
	| {
			kind: "stage";
			runId: string;
			stageId: string;
			stageName: string;
			previousStatus?: WorkflowStageStatus;
			status: WorkflowStageStatus;
	  }
	| {
			kind: "tool";
			runId: string;
			toolNodeId: string;
			toolName: string;
			previousStatus?: WorkflowToolNodeStatus;
			status: WorkflowToolNodeStatus;
	  }
	| { kind: "prompt"; runId: string; stageId?: string; promptId: string; status: "opened" | "answered" | "cancelled" };
export interface WorkflowLifecycleEvent {
	type: "workflow_lifecycle";
	eventId: string;
	cursor: WorkflowObservationCursor;
	runId: string;
	rootRunId: string;
	ownerSessionId: string;
	occurredAt: number;
	observedAt: number;
	delivery: WorkflowLifecycleDelivery;
	target: WorkflowLifecycleTarget;
	attribution?: "user" | "agent" | "scheduler" | "recovery" | "unknown";
}
export interface WorkflowStageCompletedEvent extends Omit<WorkflowLifecycleEvent, "type" | "target"> {
	type: "workflow_stage_completed";
	target: Extract<WorkflowLifecycleTarget, { kind: "stage" }> & { status: "completed" };
}
export interface WorkflowActivityChangedEvent {
	type: "workflow_activity_changed";
	cursor: WorkflowObservationCursor;
	root: WorkflowRootActivity;
}
export interface WorkflowHeartbeatEvent {
	type: "workflow_heartbeat";
	runId: string;
	rootRunId: string;
	ownerSessionId: string;
	scheduledAt: number;
	intervalMinutes: number;
}
export type WorkflowEvent =
	| WorkflowLifecycleEvent
	| WorkflowStageCompletedEvent
	| WorkflowActivityChangedEvent
	| WorkflowHeartbeatEvent;
export interface WorkflowActivityPublisher {
	publishSnapshot(input: WorkflowActivitySnapshotInput): void;
	publishChanged(root: WorkflowRootActivity): void;
	publishRemoved(rootRunId: string): void;
	publishLifecycle(event: Omit<WorkflowLifecycleEvent, "cursor">): void;
	publishHeartbeat(event: WorkflowHeartbeatEvent): void;
	dispose(): void;
}
export interface WorkflowObservationDiagnostic {
	kind:
		| "ObserverDisposed"
		| "SourceRecovering"
		| "SourceUnavailable"
		| "ObserverDeliveryFailed"
		| "ObserverOverflow"
		| "PublisherFenced";
	cursor: WorkflowObservationCursor;
}
