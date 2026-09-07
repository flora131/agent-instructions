/** Owner-bound task wire contracts. Capabilities are deliberately not wire DTOs. */
declare const brand: unique symbol;
type Brand<Name extends string> = { readonly [brand]: Name };
export type OwnerId = string & Brand<"OwnerId">;
export type TaskId = string & Brand<"TaskId">;
export type AttemptId = string & Brand<"AttemptId">;
export type WaitId = string & Brand<"WaitId">;
export type OperationId = string & Brand<"OperationId">;
export type Generation = string & Brand<"Generation">;
/** Decimal u64, never a JavaScript number. */
export type Sequence = string & Brand<"Sequence">;
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export type Failure<Code extends string> = { code: Code; message: string };
export type OwnerError = Failure<"ScopeMismatch" | "EnvironmentClosing">;
export type StartError =
	| "OwnerClosing"
	| "UnknownAgent"
	| "InvalidCwd"
	| "DepthExceeded"
	| "CapacityExhausted"
	| "DispatchGuardBusy"
	| "OperationConflict"
	| "RunnerUnavailable"
	| "SpawnFailed"
	| "ContainmentUnavailable";
export type StartFailure = Failure<StartError>;
export type WaitError = Failure<
	"UnknownTask" | "OwnerClosed" | "EnvironmentClosing" | "ScopeMismatch" | "ObserverCancelled"
>;
export type YieldError = Failure<"UnknownWait" | "StaleGeneration" | "ObserverCancelled">;
export type ForegroundError = Failure<"TaskTerminal" | "OwnerClosing" | "UnknownTask" | "ObserverCancelled">;
export type CancelError = Failure<"UnknownTask" | "CleanupFailed">;
export type CloseError = Failure<"CleanupFailed" | "EnvironmentClosing">;
export type WatchError = Failure<"OwnerClosed" | "StaleGeneration" | "EnvironmentClosing">;
export type ReportError = Failure<"StaleAttempt" | "OwnerClosing" | "TaskTerminal" | "ReportConflict">;
export type OwnerScope =
	| { kind: "session"; sessionId: string }
	| { kind: "workflow-stage"; sessionId: string; runId: string; stageId: string; stageAttemptId: string };
export type WaitPolicy = { kind: "background" } | { kind: "foreground"; budgetMs?: number };
export type YieldReason = "explicit" | "default-background" | "elapsed" | "intercom-coordination" | "input-needed";
export type WaitOutcome =
	| { kind: "settled"; taskId: TaskId; result: TaskResult }
	| { kind: "yielded"; taskId: TaskId; waitId: WaitId; reason: YieldReason };
export type AgentIntent = {
	kind: "agent";
	agent: string;
	task: string;
	description?: string;
	cwd?: string;
	parentTaskId?: TaskId;
};
export type CommandIntent = {
	kind: "command";
	command: string;
	description?: string;
	cwd?: string;
	env?: Record<string, string>;
	terminal: { kind: "pipe" } | { kind: "pty"; columns: number; rows: number };
	executionTimeoutMs?: number;
	parentTaskId?: TaskId;
};
export type TaskIntent = AgentIntent | CommandIntent;
export type TaskWaitConfiguration =
	| { kind: "automatic"; commandBudgetMs?: number; agentBudgetMs?: number }
	| { kind: "until-settled" };
export type CancelCause = "user" | "owner-close" | "execution-timeout" | "output-limit" | "parent-handoff" | "shutdown";
export type OwnerCloseCause = "session-close" | "stage-close" | "app-shutdown";
export type Cursor = { generation: Generation; sequence: Sequence };
export type NativeTaskRef = { ownerId: OwnerId; taskId: TaskId; attemptId: AttemptId; generation: Generation };
export type OutputRef = {
	ownerId: OwnerId;
	taskId: TaskId;
	artifactId: string;
	byteCount: string;
	omittedRanges: Array<{ start: string; end: string }>;
};
export type TaskResult =
	| { kind: "completed"; output: OutputRef; exitCode?: number }
	| { kind: "failed"; code: string; message: string; output?: OutputRef; exitCode?: number }
	| { kind: "cancelled"; cause: CancelCause; output?: OutputRef };
export type Execution =
	| { kind: "queued" }
	| { kind: "running" }
	| { kind: "cancelling"; cause: CancelCause }
	| { kind: "settled"; result: TaskResult };
