import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as poll } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// RFC #2884: capture a dedicated real terminal, never manufacture transcript evidence.
const { values } = parseArgs({ options: { "evidence-dir": { type: "string" }, columns: { type: "string", default: "80" }, rows: { type: "string", default: "24" } } });
assert.ok(values["evidence-dir"], "--evidence-dir is required");
const directory = resolve(values["evidence-dir"]);
mkdirSync(dirname(directory), { recursive: true });
mkdirSync(directory);
const session = `task-s2-${randomUUID()}`;
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tmux = (...args) => execFileSync("tmux", args, { encoding: "utf8", timeout: 5000 });
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
let capture = "";
try {
 tmux("new-session", "-d", "-s", session, "-x", values.columns, "-y", values.rows, "-c", cwd);
 tmux("set-option", "-t", session, "remain-on-exit", "on");
 tmux("send-keys", "-t", session, "-l", "--", `env -u PI_CODING_AGENT_DIR -u ATOMIC_CODING_AGENT_DIR bun ${quote(join(cwd, "test/fixtures/task-s2-demo.ts"))}`);
 tmux("send-keys", "-t", session, "Enter");
 const deadline = Date.now() + 30000;
 while (Date.now() < deadline) {
  capture = tmux("capture-pane", "-t", session, "-p", "-S", "-", "-J");
  if (/^DEMO COMPLETE$/m.test(capture)) break;
  await poll(20);
 }
 writeFileSync(join(directory, "capture.txt"), capture);
 for (const line of ["WAIT YIELDED parent=alive grandchild=alive", "CLEANUP reaped parent=exited grandchild=exited", "DEMO COMPLETE"]) assert.ok(capture.split("\n").includes(line), `missing ${line}`);
 assert.match(capture, /^PARENT pid=\d+ birth=/m);
 assert.match(capture, /^GRANDCHILD pid=\d+ birth=/m);
 assert.match(capture, /^LIVE AFTER YIELD .*output/m);
 assert.match(capture, /^RECEIPT .*"kind":"reaped"/m);
 console.log(`PASS real S2 lifecycle capture: ${join(directory, "capture.txt")}`);
} finally {
 spawnSync("tmux", ["kill-session", "-t", session], { timeout: 5000 });
}
