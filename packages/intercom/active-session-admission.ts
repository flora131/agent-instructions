import type { ExtensionContext } from "@bastani/atomic";
import {
	admitWorkflowStageInbound,
	type WorkflowStageAdmissionBarrier,
	type WorkflowStageFirstRefusalDisposition,
} from "./workflow-stage-admission.js";

/** Active child delivery uses native steering, never the unrelated headless idle/refusal path. */
export function admitActiveSessionInbound(
	ctx: Pick<ExtensionContext, "orchestrationContext" | "subagentPolicy"> & Partial<Pick<ExtensionContext, "isIdle">>,
	deliver: (admissionBarrier?: WorkflowStageAdmissionBarrier) => void | Promise<void>,
	firstRefusal?: () => Promise<WorkflowStageFirstRefusalDisposition>,
	onAdmissionFailure?: (error: Error) => Promise<void>,
): false | Promise<void> {
	const executionEnded = ctx.subagentPolicy?.executionEnded;
	if (executionEnded !== undefined) {
		if (executionEnded.aborted || ctx.subagentPolicy?.messageAdmission?.isOpen() === false) {
			return Promise.reject(new Error("Subagent execution is terminal and cannot accept messages"));
		}
		try {
			return Promise.resolve(deliver());
		} catch (error) {
			return Promise.reject(error);
		}
	}
	return admitWorkflowStageInbound(ctx, deliver, firstRefusal, onAdmissionFailure);
}
