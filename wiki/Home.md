# BizarHarness

**Norse-pantheon multi-agent system for [Claude Code](https://docs.claude.com/claude-code).**

BizarHarness gives Claude Code a router, an agent hierarchy, and a cost-aware dispatch layer. Twelve named agents — Odin, Frigg, Vör, Quick, Mimir, Heimdall, Hermod, Thor, Baldr, Tyr, Vidarr, Forseti — work in parallel across four model tiers, with a free DeepSeek tier for cheap work and a GPT-5.5 escape hatch for the hardest problems. The whole system runs locally; nothing is sent to a BizarHarness server.

## What it is, who it's for

BizarHarness is for developers who already use Claude Code and want to stop hand-picking models for every prompt. Instead of staring at the model selector before each turn, you describe what you want, and Odin (the router agent) decomposes the request, picks the right agents, runs them in parallel, and synthesizes the result. Implementation work is always split across a moderate-cost agent (Thor on M2.7) and a high-cost agent (Tyr on M3) so you don't pay for a flagship model when a mid-tier one would do.

It's especially useful if you:

- Juggle multiple projects and want each one to have its own memory bank.
- Want the cheapest capable agent for the job without thinking about cost.
- Use Claude Code's hook system / skills / MCP and need a guard against subagent loops.
- Like the idea of agents that learn from their mistakes over time.
- Want slash commands for the common workflows (`/plan new`, `/tdd`, `/verify`, `/tailscale-serve`).
- Want a visual plan canvas that humans can comment on, with a hard block if a subagent loops 12 times.

## Key features

- **Twelve agents, four cost tiers** — Free DeepSeek Flash for read-only Q&A and mechanical work, M2.7 for moderate implementation, M3 for complex architecture, GPT-5.5 as a last-resort escape hatch.
- **Odin router** — never executes work itself. Always decomposes a request into parallel subagent calls (2+ in a single message) and synthesizes the results.
- **Cost-aware dispatch** — the default path is always the cheapest capable agent. You only pay for high-tier models when the task actually requires them.
- **Bizar MCP server** — bundled Claude Code plugin that detects subagent loops, runs the visual plan canvas, and spawns background agents. Three surfaces:
  - **Loop guard** — warn at 5, escalate at 8, hard-block at 12 identical tool calls. Inject handoff messages so a stuck subagent can be reassigned.
  - **Plan canvas** — `/plan new|add|comment|status` writes to a local `plan.json` you can browse and comment on. No network.
  - **Background agents** — `bizar_spawn_background` runs subagents dispatched via Claude Code Agent tool with `run_in_background: true`. State persists to disk; survives restart.
- **40+ slash commands** — `/plan new`, `/tdd`, `/verify`, `/init`, `/learn`, `/tailscale-serve`, etc. See [Commands Reference](Commands-Reference) for the full list.
- **Local-first Memory Service** — every project gets a file-based Markdown vault (`.obsidian/` for local-only mode, or a shared Git repo at `~/.local/share/bizar/memory/<name>/` for managed mode). Three namespaces: `projects/<id>/`, `global/bizar/`, `users/<id>/`. No external memory service required. See the [Memory Service section](#-memory-service) below.
- **Semble code search** — Mimir uses Semble for codebase exploration before falling back to grep, so research agents get semantically-ranked results.
- **Skill discovery** — agents proactively install Skills CLI packs by domain (e.g., `skills add supabase/agent-skills --all -y` for database work) at task time. No manual configuration.
- **MagicDNS hosting** — `/tailscale-serve` exposes any local port on your tailnet at `https://<machine>.<tailnet>.ts.net/`. See [Commands Reference → /tailscale-serve](Commands-Reference#tailscale-serve--magicdns-hosting).
- **Self-improvement log** — every task appends a lesson to `.bizar/AGENTS_SELF_IMPROVEMENT.md`. The next session reads it before routing.
- **Dev sandbox** — a Docker-based sibling repo lets you test changes to the harness and its plugin without touching your real `~/.claude/`.

## 🧠 Memory Service

Memory is local-first. BizarHarness ships its own **Memory Service** — a self-contained, file-based memory subsystem that replaced the previously-disabled Hindsight MCP. No external API keys, no network calls, no vendor lock-in.

**Three-layer model:**

- **Markdown is truth.** Notes are Obsidian-compatible Markdown with strict YAML frontmatter (`memory_id`, `type`, `project_id`, `status`, `confidence`, `created`, `updated`, `tags`). Every memory note is a regular file you can grep, edit, or sync with `git`.
- **Git is collaboration.** Sync happens with standard `git pull / commit / push`. Branches, conflict resolution, and audit history come for free.
- **LightRAG is derived index (Phase 2).** Phase 1 ships a stub. Phase 2 will rebuild the semantic index from Markdown on demand — Markdown stays canonical.

**Two modes:**

| Mode | Vault location | Default? |
|---|---|---|
| `local-only` | `<project>/.obsidian/` | **Yes** — best for single-project use |
| `managed` | `~/.local/share/bizar/memory/<repoName>/` (one shared repo, three namespaces) | Opt-in — best for sharing across projects |

The `managed` repo splits into `projects/<id>/` (per-project notes), `global/bizar/` (cross-project patterns), and `users/<id>/` (personal scratch).

**Quick command reference:**

```bash
bizar memory init              # create .bizar/memory.json + .obsidian/ vault
bizar memory status            # mode, link target, dirty files, last sync
bizar memory link <repo>       # opt into managed mode
bizar memory sync              # pull → commit (with secret scan) → push
bizar memory doctor            # schema + secrets + git health checks
```

The dashboard exposes 18 REST endpoints under `/api/memory/*` for note CRUD, search, schema validation, secret scanning, and Git sync. Legacy `/api/obsidian/*` routes are preserved for back-compat.

Full reference: see [Commands Reference → Memory Commands](Commands-Reference#memory-commands) and [FAQ → Memory Service](FAQ#memory-service).

## Quick install

```bash
# Try it without installing
npx bizar

# Or install globally
npm install -g @polderlabs/bizar
bizar
```

The interactive installer walks you through component selection, agent choice, install mode, optional skill packs, and API key setup. On exit it offers to restart the Claude Code runtime.

The source install script (`bash install.sh` from this repo) is the right path if you want the bleeding edge or are contributing. It deploys agents, commands, hooks, skills, and the Bizar plugin in one go.

## Next steps

- [Getting Started](Getting-Started) — prerequisites, full install flow, and your first project.
- [Quick Start](Quick-Start) — five-minute tour of the agents and the slash commands.
- [Commands Reference](Commands-Reference) — every slash command, organized by layer.

> The wiki is the long-form reference. The repository's `README.md` is the canonical entry point and is updated on every release. If something here disagrees with the README, trust the README.
