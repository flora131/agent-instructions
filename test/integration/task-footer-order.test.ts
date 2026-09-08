import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import { bindOwnerTaskStore } from "@bastani/atomic";
import { test, vi } from "vitest";
import type { ExtensionUIContext } from "../../packages/coding-agent/src/core/extensions/index.js";
import { FooterDataProvider } from "../../packages/coding-agent/src/core/footer-data-provider.js";
import { FooterComponent } from "../../packages/coding-agent/src/modes/interactive/components/footer.js";
import { bindEngineTaskWidget } from "../../packages/coding-agent/src/modes/rpc/task-ui-bridge.js";
import {
	createProductionFullscreenContext,
	getLayoutFrame,
} from "../../packages/coding-agent/test/helpers/interactive-fullscreen-layout.js";
import { installStoreWidget } from "../../packages/workflows/src/tui/store-widget-installer.js";
import { taskFixture } from "../helpers/task-projection.js";
import {
	createStore,
	deriveGraphTheme,
	fakeFooterAgentSession,
	makeHandle,
	makeTestTui,
	StageChatView,
	setupRun,
} from "../unit/stage-chat-view-helpers.js";

test.each(["main", "stage", "engine-workflow-first", "engine-tasks-first"] as const)(
	"%s composed chat keeps active and retained failed tasks below MCP and above the workflow widget when present",
	async (surface) => {
		const tasks = taskFixture();
		const emptyTasks = taskFixture();
		const session = fakeFooterAgentSession();
		bindOwnerTaskStore(session, tasks.store);
		const footerData = new FooterDataProvider(tmpdir());
		footerData.setExtensionStatus("mcp", "MCP  1 server · 3 tools");
		const store = createStore();
		setupRun(store, "order-run", "stage-a");
		const main = surface !== "stage" ? createProductionFullscreenContext({ rows: 40, columns: 100 }) : undefined;
		const stage =
			surface === "stage"
				? new StageChatView({
						store,
						graphTheme: deriveGraphTheme({}),
						runId: "order-run",
						stageId: "stage-a",
						workflowName: "order",
						handle: makeHandle(undefined, [], "running", session).handle,
						footerData,
						piTui: makeTestTui(40),
						onClose() {},
						onDetach() {},
					})
				: undefined;
		let removeWidget = () => {};
		let removeTasks = () => {};
		const mountWorkflow = () => {
			assert.ok(main);
			removeWidget = installStoreWidget(
				{
					ui: {
						setWidget: (key, factory) =>
							main.context.setExtensionWidget(
								key,
								factory
									? (tui, theme) => {
											const widget = factory(tui, theme);
											return { ...widget, invalidate: () => widget.invalidate?.() };
										}
									: undefined,
								{ placement: "belowEditor" },
							),
						requestRender: () => main.tui.requestRender(),
					},
				},
				store,
			);
		};
		if (main) {
			main.context.footerContainer.clear();
			main.context.footerContainer.addChild(
				new FooterComponent(surface === "main" ? session : fakeFooterAgentSession(), footerData),
			);
			if (surface !== "engine-tasks-first") mountWorkflow();
			if (surface.startsWith("engine"))
				removeTasks = bindEngineTaskWidget(session, {
					setWidget: main.context.setExtensionWidget.bind(main.context),
					requestRender: () => main.tui.requestRender(),
				} as ExtensionUIContext);
		}
		const render = () => {
			if (stage) return stripVTControlCharacters(stage.render(100).join("\n"));
			assert.ok(main);
			main.tui.renderNow();
			return stripVTControlCharacters(getLayoutFrame(main.tui).lines.join("\n"));
		};
		const assertOrder = (expected: RegExp, workflow = surface !== "stage") => {
			const screen = render();
			const rows = screen.split("\n");
			const mcp = rows.findIndex((row) => row.includes("MCP "));
			const task = rows.findIndex((row) => row.includes("Tasks  "));
			const background = rows.findIndex((row) => row.includes("BACKGROUND"));
			assert.ok(mcp >= 0, screen);
			assert.equal(rows.filter((row) => row.includes("Tasks  ")).length, 1, screen);
			assert.match(rows[task]!, expected);
			assert.ok(task > mcp, `Task status must follow MCP:\n${screen}`);
			if (workflow) assert.ok(background > task, `BACKGROUND must follow task status:\n${screen}`);
			else assert.equal(background, -1, screen);
		};
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.match(render(), /MCP /);
			assert.doesNotMatch(render(), /Tasks {2}/);
			if (main && surface !== "engine-tasks-first") assert.match(render(), /BACKGROUND/);
			await tasks.start("will fail");
			await tasks.start("keeps running");
			if (surface === "engine-tasks-first") mountWorkflow();
			assertOrder(/2 local agents running/);
			tasks.runners[0].result.resolve({ kind: "failed", code: "fixture", message: "Retained failure" });
			await vi.waitFor(() => {
				tasks.store.drain();
				assert.equal(tasks.store.tasks[0]?.execution.kind, "settled");
			});
			assertOrder(/1 failed.*1 local agent running/);
			if (stage) {
				const narrow = stripVTControlCharacters(stage.render(40).join("\n"));
				assert.match(narrow, /Tasks {2}1 failed.*\/tasks/);
				assert.match(narrow, /ctrl\+x (?:return to )?graph/);
			}
			await tasks.settle(1);
			assertOrder(/1 failed/);
			if (main) {
				removeWidget();
				main.context.setExtensionWidget("workflow.run", undefined);
			}
			assertOrder(/1 failed/, false);
			bindOwnerTaskStore(session, emptyTasks.store);
			assert.match(render(), /MCP /);
			assert.doesNotMatch(render(), /Tasks {2}|BACKGROUND/);
		} finally {
			removeTasks();
			removeWidget();
			stage?.dispose();
			if (main) {
				main.resolveTheme();
				await main.initPromise;
				main.tui.stop();
				main.restoreOffline();
			}
			footerData.dispose();
			await tasks.dispose();
			await emptyTasks.dispose();
		}
	},
);
