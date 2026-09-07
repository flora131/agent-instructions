import { execFile } from "node:child_process";
import type { HerdrEnvironment } from "./environment.js";

export interface HerdrDiagnostic {
	kind: "spawn_failed" | "timeout" | "protocol_rejected" | "stale_owner" | "unsupported";
	owner?: string;
}

export const HERDR_TIMEOUT_MS = 5_000;

export function executeHerdr(
	environment: HerdrEnvironment,
	argv: string[],
	timeoutMs = HERDR_TIMEOUT_MS,
): Promise<HerdrDiagnostic | undefined> {
	return new Promise((resolve) => {
		try {
			execFile(
				environment.bin,
				argv,
				{
					env: { ...process.env, HERDR_SOCKET_PATH: environment.socketPath },
					timeout: timeoutMs,
					killSignal: "SIGKILL",
					maxBuffer: 64 * 1024,
					windowsHide: true,
				},
				(error) => {
					if (!error) resolve(undefined);
					else if (error.killed) resolve({ kind: "timeout" });
					else if (typeof error.code === "string" && error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
						resolve({ kind: "spawn_failed" });
					else resolve({ kind: "protocol_rejected" });
				},
			);
		} catch {
			resolve({ kind: "spawn_failed" });
		}
	});
}
