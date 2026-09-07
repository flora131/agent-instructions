import { setTimeout as poll } from "node:timers/promises";
import { createChildProcessEnvironment } from "../../utils/child-process.ts";
import { createModuleRequire } from "../../utils/module-require.ts";
import { getShellConfig, getShellEnv } from "../../utils/shell.ts";
import { COMMAND_FOREGROUND_BUDGET_MS } from "../tasks/command-output.js";
import type { OperationId, WaitOutcome } from "../tasks/contracts.js";
import type { OwnerLease, TaskSupervisor } from "../tasks/supervisor.js";

const NATIVE_PACKAGE = "@bastani/atomic-natives";

interface NativePtyRunResult {
	exitCode?: number;
	exit_code?: number;
	cancelled?: boolean;
	timedOut?: boolean;
	timed_out?: boolean;
}

interface NativePtySession {
	start(
		options: {
			command: string;
			cwd?: string;
			env?: Record<string, string>;
			timeoutMs?: number;
			cols?: number;
			rows?: number;
			shell?: string;
			shellArgs?: string[];
			commandTransport?: "argv" | "stdin";
			closeStdinAfterCommand?: boolean;
		},
		onChunk?: (error: Error | null, chunk: string) => void,
	): Promise<NativePtyRunResult>;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): void;
}

interface NativePtyBinding {
	PtySession: new () => NativePtySession;
}

type NativeLoadResult = { ok: true; binding: NativePtyBinding } | { ok: false; error: Error };

let cachedLoadResult: NativeLoadResult | undefined;

export function resetNativePtyBindingCache(): void {
	cachedLoadResult = undefined;
}

function loadNativePtyBinding(): NativeLoadResult {
	if (cachedLoadResult) return cachedLoadResult;
	try {
		const loaded = createModuleRequire(import.meta.url)(NATIVE_PACKAGE) as Partial<NativePtyBinding>;
		if (typeof loaded.PtySession !== "function") {
			cachedLoadResult = { ok: false, error: new Error(`Native package ${NATIVE_PACKAGE} is missing PtySession.`) };
			return cachedLoadResult;
		}
		cachedLoadResult = { ok: true, binding: loaded as NativePtyBinding };
		return cachedLoadResult;
	} catch (error) {
		cachedLoadResult = {
			ok: false,
			error: new Error(
				`Native PTY package ${NATIVE_PACKAGE} is unavailable for ${process.platform}-${process.arch}: ${error instanceof Error ? error.message : String(error)}`,
			),
		};
		return cachedLoadResult;
	}
}

export interface SupervisedCommandOwner {
	supervisor: TaskSupervisor;
	owner: OwnerLease;
}
export interface SupervisedCommandResult {
	exitCode: number | null;
	observation?: WaitOutcome;
}

