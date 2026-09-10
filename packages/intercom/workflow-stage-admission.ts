import type { ExtensionContext } from "@bastani/atomic";

export type WorkflowStageFirstRefusalDisposition = "delivered" | "unclaimed" | "abandoned";
export type WorkflowStageAdmissionBarrier = () => Promise<void>;

/**
 * boundary rather than Intercom's idle queue. A busy-stage delivery enters that
 * boundary synchronously, then waits inside it while the exact foreground
 * subagent owner receives first refusal. This prevents terminal close from
 * sealing the generation during the detach handshake and dropping the message.
 */
export function admitWorkflowStageInbound(
	ctx: Pick<ExtensionContext, "orchestrationContext"> & Partial<Pick<ExtensionContext, "isIdle">>,
	deliver: (admissionBarrier?: WorkflowStageAdmissionBarrier) => void | Promise<void>,
	firstRefusal?: () => Promise<WorkflowStageFirstRefusalDisposition>,
	onAdmissionFailure?: (error: Error) => Promise<void>,
): false | Promise<void> {
	if (ctx.orchestrationContext?.kind !== "workflow-stage") return false;
	const boundary = ctx.orchestrationContext.messageAdmission?.boundary;
	// Reserve the whole producer operation, not each SDK attempt: retry delays
	// must retain FIFO ownership. Late delivery still uses the SDK's late router.
	const run = (barrier?: WorkflowStageAdmissionBarrier): Promise<void> =>
		boundary?.runMessageDelivery(() => deliver(barrier), () => deliver(), true) ?? Promise.resolve(deliver(barrier));
	try {
		let busy = false;
		try {
			busy = ctx.isIdle?.() === false;
		} catch {
			// A retiring context is handled by the generation check in delivery.
		}
		if (!busy || !firstRefusal) return run();
		let firstRefusalPromise: Promise<void> | undefined;
		const admissionBarrier: WorkflowStageAdmissionBarrier = () => {
			firstRefusalPromise ??= (async () => {
				const disposition = await firstRefusal();
				if (disposition === "abandoned") {
					const failure = new Error("Workflow stage retired during foreground-owner admission");
					await onAdmissionFailure?.(failure);
					throw failure;
				}
			})();
			return firstRefusalPromise;
		};
		return run(admissionBarrier);
	} catch (error) {
		return Promise.reject(error);
	}
}
