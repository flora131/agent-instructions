import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { executeCodeSearch } from "../../packages/web-access/code-search.js";
import { searchWithExaMcp } from "../../packages/web-access/exa-mcp.js";

interface RpcRequest {
	id?: number;
	method: string;
	params?: { name?: string; arguments?: Record<string, string> };
}

const requests: RpcRequest[] = [];
function mockDeepWiki(
	content = " Repository answer\n",
	respond?: (request: RpcRequest, signal?: AbortSignal | null) => Response | Promise<Response> | undefined,
) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string | URL, init?: RequestInit) => {
			assert.equal(String(url), "https://mcp.deepwiki.com/mcp");
			if (init?.method === "GET") return new Response(null, { status: 405 });
			const request = JSON.parse(String(init?.body)) as RpcRequest;
			requests.push(request);
			const response = respond?.(request, init?.signal);
			if (response) return response;
			if (request.method.startsWith("notifications/")) return new Response(null, { status: 202 });
			const result =
				request.method === "initialize"
					? {
							protocolVersion: "2025-03-26",
							capabilities: { tools: {} },
							serverInfo: { name: "fixture", version: "1" },
						}
					: { content: [{ type: "text", text: content }] };
			return Response.json({ jsonrpc: "2.0", id: request.id, result });
		}),
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	requests.length = 0;
});

test("code_search initializes DeepWiki and maps raw repository and query to ask_question", async () => {
	mockDeepWiki();
	const params = { repoName: "Owner/Repo", query: "  How does it work?\n" };
	const result = await executeCodeSearch("call", params);
	assert.deepEqual(
		requests.map((request) => request.method),
		["initialize", "notifications/initialized", "tools/call"],
	);
	assert.deepEqual(requests[2].params, {
		name: "ask_question",
		arguments: { repoName: params.repoName, question: params.query },
	});
	assert.deepEqual(result.content, [{ type: "text", text: " Repository answer\n" }]);
	assert.equal(result.details.query, params.query);
});

test("code_search rejects invalid repository names and empty queries before network access", async () => {
	mockDeepWiki();
	for (const repoName of [
		"",
		"owner",
		"/repo",
		"owner/",
		"owner/repo/extra",
		" owner/repo",
		"owner/re po",
		"owner/repo\n",
	]) {
		const result = await executeCodeSearch("invalid", { repoName, query: "question" });
		assert.match(result.details.error ?? "", /repoName.*owner\/repo/);
	}
	for (const query of ["", " \n\t"]) {
		const result = await executeCodeSearch("invalid", { repoName: "owner/repo", query });
		assert.match(result.details.error ?? "", /query/);
	}
	assert.equal(requests.length, 0);
});

test("code_search limits output locally without forwarding maxTokens to DeepWiki", async () => {
	mockDeepWiki("x".repeat(5000));
	const result = await executeCodeSearch("bound", { repoName: "owner/repo", query: "question", maxTokens: 1000 });
	assert.equal(
		result.content[0].text,
		`${"x".repeat(4000)}\n\n[Truncated by code_search to approximately 1000 tokens.]`,
	);
	assert.equal(result.details.maxTokens, 1000);
	assert.deepEqual(requests[2].params?.arguments, { repoName: "owner/repo", question: "question" });
});

for (const [name, body] of [
	["empty content", { content: [] }],
	["whitespace content", { content: [{ type: "text", text: " \n" }] }],
	["missing content", {}],
	["malformed text", { content: [{ type: "text", text: 42 }] }],
	["tool error", { isError: true, content: [{ type: "text", text: "repository unavailable" }] }],
] as const) {
	test(`code_search surfaces ${name} without Exa fallback and allows a later success`, async () => {
		mockDeepWiki("", (request) =>
			request.method === "tools/call" ? Response.json({ jsonrpc: "2.0", id: request.id, result: body }) : undefined,
		);
		const result = await executeCodeSearch("error", { repoName: "owner/repo", query: "question" });
		assert.ok(result.details.error);
		assert.match(result.content[0].text, /^Error:/);
		assert.equal(requests.filter((request) => request.method === "tools/call").length, 1);
		mockDeepWiki("recovered");
		const retry = await executeCodeSearch("retry", { repoName: "owner/repo", query: "question" });
		assert.equal(retry.content[0].text, "recovered");
	});
}

