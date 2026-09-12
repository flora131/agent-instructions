import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Component } from "@earendil-works/pi-tui";
import type { TaskTranscriptSource } from "../../../core/tasks/supervisor.js";
import {
	type ChatMessageEntry,
	chatEntriesFromAgentMessages,
	LiveChatEntriesController,
	renderChatMessageEntry,
} from "./chat-message-renderer.ts";

/** A viewer subscription, not a second task runner or a task-activity publisher. */
export class TaskLiveTranscript implements Component {
	private readonly entries: ChatMessageEntry[];
	private readonly live: LiveChatEntriesController;
	private readonly unsubscribe?: () => void;
	// LiveChatEntriesController replaces changed entries, including in-place message deltas.
	// Weak keys release superseded generations without retaining a cache of the stream.
	private components = new WeakMap<ChatMessageEntry, Component>();
	readonly source: TaskTranscriptSource;
	private readonly requestRender: () => void;
	constructor(source: TaskTranscriptSource, messages: AgentMessage[], requestRender: () => void) {
		this.source = source;
		this.requestRender = requestRender;
		this.entries = chatEntriesFromAgentMessages(messages);
		this.live = new LiveChatEntriesController(this.entries);
		this.live.hydrateStreamingAssistantMessage(source.getStreamingMessage?.());
		this.unsubscribe = source.subscribe?.((event) => {
			this.live.applyEvent(event);
			this.requestRender();
		});
	}
	invalidate(): void {
		this.components = new WeakMap();
	}
	render(width: number): string[] {
		return this.entries.flatMap((entry) => {
			let component = this.components.get(entry);
			if (!component) {
				component = renderChatMessageEntry(entry, {
					ui: { requestRender: this.requestRender },
					cwd: process.cwd(),
					hideThinkingBlock: true,
					toolOutputExpanded: true,
					showImages: false,
				});
				this.components.set(entry, component);
			}
			return component.render(width);
		});
	}
	dispose(): void {
		this.unsubscribe?.();
	}
}
