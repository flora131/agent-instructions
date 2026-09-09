import assert from "node:assert/strict";
import { test } from "vitest";
import { nextRetryDecision } from "../src/core/retry-policy.ts";
import { InMemorySettingsStorage, SettingsManager } from "../src/core/settings-manager.ts";

test("shared main-chat and workflow retry policy caps backoff (#8826)", () => {
	const defaults = SettingsManager.inMemory().getRetrySettings();
	assert.equal(defaults.maxAgentDelayMs, 60_000);
	assert.equal(nextRetryDecision({ ...defaults, maxRetries: 2000 }, 1024, true)?.delayMs, 60_000);
	for (const cap of [0, 5]) {
		const settings = SettingsManager.inMemory({ retry: { maxRetries: 10, maxAgentDelayMs: cap } });
		assert.equal(nextRetryDecision(settings.getRetrySettings(), 4, true)?.delayMs, cap);
		assert.equal(settings.getProviderRetrySettings().maxRetryDelayMs, 60_000);
	}
});

test("legacy retry.maxDelayMs remains a provider limit, independent of the agent cap", () => {
	const storage = new InMemorySettingsStorage();
	storage.withLock("global", () => JSON.stringify({ retry: { maxDelayMs: 1234 } }));
	const settings = SettingsManager.fromStorage(storage);
	assert.equal(settings.getRetrySettings().maxAgentDelayMs, 60_000);
	assert.equal(settings.getProviderRetrySettings().maxRetryDelayMs, 1234);
});