for (const stage of ["initialize", "tools/call"]) {
	for (const kind of ["HTTP", "RPC", "malformed JSON"]) {
		test(`code_search surfaces ${kind} errors during ${stage}`, async () => {
			mockDeepWiki("", (request) => {
				if (request.method !== stage) return undefined;
				if (kind === "HTTP") return new Response("service unavailable", { status: 503 });
				if (kind === "RPC")
					return Response.json({
						jsonrpc: "2.0",
						id: request.id,
						error: { code: -32601, message: "tool not found" },
					});
				return new Response("broken", { headers: { "Content-Type": "application/json" } });
			});
			const result = await executeCodeSearch("error", { repoName: "owner/repo", query: "question" });
			assert.ok(result.details.error);
			assert.equal(requests.filter((request) => request.method === stage).length, 1);
		});
	}
}

test("code_search accepts SSE tool content and preserves text block order and duplicates", async () => {
	mockDeepWiki("", (request) =>
		request.method === "tools/call"
			? new Response(
					`event: message\ndata: ${JSON.stringify({
						jsonrpc: "2.0",
						id: request.id,
						result: {
							content: [
								{ type: "text", text: "second" },
								{ type: "text", text: "first" },
								{ type: "text", text: "first" },
							],
						},
					})}\n\n`,
					{ headers: { "Content-Type": "text/event-stream" } },
				)
			: undefined,
	);
	const result = await executeCodeSearch("sse", { repoName: "owner/repo", query: "question" });
	assert.equal(result.content[0].text, "second\n\nfirst\n\nfirst");
});

test("code_search propagates a pre-aborted caller's exact reason without fetching", async () => {
	mockDeepWiki();
	const controller = new AbortController();
	const reason = { cancelled: true };
	controller.abort(reason);
	await assert.rejects(
		executeCodeSearch("abort", { repoName: "owner/repo", query: "question" }, controller.signal),
		(error) => error === reason,
	);
	assert.equal(requests.length, 0);
});

for (const stage of ["initialize", "notifications/initialized", "tools/call"]) {
	for (const kind of ["caller abort", "deadline"]) {
		test(`code_search handles ${kind} during ${stage} and aborts the HTTP request`, async () => {
			const caller = new AbortController();
			const deadline = new AbortController();
			const reason = { cancelled: stage };
			vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
				assert.equal(ms, 60_000);
				return deadline.signal;
			});
			let aborted = false;
			mockDeepWiki("", (request, signal) => {
				if (request.method !== stage) return undefined;
				return new Promise<Response>((_resolve, reject) => {
					assert.ok(signal);
					signal.addEventListener(
						"abort",
						() => {
							aborted = true;
							reject(signal.reason);
						},
						{ once: true },
					);
					queueMicrotask(() =>
						kind === "caller abort"
							? caller.abort(reason)
							: deadline.abort(new DOMException("deadline", "TimeoutError")),
					);
				});
			});
			const pending = executeCodeSearch("abort", { repoName: "owner/repo", query: "question" }, caller.signal);
			if (kind === "caller abort") await assert.rejects(pending, (error) => error === reason);
			else assert.equal((await pending).details.error, "DeepWiki MCP request timed out");
			assert.equal(aborted, true);
		});
	}
}

test("unrelated web search still calls Exa's web_search_exa and returns its sources", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string | URL, init?: RequestInit) => {
			assert.equal(String(url), "https://mcp.exa.ai/mcp");
			const request = JSON.parse(String(init?.body)) as RpcRequest;
			assert.equal(request.params?.name, "web_search_exa");
			assert.equal(request.params?.arguments?.query, "web question");
			return Response.json({
				jsonrpc: "2.0",
				id: request.id,
				result: { content: [{ type: "text", text: "Title: Example\nURL: https://example.com\nText: Web answer" }] },
			});
		}),
	);
	const result = await searchWithExaMcp("web question");
	assert.deepEqual(result?.results, [{ title: "Example", url: "https://example.com", snippet: "" }]);
	assert.match(result?.answer ?? "", /Web answer/);
});