export async function executeSupervisedCommand(
	command: string,
	cwd: string,
	options: NativePtyExecOptions,
	pty: boolean,
): Promise<SupervisedCommandResult> {
	if (options.signal?.aborted) throw new Error("aborted");
	const context = options.taskOwner;
	if (!context) throw new Error("Supervised command requires its task owner");
	const shell = getShellConfig(options.shellPath);
	const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
	const invocation = [shell.shell, ...shell.args].map(quote).join(" ");
	const launch =
		shell.commandTransport === "stdin"
			? `printf %s ${quote(command)} | ${invocation}`
			: `exec ${invocation} ${quote(command)}`;
	const started = await context.supervisor.startCommandTask(
		context.owner,
		{
			kind: "command",
			command: launch,
			cwd,
			env: Object.fromEntries(
				Object.entries(
					createChildProcessEnvironment(pty ? { TERM: "xterm-256color" } : undefined, {
						...getShellEnv(),
						...(options.env ?? {}),
					}),
				).filter((entry): entry is [string, string] => entry[1] !== undefined),
			),
			terminal: pty ? { kind: "pty", columns: options.cols ?? 120, rows: options.rows ?? 40 } : { kind: "pipe" },
			...(options.timeout === undefined ? {} : { executionTimeoutMs: options.timeout * 1000 }),
		},
		crypto.randomUUID() as OperationId,
	);
	if (!started.ok) throw new Error(`${started.error.code}: ${started.error.message}`);
	const task = started.value;
	const abort = () => {
		void context.supervisor.cancelTask(task, "user");
	};
	options.signal?.addEventListener("abort", abort, { once: true });
	if (options.signal?.aborted) abort();
	let done = false;
	let offset = "0";
	const observation = context.supervisor.waitForTask(task, COMMAND_FOREGROUND_BUDGET_MS).finally(() => {
		done = true;
	});
	const drain = async () => {
		const page = await context.supervisor.readTaskOutput(task, { start: offset, maximumBytes: 8192 });
		if (!page.ok) throw new Error(page.error.message);
		for (const chunk of page.value.chunks) {
			options.onData(Buffer.from(chunk.bytes));
			offset = chunk.offsets.end;
		}
		if (page.value.nextOffset !== undefined) offset = page.value.nextOffset;
		return page.value.nextOffset !== undefined;
	};
	try {
		while (!done) {
			if (!(await drain())) await poll(10);
		}
		const result = await observation;
		if (!result.ok) throw new Error(result.error.message);
		if (result.value.kind === "yielded") {
			await drain();
			return { exitCode: null, observation: result.value };
		}
		while (await drain()) {
			/* Terminal output is finite; no live producer extends this drain. */
		}
		const terminal = result.value.result;
		if (terminal.kind === "cancelled")
			throw new Error(terminal.cause === "execution-timeout" ? `timeout:${options.timeout}` : "aborted");
		if (terminal.kind === "failed") throw new Error(`${terminal.code}: ${terminal.message}`);
		return { exitCode: terminal.exitCode ?? null };
	} finally {
		options.signal?.removeEventListener("abort", abort);
	}
}

export interface NativePtyExecOptions {
	onData: (data: Buffer) => void;
	signal?: AbortSignal;
	timeout?: number;
	env?: NodeJS.ProcessEnv;
	shellPath?: string;
	cols?: number;
	rows?: number;
	taskOwner?: SupervisedCommandOwner;
}

export async function executeNativePty(
	command: string,
	cwd: string,
	options: NativePtyExecOptions,
): Promise<SupervisedCommandResult> {
	if (options.taskOwner) return executeSupervisedCommand(command, cwd, options, true);
	const loaded = loadNativePtyBinding();
	if (!loaded.ok) throw loaded.error;
	if (options.signal?.aborted) throw new Error("aborted");
	const shellConfig = getShellConfig(options.shellPath);
	const session = new loaded.binding.PtySession();
	const onAbort = () => {
		try {
			session.kill();
		} catch {}
	};
	if (options.signal) options.signal.addEventListener("abort", onAbort, { once: true });
	try {
		const result = await session.start(
			{
				command,
				cwd,
				env: Object.fromEntries(
					Object.entries(
						createChildProcessEnvironment(
							{ TERM: "xterm-256color" },
							{ ...getShellEnv(), ...(options.env ?? {}) },
						),
					).filter((entry): entry is [string, string] => entry[1] !== undefined),
				),
				timeoutMs: options.timeout !== undefined ? Math.max(1, Math.floor(options.timeout * 1000)) : undefined,
				cols: options.cols ?? 120,
				rows: options.rows ?? 40,
				shell: shellConfig.shell,
				shellArgs: shellConfig.args,
				commandTransport: shellConfig.commandTransport,
				closeStdinAfterCommand: shellConfig.commandTransport === "stdin",
			},
			(_error, chunk) => {
				if (chunk) options.onData(Buffer.from(chunk));
			},
		);
		if (options.signal?.aborted || result.cancelled) throw new Error("aborted");
		if (result.timedOut ?? result.timed_out) throw new Error(`timeout:${options.timeout}`);
		return { exitCode: result.exitCode ?? result.exit_code ?? null };
	} finally {
		if (options.signal) options.signal.removeEventListener("abort", onAbort);
	}
}
