import { isAbsolute } from "node:path";
import type { SessionActivity } from "./activity.js";
import type { HerdrEnvironment } from "./environment.js";
import { executeHerdr, type HerdrDiagnostic } from "./transport.js";

export interface PaneIdentity {
	id: string;
	path?: string;
}
export interface PaneReportingOptions {
	clock?: () => number;
	timeoutMs?: number;
	diagnostic?: (diagnostic: HerdrDiagnostic) => void;
}
export interface PaneOwner {
	environment: HerdrEnvironment;
	identity: PaneIdentity;
	options: PaneReportingOptions;
	status: "active" | "releasing" | "retired";
	seq: number;
	identitySent: boolean;
	pending?: SessionActivity;
	flight?: Promise<void>;
	release?: Promise<void>;
	flush(): Promise<void>;
}

// Host module lifetime outlives inline extension factories and runner generations.
const owners = new Map<string, PaneOwner>();
let highWater = 0;

function diagnostic(owner: PaneOwner, value: HerdrDiagnostic): void {
	owner.options.diagnostic?.(value);
}

function argv(owner: PaneOwner, command: string): string[] {
	return [
		"pane",
		command,
		owner.environment.paneId,
		"--source",
		"custom:atomic",
		"--agent",
		"atomic",
		"--seq",
		String(owner.seq),
	];
}

async function send(owner: PaneOwner, args: string[]): Promise<void> {
	const result = await executeHerdr(owner.environment, args, owner.options.timeoutMs);
	if (result) diagnostic(owner, result);
}

export async function claimPaneReporting(
	environment: HerdrEnvironment,
	identity: PaneIdentity,
	options: PaneReportingOptions = {},
): Promise<PaneOwner> {
	while (owners.has(environment.paneId)) await releasePaneReporting(owners.get(environment.paneId)!);
	const owner: PaneOwner = {
		environment,
		identity,
		options,
		status: "active",
		seq: 0,
		identitySent: false,
		async flush() {
			await this.flight;
		},
	};
	owners.set(environment.paneId, owner);
	return owner;
}

export function reportPaneActivity(owner: PaneOwner, activity: SessionActivity): void {
	if (owner.status !== "active" || owners.get(owner.environment.paneId) !== owner) {
		diagnostic(owner, { kind: "stale_owner" });
		return;
	}
	owner.pending = activity;
	if (owner.flight) return;
	owner.flight = (async () => {
		while (owner.pending && owner.status === "active") {
			const next = owner.pending;
			owner.pending = undefined;
			owner.seq = highWater = Math.max((owner.options.clock ?? Date.now)(), highWater + 1);
			const args = [...argv(owner, "report-agent"), "--state", next.state];
			if (next.message) args.push("--message", next.message);
			if (!owner.identitySent) {
				args.push("--agent-session-id", owner.identity.id);
				if (owner.identity.path && isAbsolute(owner.identity.path))
					args.push("--agent-session-path", owner.identity.path);
				owner.identitySent = true;
			}
			await send(owner, args);
		}
	})().finally(() => {
		owner.flight = undefined;
	});
}

export function releasePaneReporting(owner: PaneOwner): Promise<void> {
	if (owner.release) return owner.release;
	if (owners.get(owner.environment.paneId) !== owner || owner.status !== "active") {
		diagnostic(owner, { kind: "stale_owner" });
		return Promise.resolve();
	}
	owner.status = "releasing";
	owner.pending = undefined;
	owner.release = (async () => {
		await owner.flight;
		if (owner.identitySent) await send(owner, argv(owner, "release-agent"));
		owner.status = "retired";
		if (owners.get(owner.environment.paneId) === owner) owners.delete(owner.environment.paneId);
	})();
	return owner.release;
}
