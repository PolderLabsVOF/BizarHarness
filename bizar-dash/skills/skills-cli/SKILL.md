---
name: skills-cli
description: How to discover and install skills using the skills CLI. Covers skills list, search, add, and the skills.sh ecosystem of skill repositories.
---

# Skills CLI

The `skills` CLI (`npm install -g skills`) is the standard way to discover and install skills in BizarHarness. Skills are Markdown files with YAML frontmatter that encode specialized knowledge and workflows for agents.

## Installation

```bash
npm install -g skills
```

Verify: `skills --version`

## Core Commands

### skills list
List all installed skills:
```bash
skills list --json
```

### skills search
Search for skills by keyword:
```bash
skills search "react performance"
```

### skills add
Install a skill from a GitHub repository:
```bash
skills add owner/repo --all -y          # install all skills from repo
skills add owner/repo -s "skill-name" -y # install specific skill
```

### skills info
Get details about a skill:
```bash
skills info my-skill
```

## Known Skill Repositories

| Domain | Repository |
|---|---|
| General (find-skills, skill-creator) | `vercel-labs/skills` |
| Frontend (React, a11y, web-design) | `vercel-labs/agent-skills`, `shadcn/ui` |
| Backend (Supabase, Postgres, auth) | `supabase/agent-skills` |
| Testing (TDD, Playwright) | `mattpocock/skills`, `microsoft/playwright-cli` |
| Design (frontend-design, UI/UX) | `anthropics/skills`, `leonxlnx/taste-skill` |

## Skill File Format

Skills are `.md` files named `SKILL.md` inside a skill directory:

```
~/.opencode/skills/my-skill/
  SKILL.md   ← the skill content
```

The first line must be YAML frontmatter:
```yaml
---
name: my-skill
description: Use when you need to do X. Covers Y and Z.
---
```

## Skill Discovery Protocol

1. **Assess** - When given a task, consider whether a skill might exist for it
2. **Check installed** - Run `skills list --json` to see what is already available
3. **Try known repos** - Based on the task domain, attempt installation from known repos
4. **Use** - Load the skill with the `skill` tool before writing code
5. **Skip** - If no skill found, proceed without

## SKILL.md Structure

A good skill is 50–200 lines:

1. **Frontmatter** - `name`, `description`
2. **When to use** - trigger conditions and use cases
3. **Key concepts** - essential background
4. **Code examples** - realistic, copy-pasteable snippets
5. **Common gotchas** - pitfalls and how to avoid them

## Skill Loading in Bizar

When an agent task is dispatched, Bizar checks if a skill matches the task description. If matched, the skill's `SKILL.md` content is injected into the agent's context before the task prompt.

Use the `skill` tool explicitly when you want to load a skill's instructions into the current conversation.
