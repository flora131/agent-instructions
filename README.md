# AI Agent Instructions Template

**Pre-built templates that make AI agents write better code with less back-and-forth.**

## The Problem
AI coding agents (Claude Code, Cursor, Copilot, Windsurf) produce higher-quality code when they understand your project's architecture, conventions, and tech stack. But explaining this context every time—or writing instruction docs from scratch—wastes hours.

## This Solution
Ready-to-use instruction templates (AGENTS.md, CLAUDE.md, PLANS.md) with best practices already written. You customize project-specific details quickly, and your AI agent immediately:
- ✅ Follows your patterns without repeated prompting
- ✅ Handles simple requests instantly with context
- ✅ Auto-generates execution plans for complex features
- ✅ Scales across your team with zero per-request overhead

**ROI:** 5-minute setup saves 2+ hours/week in context-explaining and back-and-forth.

---

## 5-Minute Setup

### 1. Clone This Repo

```bash
git clone https://github.com/YOUR_USERNAME/agent-instructions.git
```

### 2. Auto-Fill Templates with Metaprompt

**What the metaprompt does:** Scans the current directory's codebase and automatically fills `[YOUR_*]` placeholders in AGENTS.md and CLAUDE.md.

**How to use it:**

1. **Navigate to the directory** where you want AI instructions (root, `backend/`, `frontend/`, etc.)
   ```bash
   cd agent-instructions/backend  # or frontend, or stay in root
   ```

2. **Open your AI coding assistant** in that directory

3. **Share** `prompts/metaprompt.txt`

4. **Say:** *"Fill in AGENTS.md and CLAUDE.md for this directory using the metaprompt"*

The AI analyzes the focused context (tech stack, patterns, dependencies in that directory) and populates templates in ~2 minutes.

**Before/After Example:**
```
Before: [YOUR_FRAMEWORK], [YOUR_DATABASE]
After:  Express, PostgreSQL
```

**Repeat for each directory** where you want AI instructions (backend, frontend, etc.).

### 3. Link Templates to Your AI Agent

**Claude Code:** Already configured (reads CLAUDE.md automatically)
**Cursor:** `cp AGENTS.md .cursorrules`
**GitHub Copilot:** `cp AGENTS.md .github/copilot-instructions.md`
**Windsurf:** `cp AGENTS.md .windsurfrules`

---

## How It Works

### One-Time Setup, Zero Ongoing Overhead

Once configured, templates provide context for **every request** automatically.

**Simple requests:** Handled instantly with AGENTS.md context
- "Add error handling to login" → AI knows your patterns, no explanation needed
- "Fix TypeScript error" → AI understands your type system
- "Refactor component" → AI follows established conventions

**Complex features:** AI auto-generates structured execution plans
- "Build notification system" → Creates detailed plan in `specs/`, implements systematically
- "Add real-time collaboration" → Designs architecture, validates before coding

**You don't write individual plans.** Templates handle straightforward work. AI creates plans only when complexity requires it.

### Optional: DeepWiki Integration

Enable DeepWiki in CLAUDE.md for AI to consult best practices when planning complex features:
- Architecture patterns (microservices, event-driven, caching)
- Library-specific guidance (React, PostgreSQL, Redis)

**Example:** Designing rate-limiting → DeepWiki surfaces token bucket algorithms and proven patterns.

---

## What's Included

| Component | Purpose |
|-----------|---------|
| **AGENTS.md** | Project context: architecture, tech stack, conventions (works with any AI agent) |
| **CLAUDE.md** | Claude Code-specific instructions with ExecPlan workflow |
| **PLANS.md** | Template for complex feature execution plans |
| **Metaprompt** | Auto-fills all templates by analyzing your codebase |
| **Three-tier structure** | Root + `frontend/` + `backend/` for organized mono/multi-repo support |

**Result:** Professional templates with best practices built-in. You customize project specifics, not structure.

---

## Repository Structure

```
.
├── AGENTS.md               # Root-level instructions
├── CLAUDE.md               # Claude Code configuration
├── prompts/metaprompt.txt  # Auto-fill tool
├── specs/                  # Full-stack feature plans
│   └── PLANS.md
├── backend/
│   ├── AGENTS.md
│   ├── CLAUDE.md
│   └── specs/              # Backend-only plans
└── frontend/
    ├── AGENTS.md
    ├── CLAUDE.md
    └── specs/              # Frontend-only plans
```

---

## FAQ

**Q: Why separate files for backend/frontend?**
A: Different tech stacks need focused context. Keeps instructions clean and AI responses accurate.

**Q: What if I have a simple single-tier project?**
A: Just use root-level AGENTS.md and CLAUDE.md. Delete backend/frontend directories.

---

**License:** MIT
**Credits:** PLANS.md based on [OpenAI's Codex Execution Plans](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md)

Ready? Clone, run the metaprompt, and give your AI agents the context they need. 🚀
