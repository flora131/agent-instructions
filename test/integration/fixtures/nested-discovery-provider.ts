/** Deterministic model only: real CLI sessions, workflow tools and Intercom transport remain intact. */
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@bastani/atomic";
import { type AssistantMessage, createAssistantMessageEventStream } from "@bastani/pi-ai/compat";

export default function (pi: ExtensionAPI): void {
	pi.registerProvider("nested-discovery-fixture", {
		api: "nested-discovery-fixture",
		apiKey: "fixture-only",
		baseUrl: "http://127.0.0.1:1/unused",
		models: [
			{
				id: "fixture",
				name: "Fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100000,
				maxTokens: 1000,
			},
		],
		streamSimple(model, context) {
			const stream = createAssistantMessageEventStream();
			const stateDir = process.env.NESTED_DISCOVERY_STATE_DIR!;
			const last = context.messages.at(-1);
			const text =
				typeof last?.content === "string"
					? last.content
					: (last?.content ?? [])
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join("");
			const command = /^fixture-call (.+)$/.exec(text)?.[1];
			const request =
				command === undefined
					? undefined
					: (JSON.parse(command) as { name: string; arguments: Record<string, unknown> });
			const isHold = text === "fixture-hold";
			const content: AssistantMessage["content"] = request
				? [{ type: "toolCall", id: `fixture-${Date.now()}`, name: request.name, arguments: request.arguments }]
				: last?.role === "user" && text.includes("To reply, use the intercom tool:")
					? [
							{
								type: "toolCall",
								id: `reply-${Date.now()}`,
								name: "intercom",
								arguments: { action: "reply", message: "exact retained reviewer answer" },
							},
						]
					: [{ type: "text", text: "Fixture complete." }];
			if (last?.role === "toolResult")
				appendFileSync(join(stateDir, "tool-results.jsonl"), `${JSON.stringify(last)}\n`);
			const output: AssistantMessage = {
				role: "assistant",
				api: model.api,
				provider: model.provider,
				model: model.id,
				timestamp: Date.now(),
				content,
				stopReason: content[0]?.type === "toolCall" ? "toolUse" : "stop",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			void (async () => {
				if (isHold) {
					appendFileSync(join(stateDir, "holds.jsonl"), "started\n");
					while (!existsSync(join(stateDir, "release"))) await new Promise((resolve) => setTimeout(resolve, 20));
				}
				stream.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output });
				stream.end();
			})();
			return stream;
		},
	});
}
