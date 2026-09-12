---
title: "Subagents"
description: "What subagents are, when delegation helps, and where the full subagent guide lives."
---

# Subagents

A subagent is a second agent session your main session launches for a focused piece of work. It has its own context window, so a noisy investigation does not crowd out your conversation.

## When to use one

Delegate when the work is bounded and separable: searching an unfamiliar area of the codebase, reproducing a failure, reviewing a change with fresh eyes, or several independent tasks that can run at once. Keep work in your own session when it is small, or when it depends on context the subagent would have to rediscover.

## What you get

- Single or parallel runs, with results returned to your session.
- Fresh or forked context, so a delegate can start clean or inherit what you know.
- Background execution — launch, keep chatting, and collect results later.

## Next steps

- [Subagents](/subagents) — the full guide, including builtin agents and execution modes.
- [Authoring](/subagents/authoring) — define your own agents.
- [Background and parallel work](/background-tasks) — inspect, wait on, and stop delegated work.
