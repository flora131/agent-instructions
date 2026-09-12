---
title: Writing skills
description: Skill directory structure and a complete worked example.
---

# Writing skills

## Skill Structure

A skill is a directory with a `SKILL.md` file. Everything else is freeform.

```
my-skill/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Helper scripts
│   └── process.sh
├── references/           # Detailed docs loaded on-demand
│   └── api-reference.md
└── assets/
    └── template.json
```

### SKILL.md Format

````markdown
---
name: my-skill
description: What this skill does and when to use it. Be specific.
---

# My Skill

## Setup

Run once before first use:
```bash
cd /path/to/skill && bun install
```

## Usage

```bash
./scripts/process.sh <input>
```
````

Use relative file paths from the skill directory (these are bundled skill files, not docs routes):

```markdown
See the API reference at `references/api-reference.md` for details.
```

Keep authored instructions outcome-first and concise. State observable completion and stop conditions, give a short reason for material constraints, and use decision rules for judgment calls instead of `ALWAYS`/`NEVER` language. Put detailed or model-specific material in `references/` so it loads only when needed. Do not ask models to reproduce private reasoning or repeatedly verify their own work; require evidence or validation results where correctness matters.

## Example

```
brave-search/
├── SKILL.md
├── search.js
└── content.js
```

**SKILL.md:**
````markdown
---
name: brave-search
description: Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content.
---

# Brave Search

## Setup

```bash
cd /path/to/brave-search && bun install
```

## Search

```bash
./search.js "query"              # Basic search
./search.js "query" --content    # Include page content
```

## Extract Page Content

```bash
./content.js https://example.com
```
````

## Next steps

Check the skill reference for [frontmatter fields](/skills/reference#frontmatter) and [validation rules](/skills/reference#validation) before sharing your skill.
