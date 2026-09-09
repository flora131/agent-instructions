import { describe, expect, it } from "vitest";
import { getModel, streamSimple } from "../src/compat.ts";
import type { Context, Model, SimpleStreamOptions } from "../src/types.ts";

interface MistralPayload {
	promptMode?: "reasoning";
	reasoningEffort?: "none" | "high";
	promptCacheKey?: string;
}

function makeContext(): Context {
	return {
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};
}

async function capturePayload(
	model: Model<"mistral-conversations">,
	options?: SimpleStreamOptions,
): Promise<MistralPayload> {
	let capturedPayload: MistralPayload | undefined;
	const payloadCaptureModel: Model<"mistral-conversations"> = {
		...model,
		baseUrl: "http://127.0.0.1:9",
	};

	const stream = streamSimple(payloadCaptureModel, makeContext(), {
		...options,
		apiKey: "fake-key",
		onPayload: (payload) => {
			capturedPayload = payload as MistralPayload;
			return payload;
		},
	});

	await stream.result();

	if (!capturedPayload) {
		throw new Error("Expected payload to be captured before request failure");
	}

	return capturedPayload;
}

describe("Mistral reasoning mode selection", () => {
	it("uses reasoning_effort for Mistral Small 4", async () => {
		const payload = await capturePayload(getModel("mistral", "mistral-small-2603"), { reasoning: "medium" });

		expect(payload.reasoningEffort).toBe("high");
		expect(payload.promptMode).toBeUndefined();
	});

	it("omits reasoning controls for Mistral Small 4 when thinking is off", async () => {
		const payload = await capturePayload(getModel("mistral", "mistral-small-2603"));

		expect(payload.reasoningEffort).toBeUndefined();
		expect(payload.promptMode).toBeUndefined();
	});

	it("uses prompt_mode for Magistral reasoning models", async () => {
		const payload = await capturePayload(getModel("mistral", "magistral-medium-latest"), { reasoning: "medium" });

		expect(payload.promptMode).toBe("reasoning");
		expect(payload.reasoningEffort).toBeUndefined();
	});

	it("uses reasoning_effort for Mistral Medium 3.5", async () => {
		const payload = await capturePayload(getModel("mistral", "mistral-medium-3.5"), { reasoning: "medium" });

		expect(payload.reasoningEffort).toBe("high");
		expect(payload.promptMode).toBeUndefined();
	});

	it("omits reasoning controls for Mistral Medium 3.5 when thinking is off", async () => {
		const payload = await capturePayload(getModel("mistral", "mistral-medium-3.5"));

		expect(payload.reasoningEffort).toBeUndefined();
		expect(payload.promptMode).toBeUndefined();
	});

	// Regression for upstream #8700: Medium aliases use reasoning_effort, not prompt_mode.
	describe.each(["mistral-medium-2604", "mistral-medium-latest"])("%s", (id) => {
		it("uses reasoning_effort when thinking is enabled", async () => {
			const model = { ...getModel("mistral", "mistral-small-2603"), id, reasoning: true };
			const payload = await capturePayload(model, { reasoning: "medium" });
			expect(payload.reasoningEffort).toBe("high");
			expect(payload.promptMode).toBeUndefined();
		});
		it("omits reasoning controls when thinking is off", async () => {
			const model = { ...getModel("mistral", "mistral-small-2603"), id, reasoning: true };
			const payload = await capturePayload(model);
			expect(payload.reasoningEffort).toBeUndefined();
			expect(payload.promptMode).toBeUndefined();
		});
	});

	// Regression for upstream #8700: respect the reasoning capability, not just the prefix.
	it("omits reasoning controls for non-reasoning Medium models", async () => {
		const model = { ...getModel("mistral", "mistral-small-2603"), id: "mistral-medium-2505", reasoning: false };
		const payload = await capturePayload(model, { reasoning: "medium" });
		expect(payload.reasoningEffort).toBeUndefined();
		expect(payload.promptMode).toBeUndefined();
	});

	it("uses the session id as prompt cache key", async () => {
		const payload = await capturePayload(getModel("mistral", "mistral-large-latest"), {
			sessionId: "session-123",
		});

		expect(payload.promptCacheKey).toBe("session-123");
	});

	it("omits prompt cache key when cache retention is disabled", async () => {
		const payload = await capturePayload(getModel("mistral", "mistral-large-latest"), {
			sessionId: "session-123",
			cacheRetention: "none",
		});

		expect(payload.promptCacheKey).toBeUndefined();
	});
});
