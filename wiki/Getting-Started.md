# Getting Started

This page takes you from a clean machine to a working BizarHarness install in about ten minutes. It assumes you have a POSIX-like shell (macOS, Linux, or WSL) and a recent Node.js.

## Prerequisites

You need three things before you start:

- **Node.js 20 or newer.** The CLI uses ESM-only modules and `node:fs/promises`. Run `node --version` to check. If you're on an older release, use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to upgrade.
- **Git.** For cloning the repo if you want to install from source, and for the agent-driven git operations you'll be running.
- **An editor or terminal you're comfortable in.** opencode runs in your terminal; you'll be reading its output.

Optional but recommended:

- **[opencode CLI](https://opencode.ai)** on your `$PATH` — BizarHarness targets opencode, and the installer will detect it.
- **[Hindsight](https://memory-api.polderlabs.io) API key** — for persistent per-project memory. Without it, agents work in stateless mode.
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

1. **Pre-flight checks** — detects opencode, RTK, Semble, and the Skills CLI. Missing optional tools are installed automatically.
2. **Component selection** — pick what to install: agent definitions, the `AGENTS.md` master config, the `opencode.json` template, the Bizar plugin, optional rules/hooks/commands, bundled skills (BizarHarness, self-improvement, C++ coding standards, C++ testing, Embedded ESP-IDF), and the `.bizar/` folder.
3. **Agent selection** — choose which of the twelve agents to enable. The default is to install all of them.
4. **Install mode** — merge into your existing `~/.config/opencode/` or install into a project-local `.opencode/` directory.
5. **Skill packs** — pick from curated skills.sh packs (e.g., `vercel-labs/agent-skills` for React, `supabase/agent-skills` for Postgres).
6. **API keys** — optional. You can also set them later with `/connect` inside opencode.
7. **Restart** — the installer offers to restart opencode so the new agents and plugin load immediately.

## What the installer does

Behind the scenes, the installer:

- Copies the agent definitions from `config/agents/*.md` into `~/.config/opencode/agents/`.
- Copies the master `AGENTS.md` (with the routing table, skill discovery protocol, and Hindsight memory protocol) into `~/.config/opencode/`.
- Merges the Bizar plugin entry into `~/.config/opencode/opencode.json`. If a config already exists, the installer backs it up to `opencode.json.bak` and uses `jq` for a deep merge.
- Installs the bundled Bizar plugin (loop guard, status logging, handoff) into `~/.config/opencode/plugins/bizar/`.
- Installs [RTK](https://github.com/rtk-ai/rtk) if missing, then runs `rtk init -g --opencode` to wire token compression into the shell.
- Installs [Semble](https://github.com/semble-ai/semble) if missing — used by Mimir for codebase search.
- Installs the [Skills CLI](https://www.skills.sh) if missing — used by every implementation agent for on-demand skill discovery.
- Adds the selected skill packs from skills.sh.

## Restart opencode and connect providers

When the installer finishes, restart opencode so the new agents and plugin load. Then run `/connect` inside the TUI to add API keys for the providers you want to use:

| Provider | Models | Auth |
|---|---|---|
| **OpenCode Zen** | `opencode/deepseek-v4-flash-free` | Free API key from [opencode.ai](https://opencode.ai) — no charges |
| **OpenRouter** | `openrouter/minimax/minimax-m2.7`, `openrouter/minimax/minimax-m3` | API key from [openrouter.ai](https://openrouter.ai) |
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
