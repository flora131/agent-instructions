import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@bastani/atomic";
import { validateToolArguments } from "@bastani/pi-ai";
import { Value } from "typebox/value";
import { test, vi } from "vitest";

interface ExtractedContent {
	url: string;
	title: string;
	content: string;
	error: string | null;
}

interface ContentToolsModule {
	registerContentTools(
		pi: ExtensionAPI,
		deps: {
			maxInlineContent: number;
			stripThumbnails(results: ExtractedContent[]): ExtractedContent[];
			formatFullResults(): string;
		},
	): void;
}

interface WebAccessModule {
	default(pi: ExtensionAPI): void;
}

const fetchAllContent = vi.hoisted(() =>
	vi.fn(async (urls: string[]) =>
		urls.map((url) => ({
			url,
			title: "Example",
			content: "Example content",
			error: null,
		})),
	),
);
vi.mock("../../packages/web-access/extract.js", () => ({ fetchAllContent }));
vi.mock("../../packages/web-access/code-search.js", () => ({ executeCodeSearch: vi.fn() }));
vi.mock("../../packages/web-access/storage.js", () => ({
	generateId: () => "fetch-test",
	getResult: vi.fn(),
	storeResult: vi.fn(),
}));

// Keep excluded legacy web-access sources out of the root typecheck, while testing the real modules.
const { registerContentTools } = await vi.importActual<ContentToolsModule>(
	"../../packages/web-access/content-tools.js",
);
const { default: registerWebAccess } = await vi.importActual<WebAccessModule>("../../packages/web-access/index.js");

function capture(register: (pi: ExtensionAPI) => void): ToolDefinition {
	const tools: ToolDefinition[] = [];
	const pi: Pick<ExtensionAPI, "registerTool" | "on" | "registerShortcut" | "registerCommand" | "appendEntry"> = {
		registerTool: (tool) => {
			tools.push(tool);
		},
		on: () => {},
		registerShortcut: () => {},
		registerCommand: () => {},
		appendEntry: () => {},
	};
	register(pi as ExtensionAPI);
	const tool = tools.find((tool) => tool.name === "fetch_content");
	assert.ok(tool);
	return tool;
}

const registrations = {
	lazy: () => capture(registerWebAccess),
	heavy: () =>
		capture((pi) =>
			registerContentTools(pi, {
				maxInlineContent: 1000,
				stripThumbnails: (results) => results,
				formatFullResults: () => "",
			}),
		),
};

for (const [name, register] of Object.entries(registrations)) {
	test(`${name} fetch_content requires one nonempty urls array`, () => {
		const { parameters } = register();
		assert.ok(
			"properties" in parameters && typeof parameters.properties === "object" && parameters.properties !== null,
		);
		assert.equal("url" in parameters.properties, false);
		for (const input of [
			{},
			{ url: "https://example.com" },
			{ URLs: ["https://example.com"] },
			{ urls: [] },
			{ urls: "https://example.com" },
			{ urls: [{ url: "https://example.com" }] },
			{ urls: [""] },
			{ urls: ["https://example.com"], url: "https://other.example" },
		]) {
			assert.equal(Value.Check(parameters, input), false, JSON.stringify(input));
			if (typeof input.urls !== "string") {
				const tool = register();
				assert.throws(
					() =>
						validateToolArguments(tool, {
							type: "toolCall",
							id: "invalid",
							name: tool.name,
							arguments: input,
						}),
					/Validation failed for tool "fetch_content"/,
				);
			}
		}
		for (const urls of [
			["https://example.com"],
			["https://example.com", "https://other.example"],
			["/tmp/video.mp4"],
		]) {
			assert.equal(Value.Check(parameters, { urls }), true);
		}
	});

	test(`${name} fetch_content retains host normalization of a scalar urls string`, () => {
		const tool = register();
		assert.deepEqual(
			validateToolArguments(tool, {
				type: "toolCall",
				id: "scalar",
				name: tool.name,
				arguments: { urls: "https://example.com" },
			}),
			{ urls: ["https://example.com"] },
		);
	});
}

test("fetch_content passes single and multiple URLs to extraction unchanged", async () => {
	const tool = registrations.heavy();
	for (const urls of [["https://example.com"], ["https://example.com", "https://other.example"]]) {
		const result = await tool.execute(
			"test",
			{ urls },
			new AbortController().signal,
			undefined,
			{} as ExtensionContext,
		);
		assert.deepEqual(fetchAllContent.mock.lastCall?.[0], urls);
		assert.ok(typeof result.details === "object" && result.details !== null && "successful" in result.details);
		assert.equal(result.details.successful, urls.length);
	}
});
