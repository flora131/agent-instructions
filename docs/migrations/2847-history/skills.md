# Historical skills documentation

These blocks preserve the documentation at baseline `59586efd26afd32a27c999ac8bcce102777e40e4` for issue #2847. They are historical evidence, not current instructions. Current documentation incorporates main `cb13229bebe30ea7cb65689569569494b4bc651c`. The original baseline inventory and destination map remain unchanged.

<!-- baseline-block: skills::007 -->

Source: `packages/coding-agent/docs/skills.md` lines 74–79 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/skills.md#built-in-prompt-engineering-guidance`.

### Built-in prompt engineering guidance

The bundled `/skill:prompt-engineer` creates, optimizes, evaluates, and troubleshoots prompts for GPT-5.6, Claude Opus 5, and Claude Fable 5. It teaches a delete-first workflow: preserve outcomes, safety, permissions, evidence, output, and stopping contracts while removing repetition, generic self-checks, and obsolete process scaffolding. For autonomous prompts it recommends a compact `Role · Goal · Success criteria · Constraints · Tools · Output · Stop rules` shape, context-dependent tool routing, explicit effort and response-length controls, restrained delegation, grounded progress claims, and documents-first/query-last ordering for long inputs.

The skill no longer recommends response prefilling, which returns an error on Claude 4.6 and later, or visible chain-of-thought as a primary technique. Use explicit output instructions, schemas, tools, or post-processing instead of prefilling. Request conclusions, citations, commands, and observed results rather than reconstructed private reasoning; such requests can trigger Claude Fable 5's `reasoning_extraction` safeguard and force a model fallback.

<!-- baseline-block: skills::010 -->

Source: `packages/coding-agent/docs/skills.md` lines 88–121 at `59586efd26afd32a27c999ac8bcce102777e40e4`. Current destination: `packages/coding-agent/docs/skills.md#skill-commands`.

## Skill Commands

Skills register as `/skill:name` commands:

```bash
/skill:brave-search           # Load and execute the skill
/skill:pdf-tools extract      # Load skill with arguments
```

When multiple real skill files declare the same name, Atomic keeps the existing precedence winner for the bare command and retains every distinct file as an exact candidate. Use a source-qualified command to select one explicitly:

```bash
/skill:review                  # Current precedence winner
/skill:review@project          # Unique project candidate
/skill:review@user             # Unique user candidate
/skill:review@builtin          # Unique bundled candidate
```

`@project`, `@user`, and `@builtin` are available only when that family has one candidate in the collision. If a family contains multiple package candidates, Atomic advertises package-qualified aliases instead, such as `/skill:review@team-review` and `/skill:review@company-review`; the family selector is ambiguous and reports the exact choices. Autocomplete, `pi.getCommands()`, and RPC `get_commands` return the same advertised names.

Qualified selection is exact. An unknown or ambiguous qualified selector reports an error and never falls back to the bare winner. Aliases are recalculated on reload, so a qualified alias disappears when its collision disappears. The model-visible skill list uses the same aliases, while the opaque candidate IDs stored in transcripts and collision diagnostics are internal identity, not command names.

Subagent definitions and per-call `skills` overrides accept these same selectors. Live in-process children resolve them from their own loader catalog after resource reload; a missing or ambiguous selector is reported in the child result instead of silently selecting the bare skill. The parent-only `subagent` orchestration skill cannot be injected into a child, including qualified aliases such as `subagent@builtin`. Extensions can read the same catalog through `ctx.getSkillCatalog()`.

Arguments after the command are appended to the skill content as `User: <args>`.

Toggle skill commands via `/settings` in interactive mode or in `settings.json`:

```json
{
  "enableSkillCommands": true
}
```
