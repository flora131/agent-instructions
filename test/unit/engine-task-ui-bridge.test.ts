import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { type Component, getKeybindings, setKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { test } from "vitest";
import type { AgentSession } from "../../packages/coding-agent/src/core/agent-session.js";
import type { ExtensionUIContext } from "../../packages/coding-agent/src/core/extensions/index.js";
import { KeybindingsManager } from "../../packages/coding-agent/src/core/keybindings.js";
import { bindOwnerTaskStore } from "../../packages/coding-agent/src/core/tasks/owner-store.js";
import { initTheme, theme } from "../../packages/coding-agent/src/modes/interactive/theme/theme.js";
import { EngineCustomUiService } from "../../packages/coding-agent/src/modes/interactive-engine/engine-custom-ui.ts";
import {
	type InteractiveEngineMessage,
	parseInteractiveEngineMessage,
	serializeInteractiveEngineFrame,
} from "../../packages/coding-agent/src/modes/interactive-engine/protocol.ts";
import {
	bindEngineTaskWidget,
	showEngineTaskInspector,
} from "../../packages/coding-agent/src/modes/rpc/task-ui-bridge.js";
import { taskFixture } from "../helpers/task-projection.js";

test("engine task widget follows the real lazy owner through activity, settlement and disposal", async () => {
	initTheme("dark");
	const fixture = taskFixture();
	const session = {} as AgentSession;
	let widget: Component | undefined;
	const currentWidget = (): Component | undefined => widget;
	let renders = 0;
	const ui = {
		setWidget(_key, content, options) {
			if (content) assert.equal(options?.placement, "belowEditor");
			widget =
				typeof content === "function"
					? content({} as Parameters<Exclude<typeof content, string[] | undefined>>[0], theme)
					: undefined;
		},
		requestRender() {
			renders++;
		},
		custom() {
			throw new Error("Task updates must not open the inspector");
		},
	} as Pick<ExtensionUIContext, "setWidget" | "requestRender" | "custom"> as ExtensionUIContext;
	const dispose = bindEngineTaskWidget(session, ui);
	try {
		assert.equal(widget, undefined);
		bindOwnerTaskStore(session, fixture.store);
		await fixture.start("Visible background review");
		const mounted = currentWidget();
		assert.ok(mounted);
		assert.equal(mounted.render(80).length, 1);
		assert.match(stripVTControlCharacters(mounted.render(80).join("\n")), /Tasks.*1.*\/tasks/);
		assert.doesNotMatch(stripVTControlCharacters(mounted.render(80).join("\n")), /Visible background review/);
		fixture.runners[0].context.reportActivity({
			reportId: "action",
			change: { kind: "action", tool: "read", text: "Inspecting the UI" },
		});
		fixture.store.drain();
		assert.equal(mounted.render(80).length, 1);
		assert.doesNotMatch(
			stripVTControlCharacters(mounted.render(80).join("\n")),
			/Inspecting the UI|Visible background review/,
		);
		assert.ok(renders > 0);
		await fixture.settle();
		assert.match(stripVTControlCharacters(mounted.render(80).join("\n")), /1 finished.*\/tasks/);
		dispose();
		await fixture.start("Should not mount after disposal");
		assert.equal(widget, undefined);
	} finally {
		dispose();
		await fixture.dispose();
	}
});

test("engine task inspector requests an opaque fullscreen overlay using live host geometry", async () => {
	initTheme("dark");
	const previousKeys = getKeybindings();
	const keys = new KeybindingsManager();
	setKeybindings(keys);
	const fixture = taskFixture();
	const messages: InteractiveEngineMessage[] = [];
	const service = new EngineCustomUiService((line) => {
		const message = parseInteractiveEngineMessage(line);
		if (message) messages.push(message);
	}, keys);
	const session = {
		getAgentTaskHost() {},
		extensionRunner: { getUIContext: () => ({ custom: service.custom.bind(service) }) },
	} as unknown as AgentSession;
	bindOwnerTaskStore(session, fixture.store);
	let completion: Promise<void> | undefined;
	try {
		await fixture.start("Fullscreen background review");
		completion = showEngineTaskInspector(session);
		await new Promise<void>((resolve) => setImmediate(resolve));
		const open = messages.find((message) => message.type === "engine_custom_open");
		assert.ok(open && open.type === "engine_custom_open");
		assert.equal(open.overlay, true, "task inspection must not replace the editor inline");
		assert.deepEqual(open.overlayOptions, { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 });
		assert.equal(open.deferInlineCustomUiFocus, true);
		assert.equal(open.handlesInternalUiAction, true);
		assert.notEqual(open.handlesCtrlC, true, "keep the host's first-press Ctrl+C dismissal");
		for (const [width, rows] of [
			[80, 24],
			[31, 9],
			[100, 40],
			[12, 3],
		]) {
			service.handleLine(
				serializeInteractiveEngineFrame({
					type: "engine_custom_render",
					componentId: open.componentId,
					requestId: messages.length,
					width,
					rows,
				}),
			);
			await new Promise<void>((resolve) => setImmediate(resolve));
			const frame = messages.findLast((message) => message.type === "engine_custom_frame");
			assert.ok(frame && frame.type === "engine_custom_frame");
			assert.equal(frame.lines.length, rows, "short task lists must cover the entire host height");
			assert.ok(
				frame.lines.every((line) => visibleWidth(line) === width),
				"all rows must cover the host width",
			);
		}
	} finally {
		service.dispose();
		await completion;
		await fixture.dispose();
		setKeybindings(previousKeys);
	}
});
