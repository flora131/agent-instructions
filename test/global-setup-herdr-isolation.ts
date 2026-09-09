/**
 * Test TUIs and CLI fixtures must not claim/release the developer's live pane.
 * Clear inherited Herdr credentials in the runner before workers and their
 * subprocesses start. Dedicated reporter tests supply their own fake env.
 */
export default function setup(): void {
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("HERDR_")) delete process.env[key];
	}
}
