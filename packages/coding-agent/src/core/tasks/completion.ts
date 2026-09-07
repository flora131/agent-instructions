import type { SessionManager } from "../session-manager.js";
import type { OwnerId, Sequence, SettlementReceipt, TaskId, TaskResult } from "./contracts.js";

export const TASK_COMPLETION_MESSAGE_TYPE = "task-completion";
export type TaskCompletionEnvelope = {
	completionId: string;
	ownerId: OwnerId;
	taskId: TaskId;
	terminalSequence: Sequence;
	result: TaskResult;
	display: false;
};

/** Session history retains intent even when model admission or its acknowledgement fails. */
export class TaskCompletionOutbox {
	private readonly entries = new Map<string, TaskCompletionEnvelope>();
	private delivery: Promise<void> | undefined;
	private readonly session: SessionManager;
	private readonly isOpen: () => boolean;
	private readonly admit: (envelope: TaskCompletionEnvelope) => Promise<void>;

	constructor(
		session: SessionManager,
		isOpen: () => boolean,
		admit: (envelope: TaskCompletionEnvelope) => Promise<void>,
	) {
		this.session = session;
		this.isOpen = isOpen;
		this.admit = admit;
		for (const entry of session.getEntries()) {
			if (entry.type !== "custom") continue;
			if (entry.customType === "task-completion-intent") {
				const envelope = entry.data as TaskCompletionEnvelope;
				this.entries.set(envelope.completionId, envelope);
			} else if (entry.customType === "task-completion-ack") {
				this.entries.delete((entry.data as { completionId: string }).completionId);
			}
		}
	}
	get pending(): TaskCompletionEnvelope[] {
		return [...this.entries.values()];
	}

	record(ownerId: OwnerId, receipt: SettlementReceipt): void {
		if (this.entries.has(receipt.completionId)) return;
		const envelope: TaskCompletionEnvelope = {
			completionId: receipt.completionId,
			ownerId,
			taskId: receipt.taskId,
			terminalSequence: receipt.cursor.sequence,
			result: receipt.result,
			display: false,
		};
		this.entries.set(envelope.completionId, envelope);
	}

	flush(): Promise<void> {
		this.delivery ??= this.deliver().finally(() => {
			this.delivery = undefined;
		});
		return this.delivery;
	}

	private async deliver(): Promise<void> {
		for (const envelope of this.entries.values()) {
			if (!this.isOpen()) return;
			try {
				const persisted = this.session
					.getEntries()
					.some(
						(entry) =>
							entry.type === "custom" &&
							entry.customType === "task-completion-intent" &&
							(entry.data as TaskCompletionEnvelope | undefined)?.completionId === envelope.completionId,
					);
				if (!persisted) this.session.appendCustomEntry("task-completion-intent", envelope);
				this.session.flush();
				if (!this.isOpen()) return;
				await this.admit(envelope);
				this.session.appendCustomEntry("task-completion-ack", { completionId: envelope.completionId });
				this.session.flush();
				this.entries.delete(envelope.completionId);
			} catch {
				// Execution stays terminal. Explicit retry uses this same envelope and identity.
			}
		}
	}
}
