import { getExtensionContextOwner, publishExtensionContextEffect } from "../../core/extensions/runner-context.ts";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "../../core/extensions/types.ts";
import type { WorkflowRootActivity } from "../../core/extensions/workflow-events.js";
import { SettingsManager } from "../../core/settings-manager.ts";
import { OwnerTaskStore } from "../../core/tasks/owner-store.js";
import { deriveSessionActivity } from "./activity.js";
import { captureHerdrEnvironment } from "./environment.js";
import {
	claimPaneReporting,
	type PaneOwner,
	type PaneReportingOptions,
	releasePaneReporting,
	reportPaneActivity,
} from "./pane-owner.js";
import type { HerdrDiagnostic } from "./transport.js";

export interface HerdrExtensionOptions extends PaneReportingOptions {
	env?: NodeJS.ProcessEnv;
	enabled?: (ctx: ExtensionContext) => boolean;
}

function enabled(ctx: ExtensionContext): boolean {
	const settings = SettingsManager.create(ctx.cwd, undefined, { projectTrusted: ctx.isProjectTrusted() });
	return (settings.getProjectSettings().herdr?.enabled ?? settings.getGlobalSettings().herdr?.enabled) !== false;
}

export function createHerdrExtension(options: HerdrExtensionOptions = {}): ExtensionFactory {
	return (pi) => {
		if (!captureHerdrEnvironment(options.env ?? process.env)) return;
		let owner: PaneOwner | undefined;
		// Supplied loaders can share closures across sessions and overlapping reload runners.
		let boundSessionManager: ExtensionContext["sessionManager"] | undefined;
		let boundRunner: object | undefined;
		const retiredRunners = new WeakSet<object>();
		const ownsBinding = (ctx: ExtensionContext) =>
			boundSessionManager !== undefined && getExtensionContextOwner(ctx) === boundRunner;
		let lease: { dispose(): void } | undefined;
		let taskStore: OwnerTaskStore | undefined;
		let unsubscribeTasks: (() => void) | undefined;
		let agentRunning = false;
		let openPromptCount = 0;
		let availability: "ready" | "unavailable" | "recovering" = "unavailable";
		const roots = new Map<string, WorkflowRootActivity>();
		const seenDiagnostics = new Set<string>();
		let generation = 0;
		const diagnostic = (value: HerdrDiagnostic) => {
			const key = `${value.kind}:${value.owner ?? ""}`;
			if (seenDiagnostics.has(key)) return;
			seenDiagnostics.add(key);
			if (options.diagnostic) options.diagnostic(value);
			else console.error(`[Herdr] ${value.kind}${value.owner ? `: deferring to ${value.owner}` : ""}`);
		};
		const tasksRunning = () => taskStore?.tasks.some((task) => task.execution.kind !== "settled") ?? false;
		const report = () => {
			if (!owner) return;
			const activity = deriveSessionActivity({
				agentRunning,
				tasksRunning: tasksRunning(),
				openPromptCount,
				roots: [...roots.values()],
				availability,
			});
			if (activity) reportPaneActivity(owner, activity);
		};
		const start = async (ctx: ExtensionContext) => {
			const runner = getExtensionContextOwner(ctx);
			if (retiredRunners.has(runner)) return;
			if (boundSessionManager && ctx.sessionManager !== boundSessionManager) return;
			const environment = captureHerdrEnvironment(options.env ?? process.env);
			if (!environment || ctx.mode !== "tui" || !ctx.hasUI || ctx.subagentPolicy || ctx.orchestrationContext) return;
			if (!(options.enabled ?? enabled)(ctx)) return;
			const conflict = ctx
				.getExtensionPaths?.()
				.find((path) => /herdr-atomic-reporter|herdr-agent-state/.test(path));
			if (conflict) {
				diagnostic({ kind: "unsupported", owner: conflict });
				return;
			}
			if (boundRunner && boundRunner !== runner) retiredRunners.add(boundRunner);
			boundRunner = runner;
			boundSessionManager = ctx.sessionManager;
			const current = ++generation;
			lease?.dispose();
			lease = undefined;
			unsubscribeTasks?.();
			taskStore?.dispose();
			unsubscribeTasks = undefined;
			taskStore = undefined;
			openPromptCount = 0;
			roots.clear();
			availability = "unavailable";
			const claimed = await claimPaneReporting(
				environment,
				{ id: ctx.sessionManager.getSessionId(), path: ctx.sessionManager.getSessionFile() },
				{ ...options, diagnostic },
			);
			if (current !== generation) {
				await releasePaneReporting(claimed);
				return;
			}
			owner = claimed;
			agentRunning = !ctx.isIdle();
			const taskHost = ctx.getAgentTaskHost?.();
			if (taskHost) {
				const { supervisor, owner: taskOwner } = taskHost.ownerBinding;
				taskStore = new OwnerTaskStore(supervisor, taskOwner);
				taskStore.connect();
				let running = tasksRunning();
				unsubscribeTasks = taskStore.subscribe(() => {
					if (current !== generation) return;
					const next = tasksRunning();
					if (next === running) return;
					running = next;
					report();
				});
			}
			lease = ctx.observeWorkflowActivity((frame) => {
				if (current !== generation) return;
				if (frame.kind === "snapshot") {
					availability = frame.availability;
					roots.clear();
					if (frame.availability === "ready") for (const root of frame.roots) roots.set(root.rootRunId, root);
				} else if (frame.kind === "changed") roots.set(frame.root.rootRunId, frame.root);
				else roots.delete(frame.rootRunId);
				report();
			});
		};
		pi.on("session_start", (_event, ctx) => publishExtensionContextEffect(ctx, () => start(ctx)));
		pi.on("agent_start", (_event, ctx) => {
			if (!ownsBinding(ctx)) return;
			agentRunning = true;
			report();
		});
		pi.on("agent_settled", (_event, ctx) => {
			if (!ownsBinding(ctx)) return;
			agentRunning = false;
			report();
		});
		pi.on("ui_prompt_start", (_event, ctx) => {
			if (!ownsBinding(ctx)) return;
			openPromptCount++;
			report();
		});
		pi.on("ui_prompt_end", (_event, ctx) => {
			if (!ownsBinding(ctx)) return;
			openPromptCount = Math.max(0, openPromptCount - 1);
			report();
		});
		pi.on("session_shutdown", async (event, ctx) => {
			if (!ownsBinding(ctx)) return;
			// A non-quit stop may restart this runner, unless a successor supersedes it first.
			if (event.reason === "quit") retiredRunners.add(boundRunner!);
			generation++;
			lease?.dispose();
			lease = undefined;
			unsubscribeTasks?.();
			taskStore?.dispose();
			unsubscribeTasks = undefined;
			taskStore = undefined;
			const previous = owner;
			owner = undefined;
			// Clear before awaiting transport: a successor can bind while retirement drains,
			// and this shutdown's completion must never clear that newer binding.
			boundSessionManager = undefined;
			if (previous) await releasePaneReporting(previous);
		});
	};
}

export default function herdrExtension(pi: ExtensionAPI): void {
	createHerdrExtension()(pi);
}
