import type { AgentSessionInternalSurface as AgentSession } from "./agent-session-methods.ts";
import { AgentTaskHost } from "./tasks/agent-adapter.js";
import { TASK_COMPLETION_MESSAGE_TYPE, TaskCompletionOutbox } from "./tasks/completion.js";
import { WorkflowStageAdmissionBoundary } from "./workflow-stage-admission.ts";

export function getAgentTaskHost(this: AgentSession): AgentTaskHost {
	if (this._disposed) throw new Error("Task owner is closed");
	if (this._agentTaskHost) return this._agentTaskHost;
	const admission = this._workflowStageAdmission ?? new WorkflowStageAdmissionBoundary();
	this._taskAdmission = admission;
	const outbox = new TaskCompletionOutbox(
		this.sessionManager,
		() => !this._disposed && admission.isOpen(),
		async (envelope) => {
			await admission.admit(
				envelope.completionId,
				() =>
					this.sendCustomMessage(
						{
							customType: TASK_COMPLETION_MESSAGE_TYPE,
							content: JSON.stringify(envelope),
							details: envelope,
							display: false,
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
