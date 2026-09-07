import { AsyncResource } from "node:async_hooks";
import * as native from "@bastani/atomic-natives";
import type * as C from "./contracts.js";

/** These objects are live authority, not DTOs, restart tokens or model arguments. */
class Capability {
	#live = true;
	toJSON(): never {
		throw new TypeError(`Task capability is not serializable (${this.#live ? "live" : "closed"})`);
	}
}
class HostCapability extends Capability {
	readonly kind = "host";
}
class OwnerCapability extends Capability {
	readonly kind = "owner";
}
class TaskCapability extends Capability {
	readonly kind = "task";
}
class WaitCapability extends Capability {
	readonly kind = "wait";
}
export type HostSession = HostCapability;
export type OwnerLease = OwnerCapability;
export type TaskLease = TaskCapability;
export type WaitLease = WaitCapability;

export type FakeRunnerContext = {
	ref: C.NativeTaskRef;
	signal: AbortSignal;
	reportActivity(report: C.ActivityReport): C.Result<C.ReportReceipt, C.ReportError>;
};
/** Independent cleanup evidence: an outcome alone never proves resource release. */
export type FakeExecution = { result: Promise<C.TaskResult>; cleanup: Promise<C.Cleanup> };
export type TrustedTaskHost = {
	scope: C.OwnerScope;
	/** The existing host/tool refusal throws here, before native admission. */
	authorizeLaunch(intent: C.AgentIntent): void;
	createRunner(context: FakeRunnerContext, intent: C.AgentIntent): FakeExecution;
};
type HostState = { native: native.HostSession; binding: TrustedTaskHost };
type OwnerState = {
	native: native.OwnerLease;
	host: HostState;
	tasks: Map<C.TaskId, TaskLease>;
	watches: Set<TaskSubscription>;
};
type TaskState = {
	native: native.TaskLease;
	owner: OwnerState;
	ref: C.NativeTaskRef;
	controller: AbortController;
	execution?: Promise<C.Result<C.Cleanup, C.ReportError>>;
};
type WaitState = { native: native.WaitLease; outcome: Promise<C.Result<C.WaitOutcome, C.WaitError>> };

// Native supervisors share one actor per environment; their JS continuations must too.
const environment = {
	hosts: new WeakMap<HostSession, HostState>(),
	owners: new WeakMap<OwnerLease, OwnerState>(),
	tasks: new WeakMap<TaskLease, TaskState>(),
	waits: new WeakMap<WaitLease, WaitState>(),
	waitRegistry: new Map<C.WaitId, WaitLease>(),
	ownerIds: new Map<C.OwnerId, OwnerLease>(),
};

