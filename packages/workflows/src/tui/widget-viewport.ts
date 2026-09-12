import { type ReactiveWidgetComponent, ScrollableComponentViewport } from "@bastani/atomic";
import { truncateToWidth } from "./text-helpers.js";

/** Shared list cap, including its scroll hint. Short terminals use at most a third. */
export const WORKFLOW_WIDGET_MAX_ROWS = 10;

export class WorkflowWidgetViewport implements ReactiveWidgetComponent {
	private readonly viewport = new ScrollableComponentViewport();
	private lines: string[] = [];
	private pageRows = 1;
	private overflowing = false;

	constructor(
		private readonly content: ReactiveWidgetComponent,
		private readonly terminalRows: () => number,
		private readonly requestRender: () => void,
	) {
		this.viewport.setComponents([{ render: () => this.lines, invalidate() {} }]);
		this.viewport.scrollTo(0);
	}

	scroll(direction: -1 | 1): void {
		if (!this.overflowing) return;
		this.viewport.scrollBy(direction * this.pageRows);
		this.requestRender();
	}

	render(width: number): string[] {
		const cap = Math.max(1, Math.min(WORKFLOW_WIDGET_MAX_ROWS, Math.floor(this.terminalRows() / 3)));
		this.lines = this.content.render(width);
		this.overflowing = this.lines.length > cap;
		this.pageRows = Math.max(1, cap - 1);
		this.viewport.setVisibleRows(this.overflowing ? this.pageRows : Math.max(1, this.lines.length));
		const visible = this.viewport.render(width);
		if (!this.overflowing) return this.lines;
		// At a one-row budget retain a scrollable content row, rather than only chrome.
		if (cap === 1) return visible;
		const first = this.viewport.getMaxScroll() - this.viewport.getScrollFromBottom() + 1;
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
