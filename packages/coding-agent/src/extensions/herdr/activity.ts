import type {
	WorkflowActivityReason,
	WorkflowActivityState,
	WorkflowRootActivity,
} from "../../core/extensions/workflow-events.js";

export interface SessionActivity {
	state: WorkflowActivityState;
	reason: WorkflowActivityReason;
	message?: "Waiting for approval" | "Workflow needs attention";
}

export interface SessionActivityInput {
	agentRunning: boolean;
	openPromptCount: number;
	roots: readonly WorkflowRootActivity[];
	availability: "ready" | "recovering" | "unavailable";
}

export function deriveSessionActivity(input: SessionActivityInput): SessionActivity | undefined {
	const working = input.roots.find((root) => root.state === "working");
	const attention = input.roots.some((root) => root.needsAttention || root.state === "blocked");
	if (working || (input.agentRunning && input.openPromptCount === 0)) {
		return {
			state: "working",
			reason: working?.reason ?? "executing",
			...(attention ? { message: "Workflow needs attention" as const } : {}),
		};
	}
	if (input.openPromptCount > 0)
		return { state: "blocked", reason: "awaiting_input", message: "Waiting for approval" };
	const blocked = input.roots.find((root) => root.state === "blocked");
	if (blocked) return { state: "blocked", reason: blocked.reason, message: "Workflow needs attention" };
	if (input.availability !== "ready") return undefined;
	return {
		state: "idle",
		reason: input.roots.some((root) => root.reason === "paused") ? "paused" : "quiescent",
		...(attention ? { message: "Workflow needs attention" as const } : {}),
	};
}
