/** Escape untrusted text before ANSI-aware layout; never change questionnaire state. */
export function escapeDisplayText(text: string): string {
	return text.replace(
		/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g,
		(control) => `\\x${control.charCodeAt(0).toString(16).padStart(2, "0")}`,
	);
}
