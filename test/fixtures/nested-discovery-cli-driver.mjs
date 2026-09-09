// Manual E2E: run from a dedicated Herdr pane after npm run build. No credentials required.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = resolve(process.argv[2]);
assert.ok(!existsSync(evidence), "use a fresh evidence directory");
const project = join(evidence, "project");
const agent = join(evidence, "agent");
mkdirSync(join(project, ".atomic/workflows"), { recursive: true });
mkdirSync(join(project, ".atomic/extensions"), { recursive: true });
mkdirSync(agent, { recursive: true });
for (const [file, directory] of [["nested-discovery-workflow.ts", "workflows"], ["nested-discovery-provider.ts", "extensions"]]) {
	copyFileSync(join(repo, "test/integration/fixtures", file), join(project, ".atomic", directory, file));
}
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("ATOMIC_") || key.startsWith("PI_") || key === "NODE_TEST_CONTEXT") delete env[key];
Object.assign(env, { NODE_ENV: "production", ATOMIC_CODING_AGENT_DIR: agent, ATOMIC_CODING_AGENT_SESSION_DIR: join(evidence, "sessions"), ATOMIC_SKIP_VERSION_CHECK: "1", NESTED_DISCOVERY_STATE_DIR: evidence, DBOS_SYSTEM_DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/unreachable" });
const args = [join(repo, "packages/coding-agent/dist/cli.js"), "--mode", "rpc", "--approve", "--offline", "--no-session", "--provider", "nested-discovery-fixture", "--model", "fixture"];
console.log("BUILD_SHA", execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim());
console.log("CLI", process.execPath, ...args);
const cli = spawn(process.execPath, args, { cwd: project, env, stdio: ["pipe", "pipe", "pipe"] });
const frames = [];
let buffered = "";
let exited = false;
cli.on("exit", () => { exited = true; });
cli.stderr.on("data", (data) => appendFileSync(join(evidence, "stderr.log"), data));
cli.stdout.on("data", (data) => {
	appendFileSync(join(evidence, "stdout.jsonl"), data);
	buffered += data;
	const lines = buffered.split("\n");
	buffered = lines.pop();
	for (const line of lines) { try { frames.push(JSON.parse(line)); } catch {} }
});
async function waitFor(predicate, label) {
	const deadline = Date.now() + 90000;
	while (Date.now() < deadline) {
		if (predicate()) return;
		assert.equal(exited, false, `CLI exited: ${label}`);
		await new Promise((resolveWait) => setTimeout(resolveWait, 25));
	}
	throw new Error(`Timed out: ${label}; inspect ${evidence}`);
}
let sequence = 0;
async function prompt(message) {
	const id = `step-${++sequence}`;
	console.log("PROMPT", id, message);
	cli.stdin.write(`${JSON.stringify({ id, type: "prompt", message })}\n`);
	await waitFor(() => frames.some((f) => f.type === "response" && f.id === id), id);
}
async function call(name, arguments_) {
	const before = frames.length;
	await prompt(`fixture-call ${JSON.stringify({ name, arguments: arguments_ })}`);
	await waitFor(() => frames.slice(before).some((f) => f.type === "agent_end"), `${name} turn`);
	const result = frames.slice(before).find((f) => f.type === "tool_execution_end" && f.toolName === name)?.result;
	assert.ok(result, `missing ${name} tool result`);
	console.log("RESULT", JSON.stringify(result));
	appendFileSync(join(evidence, "public-results.jsonl"), `${JSON.stringify({ name, arguments: arguments_, result })}\n`);
	return result;
}
const workflowCall = async (args_) => {
	const result = await call("workflow", { ...args_, format: "json" });
	return JSON.parse(result.content.find((c) => c.type === "text").text);
};
try {
	await prompt("/workflow nested-discovery-fixture");
	await waitFor(() => existsSync(join(evidence, "holds.jsonl")), "grandchild live reviewer");
	const status = await workflowCall({ action: "status" });
	assert.equal(status.runs.length, 1);
	const root = status.runs[0].runId;
	assert.ok(root);
	console.log("ROOT_RUN_ID", root);
	const listed = await workflowCall({ action: "stages", runId: root });
	assert.deepEqual(listed.stages.map((s) => [s.name, s.status]), [["completed-reviewer", "completed"], ["live-reviewer", "running"]]);
	for (const summary of listed.stages) {
		const detail = await workflowCall({ action: "stage", runId: root, stageId: summary.id });
		assert.ok(detail.stage, JSON.stringify(detail));
		assert.equal(`${detail.runId}:${detail.stage.id}`, summary.id);
		const transcript = await workflowCall({ action: "transcript", runId: root, stageId: summary.id });
		assert.notEqual(transcript.source, "error");
		assert.equal(`${transcript.runId}:${transcript.stageId}`, summary.id);
	}
	await call("intercom", { action: "join", group: `workflow:${root}` });
	const directory = await call("intercom", { action: "list" });
	assert.match(directory.content[0].text, /live-reviewer/);
	assert.equal(directory.details.workflowStages[0].group, `workflow:${root}/reviewers`);
	// Ordinary session rows are membership-scoped; the root's roster includes active owned stages.
	const subgroup = await call("intercom", { action: "list", group: `workflow:${root}/reviewers` });
	const text = subgroup.content[0].text;
	assert.match(text, /closed · reply: post-mortem only/);
	assert.match(text, /thinking/);
	const completedRow = text.split("\n").find((line) => line.includes("closed ·"));
	assert.ok(completedRow, text);
	const completedSession = /\(([^()]+)\) —/.exec(completedRow)?.[1];
	assert.ok(completedSession);
	const scoped = await call("intercom", { action: "ask", to: completedSession, message: "scope probe" });
	assert.equal(scoped.isError, true);
	assert.match(scoped.content[0].text, /different intercom group/);
	await call("intercom", { action: "join", group: `workflow:${root}/reviewers` });
	const reply = await call("intercom", { action: "ask", to: completedSession, message: "  exact retained question\n" });
	assert.notEqual(reply.isError, true, JSON.stringify(reply));
	assert.match(reply.content[0].text, /exact retained reviewer answer/);
	const completedTranscript = readFileSync(listed.stages[0].sessionFile, "utf8").trim().split("\n").map(JSON.parse);
	assert.ok(completedTranscript.some((entry) => entry.message?.role === "user" && entry.message.content.some((part) => part.type === "text" && part.text.endsWith("\n\n  exact retained question\n"))), "retained ask text stays verbatim");
	const stale = await call("intercom", { action: "ask", to: "00000000-0000-4000-8000-000000000000", message: "stale identifier" });
	assert.equal(stale.isError, true);
	assert.match(stale.content[0].text, /Session not found/);
	writeFileSync(join(evidence, "release"), "release isolated fixture\n");
	await waitFor(() => frames.some((f) => f.type === "entry_appended" && f.entry?.customType === "workflow.run.end" && f.entry.data?.runId === root), "root completion");
	const retained = await workflowCall({ action: "stages", runId: root });
	assert.deepEqual(retained.stages.map((s) => s.id), listed.stages.map((s) => s.id));
	assert.ok(retained.stages.every((s) => s.status === "completed"));
	for (const summary of retained.stages) assert.ok((await workflowCall({ action: "stage", runId: root, stageId: summary.id })).stage);
	assert.equal(readFileSync(join(evidence, "holds.jsonl"), "utf8"), "started\n", "no duplicate execution");
	console.log("NESTED_DISCOVERY_E2E_PASS", JSON.stringify({ root, stages: listed.stages.map((s) => s.id), completedSession }));
} finally {
	writeFileSync(join(evidence, "release"), "cleanup isolated fixture\n");
	cli.kill("SIGTERM");
	await new Promise((resolveExit) => { if (exited) resolveExit(); else cli.once("exit", resolveExit); });
}
