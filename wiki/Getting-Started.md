# Getting Started

This page takes you from a clean machine to a working BizarHarness install in about ten minutes. It assumes you have a POSIX-like shell (macOS, Linux, or WSL) and a recent Node.js.

## Prerequisites

You need three things before you start:

- **Node.js 20 or newer.** The CLI uses ESM-only modules and `node:fs/promises`. Run `node --version` to check. If you're on an older release, use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to upgrade.
- **Git.** For cloning the repo if you want to install from source, and for the agent-driven git operations you'll be running.
- **An editor or terminal you're comfortable in.** cline runs in your terminal; you'll be reading its output.

Optional but recommended:

- **[cline CLI](https://docs.cline.bot)** on your `$PATH` — BizarHarness targets cline, and the installer will detect it.
- **Provider API keys** for the model tiers you want to use. The free DeepSeek tier is the easiest starting point.

## Install

The fastest path is `npx`:

```bash
npx bizar
```

If you'd rather install it globally so `bizar` is always available:

```bash
npm install -g @polderlabs/bizar
bizar
```

The first run opens the interactive installer. It walks you through:

1. **Pre-flight checks** — detects cline, Headroom, Semble, and the Skills CLI. Missing optional tools are installed automatically.
2. **Component selection** — pick what to install: agent definitions, the `AGENTS.md` master config, the `cline.json` template, the Bizar plugin, optional rules/hooks/commands, bundled skills (BizarHarness, self-improvement, C++ coding standards, C++ testing, Embedded ESP-IDF), and the `.bizar/` folder.
3. **Agent selection** — choose which of the twelve agents to enable. The default is to install all of them.
4. **Install mode** — merge into your existing `~/.config/cline/` or install into a project-local `.cline/` directory.
5. **Memory backend mode** — pick `local-only` (default; per-project vault at `.obsidian/`) or `managed` (one shared repo at `~/.local/share/bizar/memory/<name>/` with three namespaces — `projects/<id>/`, `global/bizar/`, `users/<id>/`). The managed mode is the right choice if you want memory shared across projects; you can switch later with `bizar memory link` / `bizar memory unlink`.
6. **Skill packs** — pick from curated skills.sh packs (e.g., `vercel-labs/agent-skills` for React, `supabase/agent-skills` for Postgres).
7. **API keys** — optional. You can also set them later with `/connect` inside cline.
8. **Restart** — the installer offers to restart cline so the new agents and plugin load immediately.

## What the installer does

Behind the scenes, the installer:

- Copies the agent definitions from `config/agents/*.md` into `~/.config/cline/agents/`.
- Copies the master `AGENTS.md` (with the routing table, skill discovery protocol, and Memory Service protocol) into `~/.config/cline/`.
- Merges the Bizar plugin entry into `~/.config/cline/cline.json`. If a config already exists, the installer backs it up to `cline.json.bak` and uses `jq` for a deep merge.
- Installs the bundled Bizar plugin (loop guard, status logging, handoff) into `~/.config/cline/plugins/bizar/`.
- Installs [Headroom](https://github.com/headroomlabs-ai/headroom) if missing, then runs `headroom wrap cline` to wire token compression into the shell.
- Installs [Semble](https://github.com/semble-ai/semble) if missing — used by Mimir for codebase search.
- Installs the [Skills CLI](https://www.skills.sh) if missing — used by every implementation agent for on-demand skill discovery.
- Adds the selected skill packs from skills.sh.

## Restart cline and connect providers

When the installer finishes, restart cline so the new agents and plugin load. Then run `/connect` inside the TUI to add API keys for the providers you want to use:

| Provider | Models | Auth |
|---|---|---|
| **Cline Zen** | `cline/deepseek-v4-flash-free` | Free API key from [cline.ai](https://docs.cline.bot) — no charges |
| **MiniMax (direct)** | `minimax/MiniMax-M2.7`, `minimax/MiniMax-M3` | API key from [MiniMax](https://platform.minimaxi.com) |
| **OpenAI** | `openai/gpt-5.5` | ChatGPT subscription (OAuth) |

After `/connect`, run `/models` to verify that every tier can reach its provider.

## Your first project

BizarHarness is most useful inside a project. To bootstrap one:

```bash
cd ~/my-project
bizar init
```

The `init` command:

- Detects the project stack from `package.json`, `pyproject.toml`, `Cargo.toml`, or `go.mod`.
- Installs relevant skill packs based on the detected stack (e.g., `vercel-labs/agent-skills` for React, `supabase/agent-skills` for Django).
- Creates `.bizar/PROJECT.md` with a project skeleton — stack, conventions, entry points. Vör reads this file at every clarifying-question call, so it pays to fill it in.
- Creates `.bizar/AGENTS_SELF_IMPROVEMENT.md` with starter active rules. Agents append to this file at every task.

After `init`, you can:

- Type `@frigg what does this project do` to get a read-only overview without any code changes.
- Type `@mimir find the auth handler` for Semble-powered code search.
- Type `@thor add a /healthz endpoint` for a moderate implementation task. Odin will route it to Thor (M2.7) and Tyr (M3) running in parallel.

## Next steps

Next: [Installation](Installation) — detailed install paths, manual install from source, per-project install, uninstall, and troubleshooting.

For a hands-on tour once you're set up, see [Quick Start](Quick-Start).

## 🧠 Memory Service

BizarHarness ships its own local-first memory subsystem — the **Bizar Memory Service**. Notes are Obsidian-compatible Markdown with strict YAML frontmatter, stored in a Git-managed vault, and synced via standard `git pull/push/commit`. No external API keys or hosted service required.

### Three-layer model

```
   Layer 1: Markdown is truth           ← canonical store
   Layer 2: Git is collaboration        ← sync + branches + audit
   Layer 3: LightRAG is derived index   ← semantic retrieval (Phase 2)
```

The LightRAG layer is a stub in Phase 1 (`bizar memory reindex` returns a "not yet implemented" notice) and will be wired into the existing `mods-examples/lightrag/` server in Phase 2. The Markdown layer is the canonical source of truth — reindexing rebuilds the index from Markdown at any time, never the other way around.

### Modes

| Mode | Vault location | Cross-project sharing | Default? |
|---|---|---|---|
| `local-only` | `<project>/.obsidian/` | No — per-project vault | **Yes** |
| `managed` | `~/.local/share/bizar/memory/<repoName>/` | Yes — one shared repo with three namespaces | Opt-in |

### Namespaces

The `managed` repo is split into three top-level directories:

| Namespace | Purpose |
|---|---|
| `projects/<projectId>/` | Per-project memory — conventions, ADRs, bugs, commands |
| `global/bizar/` | Cross-project knowledge — agent patterns, Bizar internals |
| `users/<userId>/` | Personal scratch — user preferences, todos, draft thoughts |

### Quick command reference

```bash
bizar memory init          # create .bizar/memory.json + vault
bizar memory status        # mode, link target, dirty files, last sync
bizar memory sync          # pull → commit (secret scan) → push
bizar memory doctor        # schema + secrets + git health checks
bizar memory link <repo>   # opt into managed mode
```

The dashboard exposes 18 REST endpoints under `/api/memory/*` for note CRUD, search, schema validation, secret scanning, and Git sync. Legacy `/api/obsidian/*` routes are preserved.

Full reference: see [Commands Reference → Memory Commands](Commands-Reference#memory-commands) and [FAQ → Memory Service](FAQ#memory-service).