function mapped<T, U, Code extends string>(
	result: C.Result<T, native.TaskFailure>,
	convert: (value: T) => U,
	codes: readonly Code[],
): C.Result<U, C.Failure<Code>> {
	if (result.ok) return { ok: true, value: convert(result.value) };
	const code = codes.find((candidate) => candidate === result.error.code);
	if (!code) throw new Error(`Unexpected native task refusal: ${result.error.code}: ${result.error.message}`);
	return { ok: false, error: { code, message: result.error.message } };
}
const ownerErrors = ["ScopeMismatch", "EnvironmentClosing"] as const;
const startErrors = [
	"OwnerClosing",
	"UnknownAgent",
	"InvalidCwd",
	"DepthExceeded",
	"CapacityExhausted",
	"DispatchGuardBusy",
	"OperationConflict",
	"RunnerUnavailable",
	"SpawnFailed",
	"ContainmentUnavailable",
] as const;
const waitErrors = ["UnknownTask", "OwnerClosed", "EnvironmentClosing", "ScopeMismatch", "ObserverCancelled"] as const;
const reportErrors = ["StaleAttempt", "OwnerClosing", "TaskTerminal", "ReportConflict"] as const;
const watchErrors = ["OwnerClosed", "StaleGeneration", "EnvironmentClosing"] as const;
function reference(value: native.NativeTaskRef): C.NativeTaskRef {
	return {
		ownerId: value.ownerId as C.OwnerId,
		taskId: value.taskId as C.TaskId,
		attemptId: value.attemptId as C.AttemptId,
		generation: value.generation as C.Generation,
	};
}
function cursor(value: native.Cursor): C.Cursor {
	return { generation: value.generation as C.Generation, sequence: value.sequence as C.Sequence };
}
function output(value: native.OutputRef): C.OutputRef {
	return {
		ownerId: value.ownerId as C.OwnerId,
		taskId: value.taskId as C.TaskId,
		artifactId: value.artifactId,
		byteCount: value.byteCount,
		omittedRanges: value.omittedRanges.map(({ start, end }) => ({ start, end })),
	};
}
function taskResult(value: native.TaskResult): C.TaskResult {
	switch (value.kind) {
		case "completed":
			return {
				kind: value.kind,
				output: output(value.output),
				...(value.exitCode === undefined ? {} : { exitCode: value.exitCode }),
			};
		case "failed":
			return {
				kind: value.kind,
				code: value.code,
				message: value.message,
				...(value.output === undefined ? {} : { output: output(value.output) }),
				...(value.exitCode === undefined ? {} : { exitCode: value.exitCode }),
			};
		case "cancelled":
			return {
				kind: value.kind,
				cause: value.cause,
				...(value.output === undefined ? {} : { output: output(value.output) }),
			};
	}
}
function execution(value: native.Execution): C.Execution {
	return value.kind === "settled" ? { kind: "settled", result: taskResult(value.result) } : value;
}
function observation(value: native.HostObservation): C.HostObservation {
	if (value.kind === "foreground") return { kind: value.kind, waitId: value.waitId as C.WaitId };
	if (value.kind === "none" && (value.reason === "task-settled" || value.reason === "owner-closing"))
		return { kind: value.kind, reason: value.reason };
	const reasons = [
		"explicit",
		"default-background",
		"elapsed",
		"intercom-coordination",
		"input-needed",
		"not-observed",
		"observer-cancelled",
	] as const;
	const reason = reasons.find((reason) => reason === value.reason);
	if (value.kind === "background" && reason) return { kind: value.kind, reason };
	throw new Error("Invalid native host observation");
}
function record(value: native.TaskRecord): C.TaskRecord {
	if (value.kind !== "agent" && value.kind !== "command") throw new Error(`Invalid native task kind: ${value.kind}`);
	return {
		ref: reference(value.ref),
		launchOperationId: value.launchOperationId as C.OperationId,
		...(value.parentTaskId === undefined ? {} : { parentTaskId: value.parentTaskId as C.TaskId }),
		...(value.launchGroupId === undefined ? {} : { launchGroupId: value.launchGroupId }),
		launchOrdinal: value.launchOrdinal,
		kind: value.kind,
		title: value.title,
		...(value.agentName === undefined ? {} : { agentName: value.agentName }),
		execution: execution(value.execution),
		observation: observation(value.observation),
		attention: value.attention,
		cleanup: value.cleanup,
		...(value.currentAction === undefined
			? {}
			: { currentAction: { tool: value.currentAction.tool, text: value.currentAction.text } }),
		...(value.metrics === undefined
			? {}
			: {
					metrics: {
						...(value.metrics.elapsedMs === undefined ? {} : { elapsedMs: value.metrics.elapsedMs }),
						...(value.metrics.toolCount === undefined ? {} : { toolCount: value.metrics.toolCount }),
						...(value.metrics.tokenCount === undefined ? {} : { tokenCount: value.metrics.tokenCount }),
					},
				}),
		output: output(value.output),
	};
}
function snapshot(value: native.OwnerSnapshot): C.OwnerSnapshot {
	if (value.state !== "open" && value.state !== "closing" && value.state !== "closed")
		throw new Error(`Invalid native owner state: ${value.state}`);
	return {
		ownerId: value.ownerId as C.OwnerId,
		scope: value.scope,
		generation: value.generation as C.Generation,
		state: value.state,
		tasks: value.tasks.map(record),
		cursor: cursor(value.cursor),
	};
}
function activity(value: native.ActivityReport): C.ActivityReport {
	if (value.change.kind === "attention-set" && value.change.attention.kind === "none")
		throw new Error("Native attention-set cannot clear attention");
	// Native tagged variants are owned wire data; only attention-set has a wider generated declaration.
	return value as C.ActivityReport;
}
function payload(value: native.TaskEvent): C.TaskEvent {
	switch (value.kind) {
		case "task-admitted":
			return { kind: value.kind, task: record(value.task) };
		case "task-started":
			return { kind: value.kind, ref: reference(value.ref) };
		case "wait-started": {
			if (value.observer !== "sdk" && value.observer !== "host") throw new Error("Invalid native observer");
			return {
				kind: value.kind,
				ref: reference(value.ref),
				waitId: value.waitId as C.WaitId,
				observer: value.observer,
			};
		}
		case "wait-yielded":
			return { kind: value.kind, ref: reference(value.ref), waitId: value.waitId as C.WaitId, reason: value.reason };
		case "host-observation-changed":
			return { kind: value.kind, ref: reference(value.ref), observation: observation(value.observation) };
		case "task-activity":
			return { kind: value.kind, ref: reference(value.ref), activity: activity(value.activity) };
		case "task-cancelling":
			return { kind: value.kind, ref: reference(value.ref), cause: value.cause };
		case "task-settled":
			return {
				kind: value.kind,
				ref: reference(value.ref),
				result: taskResult(value.result),
				completionId: value.completionId,
			};
		case "cleanup-changed":
			return { kind: value.kind, ref: reference(value.ref), cleanup: value.cleanup };
		case "owner-closing":
		case "owner-closed":
			return { kind: value.kind };
	}
}
function event(value: native.NativeEvent): C.NativeEvent {
	if (value.schemaVersion !== 1) throw new Error("Unsupported native task event schema");
	return {
		schemaVersion: 1,
		cursor: cursor(value.cursor),
		ownerId: value.ownerId as C.OwnerId,
		...(value.taskId === undefined ? {} : { taskId: value.taskId as C.TaskId }),
		payload: payload(value.payload),
	};
}
function waitOutcome(value: native.WaitOutcome): C.WaitOutcome {
	return value.kind === "settled"
		? { kind: value.kind, taskId: value.taskId as C.TaskId, result: taskResult(value.result) }
		: { kind: value.kind, taskId: value.taskId as C.TaskId, waitId: value.waitId as C.WaitId, reason: value.reason };
}
function cancelReceipt(value: native.CancelReceipt): C.CancelReceipt {
	if (value.decision !== "already-settled" && value.decision !== "cancellation-requested")
		throw new Error("Invalid cancellation decision");
	return {
		taskId: value.taskId as C.TaskId,
		decision: value.decision,
		execution: execution(value.execution),
		cleanup: value.cleanup,
	};
}

