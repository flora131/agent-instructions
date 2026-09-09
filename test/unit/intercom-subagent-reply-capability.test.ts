import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@bastani/atomic";
import { test } from "vitest";
import type { PresenceUpdates } from "../../packages/intercom/broker/client.js";
import { registerSubagentReplyCapability } from "../../packages/intercom/subagent-reply-capability.js";

type Handler = (event: never, context: ExtensionContext) => void;
function fixture() {
	const handlers = new Map<string, Handler>();
	const updates: PresenceUpdates[] = [];
	let connected = true;
	const capability = registerSubagentReplyCapability(
		{
			on: (name: string, handler: Handler) => {
				handlers.set(name, handler);
			},
		} as Pick<ExtensionAPI, "on">,
		() =>
			connected
				? {
						updatePresence: (update) => {
							updates.push(update);
							return true;
						},
					}
				: null,
	);
	const start = (executionEnded?: AbortSignal) =>
		handlers.get("session_start")?.(
			{} as never,
			{ subagentPolicy: executionEnded ? { executionEnded } : undefined } as ExtensionContext,
		);
	return {
		capability,
		updates,
		start,
		disconnect: () => {
			connected = false;
		},
		reconnect: () => {
			connected = true;
		},
	};
}

for (const outcome of ["completed", "failed", "interrupted", "cancelled"]) {
	test(`${outcome} execution becomes non-replyable without disconnecting retained send transport`, () => {
		const f = fixture();
		const owner = new AbortController();
		f.start(owner.signal);
		assert.equal(f.capability(), "live");
		owner.abort(outcome);
		assert.equal(f.capability(), "terminal");
		assert.deepEqual(f.updates, [{ replyCapability: "terminal" }]);
	});
}

test("termination while disconnected is retained for reconnect registration; old execution cannot retire replacement", () => {
	const f = fixture();
	const old = new AbortController();
	const current = new AbortController();
	f.start(old.signal);
	f.start(current.signal);
	old.abort();
	assert.equal(f.capability(), "live");
	assert.deepEqual(f.updates, []);
	f.disconnect();
	current.abort();
	f.reconnect();
	assert.equal(f.capability(), "terminal");
	assert.deepEqual(f.updates, []);
	// Lazy initialization/reload sees a signal that already ended.
	f.start(current.signal);
	assert.deepEqual(f.updates, [{ replyCapability: "terminal" }]);
});

test("ordinary idle sessions and workflow post-mortem sessions have no noninteractive execution restriction", () => {
	const f = fixture();
	f.start();
	assert.equal(f.capability(), undefined);
	assert.deepEqual(f.updates, []);
});
