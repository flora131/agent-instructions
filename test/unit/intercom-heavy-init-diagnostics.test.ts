import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@bastani/atomic";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import intercom from "../../packages/intercom/index.js";
import { IntercomClientDisconnectedError } from "../../packages/intercom/recoverable-disconnect.js";

type HeavyModule = { default: (pi: ExtensionAPI) => void | Promise<void> };
type ConsoleErrorCall = [message?: unknown, ...optionalParams: unknown[]];
type ImportResult = { error: unknown } | { module: HeavyModule };
type LifecycleHandler = (event: object, ctx: ExtensionContext) => void | Promise<void>;

const originalConsoleError = console.error;
let consoleErrorCalls: ConsoleErrorCall[] = [];

beforeEach(() => {
	consoleErrorCalls = [];
	console.error = (...args: ConsoleErrorCall) => {
		consoleErrorCalls.push(args);
	};
});

afterEach(() => {
	console.error = originalConsoleError;
});

function fixture(importResults: ImportResult[], hasUI = false) {
	const tools = new Map<string, ToolDefinition>();
	const handlers = new Map<string, LifecycleHandler>();
	const eventHandlers = new Map<string, (payload: object) => void>();
	let imports = 0;
	const pi = {
		on(name: string, handler: LifecycleHandler) {
			handlers.set(name, handler);
		},
		registerTool(tool: ToolDefinition) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		registerShortcut() {},
		events: {
			on(name: string, handler: (payload: object) => void) {
				eventHandlers.set(name, handler);
			},
			emit() {},
		},
	};
	intercom(pi as never, {
		async importHeavy() {
			const result = importResults[imports++];
			assert.ok(result, "each heavy initialization attempt needs a fixture result");
			if ("error" in result) throw result.error;
			return result.module;
		},
	});
	const notifications: Array<{ message: string; level?: string }> = [];
	const ctx = {
		hasUI,
		ui: {
			notify(message: string, level?: string) {
				notifications.push({ message, level });
			},
		},
	};
	return {
		notifications,
		ctx,
		async fire(name: string, context = ctx) {
			await handlers.get(name)?.({ type: name, reason: "startup" }, context as ExtensionContext);
		},
		emit(name: string, payload: object) {
			eventHandlers.get(name)?.(payload);
		},
		get imports() {
			return imports;
		},
		executeIntercom(context = ctx) {
			const tool = tools.get("intercom");
			assert.ok(tool, "intercom tool should be registered");
			return tool.execute(
				"tool-call",
				{ action: "list" },
				new AbortController().signal,
				undefined,
				context as ExtensionContext,
			);
		},
	};
}

function successfulHeavyModule(): HeavyModule {
	return {
		default(heavyPi) {
			heavyPi.registerTool({
				name: "intercom",
				label: "Intercom",
				description: "test intercom",
				parameters: Type.Object({}),
				async execute() {
					return { content: [{ type: "text", text: "connected" }], details: {} };
				},
			});
		},
	};
}

