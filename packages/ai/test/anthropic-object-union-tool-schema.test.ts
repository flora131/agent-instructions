import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import type { Context, Model, Tool } from "../src/types.ts";
import { validateToolArguments } from "../src/utils/validation.ts";

const parameters = Type.Union([
	Type.Object({
		requestId: Type.String(),
		kind: Type.Literal("items"),
		values: Type.Array(Type.String()),
	}),
	Type.Object({
		requestId: Type.String(),
		kind: Type.Literal("record"),
		value: Type.Object({ count: Type.Number() }),
	}),
]);

const objectParameters = Type.Object({ query: Type.String() });
const mixedUnionParameters = Type.Union([Type.Object({ value: Type.String() }), Type.String()]);

const tools: Tool[] = [
	{
		name: "store_container",
		description: "Store a container value",
		parameters,
		constrainedSampling: false,
	},
	{
		name: "search",
		description: "Search for a query",
		parameters: objectParameters,
		constrainedSampling: false,
	},
	{
		name: "mixed_union",
		description: "Accept an object or string",
		parameters: mixedUnionParameters,
		constrainedSampling: false,
	},
];

function createModel(baseUrl: string): Model<"anthropic-messages"> {
	return {
		id: "claude-haiku-4-5",
		name: "Claude Haiku 4.5",
		api: "anthropic-messages",
		provider: "test-anthropic",
		baseUrl,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 64000,
		compat: { supportsStrictTools: true },
	};
}

async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function writeEmptySseResponse(response: ServerResponse): void {
	response.writeHead(200, { "content-type": "text/event-stream" });
	response.end();
}

