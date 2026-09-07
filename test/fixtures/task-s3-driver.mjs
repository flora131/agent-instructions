// RFC PR #2884. Node-standard-library driver; the captured pane is the evidence.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as poll } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const {values} = parseArgs({options: {"evidence-dir": {type: "string"}, columns: {type: "string", default: "80"}, rows: {type: "string", default: "24"}}, strict: true});
assert.ok(values["evidence-dir"], "--evidence-dir <fresh-dir> is required");
const directory = resolve(values["evidence-dir"]);
mkdirSync(dirname(directory), {recursive: true});
mkdirSync(directory); // EEXIST refuses all reuse, including failed evidence runs.
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const session = `task-s3-${randomUUID()}`;
const COMMAND_TIMEOUT_MS = 10000;
const DEMO_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 20;
const tmux = (...args) => execFileSync("tmux", args, {encoding: "utf8", timeout: COMMAND_TIMEOUT_MS});
const alive = () => spawnSync("tmux", ["has-session", "-t", session], {stdio: "ignore", timeout: COMMAND_TIMEOUT_MS}).status === 0;
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
try {
	tmux("-V");
	tmux("new-session", "-d", "-s", session, "-c", cwd, "-x", values.columns, "-y", values.rows);
	tmux("set-option", "-t", session, "remain-on-exit", "on");
	tmux("send-keys", "-t", session, "-l", "--", `exec env -u PI_CODING_AGENT_DIR -u ATOMIC_CODING_AGENT_DIR bun ${quote(join(cwd, "test/fixtures/task-s3-demo.ts"))}`);
	tmux("send-keys", "-t", session, "Enter");
	const deadline = Date.now() + DEMO_TIMEOUT_MS;
	let capture = "";
	while (Date.now() < deadline) {
		assert.ok(alive(), "demo pane disappeared before completion");
		capture = tmux("capture-pane", "-t", session, "-p", "-J", "-S", "-");
		if (/^DEMO COMPLETE$/m.test(capture)) break;
		const dead = tmux("display-message", "-p", "-t", session, "#{pane_dead}").trim();
		assert.equal(dead, "0", `demo exited before success:\n${capture}`);
		await poll(POLL_INTERVAL_MS);
	}
	writeFileSync(join(directory, "capture.txt"), capture);
	assert.match(capture, /^DEMO COMPLETE$/m);
	assert.match(capture, /"kind":"yielded"/);
	assert.match(capture, /"reason":"intercom-coordination"/);
	assert.match(capture, /PEER MESSAGE genuine peer message/);
	assert.match(capture, /COMPLETION .*"display":false/);
	assert.match(capture, /STARTS 1/);
	const read = /ACTIVITY (\S+) read/.exec(capture);
	assert.ok(read);
	assert.ok(capture.includes(`ACTIVITY ${read[1]} bash`), "later activity keeps the same task ID");
	console.log(`PASS real tmux lifecycle capture: ${join(directory, "capture.txt")}`);
} finally {
	if (alive()) tmux("kill-session", "-t", session);
	assert.equal(alive(), false, "dedicated tmux session must be gone");
}