describe("Intercom lazy heavy-initialization diagnostics", () => {
	test("shows the reported retryable initialization failure as a warning without console or stack output", async () => {
		const failure = new Error("Connection closen");
		failure.stack = "Error: Connection closen\n    at Socket.onClose (client.ts:42:7)";
		const current = fixture([{ error: failure }, { module: successfulHeavyModule() }], true);
		const log = vi.spyOn(console, "log");
		const warn = vi.spyOn(console, "warn");
		try {
			await assert.rejects(current.executeIntercom(), (error) => error === failure);
			assert.deepEqual(current.notifications, [
				{
					message: "Intercom heavy initialization failed; a later call will retry: Connection closen",
					level: "warning",
				},
			]);
			assert.deepEqual(consoleErrorCalls, []);
			assert.equal(log.mock.calls.length, 0);
			assert.equal(warn.mock.calls.length, 0);
			assert.deepEqual(await current.executeIntercom(), {
				content: [{ type: "text", text: "connected" }],
				details: {},
			});
			assert.equal(current.imports, 2);
		} finally {
			log.mockRestore();
			warn.mockRestore();
		}
	});

	test("keeps rejected initialization and shutdown cleanup with their owners while replacement waits", async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const failure = new Error("Connection closen");
		const cleanupFailure = new Error("cleanup failed during shutdown");
		const current = fixture(
			[
				{
					module: {
						default(pi) {
							pi.on("session_start", async () => {
								entered.resolve();
								await release.promise;
								throw failure;
							});
							pi.on("session_shutdown", () => {
								throw cleanupFailure;
							});
						},
					},
				},
				{ module: successfulHeavyModule() },
			],
			true,
		);
		const rejected = assert.rejects(current.executeIntercom(), (error) => error === failure);
		await entered.promise;
		const cleanupNotifications: string[] = [];
		const shutdown = current.fire("session_shutdown", {
			hasUI: true,
			ui: {
				notify(message: string) {
					cleanupNotifications.push(message);
				},
			},
		});
		const replacement = current.fire("session_start", {
			hasUI: false,
			ui: {
				notify() {
					assert.fail("replacement received an old diagnostic");
				},
			},
		});
		release.resolve();
		await Promise.all([rejected, shutdown, replacement]);
		assert.deepEqual(cleanupNotifications, [
			"Intercom failed to clean rejected lazy candidate: cleanup failed during shutdown",
		]);
		assert.deepEqual(current.notifications, [
			{
				message: "Intercom heavy initialization failed; a later call will retry: Connection closen",
				level: "warning",
			},
		]);
		assert.deepEqual(consoleErrorCalls, []);
		await current.executeIntercom();
		assert.equal(current.imports, 2);
	});

	test("retains noninteractive diagnostic text and error identity across shared failure and later retry", async () => {
		const failure = new Error("Connection closen");
		const current = fixture([{ error: failure }, { module: successfulHeavyModule() }]);
		await Promise.all([1, 2].map(() => assert.rejects(current.executeIntercom(), (error) => error === failure)));
		assert.deepEqual(consoleErrorCalls, [
			["Intercom heavy initialization failed; a later call will retry: Connection closen", failure],
		]);
		assert.equal(consoleErrorCalls[0]?.[1], failure);
		assert.deepEqual(current.notifications, []);
		assert.equal(current.imports, 1);
		await current.executeIntercom();
		assert.equal(current.imports, 2);
	});

	test("keeps background initialization diagnostics bound to the initiating context before replay", async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const failure = new Error("Connection closen");
		const current = fixture(
			[
				{
					module: {
						async default() {
							entered.resolve();
							await release.promise;
							throw failure;
						},
					},
				},
			],
			true,
		);
		await current.fire("turn_start");
		const payload: { completion?: Promise<void> } = {};
		current.emit("atomic:workflow-pending-stage-route", payload);
		assert.ok(payload.completion);
		const rejected = assert.rejects(payload.completion, (error) => error === failure);
		await entered.promise;
		const replacement = {
			hasUI: false,
			ui: {
				notify() {
					assert.fail("wrong session");
				},
			},
		};
		await current.fire("session_start", replacement);
		release.resolve();
		await rejected;
		await tick();
		assert.deepEqual(current.notifications, [
			{
				message: "Intercom heavy initialization failed; a later call will retry: Connection closen",
				level: "warning",
			},
			{
				message: "Intercom event relay failed (atomic:workflow-pending-stage-route): Connection closen",
				level: "error",
			},
		]);
		assert.deepEqual(consoleErrorCalls, []);
	});

	for (const eventName of ["atomic:workflow-pending-stage-route", "atomic:workflow-pending-stage-undeliverable"]) {
		test(`does not redirect a stale ${eventName} callback to the replacement or console`, async () => {
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const failure = new Error("late relay failure");
			const current = fixture(
				[
					{
						module: {
							default(pi) {
								pi.events.on(eventName, async () => {
									entered.resolve();
									await release.promise;
									throw failure;
								});
							},
						},
					},
					{ module: successfulHeavyModule() },
				],
				true,
			);
			let retired = false;
			const origin = {
				...current.ctx,
				get hasUI() {
					if (retired) throw new Error("Extension context is stale");
					return true;
				},
			};
			await current.fire("session_start", origin);
			const payload: {
				completion?: Promise<void> | Promise<boolean>;
				runId: string;
				senderId: string;
				messageId: string;
				notificationId: string;
				reason: string;
			} = {
				runId: "run",
				senderId: "sender",
				messageId: "message",
				notificationId: "notice",
				reason: "stage_never_started",
			};
			current.emit(eventName, payload);
			assert.ok(payload.completion);
			const settled = eventName.endsWith("undeliverable")
				? payload.completion.then((value) => assert.equal(value, false))
				: assert.rejects(payload.completion, (error) => error === failure);
			await entered.promise;
			await current.fire("session_shutdown", origin);
			retired = true;
			await current.fire("session_start", {
				hasUI: false,
				ui: {
					notify() {
						assert.fail("wrong session");
					},
				},
			});
			release.resolve();
			await settled;
			await tick();
			assert.deepEqual(current.notifications, []);
			assert.deepEqual(consoleErrorCalls, []);
			await current.executeIntercom();
			assert.equal(current.imports, 2, "the retired callback does not invalidate the replacement");
		});
	}

	test("a throwing UI sink never logs or replaces the initialization error and remains retryable", async () => {
		const failure = new Error("Connection closen");
		const current = fixture([{ error: failure }, { module: successfulHeavyModule() }], true);
		current.ctx.ui.notify = () => {
			throw new Error("UI closed");
		};
		await assert.rejects(current.executeIntercom(), (error) => error === failure);
		await current.executeIntercom();
		assert.equal(current.imports, 2);
		assert.deepEqual(consoleErrorCalls, []);
	});

	test("attributes a failed startup replay to its lifecycle context rather than the tool caller", async () => {
		const failure = new Error("Connection closen");
		const current = fixture(
			[
				{
					module: {
						default(pi) {
							pi.on("session_start", () => {
								throw failure;
							});
						},
					},
				},
			],
			true,
		);
		await current.fire("session_start");
		const callerNotifications: string[] = [];
		const caller = {
			hasUI: false,
			ui: {
				notify(message: string) {
					callerNotifications.push(message);
				},
			},
		};
		await assert.rejects(current.executeIntercom(caller), (error) => error === failure);
		assert.deepEqual(current.notifications, [
			{
				message: "Intercom heavy initialization failed; a later call will retry: Connection closen",
				level: "warning",
			},
		]);
		assert.deepEqual(callerNotifications, []);
		assert.deepEqual(consoleErrorCalls, []);
	});

	for (const hasUI of [true, false]) {
		test(`routes rejected-candidate cleanup with hasUI=${hasUI} and preserves the initialization error and retry`, async () => {
			const failure = new Error("Connection closen");
			const cleanupFailure = new Error("cleanup failed");
			let cleanups = 0;
			const current = fixture(
				[
					{
						module: {
							default(pi) {
								pi.on("session_start", () => {
									throw failure;
								});
								pi.on("session_shutdown", () => {
									cleanups++;
									throw cleanupFailure;
								});
							},
						},
					},
					{ module: successfulHeavyModule() },
				],
				hasUI,
			);
			await assert.rejects(current.executeIntercom(), (error) => error === failure);
			const prefix = "Intercom failed to clean rejected lazy candidate:";
			const initMessage = "Intercom heavy initialization failed; a later call will retry: Connection closen";
			assert.deepEqual(
				current.notifications,
				hasUI
					? [
							{ message: `${prefix} cleanup failed`, level: "error" },
							{ message: initMessage, level: "warning" },
						]
					: [],
			);
			assert.deepEqual(
				consoleErrorCalls,
				hasUI
					? []
					: [
							[prefix, cleanupFailure],
							[initMessage, failure],
						],
			);
			assert.equal(cleanups, 1);
			await current.executeIntercom();
			assert.equal(current.imports, 2);
		});

		for (const eventName of [
			"subagent:control-intercom",
			"subagent:result-intercom",
			"atomic:workflow-pending-stage-route",
			"atomic:workflow-pending-stage-undeliverable",
		]) {
			test(`routes ${eventName} failure with hasUI=${hasUI} without changing its acknowledgement`, async () => {
				const failure = new Error("Intercom protocol error: bad frame");
				const current = fixture(
					[
						{
							module: {
								default(pi) {
									pi.events.on(eventName, () => {
										throw failure;
									});
								},
							},
						},
					],
					hasUI,
				);
				// Background relays also run in hosts without session_start.
				await current.fire("turn_start");
				const payload: {
					completion?: Promise<void> | Promise<boolean>;
					handled?: boolean;
					runId: string;
					senderId: string;
					messageId: string;
					notificationId: string;
					reason: string;
				} = {
					runId: "run",
					senderId: "sender",
					messageId: "message",
					notificationId: "notice",
					reason: "stage_never_started",
				};
				current.emit(eventName, payload);
				if (eventName === "atomic:workflow-pending-stage-route") {
					assert.ok(payload.completion);
					await assert.rejects(payload.completion, (error) => error === failure);
				} else if (eventName === "atomic:workflow-pending-stage-undeliverable") {
					assert.equal(payload.handled, true);
					assert.ok(payload.completion);
					assert.equal(await payload.completion, false);
				}
				await tick();
				const prefix = `Intercom event relay failed (${eventName}):`;
				assert.deepEqual(
					current.notifications,
					hasUI ? [{ message: `${prefix} ${failure.message}`, level: "error" }] : [],
				);
				assert.deepEqual(consoleErrorCalls, hasUI ? [] : [[prefix, failure]]);
			});
		}
	}

	test("keeps a recoverable client disconnect out of console output while rejecting the caller", async () => {
		const disconnectError = new IntercomClientDisconnectedError();
		const current = fixture([{ error: disconnectError }]);

		await assert.rejects(current.executeIntercom(), disconnectError);
		await Promise.resolve();

		assert.deepEqual(consoleErrorCalls, []);
	});

	test("retries successfully after a silent recoverable client disconnect", async () => {
		const disconnectError = new IntercomClientDisconnectedError();
		const current = fixture([{ error: disconnectError }, { module: successfulHeavyModule() }]);

		await assert.rejects(current.executeIntercom(), disconnectError);
		const result = await current.executeIntercom();
		await Promise.resolve();

		assert.equal(current.imports, 2);
		assert.deepEqual(result, { content: [{ type: "text", text: "connected" }], details: {} });
		assert.deepEqual(consoleErrorCalls, []);
	});

	test("diagnoses a non-recoverable heavy-module import failure", async () => {
		const importError = new Error("Cannot import Intercom heavy module");
		const current = fixture([{ error: importError }]);

		await assert.rejects(current.executeIntercom(), importError);
		await Promise.resolve();

		assert.deepEqual(consoleErrorCalls, [
			[
				"Intercom heavy initialization failed; a later call will retry: Cannot import Intercom heavy module",
				importError,
			],
		]);
	});

	test("keeps neighboring client failures actionable", async () => {
		const disconnectingError = new Error("Client disconnecting");
		const current = fixture([{ error: disconnectingError }]);

		await assert.rejects(current.executeIntercom(), disconnectingError);
		await Promise.resolve();

		assert.deepEqual(consoleErrorCalls, [
			["Intercom heavy initialization failed; a later call will retry: Client disconnecting", disconnectingError],
		]);
	});

	test("keeps ambiguous, look-alike, and non-Error failures actionable", async () => {
		const failures: unknown[] = [
			new Error("Configuration failed after Client disconnected unexpectedly"),
			// Same wording, raised outside the broker client: classification is by
			// construction, so this stays actionable.
			new Error("Client disconnected"),
			"Client disconnected",
			{ reason: "Client disconnected" },
			undefined,
		];

		for (const failure of failures) {
			const current = fixture([{ error: failure }]);
			await assert.rejects(current.executeIntercom());
			await Promise.resolve();
		}

		assert.deepEqual(
			consoleErrorCalls.map(([message, error]) => [message, error]),
			failures.map((failure) => [
				`Intercom heavy initialization failed; a later call will retry: ${failure instanceof Error ? failure.message : String(failure)}`,
				failure,
			]),
		);
	});
});
