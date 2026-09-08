import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test, vi } from "vitest";
import type { AgentSession } from "../../packages/coding-agent/src/core/agent-session.js";
import type { AgentTaskHost } from "../../packages/coding-agent/src/core/tasks/agent-adapter.js";
import type { OperationId, TaskResult } from "../../packages/coding-agent/src/core/tasks/contracts.js";
import type { TaskLease, TaskSupervisor } from "../../packages/coding-agent/src/core/tasks/supervisor.js";
import { WorkflowStageAdmissionBoundary } from "../../packages/coding-agent/src/core/workflow-stage-admission.js";
import { createHarness } from "../../packages/coding-agent/test/suite/harness.js";
import { createStageSkillFixture } from "../fixtures/stage-chat-skill-session.js";

type StageGenerationSession = AgentSession & { closeWorkflowStageGeneration(): Promise<void> };

function quote(text: string): string {
	return `'${text.replaceAll("'", "'\\''")}'`;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitPid(path: string): Promise<number> {
	let pid = 0;
	await vi.waitFor(() => {
		try {
			pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
		} catch {
			pid = 0;
		}
		assert.ok(Number.isInteger(pid) && pid > 0 && alive(pid));
	});
	return pid;
}

function bindStageAdmission(session: AgentSession, runId: string, stageId: string): WorkflowStageAdmissionBoundary {
	const boundary = new WorkflowStageAdmissionBoundary();
	const internal = session as AgentSession & { _workflowStageAdmission?: WorkflowStageAdmissionBoundary };
	internal._workflowStageAdmission = boundary;
	boundary.bindTaskIdentity(session.sessionManager.getSessionId(), runId, stageId);
	return boundary;
}

function listenForOwnerClose(context: { signal: AbortSignal }, result: PromiseWithResolvers<TaskResult>): void {
	const stop = () => result.resolve({ kind: "cancelled", cause: "owner-close" });
	if (context.signal.aborted) stop();
	else context.signal.addEventListener("abort", stop, { once: true });
}

async function startBackgroundShell(session: AgentSession, command: string, description: string) {
	const host = session.getAgentTaskHost();
	const { supervisor, owner } = host.ownerBinding;
	const started = await supervisor.startCommandTask(
		owner,
		{
			kind: "command",
			command,
			description,
			terminal: { kind: "pipe" },
			executionTimeoutMs: 15000,
		},
		randomUUID() as OperationId,
	);
	assert.ok(started.ok);
	const observation = await supervisor.initialObservation(started.value, { kind: "background" });
	assert.ok(observation.ok && observation.value.kind === "yielded");
	return { host, supervisor, lease: started.value, taskId: observation.value.taskId };
}

async function completeShell(supervisor: TaskSupervisor, lease: TaskLease): Promise<TaskResult> {
	const stdin = supervisor.taskStdin(lease);
	assert.ok(stdin.ok);
	assert.ok(
		(
			await supervisor.writeTaskInput(stdin.value, randomUUID() as OperationId, {
				kind: "bytes",
				bytes: Buffer.from("go\n"),
			})
		).ok,
	);
	const settled = await supervisor.waitForTask(lease);
	assert.ok(settled.ok && settled.value.kind === "settled");
	return settled.value.result;
}

function executionKind(host: AgentTaskHost, taskId: string) {
	const watched = host.watchOwnerTasks();
	assert.ok(watched.ok);
	try {
		return watched.value.snapshot.tasks.find((task) => task.ref.taskId === taskId)?.execution.kind;
	} finally {
		watched.value.dispose();
	}
}

test.runIf(process.platform !== "win32")(
	"main chat pause leaves a background shell and agent running with the same identities",
	async () => {
		const harness = await createHarness();
		const pidFile = join(harness.tempDir, "paused-shell.pid");
		const agentResult = Promise.withResolvers<TaskResult>();
		const host = harness.session.getAgentTaskHost();
		try {
			const shell = await startBackgroundShell(
				harness.session,
				`printf $$ > ${quote(pidFile)}; read value; printf 'MAIN PAUSE SURVIVED\\n'`,
				"Main pause shell",
			);
			const pid = await waitPid(pidFile);
			const agent = await host.startAgentTask(
				{ kind: "agent", agent: "worker", task: "Main pause agent" },
				randomUUID() as OperationId,
				(context) => {
					listenForOwnerClose(context, agentResult);
					return { result: agentResult.promise, cleanup: Promise.resolve({ kind: "reaped" as const }) };
				},
			);
			assert.ok(agent.ok);
			assert.ok((await host.observeAgentLaunch(agent.value.taskId, { kind: "background" })).ok);
			harness.session.pauseQueuedMessages();
			await harness.session.abort();
			assert.equal(harness.session.queuedMessagesPaused, true);
			assert.equal(alive(pid), true, "paused main chat must not kill the background shell");
			assert.equal(executionKind(host, shell.taskId), "running");
			assert.equal(executionKind(host, agent.value.taskId), "running");
			const result = await completeShell(shell.supervisor, shell.lease);
			assert.equal(result.kind, "completed");
			assert.equal(alive(pid), false);
			const output = host.ownerBinding.supervisor.taskReference(shell.lease);
			agentResult.resolve({
				kind: "completed",
				output: {
					ownerId: output.ownerId,
					taskId: agent.value.taskId,
					artifactId: "result",
					byteCount: "0",
					omittedRanges: [],
				},
			});
			const agentWait = await host.waitForTask(agent.value.taskId);
			assert.ok(agentWait.ok && agentWait.value.kind === "settled");
			assert.equal(agentWait.value.taskId, agent.value.taskId);
			await harness.session.resumeQueuedMessages();
			await harness.session.agent.waitForIdle();
			assert.equal(host.resolveTask(shell.taskId).ok, true);
			assert.equal(host.resolveTask(agent.value.taskId).ok, true);
			assert.equal(executionKind(host, shell.taskId), "settled");
			assert.equal(executionKind(host, agent.value.taskId), "settled");
		} finally {
			agentResult.resolve({ kind: "cancelled", cause: "user" });
			await host.close("session-close");
			// Resume leaves an unconsumed protected model turn. That is teardown, not
			// generation close; dispose while still paused is covered separately.
			harness.faux.unregister();
			rmSync(harness.tempDir, { recursive: true, force: true });
		}
	},
);

test.runIf(process.platform !== "win32")(
	"paused stage generation close cancels remaining owned work and disposes without resume",
	async () => {
		const fixture = await createStageSkillFixture();
		const sibling = await createStageSkillFixture();
		bindStageAdmission(fixture.stage.session, fixture.runId, fixture.stageId);
		bindStageAdmission(sibling.stage.session, sibling.runId, sibling.stageId);
		const pidFile = join(fixture.directory, "paused-complete.pid");
		const siblingPidFile = join(sibling.directory, "paused-complete-sibling.pid");
		try {
			const shell = await startBackgroundShell(
				fixture.stage.session,
				`printf $$ > ${quote(pidFile)}; read value; printf 'SHOULD BE CANCELLED\\n'`,
				"Paused stage remaining shell",
			);
			const siblingShell = await startBackgroundShell(
				sibling.stage.session,
				`printf $$ > ${quote(siblingPidFile)}; read value; printf 'SIBLING STAYS\\n'`,
				"Sibling remaining shell",
			);
			const pid = await waitPid(pidFile);
			const siblingPid = await waitPid(siblingPidFile);
			await fixture.handle.pause();
			assert.equal(fixture.stage.session.queuedMessagesPaused, true);
			assert.equal(alive(pid), true);
			const waiting = shell.supervisor.waitForTask(shell.lease);
			await (fixture.stage.session as StageGenerationSession).closeWorkflowStageGeneration();
			const settled = await waiting;
			assert.ok(settled.ok && settled.value.kind === "settled", JSON.stringify(settled));
			assert.equal(settled.value.result.kind, "cancelled");
			assert.equal(settled.value.result.kind === "cancelled" && settled.value.result.cause, "owner-close");
			await vi.waitFor(() => assert.equal(alive(pid), false));
			assert.equal(executionKind(siblingShell.host, siblingShell.taskId), "running");
			assert.equal(alive(siblingPid), true, "paused stage completion must not cancel a sibling");
			assert.equal(fixture.stage.session.queuedMessagesPaused, true, "generation close must not require resume");
			fixture.stage.session.dispose();
		} finally {
			await fixture.cleanup();
			await sibling.cleanup();
		}
	},
);

test.runIf(process.platform !== "win32")(
	"main chat dispose while still paused after a background completion does not require resume",
	async () => {
		const harness = await createHarness();
		const pidFile = join(harness.tempDir, "paused-dispose.pid");
		const host = harness.session.getAgentTaskHost();
		try {
			const shell = await startBackgroundShell(
				harness.session,
				`printf $$ > ${quote(pidFile)}; read value; printf 'PAUSED COMPLETE\\n'`,
				"Paused main completion",
			);
			await waitPid(pidFile);
			harness.session.pauseQueuedMessages();
			await harness.session.abort();
			const result = await completeShell(shell.supervisor, shell.lease);
			assert.equal(result.kind, "completed");
			assert.equal(harness.session.queuedMessagesPaused, true);
			await host.close("session-close");
			harness.session.dispose();
		} finally {
			harness.faux.unregister();
			rmSync(harness.tempDir, { recursive: true, force: true });
		}
	},
);

test.runIf(process.platform !== "win32")(
	"workflow-node pause leaves background work running and stage completion cancels only that owner",
	async () => {
		const fixture = await createStageSkillFixture();
		const sibling = await createStageSkillFixture();
		bindStageAdmission(fixture.stage.session, fixture.runId, fixture.stageId);
		bindStageAdmission(sibling.stage.session, sibling.runId, sibling.stageId);
		const pidFile = join(fixture.directory, "stage-paused-shell.pid");
		const siblingPidFile = join(sibling.directory, "sibling-shell.pid");
		try {
			const shell = await startBackgroundShell(
				fixture.stage.session,
				`printf $$ > ${quote(pidFile)}; read value; printf 'STAGE PAUSE SURVIVED\\n'`,
				"Stage pause shell",
			);
			const siblingShell = await startBackgroundShell(
				sibling.stage.session,
				`printf $$ > ${quote(siblingPidFile)}; read value; printf 'SIBLING SURVIVED\\n'`,
				"Sibling stage shell",
			);
			const pid = await waitPid(pidFile);
			const siblingPid = await waitPid(siblingPidFile);
			await fixture.handle.pause();
			assert.equal(alive(pid), true, "stage pause must not kill owned background shells");
			assert.equal(alive(siblingPid), true);
			assert.equal(executionKind(shell.host, shell.taskId), "running");
			const result = await completeShell(shell.supervisor, shell.lease);
			assert.equal(result.kind, "completed");
			assert.equal(shell.host.resolveTask(shell.taskId).ok, true);
			await fixture.handle.resume();
			assert.equal(alive(siblingPid), true);
			await (fixture.stage.session as StageGenerationSession).closeWorkflowStageGeneration();
			assert.equal(executionKind(siblingShell.host, siblingShell.taskId), "running");
			assert.equal(alive(siblingPid), true, "completing one stage must not cancel a sibling stage owner");
			const siblingWait = siblingShell.supervisor.waitForTask(siblingShell.lease);
			await (sibling.stage.session as StageGenerationSession).closeWorkflowStageGeneration();
			const siblingResult = await siblingWait;
			assert.ok(siblingResult.ok && siblingResult.value.kind === "settled", JSON.stringify(siblingResult));
			assert.equal(siblingResult.value.result.kind, "cancelled");
			assert.equal(
				siblingResult.value.result.kind === "cancelled" && siblingResult.value.result.cause,
				"owner-close",
			);
			await vi.waitFor(() => assert.equal(alive(siblingPid), false));
		} finally {
			await fixture.cleanup();
			await sibling.cleanup();
		}
	},
);

test("closing one workflow-stage admission cancels only that owner's remaining tasks", async () => {
	const first = new WorkflowStageAdmissionBoundary();
	const second = new WorkflowStageAdmissionBoundary();
	first.bindTaskIdentity("session-a", "run-a", "stage-a");
	second.bindTaskIdentity("session-b", "run-b", "stage-b");
	const hostA = first.bindAgentTaskHost({ authorizeLaunch() {} });
	const hostB = second.bindAgentTaskHost({ authorizeLaunch() {} });
	const resultA = Promise.withResolvers<TaskResult>();
	const resultB = Promise.withResolvers<TaskResult>();
	try {
		const startedA = await hostA.startAgentTask(
			{ kind: "agent", agent: "worker", task: "Stage A" },
			randomUUID() as OperationId,
			(context) => {
				listenForOwnerClose(context, resultA);
				return { result: resultA.promise, cleanup: Promise.resolve({ kind: "reaped" as const }) };
			},
		);
		const startedB = await hostB.startAgentTask(
			{ kind: "agent", agent: "worker", task: "Stage B" },
			randomUUID() as OperationId,
			(context) => {
				listenForOwnerClose(context, resultB);
				return { result: resultB.promise, cleanup: Promise.resolve({ kind: "reaped" as const }) };
			},
		);
		assert.ok(startedA.ok && startedB.ok);
		assert.ok((await hostA.observeAgentLaunch(startedA.value.taskId, { kind: "background" })).ok);
		assert.ok((await hostB.observeAgentLaunch(startedB.value.taskId, { kind: "background" })).ok);
		const waitingA = hostA.waitForTask(startedA.value.taskId);
		await first.close();
		const closedA = await waitingA;
		assert.ok(closedA.ok && closedA.value.kind === "settled", JSON.stringify(closedA));
		assert.equal(closedA.value.result.kind, "cancelled");
		assert.equal(closedA.value.result.kind === "cancelled" && closedA.value.result.cause, "owner-close");
		assert.equal(executionKind(hostB, startedB.value.taskId), "running");
		resultB.resolve({
			kind: "completed",
			output: {
				ownerId: hostB.ownerBinding.supervisor.taskReference(startedB.value.lease).ownerId,
				taskId: startedB.value.taskId,
				artifactId: "result",
				byteCount: "0",
				omittedRanges: [],
			},
		});
		const finishedB = await hostB.waitForTask(startedB.value.taskId);
		assert.ok(finishedB.ok && finishedB.value.kind === "settled");
		assert.equal(finishedB.value.result.kind, "completed");
		assert.equal(finishedB.value.taskId, startedB.value.taskId);
	} finally {
		resultA.resolve({ kind: "cancelled", cause: "user" });
		resultB.resolve({ kind: "cancelled", cause: "user" });
		await second.close();
	}
});
