# Architecture

BizarHarness is a thin orchestration layer on top of [opencode](https://opencode.ai). opencode provides the agent runtime; BizarHarness provides the router, the agent hierarchy, the cost-aware dispatch, the per-project memory banks, and the loop-guard plugin. This page describes how the pieces fit together.

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

## Per-project Hindsight memory

BizarHarness uses [Hindsight](https://memory-api.polderlabs.io) for persistent memory. Every project gets its own memory bank, named after the project directory. The default bank is reserved for general system knowledge only — it should never hold project-specific memories.

The bank-selection protocol is enforced at session start:

1. Call `hindsight_list_banks` to see what banks exist.
2. Determine the project name from the working directory.
3. Call `hindsight_recall` with the correct `bank_id`.
4. If no bank exists for the project, create one with `hindsight_create_bank(bank_id: "<project-name>")`.

Every `hindsight_retain` and `hindsight_sync_retain` call must pass `bank_id`. The default bank is for cross-project knowledge only.

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
- Plans (created by `bizarharness plan new`) — visual plan files in MDX format.

The folder is the contract between the developer and the agents. Edit `PROJECT.md` to set conventions; the next session will read them. Read `AGENTS_SELF_IMPROVEMENT.md` to see what the agents have learned; the agents will read it before routing.

## The Bizar plugin

The bundled Bizar plugin runs as an opencode plugin. It does three things:

1. **Loop detection** — fingerprints tool calls and warn/block on repetition. Defaults: warn at 5, escalate at 8, block at 12.
2. **Periodic status reporting** — logs every tool call (metadata only) to `~/.cache/bizarharness/logs/<sessionId>.log`.
3. **Handoff signal** — when a subagent is stuck, injects a system message that nudges it to use the `task` tool to escalate.

The plugin is read-only on the project, makes no outbound network calls, and writes only to `~/.cache/bizarharness/`. See [Bizar Plugin](Bizar-Plugin) for the full spec.

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
                    │  Hindsight memory    │
                    │  bank=<project>      │
                    │  (per-project)       │
                    └──────────────────────┘
```

`Forseti` is invoked as a side-channel between Odin and the high-tier agents (Tyr, Vidarr) for plan review. It runs in M3, has `edit: deny`, and never modifies project files.

## Next steps

Next: [Agents Reference](Agents-Reference) — every agent in the system, with model, cost, when-to-use, and example invocations.
