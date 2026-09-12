import { type ReactiveWidgetComponent, ScrollableComponentViewport } from "@bastani/atomic";
import { truncateToWidth } from "./text-helpers.js";

/** Shared list cap, including its scroll hint. Short terminals use at most a third. */
export const WORKFLOW_WIDGET_MAX_ROWS = 10;

export class WorkflowWidgetViewport implements ReactiveWidgetComponent {
	private readonly viewport = new ScrollableComponentViewport();
	private lines: string[] = [];
	private scrollable = false;

	constructor(
		private readonly content: ReactiveWidgetComponent,
		private readonly terminalRows: () => number,
		private readonly requestRender: () => void,
	) {
		this.viewport.setComponents([{ render: () => this.lines, invalidate() {} }]);
		this.viewport.scrollTo(0);
	}

	scroll(direction: -1 | 1): void {
		if (!this.scrollable) return;
		this.viewport.scrollBy(direction);
		this.requestRender();
	}

	render(width: number): string[] {
		const cap = Math.max(1, Math.min(WORKFLOW_WIDGET_MAX_ROWS, Math.floor(this.terminalRows() / 3)));
		const previousLineCount = this.lines.length;
		this.lines = this.content.render(width);
		if (previousLineCount <= 1 || (this.lines.length < previousLineCount && this.lines.length <= cap)) {
			this.viewport.scrollTo(0);
		}
		this.scrollable = this.lines.length > 1;
		// #3015: the dock can paint only the first row of our nominal viewport.
		// Advance one row and allow the final source row to become the first row,
		// even when the whole list fits our cap. No clipped row can be skipped.
		this.viewport.setVisibleRows(1);
		this.viewport.render(width);
		if (!this.scrollable) return this.lines;
		const first = this.viewport.getMaxScroll() - this.viewport.getScrollFromBottom() + 1;
		const visible = this.lines.slice(first - 1, first - 1 + Math.max(1, cap - 1));
		// At a one-row budget retain content rather than only chrome.
		if (cap === 1) return visible;
		const hint = ` ${first}–${first + visible.length - 1}/${this.lines.length} · Alt+PgUp/PgDn scroll workflows`;
		return [...visible, truncateToWidth(hint, width, "…")];
	}

	invalidate(): void {
		this.content.invalidate?.();
	}
	dispose(): void {
		this.content.dispose?.();
	}
}
