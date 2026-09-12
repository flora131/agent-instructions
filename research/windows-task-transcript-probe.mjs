// Run after npm ci --ignore-scripts and npm run build. Native Bun, no terminal writes.
// bun --no-install research/windows-task-transcript-probe.mjs [--baseline]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { stripVTControlCharacters as strip } from "node:util";
import { TaskLiveTranscript as CandidateTranscript } from "../packages/coding-agent/src/modes/interactive/components/task-live-transcript.ts";
import { initTheme } from "../packages/coding-agent/src/modes/interactive/theme/theme.ts";
const baseline = process.argv.includes("--baseline");
const baselineRef = "ff55b141109e3f9f5980c1f0c718dea39f6b2fd9";
async function transcriptClass() {
	if (!baseline) return CandidateTranscript;
	const source = execFileSync("git", ["show", `${baselineRef}:packages/coding-agent/src/modes/interactive/components/task-live-transcript.ts`], { encoding: "utf8" });
	// Compile the exact baseline component in memory, resolving its unchanged renderer
	// against this checkout. No checkout switching or temporary product files.
	const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source).replace(
		'"./chat-message-renderer.ts"',
		JSON.stringify(new URL("../packages/coding-agent/src/modes/interactive/components/chat-message-renderer.ts", import.meta.url).href),
	);
	return (await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`)).TaskLiveTranscript;
}
const TaskLiveTranscript = await transcriptClass();
initTheme("dark");
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-responses", provider: "openai", model: "fixture", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 1 });
const quantile = (a, p) => [...a].sort((x, y) => x - y)[Math.ceil(a.length * p) - 1];
console.log(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, bun: Bun.version, tty: !!process.stdout.isTTY, backend: "headless component render; no terminal writes", width: 100, samples: 30 }));
console.log(JSON.stringify({ variant: baseline ? "exact baseline component with current unchanged shared renderers" : "candidate", baselineRef }));
for (const count of [100, 500, 1000]) {
 let listener;
 let requests = 0;
 const messages = Array.from({ length: count }, (_, i) => assistant(`HISTORY-${String(i).padStart(4, "0")} **bold** and inline \`code\`\n\n- item one\n- item two\n\n\`\`\`typescript\nconst value = ${i};\n\`\`\``));
 const source = { getSessionId: () => "bench", getEntries: () => [], subscribe: (cb) => { listener = cb; return () => { listener = undefined; }; }, getStreamingMessage: () => assistant("LIVE") };
 const view = new TaskLiveTranscript(source, messages, () => requests++);
 let rows = view.render(100);
 const times = [];
 const cached = [];
 const cpu = process.cpuUsage();
 for (let i = 0; i < 30; i++) {
  const start = performance.now();
  listener({ type: "message_update", message: assistant(""), assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: ` D${i}`, partial: assistant("") } });
  rows = view.render(100);
  times.push(performance.now() - start);
  const next = performance.now();
  view.render(100);
  cached.push(performance.now() - next);
 }
 const used = process.cpuUsage(cpu);
 const plain = strip(rows.join("\n"));
 for (let i = 0; i < count; i++) assert.equal(plain.split(`HISTORY-${String(i).padStart(4, "0")}`).length - 1, 1);
 assert.deepEqual(plain.match(/\bD\d+\b/g), Array.from({ length: 30 }, (_, i) => `D${i}`));
 assert.equal(requests, 30);
 console.log(JSON.stringify({ count, historyInputBytes: Buffer.byteLength(JSON.stringify(messages)), rows: rows.length, renderedBytes: Buffer.byteLength(rows.join("\n")), eventRenderMedianMs: quantile(times, .5), eventRenderP95Ms: quantile(times, .95), cachedRenderMedianMs: quantile(cached, .5), cachedRenderP95Ms: quantile(cached, .95), cpuMs: (used.user + used.system) / 1000, requests, assertions: "every history marker exactly once; all deltas in order; 30 update requests; subscription disposed" }));
 view.dispose();
 assert.equal(listener, undefined);
}
