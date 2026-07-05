# Bizar Skills - Reference

Skills are specialized instruction sets that agents load before working on specific domains. They live as `SKILL.md` files in well-known directories and are injected into agent context when relevant.

## What Skills Are

A skill is a Markdown file with YAML frontmatter. The frontmatter declares a `description` that the agent matcher uses to decide when to load the skill. The body contains domain-specific knowledge, patterns, gotchas, and code examples.

Example `SKILL.md`:

```yaml
---
name: my-skill
description: Use when working with X. Covers Y and Z.
---
# My Skill

## When to use
...

## Key concepts
...

## Code examples
...

## Common gotchas
...
```

## Where Skills Live

| Path | Source | Priority | Notes |
|---|---|---|---|
| `~/.opencode/skills/<name>/SKILL.md` | User / System | Highest | User-overridable builtins |
| `~/.agents/skills/<name>/SKILL.md` | User-added | High | Installed via `skills add` |
| `bizar-dash/skills/<name>/SKILL.md` | Shipped | Medium | Ships with BizarHarness package |
| `.agents/skills/<name>/SKILL.md` | Project | Low | Project-local skills |
| `.opencode/skills/<name>/SKILL.md` | Project | Lowest | Project-local skills |

When the same skill name appears in multiple places, the highest-priority source wins.

## Discovering Skills

Use the `skills` CLI:

```bash
# List installed skills
skills list --json

# Search for a skill
skills search "react"

# Install from a repository
skills add owner/repo -s "skill-name" -y
```

Known repositories:
- `vercel-labs/skills` - find-skills, skill-creator, general tools
- `vercel-labs/agent-skills` - React, Next.js, frontend performance
- `shadcn/ui` - shadcn/ui components
- `supabase/agent-skills` - Postgres, Auth, Edge Functions
- `mattpocock/skills` - TypeScript, TDD
- `anthropics/skills` - Claude patterns, agents
- `leonxlnx/taste-skill` - design, UI/UX

## Shipped Bizar Skills

These skills ship with BizarHarness and are available immediately:

| Skill | Description |
|---|---|
| `bizar` | Norse-pantheon multi-agent system, Odin routing, agent tiers |
| `agent-baseline` | Always-on rules: Semble, Skills CLI, loop guard, copyright |
| `self-improvement` | .bizar/AGENTS_SELF_IMPROVEMENT.md protocol |
| `obsidian` | Bizar Memory Service (Obsidian + Git + LightRAG) |
| `minimax` | MiniMax provider, multi-key rotation, usage tracking |
| `providers` | Provider subsystem, backup keys, auto-add wizard |
| `chat` | Chat + opencode session integration |
| `usage` | Token usage monitoring, cost estimation, MiniMax usage dashboard |
| `skills-cli` | skills CLI reference, skill repos, discovery protocol |
| `lightrag` | LightRAG integration, opencode-free defaults, indexing |
| `sdk` | @polderlabs/bizar-sdk on Cloudflare Workers |

## Skill Loading

Agents check skill relevance at dispatch time. You can also load a skill explicitly in conversation using the `skill` tool:

```
Load the `minimax` skill before we discuss multi-key rotation.
```

## Adding a Project Skill

Create a skill directory in your project:

```bash
mkdir -p .agents/skills/my-project-skill
cat > .agents/skills/my-project-skill/SKILL.md << 'EOF'
---
name: my-project-skill
description: Use when working on my project's specific domain X.
---
# My Project Skill
...
EOF
```

Project skills are picked up automatically on next session start.