export type ResourceFailure = { resource: string; code: string; message: string };
export type Cleanup =
	| { kind: "active" }
	| { kind: "draining" }
	| { kind: "reaped" }
	| { kind: "failed"; resources: Array<ResourceFailure> };
export type PromptRoute = { sessionId: string; promptId: string; stageAttemptId?: string };
export type Attention =
	| { kind: "none" }
	| { kind: "input-needed"; requestId: string; prompt: string; route: PromptRoute }
	| { kind: "no-recent-activity"; lastActivityAt?: string };
export type HostObservation =
	| { kind: "foreground"; waitId: WaitId }
	| { kind: "background"; reason: YieldReason | "not-observed" | "observer-cancelled" }
	| { kind: "none"; reason: "task-settled" | "owner-closing" };
export type TaskRecord = {
	ref: NativeTaskRef;
	launchOperationId: OperationId;
	parentTaskId?: TaskId;
	launchGroupId?: string;
	launchOrdinal: number;
	kind: "agent" | "command";
	title: string;
	agentName?: string;
	execution: Execution;
	observation: HostObservation;
	attention: Attention;
	cleanup: Cleanup;
	currentAction?: { tool: string; text: string };
	metrics?: { elapsedMs?: number; toolCount?: number; tokenCount?: number };
	output: OutputRef;
};
export type ActivityReport = {
	reportId: string;
	change:
		| { kind: "action"; tool: string; text: string }
		| { kind: "metrics"; elapsedMs?: number; toolCount?: number; tokenCount?: number }
		| { kind: "output"; offset: string; bytesBase64: string }
		| { kind: "attention-set"; attention: Exclude<Attention, { kind: "none" }> }
		| { kind: "attention-clear"; requestId: string };
};
export type OutcomeReport = { reportId: string; result: TaskResult };
export type TaskEvent =
	| { kind: "task-admitted"; task: TaskRecord }
	| { kind: "task-started"; ref: NativeTaskRef }
	| { kind: "wait-yielded"; ref: NativeTaskRef; waitId: WaitId; reason: YieldReason }
	| { kind: "wait-started"; ref: NativeTaskRef; waitId: WaitId; observer: "sdk" | "host" }
	| { kind: "host-observation-changed"; ref: NativeTaskRef; observation: HostObservation }
	| { kind: "task-activity"; ref: NativeTaskRef; activity: ActivityReport }
	| { kind: "task-cancelling"; ref: NativeTaskRef; cause: CancelCause }
	| { kind: "task-settled"; ref: NativeTaskRef; result: TaskResult; completionId: string }
	| { kind: "cleanup-changed"; ref: NativeTaskRef; cleanup: Cleanup }
	| { kind: "owner-closing" }
	| { kind: "owner-closed" };
export type NativeEvent = {
	schemaVersion: 1;
	cursor: Cursor;
	ownerId: OwnerId;
	taskId?: TaskId;
	payload: TaskEvent;
};
export type OwnerSnapshot = {
	ownerId: OwnerId;
	scope: OwnerScope;
	generation: Generation;
	state: "open" | "closing" | "closed";
	tasks: Array<TaskRecord>;
	cursor: Cursor;
};
export type ReportReceipt = { reportId: string; cursor: Cursor; disposition: "accepted" | "duplicate" };
export type SettlementReceipt = { taskId: TaskId; cursor: Cursor; result: TaskResult; completionId: string };
export type CancelReceipt = {
	taskId: TaskId;
	decision: "already-settled" | "cancellation-requested";
	execution: Execution;
	cleanup: Cleanup;
};
export type OwnerCloseReceipt = { ownerId: OwnerId; state: "closed"; tasks: Array<CancelReceipt> };
export type ArtifactRef = { kind: "transcript" | "result"; uri: string };
export type ModelAdmitted = { kind: "admitted"; observation: WaitOutcome; artifacts?: Array<ArtifactRef> };
export type ModelRejected = { kind: "unstarted"; reason: { kind: "rejected"; error: StartFailure } };
export type ModelUnstarted =
	| ModelRejected
	| { kind: "unstarted"; reason: { kind: "skipped"; cause: "parallel-group-detach" } };
export type ModelSingleResponse = ModelAdmitted | ModelRejected;
export type ModelParallelResponse = {
	kind: "parallel";
	slots: Array<{ ordinal: number; outcome: ModelAdmitted | ModelUnstarted }>;
};
