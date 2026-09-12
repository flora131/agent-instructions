---
title: Configure Atomic
description: Write your first settings file and override settings per project.
---

# Configure Atomic

**Outcome:** A working `settings.json` and, where you need one, a project-scoped override.

**Prerequisites:** [First session](/getting-started/first-session) is complete.

## Example

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "compression_ratio": 0.5,
    "preserve_recent": 2
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3
  },
  "httpIdleTimeoutMs": 300000,
  "enabledModels": ["claude-*", "gpt-4o"],
  "warnings": {
    "anthropicExtraUsage": true
  },
  "packages": ["pi-skills"],
  "workflows": ["./workflows/*.ts"]
}
```

## Project Overrides

Project settings (`.atomic/settings.json`) override global settings. Nested objects merge recursively; arrays and scalar values replace global values:

```json
// ~/.atomic/agent/settings.json (global)
{
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 16384 }
}

// .atomic/settings.json (project)
{
  "compaction": { "reserveTokens": 8192 }
}

// Result
{
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 8192 }
}
```

## Next step

Every field is listed in the [Settings reference](/settings).
