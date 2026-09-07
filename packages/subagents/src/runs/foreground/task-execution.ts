import type { AgentTaskHost, OperationId, WaitPolicy } from "@bastani/atomic";
import type {
	Cleanup,
	ModelSingleResponse,
	Result,
	TaskResult,
	WaitOutcome,
	YieldError,
	YieldReason,
} from "../../../../coding-agent/src/core/tasks/contracts.js";
import type { AgentConfig } from "../../agents/agents.js";
import type { RunSyncOptions, SingleResult, SubagentToolResult } from "../../shared/types.js";
import { getSingleResultOutput } from "../../shared/utils.js";
import type { SubagentExecutorRuntimeDeps } from "./subagent-executor-types.js";

export function taskToolResult(response: ModelSingleResponse): SubagentToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(response) }],
		details: { mode: "single", results: [], taskResponse: response },
		...(response.kind === "unstarted" ? { isError: true } : {}),
	};
}

/** Bind the real foreground runner once; only its registered observation may yield. */
export async function runAgentTask(input: {
	host: AgentTaskHost;
	cwd: string;
	agents: AgentConfig[];
	agent: string;
	task: string;
	intentTask?: string;
	options: RunSyncOptions;
	wait?: WaitPolicy;
	runtime: SubagentExecutorRuntimeDeps;
	onTerminal?: (result: SingleResult) => void;
	schedule?: (dispatch: () => Promise<void>) => void;
	outputText?: (result: SingleResult) => string;
}): Promise<ModelSingleResponse> {
	let yieldWait: ((reason: YieldReason) => Result<WaitOutcome, YieldError>) | undefined;
	let pendingYield = false;
	const registered = Promise.withResolvers<void>();
	const started = await input.host.startAgentTask(
		{ kind: "agent", agent: input.agent, task: input.intentTask ?? input.task, cwd: input.options.cwd ?? input.cwd },
		`${input.options.runId}:${input.options.index ?? 0}` as OperationId,
		(context) => {
			const cleaned = Promise.withResolvers<Cleanup>();
			let executionBound = false;
			const result = registered.promise.then(async (): Promise<TaskResult> => {
				try {
					const child = await input.runtime.runSync(input.cwd, input.agents, input.agent, input.task, {
						...input.options,
						signal: context.signal,
						taskExecution: {
							signal: context.signal,
							reportActivity: context.reportActivity,
							onExecution: (execution) => {
								executionBound = true;
								void execution.cleanup.then(cleaned.resolve, (error) =>
									cleaned.resolve({
										kind: "failed",
										resources: [{ resource: "agent-session", code: "CleanupFailed", message: String(error) }],
									}),
								);
							},
							yieldTaskWait: () => {
								if (yieldWait) yieldWait("intercom-coordination");
								else pendingYield = true;
							},
						},
					});
					input.onTerminal?.(child);
					const text = input.outputText?.(child) ?? getSingleResultOutput(child);
					const bytes = Buffer.from(text);
					context.reportActivity({
						reportId: "terminal-output",
						change: { kind: "output", offset: "0", bytesBase64: bytes.toString("base64") },
					});
					const output = {
						ownerId: context.ref.ownerId,
						taskId: context.ref.taskId,
						artifactId: `output:${context.ref.taskId}`,
						byteCount: String(bytes.length),
						omittedRanges: [],
					};
					if (child.interrupted)
						return {
							kind: "cancelled",
							cause: input.options.interruptSignal?.aborted ? "parent-handoff" : "owner-close",
							output,
						};
					return child.status === "ok"
						? { kind: "completed", output }
						: {
								kind: "failed",
								code: "AgentFailed",
								message: child.error ?? child.envelope ?? "Agent failed",
								output,
							};
				} finally {
					// A refusal before session admission has no session resources to reap.
					if (!executionBound) cleaned.resolve({ kind: "reaped" });
				}
			});
			return { result, cleanup: cleaned.promise };
		},
		input.schedule,
	);
	if (!started.ok) return { kind: "unstarted", reason: { kind: "rejected", error: started.error } };
	const observation = input.host.observeAgentLaunch(started.value.taskId, input.wait, (yieldRegistered) => {
		yieldWait = yieldRegistered;
		if (pendingYield) yieldRegistered("intercom-coordination");
		registered.resolve();
	});
	registered.resolve();
	const observed = await observation;
	if (!observed.ok) throw new Error(`${observed.error.code}: ${observed.error.message}`);
	return { kind: "admitted", observation: observed.value };
}
