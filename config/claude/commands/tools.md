---
description: List every Bizar tool available at user level after install — agents, commands, skills, hooks, MCP, CLI subcommands.
allowed-tools: Read, Bash
---

# /tools — inventory of installed Bizar surfaces

Prints one section per installed surface.

```bash
node "$(npm root -g)/@polderlabs/bizar/cli/commands/tools.mjs" --json
```

Sections:

- **Agents** — the 16 role agents under `~/.claude/agents/`.
- **Commands** — slash commands under `~/.claude/commands/` (this file is one of them).
- **Skills** — skills under `~/.claude/skills/`.
- **Hooks** — lifecycle hooks under `~/.claude/hooks/` with their current
  event bindings from `~/.claude/settings.json`.
- **MCP tools** — every tool the Bizar SDK exposes over stdio
  (`plan_action`, `loop_*`, `graph_*`, `list_instincts`, `list_decisions`).
- **Wired `bizar` commands** — every `bizar <cmd>` you can run from the
  terminal (`install`, `update`, `doctor`, `repair`, `audit`, `validate`,
  `backup`, `restore`, `migrate`, `browser`, `picker-proxy`, `rca`, `sandbox`,
  `model`, `cost`, `claim`, `task`, `control`, `workflow`, `hook`,
  `setup-provider`, `claude-cmd`, `heads-up`, `worktree-merge`, `init`,
  `audit`).

Anything missing from this output is missing from your user-level install —
re-run `bizar repair`.