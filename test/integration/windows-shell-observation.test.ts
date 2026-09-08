import assert from "node:assert/strict";
import { test } from "vitest";
import { TaskSupervisor } from "../../packages/coding-agent/src/core/tasks/supervisor.js";
import { createLocalBashOperations } from "../../packages/coding-agent/src/core/tools/bash.js";
import { createLocalPowerShellOperations } from "../../packages/coding-agent/src/core/tools/powershell.js";

function owner() {
	const supervisor = new TaskSupervisor();
	const scope = { kind: "session" as const, sessionId: crypto.randomUUID() };
	const host = supervisor.bindHostSession({
		scope,
		tasks: { wait: { kind: "automatic", commandBudgetMs: 0 } },
		authorizeLaunch() {},
		createRunner() {
			throw new Error("shell tests must not launch an agent");
		},
	});
	const opened = supervisor.openTaskOwner(host, scope);
	assert.ok(opened.ok);
	return { supervisor, owner: opened.value };
}

// Windows shell support following PR #2934: observation never transfers ownership.
for (const shell of ["bash", "powershell"] as const) {
	test.runIf(process.platform === "win32")(
		`${shell} yields its Windows command and retains the same live task`,
		async () => {
			const binding = owner();
			try {
				const operations =
					shell === "bash"
						? createLocalBashOperations({ taskOwner: binding })
						: createLocalPowerShellOperations({ taskOwner: binding });
				const result = await operations.exec(
					shell === "bash" ? "printf ready; sleep 30" : "Write-Output ready; Start-Sleep -Seconds 30",
					process.cwd(),
					{ timeout: 60, onData() {} },
				);
				assert.equal(result.exitCode, null);
				assert.equal(result.observation?.kind, "yielded");
				if (result.observation?.kind !== "yielded") throw new Error("missing observation");
				assert.equal(result.observation.reason, "elapsed");
				const watch = binding.supervisor.watchOwnerTasks(binding.owner);
				assert.ok(watch.ok);
				try {
					assert.equal(watch.value.snapshot.tasks.length, 1);
					const task = watch.value.snapshot.tasks[0];
					assert.equal(task.ref.taskId, result.observation.taskId);
					assert.equal(task.execution.kind, "running");
					assert.deepEqual(task.observation, { kind: "background", reason: "elapsed" });
				} finally {
					watch.value.dispose();
				}
			} finally {
				const closed = await binding.supervisor.closeTaskOwner(binding.owner, "session-close");
				assert.ok(closed.ok, JSON.stringify(closed));
				for (const task of closed.value.tasks) assert.equal(task.cleanup.kind, "reaped");
			}
		},
	);
	for (const pty of [false, true]) {
		test.runIf(process.platform === "win32")(
			`${shell} ${pty ? "PTY" : "pipe"} preserves command text and terminal output`,
			async () => {
				const binding = owner();
				const chunks: Buffer[] = [];
				try {
					const operations =
						shell === "bash"
							? createLocalBashOperations({ taskOwner: binding })
							: createLocalPowerShellOperations({ taskOwner: binding });
					const literal = 'héllo %PATH% & | < > ^ ! $ " quote';
					const command =
						shell === "bash"
							? `printf '%s\\n' '${literal}'; printf '%s\\n' "$ATOMIC_SHELL_TEST" "$ATOMIC_SHELL_REMOVE"; exit 7`
							: `Write-Output '${literal}'; Write-Output $env:ATOMIC_SHELL_TEST; Write-Output $env:ATOMIC_SHELL_REMOVE; exit 7`;
					const result = await operations.exec(command, process.cwd(), {
						pty,
						wait: { kind: "foreground", budgetMs: 15000 },
						timeout: 20,
						env: {
							...process.env,
							Atomic_Shell_Test: "superseded-value",
							ATOMIC_SHELL_TEST: "environment-retained",
							ATOMIC_SHELL_REMOVE: "must-not-leak",
							atomic_shell_remove: undefined,
						},
						onData: (chunk) => chunks.push(chunk),
					});
					assert.equal(result.exitCode, 7, JSON.stringify(result));
					const output = Buffer.concat(chunks).toString("utf8");
					assert.ok(output.includes(literal), output);
					assert.ok(output.includes("environment-retained"), output);
					assert.ok(!output.includes("must-not-leak"), output);
					assert.ok(!output.includes("superseded-value"), output);
				} finally {
					const closed = await binding.supervisor.closeTaskOwner(binding.owner, "session-close");
					assert.ok(closed.ok, JSON.stringify(closed));
					for (const task of closed.value.tasks) assert.equal(task.cleanup.kind, "reaped");
				}
			},
		);
	}
}
