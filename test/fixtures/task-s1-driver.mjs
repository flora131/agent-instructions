/** Credential-free real-native terminal evidence. Requires Bun and tmux on PATH. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as poll } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HELP = "Usage: node test/fixtures/task-s1-driver.mjs --evidence-dir <fresh-directory> [--columns 80] [--rows 24]";
const TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 10_000;
const { values } = parseArgs({ options: {
	"evidence-dir": { type: "string" },
	columns: { type: "string", default: "80" },
	rows: { type: "string", default: "24" },
	help: { type: "boolean" },
}, strict: true });
if (values.help) console.log(HELP);
else {
	assert.ok(values["evidence-dir"], HELP);
	const columns = Number(values.columns);
	const rows = Number(values.rows);
	assert.ok(Number.isInteger(columns) && columns >= 48, "--columns must be an integer >= 48");
	assert.ok(Number.isInteger(rows) && rows >= 16, "--rows must be an integer >= 16");
	await run(resolve(values["evidence-dir"]), columns, rows);
}
async function run(directory, columns, rows) {
	mkdirSync(dirname(directory), { recursive: true });
	mkdirSync(directory); // Refuse reuse before touching terminal tooling.
	const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
	const session = `task-s1-${randomUUID()}`;
	const tmux = (...args) => execFileSync("tmux", args, { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS });
	const alive = () => spawnSync("tmux", ["has-session", "-t", session], { timeout: COMMAND_TIMEOUT_MS }).status === 0;
	const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
	let capture = "";
	try {
		tmux("-V");
		execFileSync("bun", ["--version"], { timeout: COMMAND_TIMEOUT_MS });
		// Keep an exited pane inspectable without a sleep or a live fixture after completion.
		tmux("new-session", "-d", "-s", session, "-c", cwd, "-x", String(columns), "-y", String(rows));
		tmux("set-option", "-t", session, "remain-on-exit", "on");
		tmux("respawn-pane", "-k", "-t", session, `exec bun ${quote(join(cwd, "test/fixtures/task-s1-demo.ts"))}`);
		assert.equal(tmux("display-message", "-p", "-t", session, "#{pane_width}x#{pane_height}").trim(), `${columns}x${rows}`);
		const deadline = Date.now() + TIMEOUT_MS;
		while (Date.now() < deadline) {
			capture = tmux("capture-pane", "-t", session, "-p", "-J", "-S", "-");
			if (/^DEMO COMPLETE$/m.test(capture)) break;
			assert.notEqual(tmux("display-message", "-p", "-t", session, "#{pane_dead}").trim(), "1", "Demo exited before completion");
			await poll(20);
		}
		writeFileSync(join(directory, "capture.txt"), capture);
		assert.match(capture, /^DEMO COMPLETE$/m);
		const identities = [];
		for (const phase of ["LAUNCH running", "INITIAL default-background", "YIELD elapsed running", "ACTIVITY read", "SETTLED completed", "CLOSE closed reaped"]) {
			const match = new RegExp(`^${phase} task=(\\S+) attempt=(\\S+)$`, "m").exec(capture);
			assert.ok(match, `Missing ${phase}`);
			identities.push(match.slice(1));
		}
		for (const identity of identities) assert.deepEqual(identity, identities[0]);
		const cursors = [...capture.matchAll(/^CURSOR (\d+) ([a-z-]+)$/gm)];
		assert.ok(cursors.length > 0);
		let previous = 0n;
		for (const [, sequence] of cursors) {
			assert.ok(BigInt(sequence) > previous, "Journal cursors must be strictly ordered");
			previous = BigInt(sequence);
		}
		for (const kind of ["task-admitted", "task-started", "wait-yielded", "task-activity", "task-settled", "owner-closing", "owner-closed"]) assert.ok(cursors.some((entry) => entry[2] === kind), `Missing journal ${kind}`);
		assert.equal(cursors.at(-1)[2], "owner-closed");
		assert.match(capture, /^RUNNERS 1$/m);
		while (tmux("display-message", "-p", "-t", session, "#{pane_dead}").trim() !== "1" && Date.now() < deadline) await poll(20);
		assert.equal(tmux("display-message", "-p", "-t", session, "#{pane_dead_status}").trim(), "0", "Demo must exit successfully");
		writeFileSync(join(directory, "assertions.log"), `PASS ${columns}x${rows}; stable task/attempt; one runner; elapsed yield; activity; settlement; close; ${cursors.length} ordered cursors; DEMO COMPLETE; exit 0\n`);
	} catch (error) {
		if (alive()) capture = tmux("capture-pane", "-t", session, "-p", "-J", "-S", "-");
		writeFileSync(join(directory, "capture.txt"), capture);
		writeFileSync(join(directory, "failure.log"), `${error.stack ?? error}\n`);
		throw error;
	} finally {
		if (alive()) tmux("kill-session", "-t", session);
		assert.ok(!alive(), "Dedicated tmux session survived cleanup");
		writeFileSync(join(directory, "cleanup.txt"), `${session}: absent\n`);
	}
}
