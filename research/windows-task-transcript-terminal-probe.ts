import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { startConpty } from "../scripts/perf/windows-startup/conpty.js";

const out = process.argv[2];
assert.ok(out, "provide an external evidence directory");
mkdirSync(out, { recursive: true });
const eventsPath = join(out, "events.jsonl");
writeFileSync(eventsPath, "");
writeFileSync(join(out, "terminal.ansi"), "");
interface Event {
	kind: string;
	at: number;
	text?: string;
	fullscreen?: boolean;
	picker?: boolean;
	count?: number;
	width?: number;
	rows?: number;
	renderMs?: number;
	eventMs?: number;
	listeners?: number;
	tty?: boolean[];
}
const events = (): Event[] =>
	readFileSync(eventsPath, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
const wait = async (predicate: (event: Event) => boolean, after = 0) => {
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		const found = events().slice(after).find(predicate);
		if (found) return found;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`barrier timed out: ${predicate}`);
};
const sources = [
	"packages/coding-agent/src/modes/interactive/components/task-live-transcript.ts",
	"test/fixtures/windows-task-transcript-terminal.ts",
	"research/windows-task-transcript-terminal-probe.ts",
];
const hash = () =>
	Object.fromEntries(sources.map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hash();
const metadata = {
	head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	sources: before,
	platform: process.platform,
	runtime: process.version,
	bun: Bun.version,
	backend: "atomic-natives PtySession Windows ConPTY; cmd.exe; Bun child",
	visibleWindow: false,
	mode: "local ChatSessionHost fixture; not isolated engine",
};
if (process.env.TASK_TERMINAL_BASELINE)
	writeFileSync(
		join(out, "baseline-control.json"),
		JSON.stringify(
			{
				path: process.env.TASK_TERMINAL_BASELINE,
				sha256: createHash("sha256").update(readFileSync(process.env.TASK_TERMINAL_BASELINE)).digest("hex"),
				note: "Only task-live-transcript.ts substituted via Bun preload onLoad; all other modules current checkout",
			},
			null,
			2,
		),
	);
writeFileSync(join(out, "metadata.json"), JSON.stringify(metadata, null, 2));
let bytes = 0;
let chunks = 0;
const env = Object.fromEntries(
	Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const child = startConpty({
	command: `bun --no-install --preload ./research/windows-task-transcript-baseline-preload.ts test/fixtures/windows-task-transcript-terminal.ts`,
	cwd: process.cwd(),
	env: { ...env, TASK_TERMINAL_EVENTS: eventsPath },
	timeoutMs: 180000,
	onChunk(chunk, atNs) {
		bytes += Buffer.byteLength(chunk);
		chunks++;
		appendFileSync(join(out, "terminal.ansi"), chunk);
		appendFileSync(
			join(out, "chunks.jsonl"),
			`${JSON.stringify({ atNs: atNs.toString(), bytes: Buffer.byteLength(chunk) })}\n`,
		);
	},
});
async function input(data: string, predicate: (event: Event) => boolean) {
	const after = events().length;
	child.write(data);
	return wait(predicate, after);
}
let finished = false;
try {
	const ready = await wait((event) => event.kind === "ready");
	if (process.env.TASK_TERMINAL_BASELINE) assert.ok(events().some((event) => event.kind === "baseline-loaded"));
	assert.deepEqual(ready.tty, [true, true, true]);
	await input("/tasks\r", (event) => event.kind === "frame" && event.picker === true);
	await input("\r", (event) => event.kind === "frame" && event.fullscreen === true);
	// Drill into the agent transcript from task detail.
	await input("\r", (event) => event.kind === "subscribe");
	await input("\u001b[5~", (event) => event.kind === "frame" && !!event.text?.includes("HISTORY-000"));
	const anchored = events()
		.filter((event) => event.kind === "frame")
		.at(-1)!;
	await input("\u001bOS", (event) => event.kind === "burst-start");
	await wait((event) => event.kind === "burst" && event.count! >= 100);
	const during = events()
		.filter((event) => event.kind === "frame")
		.at(-1)!;
	assert.ok(during.text?.includes("HISTORY-000"), "history remains anchored during burst");
	assert.equal(
		during.text?.split("Lines ")[0],
		anchored.text?.split("Lines ")[0],
		"historical viewport unchanged during live growth",
	);
	await input("\u001b[6~", (event) => event.kind === "frame" && !event.text?.includes("HISTORY-000"));
	let after = events().length;
	child.resize(72, 24);
	await wait((event) => event.kind === "frame" && event.width === 72 && event.rows === 24, after);
	after = events().length;
	child.resize(120, 40);
	await wait((event) => event.kind === "frame" && event.width === 120 && event.rows === 40, after);
	const endFrame = await input("\u001b[F", (event) => event.kind === "frame");
	await wait((event) => event.kind === "frame" && event.count! >= endFrame.count! + 80);
	const grownFrame = events()
		.filter((event) => event.kind === "frame")
		.at(-1)!;
	writeFileSync(
		join(out, "follow-tail.json"),
		JSON.stringify(
			{
				endCount: endFrame.count,
				laterCount: grownFrame.count,
				endMarkers: endFrame.text?.match(/LIVE-\d+/g),
				laterMarkers: grownFrame.text?.match(/LIVE-\d+/g),
				note: "Characterization only: End clamps to the current bottom; compare markers after growth, without asserting sticky follow-tail",
			},
			null,
			2,
		),
	);
	await wait((event) => event.kind === "burst-end");
	await input("\u001b[F", (event) => event.kind === "frame" && !!event.text?.includes("LIVE-0999"));
	await input("\u001b[15~", (event) => event.kind === "completed");
	await input("\u001b", (event) => event.kind === "unsubscribe");
	await input("\u0003", (event) => event.kind === "exit");
	const exited = await child.exited;
	finished = true;
	assert.equal(exited.exitCode, 0);
	assert.equal(events().find((event) => event.kind === "exit")?.listeners, 0);
	assert.deepEqual(hash(), before, "candidate source unchanged during scenario");
	const frames = events().filter((event) => event.kind === "frame");
	const times = frames.map((event) => event.renderMs!).sort((a, b) => a - b);
	const result = {
		passed: true,
		exited,
		frames: frames.length,
		terminalBytes: bytes,
		terminalChunks: chunks,
		frameRenderMedianMs: times[Math.floor(times.length * 0.5)],
		frameRenderP95Ms: times[Math.floor(times.length * 0.95)],
		assertions: [
			"native Windows TTY",
			"typed /tasks",
			"picker and fullscreen drilldown",
			"1000 live messages with 8000 deltas",
			"historical viewport anchored during growth",
			"PageDown during streaming",
			"72x24 and 120x40 resize",
			"final LIVE-0999 visible after End",
			"task completion",
			"unsubscribe and exit",
		],
		limits: [
			"No visible terminal window or video",
			"Local host only; no isolated RPC transport",
			"Fixture renderer instrumentation and output logging perturb timings",
			"No assertion of sticky follow-tail",
			"Deterministic task events, not real provider or artifact I/O",
		],
	};
	writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
} catch (error) {
	writeFileSync(join(out, "failure.txt"), String(error));
	throw error;
} finally {
	if (!finished) child.kill();
}
