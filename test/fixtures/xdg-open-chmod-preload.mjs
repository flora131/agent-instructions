// Test-only observation of the real build. Bun's syncBuiltinESMExports does not
// update named fs imports, so replace that export while forwarding every call.
import fs from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "bun:test";

const originalChmodSync = fs.chmodSync;
const logPath = process.env.ATOMIC_TEST_CHMOD_LOG;
if (!logPath) throw new Error("Missing chmod observation log");

function chmodSync(path, mode) {
	originalChmodSync(path, mode);
	const requestedPath = resolve(path instanceof URL ? fileURLToPath(path) : String(path));
	const requestedMode = typeof mode === "string" ? Number.parseInt(mode, 8) : mode;
	fs.appendFileSync(logPath, `${JSON.stringify({ path: requestedPath, mode: requestedMode })}\n`);
}

mock.module("node:fs", () => ({ ...fs, chmodSync, default: { ...fs, chmodSync } }));
