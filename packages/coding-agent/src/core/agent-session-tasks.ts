import type { AgentSessionInternalSurface as AgentSession } from "./agent-session-methods.ts";
import { AgentTaskHost } from "./tasks/agent-adapter.js";
import { COMMAND_DETAIL_TAIL_BYTES, taskOutputText } from "./tasks/command-output.js";
import {
	formatTaskCompletion,
	TASK_COMPLETION_MESSAGE_TYPE,
	TaskCompletionOutbox,
	taskCompletionNotice,
} from "./tasks/completion.js";
import { bindOwnerTaskStore, OwnerTaskStore } from "./tasks/owner-store.js";
import { taskTranscriptSource } from "./tasks/supervisor.js";
import { WorkflowStageAdmissionBoundary } from "./workflow-stage-admission.ts";

export function getAgentTaskHost(this: AgentSession): AgentTaskHost {
	if (this._disposed) throw new Error("Task owner is closed");
	if (this._agentTaskHost) return this._agentTaskHost;
	const admission =
		this._workflowStageAdmission ?? WorkflowStageAdmissionBoundary.restore(this.sessionManager.getEntries());
	this._taskAdmission = admission;
	const outbox = new TaskCompletionOutbox(
		this.sessionManager,
		() => !this._disposed && admission.isOpen(),
		async (envelope) => {
			// Settlement can precede the UI projection's next drain. Read the owner
			// snapshot, not the display store, when attaching completion context.
			const host = this._agentTaskHost;
			const watched = host?.watchOwnerTasks();
			const task = watched?.ok
				? watched.value.snapshot.tasks.find(
						(item) => item.ref.taskId === envelope.taskId && item.ref.ownerId === envelope.ownerId,
					)
				: undefined;
			if (watched?.ok) watched.value.dispose();
			// Foreground shell results already return through their tool call. Do not
			// create a second model turn or background card for that same execution.
			if (task?.kind === "command" && !task.wasBackground) return;
			const lease = task ? host?.resolveTask(envelope.taskId) : undefined;
			const source = lease?.ok ? taskTranscriptSource(lease.value) : undefined;
			const response = source?.ok
				? source.value.session
						.getEntries()
						.slice()
						.reverse()
						.find(
							(entry) =>
								entry.type === "message" &&
								entry.message.role === "assistant" &&
								entry.message.content.some((block) => block.type === "text" && block.text.trim()),
						)
				: undefined;
			let output =
				response?.type === "message" && response.message.role === "assistant"
					? response.message.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n")
					: undefined;
			if (task?.kind === "command" && lease?.ok && host) {
				try {
					const bytes = BigInt(task.output.byteCount);
					const start = bytes > BigInt(COMMAND_DETAIL_TAIL_BYTES) ? bytes - BigInt(COMMAND_DETAIL_TAIL_BYTES) : 0n;
					const page = await host.ownerBinding.supervisor.readTaskOutput(lease.value, {
						start: String(start),
						maximumBytes: COMMAND_DETAIL_TAIL_BYTES,
					});
					output = page.ok
						? `${start > 0n ? "[Earlier output omitted]\n" : ""}${taskOutputText(page.value)}`
						: "Output unavailable";
				} catch {
					// Missing retained output must not suppress a terminal notification.
					output = "Output unavailable";
				}
			}
			await admission.admit(
				envelope.completionId,
				() =>
					this.sendCustomMessage(
						{
							customType: TASK_COMPLETION_MESSAGE_TYPE,
							content: formatTaskCompletion(envelope, task, output),
							details: { ...envelope, notification: taskCompletionNotice(envelope, task, output) },
							display: true,
						},
						{ triggerTurn: true, persistWhenStreaming: true, stageAdmissionKey: envelope.completionId },
					),
				() => {
					throw new Error("Task owner is closed");
				},
			).completion;
		},
	);
	this._taskCompletionOutbox = outbox;
	const binding = {
		authorizeLaunch: () => {
			if (this._disposed || !admission.isOpen()) throw new Error("Task owner is closed");
			// Top-level sessions (main chat, workflow stages) may carry a policy without `depth`;
			// only an admitted in-process child (depth >= 1) is refused delegation.
			if ((this._subagentPolicy?.depth ?? 0) >= 1)
				throw new Error("Subagent delegation is not available inside a subagent");
		},
		onTaskSettled: (
			...[ref, receipt]: Parameters<NonNullable<import("./tasks/supervisor.js").TrustedTaskHost["onTaskSettled"]>>
		) => {
			outbox.record(ref.ownerId, receipt);
			void outbox.flush();
		},
	};
	this._agentTaskHost = this._workflowStageAdmission
		? this._workflowStageAdmission.bindAgentTaskHost(binding)
		: new AgentTaskHost({ ...binding, scope: { kind: "session", sessionId: this.sessionManager.getSessionId() } });
	const { supervisor, owner } = this._agentTaskHost.ownerBinding;
	const store = new OwnerTaskStore(supervisor, owner);
	const connected = store.connect();
	if (!connected.ok) throw new Error(connected.error.message);
	bindOwnerTaskStore(this, store);
	return this._agentTaskHost;
}

export async function closeSessionTasks(this: AgentSession): Promise<void> {
	// Replacement stage sessions share generation lifetime; disposal is not stage closure.
	if (this._workflowStageAdmission) return;
	this._taskAdmission?.seal();
	const closed = await this._agentTaskHost?.close("session-close");
	if (closed && !closed.ok) throw new Error(`${closed.error.code}: ${closed.error.message}`);
}

export const agentSessionTaskMethods = { getAgentTaskHost, closeSessionTasks };
