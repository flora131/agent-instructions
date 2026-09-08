import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import {
	Container,
	getKeybindings,
	ScrollView,
	setKeybindings,
	Text,
	VStack,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { test } from "vitest";
import type { AgentSession } from "../../packages/coding-agent/src/core/agent-session.js";
import type { ExtensionUIContext } from "../../packages/coding-agent/src/core/extensions/index.js";
import { KeybindingsManager } from "../../packages/coding-agent/src/core/keybindings.js";
import { SessionManager } from "../../packages/coding-agent/src/core/session-manager.js";
import { bindOwnerTaskStore } from "../../packages/coding-agent/src/core/tasks/owner-store.js";
import { CustomEditor } from "../../packages/coding-agent/src/modes/interactive/components/custom-editor.ts";
import {
	InteractiveModeBase,
	shouldHandleFullscreenViewportInput,
} from "../../packages/coding-agent/src/modes/interactive/interactive-mode-base.ts";
import "../../packages/coding-agent/src/modes/interactive/interactive-extension-context.ts";
import "../../packages/coding-agent/src/modes/interactive/interactive-extension-custom-ui.ts";
import "../../packages/coding-agent/src/modes/interactive/interactive-selectors.ts";
import { registerStartupInputListeners } from "../../packages/coding-agent/src/modes/interactive/interactive-input-handling.ts";
import {
	createFullscreenTui,
	handleFocusedOverlayInternalUiAction,
} from "../../packages/coding-agent/src/modes/interactive/interactive-tui.ts";
import { getEditorTheme, initTheme } from "../../packages/coding-agent/src/modes/interactive/theme/theme.js";
import { EngineCustomUiService } from "../../packages/coding-agent/src/modes/interactive-engine/engine-custom-ui.ts";
import type { IsolatedInteractiveRuntime } from "../../packages/coding-agent/src/modes/interactive-engine/isolated-runtime.ts";
import {
	type InteractiveEngineCommand,
	type InteractiveEngineMessage,
	parseInteractiveEngineMessage,
	serializeInteractiveEngineFrame,
} from "../../packages/coding-agent/src/modes/interactive-engine/protocol.ts";
import { RemoteComponentController } from "../../packages/coding-agent/src/modes/interactive-engine/remote-component.ts";
import { registerRemoteProxyOwnership } from "../../packages/coding-agent/src/modes/interactive-engine/remote-input-ownership.ts";
import { showEngineTaskInspector } from "../../packages/coding-agent/src/modes/rpc/task-ui-bridge.js";
import { RecordingTerminal } from "../../packages/coding-agent/test/helpers/interactive-fullscreen-layout.ts";
import { taskFixture } from "../helpers/task-projection.js";

async function flush(): Promise<void> {
	for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

async function mountMainInspector(isolated: boolean) {
	initTheme("dark");
	const keys = new KeybindingsManager({ "app.tasks.inspect": "ctrl+e", "app.tasks.cancel": "ctrl+x" });
	setKeybindings(keys);
	const fixture = taskFixture();
	await fixture.start("Fullscreen review");
	const transcript = SessionManager.inMemory();
	for (let i = 0; i < 50; i++) transcript.appendMessage({ role: "user", content: `CHILD-MESSAGE-${i}`, timestamp: i });
	fixture.runners[0].context.bindTranscript(transcript);
	const terminal = new RecordingTerminal();
	terminal.columns = 80;
	terminal.rows = 24;
	let editor: CustomEditor;
	let hostFallbacks = 0;
	const tui = createFullscreenTui({
		showHardwareCursor: false,
		logDirectory: "/tmp",
		terminal,
		shouldHandleViewportInput: (data, mouse, overlay) =>
			shouldHandleFullscreenViewportInput(tui.getFocusedComponent(), editor, data, mouse, overlay, keys),
		onOverlayUnhandledInput: () => {
			hostFallbacks++;
			return true;
		},
		onOverlayInternalUiAction: (url) => handleFocusedOverlayInternalUiAction(tui, url),
		onInternalUiAction: () => {
			hostFallbacks++;
		},
	});
	editor = new CustomEditor(tui, getEditorTheme(), keys);
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	const document = new Text(Array.from({ length: 100 }, (_, i) => `MAIN-CHAT-${i}`).join("\n"), 0, 0);
	const scroll = new ScrollView(document, { follow: "end", primary: true });
	tui.setLayoutRoot(
		new VStack([
			{ component: scroll, basis: 0, grow: 1, minSize: 1 },
			{ component: editorContainer, shrink: 0 },
		]),
	);
	tui.setFocus(editor);
	const listeners = new Set<(message: InteractiveEngineMessage) => void>();
	let service: EngineCustomUiService | undefined;
	const session = {
		getAgentTaskHost() {},
		extensionRunner: { getUIContext: () => ({ custom: service!.custom.bind(service!) }) },
	} as unknown as AgentSession;
	bindOwnerTaskStore(session, fixture.store);
	const runtime = {
		session,
		onGenerationEnded: () => () => {},
		onEngineMessage: (listener: (message: InteractiveEngineMessage) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		sendEngineCommand: (command: InteractiveEngineCommand) =>
			service?.handleLine(serializeInteractiveEngineFrame(command)),
	} as unknown as IsolatedInteractiveRuntime;
	const mode = Object.assign(Object.create(InteractiveModeBase.prototype), {
		ui: tui,
		runtimeHost: runtime,
		editor,
		defaultEditor: editor,
		editorContainer,
		keybindings: keys,
		firstSubmitRecorded: true,
		blockingInlineCustomUiDepth: 0,
		deferredInlineCustomUiFocusDepth: 0,
		hostCustomUiStateListeners: new Set(),
		addTuiInputListener: tui.addInputListener.bind(tui),
		handleCtrlC: () => {
			hostFallbacks++;
		},
		showError: (message: string) => {
			throw new Error(message);
		},
	}) as InteractiveModeBase;
	registerStartupInputListeners(mode);
	mode.setupEditorSubmitHandler();
	let controller: RemoteComponentController | undefined;
	let releaseOwnership = () => {};
	if (isolated) {
		service = new EngineCustomUiService((line) => {
			const message = parseInteractiveEngineMessage(line);
			if (message) for (const listener of listeners) listener(message);
		}, keys);
		controller = new RemoteComponentController(
			runtime,
			{
				custom: (factory, options) => mode.showExtensionCustom(factory, options),
				requestRender: () => tui.requestRender(),
				setWidget() {},
			} satisfies Pick<ExtensionUIContext, "custom" | "requestRender" | "setWidget">,
			{ isFullscreen: () => true, onRendererReplaced: () => () => {} },
		);
		releaseOwnership = registerRemoteProxyOwnership(runtime, controller);
	}
	tui.start();
	tui.renderNow();
	const open = () =>
		isolated
			? showEngineTaskInspector(session, { custom: service!.custom.bind(service!) })
			: Promise.resolve(editor.onSubmit!("/tasks"));
	const completion = open();
	await flush();
	async function paint() {
		tui.renderNow();
		await flush();
		tui.renderNow();
		const focused = tui.getFocusedComponent();
		assert.ok(focused);
		return focused.render(terminal.columns);
	}
	async function input(data: string) {
		terminal.input(data);
		await flush();
		return paint();
	}
	return {
		tui,
		terminal,
		editor,
		fixture,
		scroll,
		completion,
		open,
		paint,
		input,
		get hostFallbacks() {
			return hostFallbacks;
		},
		async dispose() {
			controller?.dispose();
			service?.dispose();
			releaseOwnership();
			mode.disposeActiveSelector();
			tui.hideOverlay();
			tui.stop();
			await fixture.dispose();
		},
	};
}

for (const isolated of [false, true]) {
	test(`${isolated ? "isolated engine" : "in-process"} /tasks covers the host, owns keys, and escapes without cancelling`, async () => {
		const previousKeys = getKeybindings();
		const host = await mountMainInspector(isolated);
		try {
			assert.equal(host.tui.hasOverlay(), true, "/tasks must mount an overlay, not an inline selector");
			const assertFrame = async () => {
				const frame = await host.paint();
				assert.equal(frame.length, host.terminal.rows);
				assert.ok(frame.every((line) => visibleWidth(line) === host.terminal.columns));
				assert.doesNotMatch(stripVTControlCharacters(frame.join("\n")), /MAIN-CHAT/);
				return stripVTControlCharacters(frame.join("\n"));
			};
			await assertFrame();
			const scrollTop = host.scroll.scrollTop;
			assert.ok(scrollTop > 0, "fixture must have scrollable main chat history");
			const assertKeysOwned = async () => {
				for (const key of [
					"\x1b[5~",
					"\x1b[6~",
					"\x1b[H",
					"\x1b[F",
					"\x1b[A",
					"\x1b[B",
					"\x14",
					"\x0f",
					"\x06",
					"\x15",
					"\x04",
					"\x1b[1;2A",
					"\x1b[1;2B",
					"\x1b[<64;10;5M",
					"ordinary text",
				]) {
					await host.input(key);
					assert.equal(host.scroll.scrollTop, scrollTop, `main chat scrolled for ${JSON.stringify(key)}`);
					assert.equal(host.editor.getText(), "");
					assert.equal(host.hostFallbacks, 0, `main action received ${JSON.stringify(key)}`);
				}
			};
			await assertKeysOwned();
			await host.input("\x05"); // configured inspect, not hardcoded Enter
			assert.match(await assertFrame(), /Inspect transcript/);
			await assertKeysOwned();
			// Restore the first detail action after the arrow-key checks.
			await host.input("\x1b");
			await host.input("\x05");
			await host.input("\x05");
			assert.match(await assertFrame(), /^Transcript/);
			await assertKeysOwned();
			await host.input("\x1b[F");
			assert.match(await assertFrame(), /CHILD-MESSAGE-49/);
			await host.input("\x1b[H");
			assert.match(await assertFrame(), /CHILD-MESSAGE-0/);
			for (const [width, rows] of [
				[31, 9],
				[100, 40],
			]) {
				host.terminal.resize(width, rows);
				await assertFrame();
			}
			await host.input("\x1b");
			assert.match(await assertFrame(), /Inspect transcript/);
			await host.input("\x1b");
			assert.match(await assertFrame(), /Background tasks/);
			await host.input("\x1b");
			await host.completion;
			assert.equal(host.tui.hasOverlay(), false);
			assert.equal(host.tui.getFocusedComponent(), host.editor);
			assert.equal(host.fixture.runners[0].context.signal.aborted, false);
			const reopened = host.open();
			await flush();
			await host.paint();
			await host.input("\x18"); // configured task cancel still requires confirmation
			assert.match(await assertFrame(), /confirm/);
			await host.input("\x1b");
			assert.equal(host.fixture.runners[0].context.signal.aborted, false);
			await host.input("\x03");
			assert.equal(host.tui.hasOverlay(), false, "physical Ctrl+C must close the view, not trap input");
			await reopened;
			assert.equal(host.tui.getFocusedComponent(), host.editor);
			assert.equal(host.fixture.runners[0].context.signal.aborted, false);
			assert.equal(host.hostFallbacks, 0);
			const beforeChatScroll = host.scroll.scrollTop;
			await host.input("\x1b[5~");
			assert.ok(host.scroll.scrollTop < beforeChatScroll, "main chat paging resumes after closing");
		} finally {
			await host.dispose();
			setKeybindings(previousKeys);
		}
	});
}