// #2190 / #2189: advertise union fields without changing the authored validation schema.
it("projects a root object union into an Anthropic-compatible tool schema", async () => {
	const authoredParameters = JSON.stringify(parameters);
	let capturedBody: Record<string, unknown> | undefined;
	const server = createServer(async (request, response) => {
		capturedBody = await readRequestBody(request);
		writeEmptySseResponse(response);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as AddressInfo;

	try {
		const context: Context = {
			messages: [{ role: "user", content: "Store the items", timestamp: Date.now() }],
			tools,
		};
		const stream = streamAnthropic(createModel(`http://127.0.0.1:${address.port}`), context, {
			apiKey: "test-key",
			cacheRetention: "none",
		});
		for await (const event of stream) {
			if (event.type === "done" || event.type === "error") break;
		}
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}

	const outgoingTools = capturedBody?.tools;
	expect(Array.isArray(outgoingTools)).toBe(true);
	const [unionTool, objectTool, mixedUnionTool] = outgoingTools as Array<Record<string, unknown>>;
	const inputSchema = unionTool.input_schema as Record<string, unknown>;
	expect(inputSchema).toEqual({
		type: "object",
		properties: {
			requestId: parameters.anyOf[0].properties.requestId,
			kind: {
				anyOf: [parameters.anyOf[0].properties.kind, parameters.anyOf[1].properties.kind],
			},
			values: parameters.anyOf[0].properties.values,
			value: parameters.anyOf[1].properties.value,
		},
		required: ["requestId", "kind"],
	});
	expect(inputSchema).not.toEqual({ type: "object", properties: {}, required: [] });
	expect(inputSchema).not.toHaveProperty("anyOf");
	expect(inputSchema).not.toHaveProperty("oneOf");
	expect(inputSchema).not.toHaveProperty("allOf");
	expect(JSON.stringify(parameters)).toBe(authoredParameters);

	expect(objectTool.input_schema).toEqual({
		type: "object",
		properties: objectParameters.properties,
		required: objectParameters.required,
	});
	expect(mixedUnionTool.input_schema).toEqual({ type: "object", properties: {}, required: [] });
});

type CapturedSchema = { type: string; properties: Record<string, unknown>; required: string[] };

async function captureToolSchema(tool: Tool): Promise<{ advertised: CapturedSchema; wire: CapturedSchema }> {
	let advertised: CapturedSchema | undefined;
	let wire: CapturedSchema | undefined;
	await streamAnthropic(
		createModel("https://localhost.invalid"),
		{ messages: [{ role: "user", content: "Offline schema capture", timestamp: 1 }], tools: [tool] },
		{
			apiKey: "test-key",
			cacheRetention: "none",
			maxRetries: 0,
			onPayload(payload) {
				advertised = (payload as { tools: { input_schema: CapturedSchema }[] }).tools[0].input_schema;
			},
			fetch: async (_input, init) => {
				wire = JSON.parse(String(init?.body)).tools[0].input_schema;
				return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
			},
		},
	).result();
	assert(advertised);
	assert(wire);
	return { advertised, wire };
}

// #2190 / #2189: arbitrary own field names must survive projection and JSON serialization.
it("preserves own union property keys, order and prototypes without changing validation", async () => {
	const fields = {
		["__proto__"]: Type.String(),
		constructor: Type.String(),
		toString: Type.String(),
		"": Type.String(),
		"a.b/λ": Type.String(),
	};
	const parameters = Type.Union([
		Type.Object({ ...fields, kind: Type.Literal("a") }),
		Type.Object({ ...fields, kind: Type.Literal("b") }),
	]);
	const tool: Tool = { name: "own_keys", description: "Own keys", parameters, constrainedSampling: false };
	const authored = JSON.stringify(parameters);
	const keys = [...Object.keys(fields), "kind"];
	const args = Object.fromEntries(keys.map((key) => [key, key === "kind" ? "a" : "  verbatim\n"]));
	const call = { type: "toolCall" as const, id: "local", name: tool.name, arguments: args };
	assert.deepEqual(validateToolArguments(tool, call), args);
	assert.throws(() => validateToolArguments(tool, { ...call, arguments: { kind: "a" } }), /Validation failed/);
	assert.throws(
		() => validateToolArguments(tool, { ...call, arguments: { ...args, ["__proto__"]: 42 } }),
		/Validation failed/,
	);

	const { advertised, wire } = await captureToolSchema(tool);
	assert.deepEqual(Object.keys(wire.properties), keys);
	assert.deepEqual(wire.required, keys);
	assert.deepEqual(wire.properties, {
		...fields,
		kind: { anyOf: [parameters.anyOf[0].properties.kind, parameters.anyOf[1].properties.kind] },
	});
	assert.equal(Object.getPrototypeOf(advertised.properties), Object.prototype);
	assert.equal(Object.getPrototypeOf(wire.properties), Object.prototype);
	for (const key of keys) {
		assert.equal(Object.getOwnPropertyDescriptor(advertised.properties, key)?.enumerable, true);
		assert.equal(Object.hasOwn(wire.properties, key), true);
	}
	assert.equal(tool.parameters, parameters);
	assert.equal(JSON.stringify(parameters), authored);
	for (const branch of parameters.anyOf) assert.equal(Object.getPrototypeOf(branch.properties), Object.prototype);
});

// #2190 / #2189: properties metadata must not turn an explicitly nonobject branch into an object.
it("keeps an explicit string branch with properties on the unsupported-root fallback", async () => {
	const parameters = Type.Union([
		Type.String({ properties: { ignored: Type.String() } }),
		Type.Object({ actual: Type.Number() }),
	]);
	const tool: Tool = { name: "mixed_metadata", description: "Mixed union", parameters, constrainedSampling: false };
	const authored = JSON.stringify(parameters);
	const call = {
		type: "toolCall" as const,
		id: "local",
		name: tool.name,
		arguments: { actual: 1, ignored: 42 },
	};
	assert.deepEqual(validateToolArguments(tool, call), call.arguments);
	assert.throws(() => validateToolArguments(tool, { ...call, arguments: { ignored: 42 } }), /Validation failed/);
	assert.throws(() => validateToolArguments(tool, { ...call, arguments: { actual: "wrong" } }), /Validation failed/);
	const { wire } = await captureToolSchema(tool);
	assert.deepEqual(wire, { type: "object", properties: {}, required: [] });
	assert.equal(tool.parameters, parameters);
	assert.equal(JSON.stringify(parameters), authored);
});

// #2190 / #2189: absent type retains the existing implicit-object projection boundary.
it("continues projecting implicit object branches without adding a type to the authored schema", async () => {
	const parameters = {
		anyOf: [
			{
				properties: { kind: { const: "items" }, values: { type: "array", items: { type: "string" } } },
				required: ["kind", "values"],
			},
			{
				type: "object",
				properties: { kind: { const: "record" }, count: { type: "number" } },
				required: ["kind", "count"],
			},
		],
	};
	const tool: Tool = { name: "implicit", description: "Implicit objects", parameters, constrainedSampling: false };
	const authored = JSON.stringify(parameters);
	const args = { kind: "items", values: [] };
	assert.deepEqual(
		validateToolArguments(tool, { type: "toolCall", id: "local", name: tool.name, arguments: args }),
		args,
	);
	const { wire } = await captureToolSchema(tool);
	assert.deepEqual(wire, {
		type: "object",
		properties: {
			kind: { anyOf: [{ const: "items" }, { const: "record" }] },
			values: { type: "array", items: { type: "string" } },
			count: { type: "number" },
		},
		required: ["kind"],
	});
	assert.equal(tool.parameters, parameters);
	assert.equal(JSON.stringify(parameters), authored);
});

// #2190 / #2189: object-only type arrays are valid object branches, not unsupported mixed types.
it("continues projecting object-only type arrays without changing original union validation", async () => {
	const parameters = {
		anyOf: [
			{
				type: ["object"],
				properties: { kind: { const: "a" }, x: { type: "string" } },
				required: ["kind", "x"],
				additionalProperties: false,
			},
			{
				type: "object",
				properties: { kind: { const: "b" }, y: { type: "number" } },
				required: ["kind", "y"],
				additionalProperties: false,
			},
		],
	};
	const tool: Tool = {
		name: "object_type_array",
		description: "Object union",
		parameters,
		constrainedSampling: false,
	};
	const authored = JSON.stringify(parameters);
	const call = { type: "toolCall" as const, id: "local", name: tool.name, arguments: { kind: "a", x: "  raw\n" } };
	assert.deepEqual(validateToolArguments(tool, call), call.arguments);
	assert.deepEqual(validateToolArguments(tool, { ...call, arguments: { kind: "b", y: 0 } }), { kind: "b", y: 0 });
	for (const args of [{ kind: "a" }, { kind: "a", y: 0 }, { kind: "a", x: { bad: true } }]) {
		assert.throws(() => validateToolArguments(tool, { ...call, arguments: args }), /Validation failed/);
	}
	const { advertised, wire } = await captureToolSchema(tool);
	assert.deepEqual(wire, {
		type: "object",
		properties: { kind: { anyOf: [{ const: "a" }, { const: "b" }] }, x: { type: "string" }, y: { type: "number" } },
		required: ["kind"],
	});
	assert.deepEqual(advertised, wire);
	assert.deepEqual(Object.keys(wire.properties), ["kind", "x", "y"]);
	assert.equal(Object.getPrototypeOf(advertised.properties), Object.prototype);
	assert.equal(tool.parameters, parameters);
	assert.equal(JSON.stringify(parameters), authored);
});

// #2190 / #2189: allowing object-only type arrays must not admit mixed object/nonobject branches.
it("keeps mixed object/nonobject type arrays with properties on the unsupported-root fallback", async () => {
	for (const type of [
		["object", "string"],
		["null", "object"],
	]) {
		const parameters = {
			anyOf: [
				{ type, properties: { ignored: { type: "string" } }, required: ["ignored"] },
				{ type: "object", properties: { actual: { type: "number" } }, required: ["actual"] },
			],
		};
		const tool: Tool = {
			name: "mixed_type_array",
			description: "Mixed types",
			parameters,
			constrainedSampling: false,
		};
		const authored = JSON.stringify(parameters);
		const call = { type: "toolCall" as const, id: "local", name: tool.name, arguments: { actual: 0 } };
		assert.deepEqual(validateToolArguments(tool, call), call.arguments);
		assert.throws(() => validateToolArguments(tool, { ...call, arguments: {} }), /Validation failed/);
		const { advertised, wire } = await captureToolSchema(tool);
		assert.deepEqual(wire, { type: "object", properties: {}, required: [] });
		assert.deepEqual(advertised, wire);
		assert.equal(tool.parameters, parameters);
		assert.equal(JSON.stringify(parameters), authored);
	}
});
