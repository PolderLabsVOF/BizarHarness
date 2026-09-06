# Bizar Skills Reference

Skills are Markdown instruction packs with YAML frontmatter. Load the relevant installed skill before applying a domain-specific workflow.

## Locations and precedence

1. `~/.claude/skills/<name>/SKILL.md`
2. `~/.agents/skills/<name>/SKILL.md`
3. `.agents/skills/<name>/SKILL.md`
4. `.claude/skills/<name>/SKILL.md`

The installer copies Bizar's bundled `config/skills/` packs into the Claude Code skill directory. The repository copy remains the development source of truth.

## Discovery

```bash
npx skills list
npx skills find "react"
npx skills add owner/repo --skill "skill-name"
```

Use installed skills proactively for hard or specialized work. Marketplace
search is a fallback only when the work is difficult or stuck and no installed
skill fits. Review a skill's source and instructions before installing it;
public marketplace entries are third-party code, not an automatic trust grant.

## Core Bizar packs

- `bizar` — guarded autonomy, routing, approval boundaries, and completion gates.
- `i-have-adhd` — default concise, scannable user-facing response shape.
- `agent-baseline` — rules inherited by every agent.
- `self-improvement` — explicit bounded global preferences and project lessons.
- `skills-cli` — skill discovery and installation.
- `providers` — model-provider configuration (provider-agnostic; ships
  no default gateway; operators configure via $ANTHROPIC_BASE_URL).
  Bizar dispatches through four static native aliases (`haiku`,
  `sonnet`, `opus`, `fable`); OmniRoute handles ordered failover
  between configured full IDs for the chosen alias.
- `sdk` — Bizar typed SDK and MCP integration.
- thinking skills — structured reasoning patterns loaded only when relevant.

Inspect `.claude/skills/` rather than relying on a hard-coded inventory; the installer and user may add or remove packs.
