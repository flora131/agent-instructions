import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "../../core/extensions/types.ts";
import type { WorkflowRootActivity } from "../../core/extensions/workflow-events.js";
import { SettingsManager } from "../../core/settings-manager.ts";
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
		let lease: { dispose(): void } | undefined;
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
		const report = () => {
			if (!owner) return;
			const activity = deriveSessionActivity({
				agentRunning,
				openPromptCount,
				roots: [...roots.values()],
				availability,
			});
			if (activity) reportPaneActivity(owner, activity);
		};
		pi.on("session_start", async (_event, ctx) => {
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
			const current = ++generation;
			lease?.dispose();
			lease = undefined;
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
		});
		pi.on("agent_start", () => {
			agentRunning = true;
			report();
		});
		pi.on("agent_settled", () => {
			agentRunning = false;
			report();
		});
		pi.on("ui_prompt_start", () => {
			openPromptCount++;
			report();
		});
		pi.on("ui_prompt_end", () => {
			openPromptCount = Math.max(0, openPromptCount - 1);
			report();
		});
		pi.on("session_shutdown", async () => {
			generation++;
			lease?.dispose();
			lease = undefined;
			const previous = owner;
			owner = undefined;
			if (previous) await releasePaneReporting(previous);
		});
	};
}

export default function herdrExtension(pi: ExtensionAPI): void {
	createHerdrExtension()(pi);
}