function reportReceipt(value: native.ReportReceipt): C.ReportReceipt {
	if (value.disposition !== "accepted" && value.disposition !== "duplicate")
		throw new Error("Invalid report disposition");
	return { reportId: value.reportId, cursor: cursor(value.cursor), disposition: value.disposition };
}
/** Projection only: native ordering remains the sole lifecycle authority. */
function applyEvent(current: C.OwnerSnapshot, value: C.NativeEvent): C.OwnerSnapshot {
	const next: C.OwnerSnapshot = { ...current, tasks: [...current.tasks], cursor: value.cursor };
	const change = value.payload;
	if (change.kind === "owner-closing") {
		next.state = "closing";
		return next;
	}
	if (change.kind === "owner-closed") {
		next.state = "closed";
		return next;
	}
	if (change.kind === "task-admitted") {
		next.tasks.push(change.task);
		return next;
	}
	const index = next.tasks.findIndex((task) => task.ref.taskId === change.ref.taskId);
	if (index < 0) throw new Error("Native delta references a task absent from its snapshot");
	const task: C.TaskRecord = { ...next.tasks[index] };
	next.tasks[index] = task;
	switch (change.kind) {
		case "task-started":
			task.execution = { kind: "running" };
			break;
		case "host-observation-changed":
			task.observation = change.observation;
			break;
		case "task-cancelling":
			task.execution = { kind: "cancelling", cause: change.cause };
			task.attention = { kind: "none" };
			break;
		case "task-settled":
			task.execution = { kind: "settled", result: change.result };
			task.attention = { kind: "none" };
			if (change.result.output !== undefined) task.output = change.result.output;
			break;
		case "cleanup-changed":
			task.cleanup = change.cleanup;
			break;
		case "task-activity": {
			const activity = change.activity.change;
			switch (activity.kind) {
				case "action":
					task.currentAction = { tool: activity.tool, text: activity.text };
					if (task.attention.kind === "no-recent-activity") task.attention = { kind: "none" };
					break;
				case "metrics":
					task.metrics = {
						...task.metrics,
						...(activity.elapsedMs === undefined ? {} : { elapsedMs: activity.elapsedMs }),
						...(activity.toolCount === undefined ? {} : { toolCount: activity.toolCount }),
						...(activity.tokenCount === undefined ? {} : { tokenCount: activity.tokenCount }),
					};
					break;
				case "attention-set":
					task.attention = activity.attention;
					break;
				case "attention-clear":
					if (task.attention.kind === "input-needed" && task.attention.requestId === activity.requestId)
						task.attention = { kind: "none" };
					break;
				case "output":
					break;
			}
			break;
		}
		case "wait-started":
		case "wait-yielded":
			break;
	}
	return next;
}
/** One bounded wake poll per live subscription, including a journal with no retained event. */
const RECONCILE_INTERVAL_MS = 25;
const MAX_PENDING_EVENTS = 64;
export class TaskSubscription {
	#native: native.TaskSupervisor;
	#lease: native.SubscriptionLease;
	#resource = new AsyncResource("TaskSubscription");
	#timer?: ReturnType<typeof setTimeout>;
	#queue: C.NativeEvent[] = [];
	#next?: (value: IteratorResult<C.NativeEvent>) => void;
	#disposed = false;
	#snapshot: C.OwnerSnapshot;
	#cursor: C.Cursor;
	#reconcile: (snapshot: C.OwnerSnapshot) => void;
	#onDispose: () => void;
	#failure?: Error;
	readonly events: AsyncIterable<C.NativeEvent>;

