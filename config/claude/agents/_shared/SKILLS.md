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
skills list --json
skills search "react"
skills add owner/repo -s "skill-name" -y
```

## Core Bizar packs

- `bizar` — guarded autonomy, routing, approval boundaries, and completion gates.
- `agent-baseline` — rules inherited by every agent.
- `self-improvement` — `.bizar/AGENTS_SELF_IMPROVEMENT.md` protocol.
- `skills-cli` — skill discovery and installation.
- `providers` / `9router` — model-provider configuration.
- `sdk` — Bizar typed SDK and MCP integration.
- thinking skills — structured reasoning patterns loaded only when relevant.

Inspect `.claude/skills/` rather than relying on a hard-coded inventory; the installer and user may add or remove packs.
