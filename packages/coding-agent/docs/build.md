---
title: Build with Atomic
description: Extend Atomic with skills, subagents, intercom, workflows, extensions, prompt templates, themes, packages, custom models and providers, and programmatic integrations.
---

# Build with Atomic

Build covers everything you add to Atomic: customization mechanisms that change how a session behaves, and programmatic interfaces that embed Atomic in your own software.

If you have not run Atomic yet, start at the [Quickstart](/quickstart). If you are looking for an exact contract rather than a way to build something, go to the [Reference index](/reference).

## Choose the lightest mechanism

Work down this list and stop at the first mechanism that solves your problem.

1. [Prompt templates](/prompt-templates) — reusable prompts that expand from a slash command. No code.
2. [Skills](/skills) — on-demand instructions the agent loads when a task matches. Markdown plus optional scripts.
3. [Subagents](/subagents) — delegate a focused, bounded task to a child agent.
4. [Intercom](/intercom) — coordinate several sessions on one machine.
5. [Workflows](/workflows) — multi-stage, resumable engineering loops with gates and artifacts.
6. [Extensions](/extensions) — TypeScript that adds tools, commands, events, and custom UI when nothing lighter fits.
7. [Atomic packages](/packages) — bundle and distribute the result.

## Change the model layer

- [Custom models](/models) — add model entries for a supported provider API.
- [Custom providers](/custom-provider) — implement a provider API or OAuth flow Atomic does not ship.
- [Themes](/themes) — restyle the terminal interface.

## Embed Atomic in your own software

[Programmatic use](/programmatic) compares JSON mode, RPC, and the SDK, and links each one to its protocol or API reference.

## Customization

- [Extensions](/extensions) - TypeScript modules for tools, commands, events, and custom UI.
- [Skills](/skills) - Agent Skills for reusable on-demand capabilities.
- [Subagents](/subagents) - focused child agents for research, analysis, debugging, cleanup, and review compositions.
- [Workflows](/workflows) - executable engineering loops with tracked stages, artifacts, gates, and resumable runs.
- [Prompt templates](/prompt-templates) - reusable prompts that expand from slash commands.
- [Themes](/themes) - built-in and custom terminal themes.
- [Atomic packages](/packages) - bundle and share extensions, skills, prompts, and themes.
- [Custom models](/models) - add model entries for supported provider APIs.
- [Custom providers](/custom-provider) - implement custom APIs and OAuth flows.

## Programmatic usage

- [SDK](/sdk) - embed Atomic in Node.js applications.
- [RPC mode](/rpc) - integrate over stdin/stdout JSONL.
- [JSON event stream mode](/json) - print mode with structured events.
- [TUI components](/tui) - build custom terminal UI for extensions.
