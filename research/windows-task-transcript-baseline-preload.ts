import { appendFileSync, readFileSync } from "node:fs";
import { plugin } from "bun";

// Baseline control only: substitute exactly one module without editing the checkout.
const baseline = process.env.TASK_TERMINAL_BASELINE;
if (baseline) {
	plugin({
		name: "task-transcript-baseline-control",
		setup(build) {
			build.onLoad({ filter: /[\\/]task-live-transcript\.ts$/ }, () => {
				appendFileSync(
					process.env.TASK_TERMINAL_EVENTS!,
					`${JSON.stringify({ kind: "baseline-loaded", at: performance.now(), path: baseline })}\n`,
				);
				return { contents: readFileSync(baseline, "utf8"), loader: "ts" };
			});
		},
	});
}
