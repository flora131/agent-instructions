import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HerdrEnvironment } from "../../src/extensions/herdr/environment.js";

export interface HerdrCall {
	phase: "start" | "end";
	args: string[];
	socket: string;
}

// A disposable executable records its own lifetime, not just spawn requests.
export async function fakeHerdr(body = "finish();") {
	const dir = await mkdtemp(join(tmpdir(), "atomic-herdr-"));
	const log = join(dir, "calls.jsonl");
	const script = join(dir, "fake.cjs");
	const bin = process.platform === "win32" ? join(dir, "fake.exe") : script;
	const previousNodeOptions = process.env.NODE_OPTIONS;
	await writeFile(log, "");
	await writeFile(
		script,
		`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(${process.platform === "win32" ? 1 : 2});
const record = phase => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({phase, args, socket: process.env.HERDR_SOCKET_PATH}) + "\\n");
const finish = (code = 0) => { record("end"); process.exit(code); };
record("start");
${body}
`,
	);
	if (process.platform === "win32") {
		await copyFile(process.execPath, bin);
		process.env.NODE_OPTIONS = `--require ${JSON.stringify(script)}`;
	} else await chmod(script, 0o755);
	const environment: HerdrEnvironment = { bin, paneId: dir, socketPath: " socket path " };
	const env = { HERDR_ENV: "1", HERDR_BIN_PATH: bin, HERDR_PANE_ID: dir, HERDR_SOCKET_PATH: environment.socketPath };
	async function calls(): Promise<HerdrCall[]> {
		return (await readFile(log, "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	}
	return {
		dir,
		bin,
		env,
		environment,
		calls,
		async waitFor(count: number) {
			const deadline = Date.now() + 5_000;
			while (Date.now() < deadline) {
				const entries = (await calls()).filter((call) => call.phase === "end");
				if (entries.length >= count) return entries;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			assert.fail(`Expected ${count} completed fake Herdr calls: ${JSON.stringify(await calls())}`);
		},
		async dispose() {
			if (process.platform === "win32") {
				if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
				else process.env.NODE_OPTIONS = previousNodeOptions;
			}
			await rm(dir, { recursive: true, force: true });
		},
	};
}

export function arg(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index < 0 ? undefined : args[index + 1];
}
