import { stripAnsi } from "../../utils/ansi.js";
import { type ActivityWatchdogDiagnostic, shouldRenderEngineDiagnosticAsChatError } from "./activity-watchdog.ts";

export interface EngineDiagnosticView {
	stopWorkingLoader(): void;
	showStatus(message: string, persist?: boolean): void;
	showError(message: string): void;
}

/** Sanitize only the display copy, like task-detail's multiline presentation. */
export function renderDiagnosticStatus(message: string, view: Pick<EngineDiagnosticView, "showStatus">): void {
	// ANSI stripping alone misses bare C0/C1 controls and incomplete escape sequences.
	const text = stripAnsi(message).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, " ");
	view.showStatus(text, true);
}

/**
 * Host presentation policy for interactive-engine diagnostics.
 *
 * Engine recovery is operational status, not a failure: the engine-death
 * teardown has already remounted the editor and restored focus, so the notice is
 * a calm status line rather than a red chat error. Heartbeat-watchdog gaps stay
 * internal. Concrete engine failures still surface as chat errors.
 */
export function renderEngineDiagnostic(diagnostic: ActivityWatchdogDiagnostic, view: EngineDiagnosticView): void {
	if (diagnostic.source === "stderr") {
		renderDiagnosticStatus(diagnostic.message, view);
		return;
	}
	if (diagnostic.source === "recovery") {
		view.stopWorkingLoader();
		view.showStatus(diagnostic.message);
		return;
	}
	if (shouldRenderEngineDiagnosticAsChatError(diagnostic)) view.showError(diagnostic.message);
}
