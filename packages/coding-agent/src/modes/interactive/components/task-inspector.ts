import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type Component, getKeybindings, Input, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "../../../core/keybindings.ts";
import type { OperationId, PromptRoute, TaskId } from "../../../core/tasks/contracts.js";
import type { OwnerTaskStore } from "../../../core/tasks/owner-store.js";
import { taskTranscriptSource } from "../../../core/tasks/supervisor.js";
import { readTaskTranscript } from "../../../core/tasks/transcript.js";
import { chatEntriesFromAgentMessages, renderChatMessageEntry } from "./chat-message-renderer.ts";
import { TaskDetail, taskDetailActions } from "./task-detail.js";
import { taskListSections } from "./task-list.js";
import { TaskNavigation } from "./task-navigation.js";

/** Focused view only. The store and original session remain the authorities. */
export class TaskInspector implements Component {
	readonly navigation: TaskNavigation;
	private actionIndex = 0;
	private confirmation?: (answer: boolean) => void;
	private transcript?: Component[];
	private cursor?: string;
	private status = "";
	private scroll = 0;
	private detailContent: { prompt?: string; output?: string } = {};
	private readonly input = new Input();
	private readonly unsubscribe: () => void;
	constructor(
		privateStore: OwnerTaskStore,
		privateRender: () => void,
		privateClose: () => void,
		openQuestion?: (route: PromptRoute) => void,
	) {
		this.store = privateStore;
		this.requestRender = privateRender;
		this.close = privateClose;
		this.navigation = new TaskNavigation(getKeybindings() as KeybindingsManager, {
			inspect: () => {
				this.actionIndex = 0;
				this.transcript = undefined;
				void this.loadDetail();
			},
			transcript: () => {
				void this.loadTranscript();
			},
			foreground: (task) => {
				const lease = this.store.resolveTask(task.ref.taskId);
				if (lease.ok)
					void this.store.supervisor.foregroundTask(lease.value).then((result) => {
						this.status = result.ok ? result.value.kind : result.error.message;
						this.requestRender();
					});
			},
			confirmCancel: () =>
				new Promise<boolean>((resolve) => {
					this.confirmation = resolve;
					this.requestRender();
				}),
			cancel: (task) => {
				const lease = this.store.resolveTask(task.ref.taskId);
				if (lease.ok) void this.store.supervisor.cancelTask(lease.value, "user").then(() => this.requestRender());
			},
			stdinAvailable: (task) => {
				const lease = this.store.resolveTask(task.ref.taskId);
				return lease.ok && this.store.supervisor.taskStdin(lease.value).ok;
			},
			input: () => {
				this.input.setValue("");
			},
			openQuestion: (route) => {
				if (openQuestion) {
					this.close();
					openQuestion(route);
				} else this.status = "Question is available in its owning session.";
			},
		});
		this.unsubscribe = this.store.subscribe(() => {
			this.navigation.update(this.store.tasks);
			this.requestRender();
		});
		this.navigation.update(this.store.tasks);
		this.navigation.open();
		this.input.onSubmit = (text) => {
			void this.sendInput(text);
		};
	}
	private readonly store: OwnerTaskStore;
	private readonly requestRender: () => void;
	private readonly close: () => void;
	open(id?: TaskId): void {
		this.navigation.open(id);
	}
	dispose(): void {
		this.confirmation?.(false);
		this.unsubscribe();
	}
	invalidate(): void {}
	private selected() {
		return this.store.tasks.find((task) => task.ref.taskId === this.navigation.selectedTaskId);
	}
	private stdinAvailable(): boolean {
		const task = this.selected();
		if (!task || task.execution.kind === "settled") return false;
		const lease = this.store.resolveTask(task.ref.taskId);
		return lease.ok && this.store.supervisor.taskStdin(lease.value).ok;
	}
	private async sendInput(text: string): Promise<void> {
		const task = this.selected();
		if (!task) return;
		const lease = this.store.resolveTask(task.ref.taskId);
		if (!lease.ok) return;
		const stdin = this.store.supervisor.taskStdin(lease.value);
		if (!stdin.ok) {
			this.status = stdin.error.message;
			return;
		}
		const result = await this.store.supervisor.writeTaskInput(stdin.value, randomUUID() as OperationId, {
			kind: "bytes",
			bytes: Buffer.from(`${text}\n`),
		});
		this.status = result.ok ? `Sent ${result.value.acceptedBytes} bytes` : result.error.message;
		this.input.setValue("");
		this.requestRender();
	}
	private async loadTranscript(earlier = false): Promise<void> {
		const task = this.selected();
		if (!task) return;
		const lease = this.store.resolveTask(task.ref.taskId);
		if (!lease.ok) {
			this.status = lease.error.message;
			return;
		}
		const page = await readTaskTranscript(lease.value, earlier ? this.cursor : undefined);
		const bound = taskTranscriptSource(lease.value);
		if (!page.ok || !bound.ok) {
			this.status = "Transcript unavailable";
			this.requestRender();
			return;
		}
		const ids = new Set(page.value.items.map((item) => item.source.entryId));
		const messages = bound.value.session.getEntries().flatMap<AgentMessage>((entry) => {
			if (entry.type !== "message" || !ids.has(entry.id)) return [];
			const message = entry.message;
			if (message.role === "assistant")
				return [
					{
						...message,
						content: message.content.filter(
							(block, index) =>
								block.type !== "thinking" &&
								page.value.items.some(
									(item) => item.source.entryId === entry.id && item.source.contentIndex === index,
								),
						),
					},
				];
			return message.role === "user" || message.role === "toolResult" ? [message] : [];
		});
		this.transcript = chatEntriesFromAgentMessages(messages).map((entry) =>
			renderChatMessageEntry(entry, {
				ui: { requestRender: this.requestRender },
				cwd: process.cwd(),
				hideThinkingBlock: true,
				toolOutputExpanded: true,
			}),
		);
		this.cursor = page.value.nextCursor;
		this.status = this.cursor ? "PageUp: earlier retained messages" : "";
		this.requestRender();
	}
	private async loadDetail(): Promise<void> {
		this.detailContent = {};
		const task = this.selected();
		if (!task) return;
		const lease = this.store.resolveTask(task.ref.taskId);
		if (!lease.ok) return;
		const source = taskTranscriptSource(lease.value);
		if (source.ok) {
			const prompt = source.value.session
				.getEntries()
				.find((entry) => entry.type === "message" && entry.message.role === "user");
			if (prompt?.type === "message" && prompt.message.role === "user")
				this.detailContent.prompt =
					typeof prompt.message.content === "string"
						? prompt.message.content
						: prompt.message.content
								.filter((block) => block.type === "text")
								.map((block) => block.text)
								.join("");
		}
		if (task.kind === "command") {
			const count = BigInt(task.output.byteCount);
			const output = await this.store.supervisor.readTaskOutput(lease.value, {
				start: String(count > 8192n ? count - 8192n : 0n),
				maximumBytes: 8192,
			});
			if (output.ok)
				this.detailContent.output = output.value.chunks
					.map((chunk) => Buffer.from(chunk.bytes).toString("utf8"))
					.join("");
		}
		this.requestRender();
	}
	handleInput(data: string): boolean {
		if (this.confirmation) {
			if (data === "y" || data === "n" || matchesKey(data, "escape")) {
				const answer = this.confirmation;
				this.confirmation = undefined;
				answer(data === "y");
			}
			this.requestRender();
			return true;
		}
		if (matchesKey(data, "escape")) {
			if (this.transcript) this.transcript = undefined;
			else {
				this.navigation.handleInput(data, "tasks");
				if (this.navigation.focus.kind === "composer") this.close();
			}
			this.requestRender();
			return true;
		}
		if (this.navigation.focus.kind === "stdin") {
			this.input.handleInput(data);
			this.requestRender();
			return true;
		}
		if (this.transcript) {
			if (matchesKey(data, "up")) this.scroll = Math.max(0, this.scroll - 1);
			else if (matchesKey(data, "down")) this.scroll++;
			else if (matchesKey(data, "pageUp") && this.cursor) {
				this.scroll = 0;
				void this.loadTranscript(true);
			}
			this.requestRender();
			return true;
		}
		const task = this.selected();
		if (task && this.navigation.focus.kind === "detail") {
			const actions = taskDetailActions(task.execution, task.attention, this.stdinAvailable());
			if (matchesKey(data, "up")) this.actionIndex = Math.max(0, this.actionIndex - 1);
			else if (matchesKey(data, "down")) this.actionIndex = Math.min(actions.length - 1, this.actionIndex + 1);
			else if (getKeybindings().matches(data, "app.tasks.inspect"))
				void this.navigation.activate(actions[Math.min(this.actionIndex, actions.length - 1)]);
			else if (!this.navigation.handleInput(data, "tasks")) return false;
		} else if (!this.navigation.handleInput(data, "tasks")) return false;
		this.requestRender();
		return true;
	}
	render(width: number): string[] {
		return this.renderViewport(width, Math.max(3, (process.stdout.rows || 24) - 5));
	}
	renderViewport(width: number, budget: number): string[] {
		const rows = this.renderAll(width);
		const height = Math.max(1, budget - 1);
		const selected = rows.findIndex((row) => row.startsWith("›"));
		const offset = this.transcript
			? Math.min(this.scroll, Math.max(0, rows.length - height))
			: Math.max(0, selected - height + 1);
		return [...rows.slice(offset, offset + height), truncateToWidth("/tasks · Escape: back", width)].slice(
			0,
			Math.max(1, budget),
		);
	}
	private renderAll(width: number): string[] {
		const task = this.selected();
		if (this.confirmation)
			return new Text(
				`Cancel ${task?.title}\nTask ${task?.ref.taskId}\ny: confirm · n/Escape: keep running`,
				0,
				0,
			).render(width);
		if (this.navigation.focus.kind === "stdin")
			return [`Input to ${task?.title} · Escape: tasks`, ...this.input.render(width), this.status];
		if (this.transcript) return [...this.transcript.flatMap((component) => component.render(width)), this.status];
		if (task && this.navigation.focus.kind === "detail") {
			const lines = new TaskDetail(task, { ...this.detailContent, stdinAvailable: this.stdinAvailable() }).render(
				width,
			);
			const actionStart = lines.findIndex((line) => line.trim() === "Actions") + 1;
			const selected = actionStart + this.actionIndex;
			if (lines[selected]) lines[selected] = `› ${lines[selected]}`;
			return [...lines, this.status];
		}
		const sections = taskListSections(this.store.tasks);
		if (!sections.length)
			return new Text("Launched agents and shells will appear here.\nEscape: composer", 0, 0).render(width);
		return sections.flatMap((section) => [
			section.title,
			...section.tasks.map((item) =>
				truncateToWidth(
					`${item.ref.taskId === this.navigation.selectedTaskId ? "›" : " "} ${item.title} · ${item.execution.kind === "settled" ? item.execution.result.kind : item.execution.kind}`,
					width,
				),
			),
		]);
	}
}
