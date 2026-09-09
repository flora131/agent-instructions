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
	private components?: Component[];
	readonly source: TaskTranscriptSource;
	private readonly requestRender: () => void;
	constructor(source: TaskTranscriptSource, messages: AgentMessage[], requestRender: () => void) {
		this.source = source;
		this.requestRender = requestRender;
		this.entries = chatEntriesFromAgentMessages(messages);
		this.live = new LiveChatEntriesController(this.entries);
		this.live.hydrateStreamingAssistantMessage(source.getStreamingMessage?.());
		this.unsubscribe = source.subscribe?.((event) => {
			if (this.live.applyEvent(event)) this.components = undefined;
			this.requestRender();
		});
	}
	invalidate(): void {
		this.components = undefined;
	}
	render(width: number): string[] {
		this.components ??= this.entries.map((entry) =>
			renderChatMessageEntry(entry, {
				ui: { requestRender: this.requestRender },
				cwd: process.cwd(),
				hideThinkingBlock: true,
				toolOutputExpanded: true,
				showImages: false,
			}),
		);
		return this.components.flatMap((component) => component.render(width));
	}
	dispose(): void {
		this.unsubscribe?.();
	}
}
