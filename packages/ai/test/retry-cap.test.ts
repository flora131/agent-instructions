import { describe, expect, it, vi } from "vitest";
import { fauxAssistantMessage } from "../src/providers/faux.ts";
import { retryAssistantCall } from "../src/utils/retry.ts";

describe("assistant retry cap", () => {
	it("caps scheduled delays during prolonged failures (#8826)", async () => {
		const onRetryScheduled = vi.fn();
		await retryAssistantCall(
			async () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" }),
			{ enabled: true, maxRetries: 4, baseDelayMs: 1, maxAgentDelayMs: 3 },
			undefined,
			{ onRetryScheduled },
		);
		expect(onRetryScheduled.mock.calls.map((call) => call[2])).toEqual([1, 2, 3, 3]);
	});
});
