---
title: Custom subagents
description: Define, scope, and configure your own subagents.
---

# Custom subagents

## Custom agents

Custom agents are Markdown files with YAML frontmatter and a system prompt body. Keep the body outcome-first and locally complete: state the role or goal, observable success criteria, constraints and context-dependent tool routes, required output shape, and stop conditions. Reserve absolute wording for true invariants, request evidence and conclusions rather than private reasoning, and avoid repeated self-check instructions. Common locations are:

| Scope | Path |
|---|---|
| User | `~/.atomic/agent/agents/**/*.md` |
| Project | `.atomic/agents/**/*.md` |

A small custom read-only inspection agent:

```markdown
---
name: strict-inspector
description: Inspect code for correctness and regressions
tools: read, search, bash
model: anthropic/claude-sonnet-4
fallbackModels: openai/gpt-5-mini
inheritProjectContext: true
---

## Role and goal
Inspect the current diff for correctness and regressions without editing files.

## Success criteria
Cite each actionable issue with file:line evidence and the observed failure or risk.

## Output and stop rule
Return only issues worth fixing now. Stop when the relevant diff and affected call paths have been inspected, or name the evidence you could not access.
```