	constructor(
		actor: native.TaskSupervisor,
		initial: native.NativeTaskSubscription,
		reconcile: (snapshot: C.OwnerSnapshot) => void,
		onDispose: () => void,
	) {
		this.#native = actor;
		this.#lease = initial.lease;
		this.#snapshot = snapshot(initial.snapshot);
		this.#cursor = cursor(initial.cursor);
		this.#reconcile = reconcile;
		this.#onDispose = onDispose;
		this.events = {
			[Symbol.asyncIterator]: () => ({
				next: () => {
					const value = this.#queue.shift();
					if (value) return Promise.resolve({ done: false, value });
					if (this.#disposed) return Promise.resolve({ done: true, value: undefined });
					if (this.#next) return Promise.reject(new Error("Only one pending subscription read is supported"));
					return new Promise((resolve) => {
						this.#next = resolve;
					});
				},
				return: async () => {
					this.dispose();
					return { done: true, value: undefined };
				},
			}),
		};
		this.#arm();
	}
	get snapshot(): C.OwnerSnapshot {
		return this.#snapshot;
	}
	get cursor(): C.Cursor {
		return this.#cursor;
	}
	/** Consumer exceptions are observable without breaking the native wake or fallback poll. */
	get failure(): Error | undefined {
		return this.#failure;
	}
	/** Callback payloads are authentic hints; only the journal/snapshot is authoritative. */
	wake(_hint: native.NativeEvent): void {
		this.#resource.runInAsyncScope(() => this.drain());
	}
	#arm(): void {
		if (this.#disposed || this.#timer) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.#resource.runInAsyncScope(() => this.drain());
			this.#arm();
		}, RECONCILE_INTERVAL_MS);
		this.#timer.unref();
	}
	drain(): void {
		if (this.#disposed) return;
		const drained = this.#native.drainOwnerTasks(this.#lease);
		if (!drained.ok) {
			this.dispose();
			return;
		}
		const events = drained.value.events.map(event);
		if (drained.value.snapshot) this.#snapshot = snapshot(drained.value.snapshot);
		for (const value of events) {
			if (BigInt(value.cursor.sequence) > BigInt(this.#snapshot.cursor.sequence))
				this.#snapshot = applyEvent(this.#snapshot, value);
		}
		this.#cursor = cursor(drained.value.cursor);
		this.#snapshot = { ...this.#snapshot, cursor: this.#cursor };
		const overflow = this.#queue.length + events.length > MAX_PENDING_EVENTS;
		if (drained.value.reset || overflow) this.#queue = [];
		if (drained.value.snapshot || events.length) {
			try {
				this.#resource.runInAsyncScope(this.#reconcile, undefined, this.#snapshot);
			} catch (error) {
				this.#failure = error instanceof Error ? error : new Error(String(error));
			}
		}
		if (!overflow)
			for (const value of events) {
				if (this.#next) {
					const next = this.#next;
					this.#next = undefined;
					next({ done: false, value });
				} else this.#queue.push(value);
			}
		if (this.#snapshot.state === "closed") this.dispose(false);
	}
	dispose(clear = true): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#native.disposeSubscription(this.#lease);
		if (clear) this.#queue = [];
		this.#next?.({ done: true, value: undefined });
		this.#next = undefined;
		this.#resource.emitDestroy();
		this.#onDispose();
	}
}

export class TaskSupervisor {
	#native = new native.TaskSupervisor();
	#hosts = environment.hosts;
	#owners = environment.owners;
	#tasks = environment.tasks;
	#waits = environment.waits;
	#waitRegistry = environment.waitRegistry;
	#ownerIds = environment.ownerIds;
	bindHostSession(binding: TrustedTaskHost): HostSession {
		const host = new HostCapability();
		Object.freeze(host);
		this.#hosts.set(host, { native: this.#native.bindHostSession(binding.scope), binding });
		return host;
	}
	openTaskOwner(host: HostSession, scope: C.OwnerScope): C.Result<OwnerLease, C.OwnerError> {
		const state = this.#host(host);
		return mapped(
			this.#native.openTaskOwner(state.native, scope),
			(lease) => {
				const probe = this.#native.watchOwnerTasks(lease, (_hint) => {});
				if (!probe.ok) throw new Error(probe.error.message);
				const id = probe.value.snapshot.ownerId as C.OwnerId;
				this.#native.disposeSubscription(probe.value.lease);
				const existing = this.#ownerIds.get(id);
				if (existing) return existing;
				const owner = new OwnerCapability();
				Object.freeze(owner);
				this.#owners.set(owner, { native: lease, host: state, tasks: new Map(), watches: new Set() });
				this.#ownerIds.set(id, owner);
				this.watchOwnerTasks(owner, (projection) => {
					if (projection.state === "closed") this.#ownerIds.delete(projection.ownerId);
					for (const record of projection.tasks) {
						if (record.execution.kind !== "cancelling") continue;
						const task = this.#owner(owner).tasks.get(record.ref.taskId);
						if (task) this.#task(task).controller.abort(record.execution.cause);
					}
				});
				return owner;
			},
			ownerErrors,
		);
	}
	async startAgentTask(
		owner: OwnerLease,
		intent: C.AgentIntent,
		operation: C.OperationId,
	): Promise<C.Result<TaskLease, C.StartFailure>> {
		const state = this.#owner(owner);
		state.host.binding.authorizeLaunch(intent);
		const admitted = mapped(
			this.#native.startAgentTask(state.native, intent, operation),
			(lease) => lease,
			startErrors,
		);
		if (!admitted.ok) return admitted;
		const ref = this.#native.taskReference(admitted.value);
		if (!ref.ok) throw new Error(ref.error.message);
		const id = ref.value.taskId as C.TaskId;
		const existing = state.tasks.get(id);
		if (existing) return { ok: true, value: existing };
		const runner = mapped(this.#native.claimTaskRunner(admitted.value), (lease) => lease, startErrors);
		if (!runner.ok) return runner;
		const task = new TaskCapability();
		Object.freeze(task);
		const taskState: TaskState = {
			native: admitted.value,
			owner: state,
			ref: reference(ref.value),
			controller: new AbortController(),
		};
		this.#tasks.set(task, taskState);
		state.tasks.set(id, task);
		let execution: FakeExecution;
		try {
			execution = state.host.binding.createRunner(
				{
					ref: reference(taskState.ref),
					signal: taskState.controller.signal,
					reportActivity: (report) =>
						mapped(this.#native.reportTaskActivity(runner.value, report), reportReceipt, reportErrors),
				},
				intent,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			execution = {
				result: Promise.resolve({ kind: "failed", code: "SpawnFailed", message }),
				cleanup: Promise.resolve({
					kind: "failed",
					resources: [{ resource: "fake-runner-setup", code: "CleanupUnconfirmed", message }],
				}),
			};
		}
		const outcome = execution.result
			.catch((error: Error) => ({ kind: "failed" as const, code: "RunnerFailed", message: error.message }))
			.then((result) => {
				return mapped(
					this.#native.reportTaskOutcome(runner.value, { reportId: "runner-outcome", result }),
					() => undefined,
					reportErrors,
				);
			});
		const cleanup = execution.cleanup.catch(
			(error: Error): C.Cleanup => ({
				kind: "failed",
				resources: [{ resource: "fake-runner", code: "CleanupFailed", message: error.message }],
			}),
		);
		taskState.execution = Promise.all([outcome, cleanup]).then(([reported, evidence]) => {
			const acknowledged = mapped(
				this.#native.acknowledgeTaskCleanup(runner.value, evidence),
				(cleanup) => cleanup,
				reportErrors,
			);
			if (!reported.ok && !(taskState.controller.signal.aborted && reported.error.code === "ReportConflict"))
				return reported;
			return acknowledged;
		});
		// Setup is complete. Do not await execution; ready terminal microtasks may win observation.
		await Promise.resolve();
		return { ok: true, value: task };
	}
	taskReference(task: TaskLease): C.NativeTaskRef {
		return reference(this.#task(task).ref);
	}
	waitForTask(task: TaskLease, budgetMs?: number): C.Result<WaitLease, C.WaitError> {
		return mapped(
			this.#native.waitForTask(this.#task(task).native, budgetMs),
			(lease) => this.#register(lease),
			waitErrors,
		);
	}
	waitForTaskId(owner: OwnerLease, taskId: C.TaskId, budgetMs?: number): C.Result<WaitLease, C.WaitError> {
		const found = mapped(this.#native.lookupTask(this.#owner(owner).native, taskId), (lease) => lease, waitErrors);
		if (!found.ok) return found;
		return mapped(this.#native.waitForTask(found.value, budgetMs), (lease) => this.#register(lease), waitErrors);
	}
	foregroundTask(task: TaskLease, budgetMs?: number): C.Result<WaitLease, C.ForegroundError> {
		const state = this.#task(task);
		return mapped(
			this.#native.foregroundTask(state.native, state.owner.host.native, budgetMs),
			(lease) => this.#register(lease),
			["TaskTerminal", "OwnerClosing", "UnknownTask", "ObserverCancelled"],
		);
	}
	waitId(wait: WaitLease): C.WaitId {
		return this.#wait(wait).native.waitId as C.WaitId;
	}
	findWait(id: C.WaitId): WaitLease | undefined {
		return this.#waitRegistry.get(id);
	}
	observeTaskWait(wait: WaitLease): Promise<C.Result<C.WaitOutcome, C.WaitError>> {
		return this.#wait(wait).outcome;
	}
	yieldTaskWait(wait: WaitLease, reason: C.YieldReason): C.Result<C.WaitOutcome, C.YieldError> {
		return mapped(this.#native.yieldTaskWait(this.#wait(wait).native, reason), waitOutcome, [
			"UnknownWait",
			"StaleGeneration",
		]);
	}
	disposeTaskWait(wait: WaitLease): C.Result<void, C.WaitError> {
		return mapped(this.#native.disposeTaskWait(this.#wait(wait).native), () => undefined, waitErrors);
	}
	async initialObservation(task: TaskLease, policy?: C.WaitPolicy): Promise<C.Result<C.WaitOutcome, C.WaitError>> {
		const state = this.#task(task);
		const registered = mapped(
			this.#native.waitForTask(
				state.native,
				policy?.kind === "foreground" ? policy.budgetMs : undefined,
				state.owner.host.native,
			),
			(lease) => this.#register(lease),
			waitErrors,
		);
		if (!registered.ok) return registered;
		if (policy?.kind !== "foreground")
			this.yieldTaskWait(registered.value, policy ? "explicit" : "default-background");
		return this.observeTaskWait(registered.value);
	}
	cancelTask(task: TaskLease, cause: C.CancelCause): C.Result<C.CancelReceipt, C.CancelError> {
		const state = this.#task(task);
		const result = mapped(this.#native.cancelTask(state.native, cause), cancelReceipt, [
			"UnknownTask",
			"CleanupFailed",
		]);
		if (result.ok && result.value.decision === "cancellation-requested") state.controller.abort(cause);
		return result;
	}
	async closeTaskOwner(
		owner: OwnerLease,
		cause: C.OwnerCloseCause,
	): Promise<C.Result<C.OwnerCloseReceipt, C.CloseError>> {
		const state = this.#owner(owner);
		const closing = this.#native.closeTaskOwner(state.native, cause);
		for (const task of state.tasks.values()) this.#task(task).controller.abort("owner-close");
		const result = mapped(
			await closing,
			(receipt): C.OwnerCloseReceipt => ({
				ownerId: receipt.ownerId as C.OwnerId,
				state: "closed",
				tasks: receipt.tasks.map(cancelReceipt),
			}),
			["CleanupFailed", "EnvironmentClosing"],
		);
		if (result.ok)
			for (const task of state.tasks.values()) {
				const completed = await this.#task(task).execution;
				if (completed && !completed.ok)
					throw new Error(`Runner protocol failed: ${completed.error.code}: ${completed.error.message}`);
			}
		if (result.ok)
			for (const watch of state.watches) {
				watch.drain();
				watch.dispose(false);
			}
		return result;
	}
	/**
	 * The bounded event stream carries only authentic deltas. Reconciliation is delivered
	 * through onReconcile and snapshot, including overflow with no surviving event. Apply
	 * the snapshot first and ignore deltas at or below its cursor. Consumer exceptions
	 * remain visible as subscription.failure; they never disable the fallback poll.
	 */
	watchOwnerTasks(
		owner: OwnerLease,
		onReconcile: (snapshot: C.OwnerSnapshot) => void = () => {},
		from?: C.Cursor,
	): C.Result<TaskSubscription, C.WatchError> {
		const state = this.#owner(owner);
		let subscription: TaskSubscription | undefined;
		return mapped(
			this.#native.watchOwnerTasks(state.native, (hint) => subscription?.wake(hint), from),
			(initial) => {
				subscription = new TaskSubscription(this.#native, initial, onReconcile, () => {
					if (subscription) state.watches.delete(subscription);
				});
				state.watches.add(subscription);
				return subscription;
			},
			watchErrors,
		);
	}
	#register(lease: native.WaitLease): WaitLease {
		const wait = new WaitCapability();
		Object.freeze(wait);
		const id = lease.waitId as C.WaitId;
		this.#waitRegistry.set(id, wait);
		const outcome = this.#native
			.observeTaskWait(lease)
			.then((result) => mapped(result, waitOutcome, waitErrors))
			.finally(() => {
				this.#waitRegistry.delete(id);
			});
		this.#waits.set(wait, { native: lease, outcome });
		return wait;
	}
	#host(host: HostSession): HostState {
		const state = this.#hosts.get(host);
		if (!state) throw new TypeError("Foreign host capability");
		return state;
	}
	#owner(owner: OwnerLease): OwnerState {
		const state = this.#owners.get(owner);
		if (!state) throw new TypeError("Foreign owner capability");
		return state;
	}
	#task(task: TaskLease): TaskState {
		const state = this.#tasks.get(task);
		if (!state) throw new TypeError("Foreign task capability");
		return state;
	}
	#wait(wait: WaitLease): WaitState {
		const state = this.#waits.get(wait);
		if (!state) throw new TypeError("Foreign wait capability");
		return state;
	}
}
