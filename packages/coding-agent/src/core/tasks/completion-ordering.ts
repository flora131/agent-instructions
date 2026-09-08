import type { EventBus } from "../event-bus.js";

/** Shared with the optional Intercom/subagent companions. */
export const SUBAGENT_TERMINAL_ORDERING_BARRIER_EVENT = "subagent:terminal-ordering-barrier";

/** Trusted runner metadata; never inferred from model-provided task IDs or labels. */
export interface TaskCompletionSource {
	readonly runId: string;
	readonly intercomTarget: string;
}

/** Notification delivery owns this wait. It must never reject a runner's execution result. */
export async function flushTaskCompletionMessages(
	events: EventBus,
	source: TaskCompletionSource,
	completionId: string,
): Promise<void> {
	const request = {
		runId: source.runId,
		terminalId: completionId,
		terminalAt: Date.now(),
		source: "owner-task" as const,
		sourceSessionTargets: [source.intercomTarget],
		completion: undefined as Promise<void> | undefined,
	};
	Object.defineProperty(request, "terminalOwner", { value: events });
	// The event bus invokes listeners synchronously but does not await them.
	// A claiming listener publishes its completion promise before returning.
	events.emit(SUBAGENT_TERMINAL_ORDERING_BARRIER_EVENT, request);
	await request.completion;
}
