import { AsyncLocalStorage } from "node:async_hooks";
import type * as C from "./contracts.js";
import {
	type FakeExecution,
	type FakeRunnerContext,
	type TaskLease,
	TaskSupervisor,
	type TrustedTaskHost,
} from "./supervisor.js";

export type AgentTaskRunnerFactory = (context: FakeRunnerContext, intent: C.AgentIntent) => FakeExecution;
export type AgentTaskHostBinding = Omit<TrustedTaskHost, "createRunner">;

// S1 converges repeated live-scope bindings on one owner, so dispatch context is shared too.
const runners = new AsyncLocalStorage<AgentTaskRunnerFactory>();

/** Internal trusted-host seam. Bind actual host identity, never model-supplied scope. */
export class AgentTaskHost {
	private readonly supervisor = new TaskSupervisor();
	private readonly owner;

	constructor(binding: AgentTaskHostBinding) {
		const host = this.supervisor.bindHostSession({
			...binding,
			createRunner: (context, intent) => {
				const runner = runners.getStore();
				if (!runner) throw new Error("Agent runner factory missing from launch context");
				return runner(context, intent);
			},
		});
		const opened = this.supervisor.openTaskOwner(host, binding.scope);
		if (!opened.ok) throw new Error(`${opened.error.code}: ${opened.error.message}`);
		this.owner = opened.value;
	}

	async startAgentTask(
		intent: C.AgentIntent,
		operation: C.OperationId,
		runner: AgentTaskRunnerFactory,
	): Promise<C.Result<{ taskId: C.TaskId; lease: TaskLease }, C.StartFailure>> {
		const started = await runners.run(runner, () => this.supervisor.startAgentTask(this.owner, intent, operation));
		return started.ok
			? {
					ok: true as const,
					value: { taskId: this.supervisor.taskReference(started.value).taskId, lease: started.value },
				}
			: started;
	}
	resolveTask(taskId: C.TaskId): C.Result<TaskLease, C.WaitError> {
		return this.supervisor.lookupTask(this.owner, taskId);
	}

	observeAgentLaunch(
		taskId: C.TaskId,
		policy?: C.WaitPolicy,
		onRegistered?: (yieldWait: (reason: C.YieldReason) => C.Result<C.WaitOutcome, C.YieldError>) => void,
	) {
		const task = this.resolveTask(taskId);
		return task.ok
			? this.supervisor.initialObservation(task.value, policy, (wait) => {
					onRegistered?.((reason) => this.supervisor.yieldTaskWait(wait, reason));
				})
			: Promise.resolve(task);
	}

	waitForTask(taskId: C.TaskId, budgetMs?: number) {
		return this.supervisor.waitForTaskId(this.owner, taskId, budgetMs);
	}

	cancelTask(taskId: C.TaskId, cause: C.CancelCause) {
		const task = this.resolveTask(taskId);
		return task.ok ? this.supervisor.cancelTask(task.value, cause) : Promise.resolve(task);
	}

	watchOwnerTasks(cursor?: C.Cursor) {
		return this.supervisor.watchOwnerTasks(this.owner, cursor);
	}

	close(cause: C.OwnerCloseCause) {
		return this.supervisor.closeTaskOwner(this.owner, cause);
	}
}
