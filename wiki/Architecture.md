# Architecture

BizarHarness is a thin orchestration layer on top of [opencode](https://opencode.ai). opencode provides the agent runtime; BizarHarness provides the router, the agent hierarchy, the cost-aware dispatch, the Bizar Memory Service, and the loop-guard plugin. This page describes how the pieces fit together.

## The Norse-pantheon metaphor

Each agent in the system is named after a Norse deity. The metaphor is loose — it gives each agent a memorable identity and a one-rune symbol — but the role mapping is mostly accidental. The full pantheon (13 agents):

| Agent | Rune | Role |
|---|---|---|
| **Odin** | ᛟ | Router — never executes work, always dispatches |
| **Frigg** | ᚠ | Read-only Q&A — answers, never modifies |
| **Vör** | ᛢ | Clarifier — asks if the request is ambiguous |
| **Quick** | ᛃ | Single-shot fast path — no decomposition, no delegation |
| **Mimir** | ᛗ | Research — codebase exploration, Semble-first search |
| **Heimdall** | ᚹ | Simple — file ops, mechanical work, quick edits |
| **Hermod** | ᚱ | Git ops — commit, push, merge, PR, rebase |
| **Thor** | ᚦ | Moderate — implementation, debugging, refactoring |
| **Baldr** | ᛒ | Design — design systems, visual audits, usability |
| **Tyr** | ᛏ | Complex — architecture, deep debugging, multi-step |
| **Vidarr** | ᛉ | Last resort — GPT-5.5 escape hatch when all else fails |
| **Forseti** | ᚨ | Auditor — adversarial plan review, edit-deny |
| **Semble-search** | (none) | Codebase search via Semble MCP (subagent of Mimir) |

The metaphor is useful as a mental model for routing: when in doubt, pick the agent whose role matches the task. See [Agents Reference](Agents-Reference) for per-agent details.

## The 5-tier model architecture

Models are grouped by capability and cost into five tiers. Every BizarHarness agent maps to exactly one tier. Routing always prefers the lowest tier that can do the job.

| Tier | Model | Cost | Used by |
|---|---|---|---|
| **0 (free)** | DeepSeek V4 Flash (OpenCode Zen) | $0 | Frigg, Vör, Quick, Mimir, Heimdall |
| **1 (low)** | MiniMax M2.7 | $0.30/M in, $1.20/M out | Hermod, Thor, Baldr |
| **2 (mid)** | MiniMax M3 | $0.30/M in, $1.20/M out | Odin, Tyr, Forseti |
| **3 (high)** | MiniMax M3 (auditor) | $0.30/M in, $1.20/M out | Forseti (M3 with edit-deny) |
| **4 (last)** | GPT-5.5 (OpenAI subscription) | Subscription | Vidarr |

The free tier handles the majority of work: read-only Q&A, mechanical edits, codebase search. You only pay for a model when the task is genuinely complex (M3) or has stalled (GPT-5.5). See [Model Routing](Model-Routing) for the dispatch rules.

## The Odin router

Odin is the default agent. When you start a session and don't explicitly invoke a subagent, you're talking to Odin. The router has a stripped tool surface — no `bash`, no `glob`, no `grep`, no `edit`, no `write`, no `question` — so it cannot execute work. Its only job is to dispatch.

The flow:

```
   User     Odin ᛟ          Subagent       Forseti ᚨ
    │         │                │              │
    │─Request─>│                │              │
    │         │                │              │
    │         │─ Decompose ────│              │
    │         │  into parallel │              │
    │         │  streams      │              │
    │         │                │              │
    │         │─ task ────────>│              │
    │         │─ task ────────>│              │
    │         │                │              │
    │         │     plan review (when complex)│
    │         │──────────────────────────────>│
    │         │    approve / changes required │
    │         │<──────────────────────────────│
    │         │                │              │
    │         │<─── results ───│              │
    │<─ synth ─│                │              │
```

Three key behaviors:

1. **Odin never executes work.** Stripping the executable tools forces Odin to delegate. This is enforced at the agent definition level, not by convention.
2. **Always parallel.** Every request with 2+ work items fires them in the same message. Sequential `task` calls are an anti-pattern.
3. **Forseti gates Tier 4 and Tier 5.** For Tyr and Vidarr work, Odin dispatches the plan to Forseti first. Forseti returns approve, request-changes, or reject. The plan only executes after approval.

## Bizar Memory Service

BizarHarness ships the **Bizar Memory Service** — local Obsidian-compatible Markdown + Git-shared sync — as the per-project memory layer. The Hindsight MCP service is retired.

### Three layers, one canonical truth

| Layer | Role | Backed by |
|---|---|---|
| **Markdown** | Canonical truth | Obsidian-flavoured `.md` files on disk |
| **Git** | Collaboration / history | The vault directory IS a Git repo |
| **LightRAG** (Phase 2) | Derived search index | Always rebuildable from Markdown; never write to it directly |

Agents write Markdown. The `bizar memory sync` orchestrator handles Git (commit + optional push) and triggers a LightRAG reindex when enabled. There is exactly one canonical surface — Markdown on disk.

### Vault location

```
.bizar/memory.json
├── mode:  "local-only"  →  vault = .obsidian/
└── mode:  "managed"     →  vault = ~/.local/share/bizar/memory/<repoName>/
```

Two modes:

- **`local-only`** (default) — vault lives at `.obsidian/` inside this project. Single-machine. No remote. Use for solo work or private projects.
- **`managed`** — vault lives at `~/.local/share/bizar/memory/<repoName>/`, a user-level shared Git repo. Use when you want cross-project search and a single source of truth across all your Bizar projects.

### Three namespaces

Namespaces live at the vault root. The resolution rule is **vault root + namespace**:

| Namespace | Path | When to write here |
|---|---|---|
| **project** | `projects/<projectId>/` | Anything specific to THIS project |
| **global** | `global/bizar/` | Anything that applies to Bizar AS A SYSTEM, across projects |
| **user** | `users/<userId>/` | Anything purely personal |

`projectId` is the basename of the project root; `userId` is the OS username. When in doubt, write to **project**. See `config/skills/obsidian/SKILL.md` for the full reading/writing protocol.

### Agent-facing API surface

Dashboard REST (canonical; lazy-imported):

```
GET    /api/memory/notes?namespace=projects/<id>          # list
GET    /api/memory/notes/<path>                           # read (frontmatter + body)
POST   /api/memory/notes                                  # write (rich shape)
POST   /api/memory/search                                 # full-text search
POST   /api/memory/reindex                                # rebuild LightRAG from Markdown
POST   /api/memory/git/sync                               # git pull/commit/push orchestrator
GET    /api/obsidian/notes                                # legacy back-compat — same data, older shape
```

CLI:

```
bizar memory init         # one-time vault bootstrap
bizar memory status       # mode, paths, git state
bizar memory search "<q>" # full-text search
bizar memory write <path> # open $EDITOR for a new note
bizar memory sync         # git add/commit/push (with secret scan + schema check)
bizar memory reindex      # rebuild LightRAG (Phase 2)
bizar memory conflicts    # list notes with status=conflict (human review surface)
bizar memory doctor       # health check
```

`bizar memory commit` runs the secret scanner before `git commit` — **HIGH severity blocks the commit**; MEDIUM warns. Override with `--allow-secrets` (NOT recommended; see `AGENTS_SELF_IMPROVEMENT` rule #4 for the Hindsight token leak lesson).

### Diagram

```
                ┌──────────────────────────────────────────┐
                │  Agent (Odin / Tyr / Thor / Heimdall …)  │
                └─────────────────────┬────────────────────┘
                                      │  API call (or CLI)
                                      ▼
                ┌──────────────────────────────────────────┐
                │  Dashboard REST                          │
                │    POST /api/memory/notes                 │
                │    POST /api/memory/git/sync              │
                └─────────────────────┬────────────────────┘
                                      │
                                      ▼
                ┌──────────────────────────────────────────┐
                │  memory-store.mjs + memory-schema.mjs    │
                │  (validates frontmatter, scans secrets)  │
                └─────┬───────────────┬────────────┬───────┘
                      │               │            │
                      ▼               ▼            ▼
         ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
         │  Markdown    │   │  Git         │   │  LightRAG    │
         │  (TRUTH)     │   │  (history +  │   │  (derived    │
         │              │   │  collab)     │   │  index,      │
         │  .obsidian/  │   │              │   │  Phase 2)    │
         │   or         │   │  commits     │   │              │
         │  ~/…/        │   │  per write   │   │  rebuilt     │
         │  memory/     │   │              │   │  on demand   │
         └──────────────┘   └──────────────┘   └──────────────┘
```

Always write Markdown. Git follows. LightRAG is derived — never authoritative.

## Semble code search

[Semble](https://github.com/semble-ai/semble) is the codebase search tool used by Mimir (and, when useful, by other agents). Semble indexes the project on first run and exposes two MCP tools:

- `mcp__semble__search` — natural-language or code query.
- `mcp__semble__find_related` — find code similar to a file:line.

Agents use Semble before falling back to `grep`, `glob`, or `read`. This is enforced in `config/AGENTS.md` (the master agent config) and applies to every agent.

## Always-on rules

BizarHarness ships a `rules/` folder with cross-cutting rules that every agent follows:

| File | Scope |
|---|---|
| `rules/general.md` | Cross-cutting: secrets, logging, code quality |
| `rules/javascript.md` | JavaScript/TypeScript conventions |
| `rules/python.md` | Python conventions |
| `rules/git.md` | Git and commit conventions |
| `rules/testing.md` | Test methodology and coverage |

Odin reads the relevant rule files based on the detected project stack and injects them as behavioral constraints in every subagent dispatch. Agents are also free to propose additions to the rule files when they discover a new pattern.

## The .bizar/ folder

Every BizarHarness project has a `.bizar/` folder at the root. It contains:

- `PROJECT.md` — stack, conventions, entry points. Vör reads this first when clarifying.
- `AGENTS_SELF_IMPROVEMENT.md` — the running log of lessons learned. Read at session start, appended to at session end.
- Plans (created by `bizar plan new`) — visual plan files in MDX format.

The folder is the contract between the developer and the agents. Edit `PROJECT.md` to set conventions; the next session will read them. Read `AGENTS_SELF_IMPROVEMENT.md` to see what the agents have learned; the agents will read it before routing.

## The Bizar plugin

The bundled Bizar plugin runs as an opencode plugin. It does three things:

1. **Loop detection** — fingerprints tool calls and warn/block on repetition. Defaults: warn at 5, escalate at 8, block at 12.
2. **Periodic status reporting** — logs every tool call (metadata only) to `~/.cache/bizar/logs/<sessionId>.log`.
3. **Handoff signal** — when a subagent is stuck, injects a system message that nudges it to use the `task` tool to escalate.

The plugin is read-only on the project, makes no outbound network calls, and writes only to `~/.cache/bizar/`. See [Bizar Plugin](Bizar-Plugin) for the full spec.

## Background agents (experimental)

v0.4 of the plugin adds **background agents** — asynchronous subagent execution via a single long-running `opencode serve` instance. Background agents let Odin parallelize independent work without blocking the main conversation. The four custom tools are `bizar_spawn_background`, `bizar_status`, `bizar_collect`, and `bizar_kill`. See [Background Agents](Background-Agents).

## System diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                          User Prompt                              │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌──────────────────────┐
                    │  Odin (M3, router)   │
                    │  strips tools: no    │
                    │  bash/edit/write     │
                    └──────────────────────┘
                                │
                  ┌─────────────┼─────────────┐
                  ▼             ▼             ▼
            ┌──────────┐  ┌──────────┐  ┌──────────┐
            │ Thor M2.7│  │ Tyr M3   │  │ Mimir/   │
            │ medium   │  │ complex  │  │ Frigg/   │
            │ impl.    │  │ + audit  │  │ Heimdall │
            │          │  │          │  │ (free)   │
            └──────────┘  └──────────┘  └──────────┘
                  │             │             │
                  └─────────────┼─────────────┘
                                ▼
                    ┌──────────────────────┐
                    │  Synthesis           │
                    │  (back to Odin, then │
                    │  to user)            │
                    └──────────────────────┘
                                │
                                ▼
                    ┌──────────────────────┐
                    │  Bizar Memory        │
                    │  Service             │
                    │  (Markdown + Git +   │
                    │  LightRAG phase 2)   │
                    └──────────────────────┘
```

`Forseti` is invoked as a side-channel between Odin and the high-tier agents (Tyr, Vidarr) for plan review. It runs in M3, has `edit: deny`, and never modifies project files.

## Next steps

Next: [Agents Reference](Agents-Reference) — every agent in the system, with model, cost, when-to-use, and example invocations.
