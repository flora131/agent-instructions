import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { activityMonitor } from "./activity.js";

const DEEPWIKI_MCP_URL = "https://mcp.deepwiki.com/mcp";
const DEFAULT_MAX_TOKENS = 5000;
const REQUEST_TIMEOUT_MS = 60_000;

function trimApproxTokens(text: string, maxTokens: number): string {
	const maxCharacters = Math.max(1000, maxTokens * 4);
	if (text.length <= maxCharacters) return text;
	return `${text.slice(0, maxCharacters)}\n\n[Truncated by code_search to approximately ${maxTokens} tokens.]`;
}

export async function executeCodeSearch(
	_toolCallId: string,
	params: { repoName: string; query: string; maxTokens?: number },
	signal?: AbortSignal,
): Promise<{
	content: Array<{ type: "text"; text: string }>;
	details: { repoName: string; query: string; maxTokens: number; error?: string; mode?: "deepwiki" };
}> {
	signal?.throwIfAborted();
	const { repoName, query } = params;
	const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
	const details = { repoName, query, maxTokens };
	const validationError = typeof repoName !== "string" || !/^[^\s/]+\/[^\s/]+$/.test(repoName)
		? "repoName must be in owner/repo format"
		: typeof query !== "string" || !query.trim() ? "No query provided" : undefined;
	if (validationError) {
		return { content: [{ type: "text", text: `Error: ${validationError}.` }], details: { ...details, error: validationError } };
	}
	const activityId = activityMonitor.logStart({ type: "api", query });
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const client = new Client({ name: "atomic-code-search", version: "1.0.0" });
	const transport = new StreamableHTTPClientTransport(new URL(DEEPWIKI_MCP_URL), {
		fetch: (url, init) => fetch(url, {
			...init,
			signal: init?.signal ? AbortSignal.any([init.signal, requestSignal]) : requestSignal,
		}),
	});
	try {
		await client.connect(transport, { signal: requestSignal, timeout: REQUEST_TIMEOUT_MS });
		const result = CallToolResultSchema.parse(await client.callTool(
			{ name: "ask_question", arguments: { repoName, question: query } },
			CallToolResultSchema,
			{ signal: requestSignal, timeout: REQUEST_TIMEOUT_MS },
		));
		requestSignal.throwIfAborted();
		const text = result.content
			.filter(item => item.type === "text")
			.map(item => item.text)
			.join("\n\n");
		if (result.isError) throw new Error(`DeepWiki MCP: ${text || "Tool returned an error"}`);
		if (!text.trim()) throw new Error("DeepWiki MCP returned an empty response");
		activityMonitor.logComplete(activityId, 200);
		return {
			content: [{ type: "text", text: trimApproxTokens(text, maxTokens) }],
			details: { ...details, mode: "deepwiki" },
		};
	} catch (err) {
		if (signal?.aborted) {
			activityMonitor.logComplete(activityId, 0);
			throw signal.reason;
		}
		const message = timeout.aborted ? "DeepWiki MCP request timed out" : err instanceof Error ? err.message : String(err);
		activityMonitor.logError(activityId, message);
		return {
			content: [{ type: "text", text: `Error: ${message}` }],
			details: { ...details, error: message },
		};
	} finally {
		await client.close();
	}
}
