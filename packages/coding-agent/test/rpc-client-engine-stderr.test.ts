import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ENV_AGENT_DIR, getEngineStderrLogPath } from "../src/config.ts";
import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

const ZLIB_LINE = "zlib error: incorrect header check";
const tempDirs: string[] = [];

/**
 * The log write is the only observable the engine branch produces, so the test
 * taps it directly rather than polling the filesystem on a clock. The real
 * writer still runs: the assertion reads the file it produced.
 */
const hooks = vi.hoisted(() => ({ onEngineStderrLog: (_data: string): void => {} }));

vi.mock("../src/modes/rpc/rpc-client-process.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/modes/rpc/rpc-client-process.ts")>();
	return {
		...actual,
		writeEngineStderrLog: (data: Buffer | string) => {
			actual.writeEngineStderrLog(data);
			hooks.onEngineStderrLog(String(data));
		},
	};
});

function tempDirectory(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

/** A child that satisfies the engine readiness handshake, then emits the offending line. */
function writeChildScript(): string {
	const path = join(tempDirectory("atomic-rpc-engine-stderr-"), "child.mjs");
	writeFileSync(
		path,
		`process.stdout.write(JSON.stringify({ type: "engine_ready", protocolVersion: 4, pid: process.pid }) + "\\n");\n` +
			`process.stderr.write(${JSON.stringify(`${ZLIB_LINE}\n`)});\n` +
			`process.stdin.resume();\n`,
	);
	return path;
}

let loggedLine: PromiseWithResolvers<void>;
let echoedLine: PromiseWithResolvers<void>;
let stderrWrites: string[];

beforeEach(() => {
	vi.stubEnv(ENV_AGENT_DIR, tempDirectory("atomic-agent-dir-"));
	loggedLine = Promise.withResolvers<void>();
	echoedLine = Promise.withResolvers<void>();
	stderrWrites = [];

	hooks.onEngineStderrLog = (data) => {
		if (data.includes("zlib")) loggedLine.resolve();
	};
	vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
		stderrWrites.push(String(chunk));
		if (String(chunk).includes("zlib")) echoedLine.resolve();
		return true;
	});
});

afterEach(() => {
	hooks.onEngineStderrLog = () => {};
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("RpcClient engine stderr routing", () => {
	test("logs engine-child stderr instead of blitting it onto the host terminal", async () => {
		const client = new RpcClient({
			cliPath: writeChildScript(),
			interactiveEngine: { onDiagnostic: () => {} },
		});

		try {
			await client.start();
			await loggedLine.promise;

			expect(readFileSync(getEngineStderrLogPath(), "utf8")).toContain(ZLIB_LINE);
			expect(stderrWrites.filter((chunk) => chunk.includes("zlib"))).toEqual([]);
		} finally {
			await client.stop();
		}
	});

	test("keeps the terminal passthrough for a plain RPC client that owns no screen", async () => {
		const client = new RpcClient({ cliPath: writeChildScript() });

		try {
			await client.start();
			await echoedLine.promise;

			expect(stderrWrites.some((chunk) => chunk.includes(ZLIB_LINE))).toBe(true);
			expect(existsSync(getEngineStderrLogPath())).toBe(false);
		} finally {
			await client.stop();
		}
	});
});
