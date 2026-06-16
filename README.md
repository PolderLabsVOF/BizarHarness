```
                    ╔═══════════════════════════════════════╗
                    ║        B I Z A R H A R N E S S        ║
                    ║     ᚾᛟᚱᛋᛖ ᛈᚨᚾᛏᚺᛖᛟᚾ ᚨᚷᛖᚾᛏ ᛋᛏᚨᚲᚲ      ║
                    ╚═══════════════════════════════════════╝
```

```
              ╔══════════════════════════════════════════╗
              ║          ᚠᚢᚦᚨᚱᚲ ᛏᛇᚱ ᚷᛟᛞᚨᛉ          ║
              ║     Elder Futhark · Agent Hierarchy     ║
              ╚══════════════════════════════════════════╝
```

A 7-agent opencode hierarchy named after the Norse gods, with automatic cost-aware routing from free (DeepSeek) through mid-tier (MiniMax M2.7) and high-tier (MiniMax M3) up to GPT-5.5 as the ultimate fallback.

---

## ᛟ Yggdrasil — The Agent Tree

```
                              ┌─────────────┐
                              │ᛟ ODIN       │
                              ├─────────────┤
                              │Router (free)│
                              │             │
                              └─────────────┘


┌───────────────┐  ┌──────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌─────────────────┐
│ᛗ MIMIR        │  │ᚹ HEIMDALL    │   │ᚱ HERMOD    │   │ᚦ THOR      │   │ᛏ TYR       │   │ᛉ VIDARR         │
├───────────────┤  ├──────────────┤   ├────────────┤   ├────────────┤   ├────────────┤   ├─────────────────┤
│Research (free)│  │Simple (free) │   │GitOps ($)  │   │Medium ($)  │   │Complex ($$)│   │Last Resort ($$$)│
│               │  │              │   │            │   │            │   │            │   │                 │
└───────────────┘  └──────────────┘   └────────────┘   └────────────┘   └────────────┘   └─────────────────┘


                                                                  ┌───────────────────┐
                                                                  │ᚨ FORSETI          │
                                                                  ├───────────────────┤
                                                                  │Auditor (edit:deny)│
                                                                  │                   │
                                                                  └───────────────────┘
```

> _Generated with PlantUML ASCII art_

---

```
             \      /      \      /
              \    /        \    /
               \  /          \  /
                \/            \/
    ╔══════════════════════════════════════════════════╗
    ║               ᚢᚨᛚᚲᚾᚢᛏ                 ║
    ║            The Knot of the Slain                  ║
    ╚══════════════════════════════════════════════════╝
                /\            /\
               /  \          /  \
              /    \        /    \
             /      \      /      \
```

## ᚠ The Pantheon

### ᛟ Odin — The All-Father
**Model:** `minimax/MiniMax-M3` (via minimax.io)
**Role:** Primary agent & router

Odin is the default agent. He never executes work himself — he analyzes every request, decomposes it into parallel work streams, and dispatches to the right subagent. He routes by task type, model cost, and complexity tier. Independent work items are launched simultaneously via parallel `task` calls.

### ᛗ Mimir — The Wise One
**Model:** `opencode/deepseek-v4-flash-free` (via OpenCode Zen — free)
**Role:** Research & codebase exploration

Mimir drinks from the well of knowledge. He is the dedicated exploration agent, using **Semble-first** search before falling back to grep/glob. He discovers patterns, maps architecture, analyzes documentation, and reports findings with file paths and line numbers. He never implements — he discovers and reports.

### ᚹ Heimdall — The Watchman
**Model:** `opencode/deepseek-v4-flash-free` (via OpenCode Zen — free)
**Role:** Simple tasks & mechanical work

Heimdall guards the Bifrost bridge. He handles routine, deterministic work — quick edits, file operations, formatting, simple CRUD, boilerplate, and any task where the path is clear and unambiguous.

### ᚱ Hermod — The Swift Messenger
**Model:** `minimax/MiniMax-M2.7` (via minimax.io)
**Cost:** $0.30/M input · $1.20/M output
**Role:** Git & GitHub operations

Hermod rides Sleipnir across branches and repos. He handles commits, pushes, pulls, branching, merging, rebasing, pull requests, conflict resolution, releases, and any `gh` CLI operation.

### ᚦ Thor — The Thunderer
**Model:** `minimax/MiniMax-M2.7` (via minimax.io)
**Cost:** $0.30/M input · $1.20/M output
**Role:** Moderate complexity implementation

Thor wields Mjölnir for tasks that need stronger reasoning than the free tier but don't require Tyr's full power. Features of moderate complexity, non-trivial debugging, code review, refactoring, and well-scoped multi-step work.

### ᛏ Tyr — The Lawgiver
**Model:** `minimax/MiniMax-M3` (via minimax.io)
**Cost:** $0.30/M input · $1.20/M output
**Role:** Complex implementation & deep debugging

Tyr is the boldest — for the most demanding engineering work. Complex features from scratch, deep debugging of subtle bugs, architectural design, cross-cutting refactoring, and critical code review. Every Tyr plan is first audited by Forseti.

### ᛉ Vidarr — The Avenger
**Model:** `openai/gpt-5.5` (via OpenAI ChatGPT subscription)
**Cost:** Subscription (highest tier)
**Role:** Last resort fallback

Vidarr avenges when all others fail. Only invoked when Tyr stalls or debugging is stuck. For novel problems requiring lateral thinking, postmortem analysis of failed attempts, and the hardest unsolvable bugs.

### ᚨ Forseti — The Just One
**Model:** `minimax/MiniMax-M3` (via minimax.io, **edit: deny**, audit-only)
**Cost:** $0.30/M input · $1.20/M output
**Role:** Adversarial plan review

Forseti sits in judgment. Before any Tyr or Vidarr plan executes, Forseti audits it for completeness, correctness, consistency, feasibility, and security. He demands corrections where needed and only approves when the plan is solid. He cannot write code — his only tool is reason.

---

```
                 ⎛                 ⎞
                ⎛   ╱╲     ╱╲    ⎞
               ⎛   ╱  ╲   ╱  ╲   ⎞
               ⎜  ╱ ╱╲╲ ╱╱╲╲ ╲  ⎟
               ⎜  ╲ ╲╱╱ ╲╲╱╱ ╱  ⎟
               ⎛   ╲  ╱   ╲  ╱   ⎞
                ⎛   ╲╱     ╲╱    ⎞
                 ⎛                 ⎞
    ╔══════════════════════════════════════════════════╗
    ║              ᚨᛖᚷᛁᛋᚺᛃᚨᛚᛗᚱ               ║
    ║            The Helm of Awe                        ║
    ╚══════════════════════════════════════════════════╝
```

## ⚙️ Request Flow

```
       ┌─┐
       ║"│
       └┬┘
       ┌┼┐            ┌──────┐                                    ┌─────────┐
        │             │ᛟ ODIN│               ┌────────┐           │ᚨ FORSETI│
       ┌┴┐            │Router│               │Subagent│           │Auditor  │
      User            └───┬──┘               └────┬───┘           └────┬────┘
        │    Request      │                       │                    │
        │────────────────>│                       │                    │
        │                 │                       │                    │
        │                 │────┐                  │                    │
        │                 │    │ Decompose into   │                    │
        │                 │<───┘ parallel streams │                    │
        │                 │                       │                    │
        │                 │                       │                    │
        │                 │   task (parallel)     │                    │
        │                 │──────────────────────>│                    │
        │                 │                       │                    │
        │                 │   task (parallel)     │                    │
        │                 │──────────────────────>│                    │
        │                 │                       │                    │
        │                 │   task (parallel)     │                    │
        │                 │──────────────────────>│                    │
        │                 │                       │                    │
        │                 │                       │  plan review       │
        │                 │                       │  (when complex)    │
        │                 │                       │───────────────────>│
        │                 │                       │                    │
        │                 │                       │ approve / changes  │
        │                 │                       │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
        │                 │                       │                    │
        │                 │       results         │                    │
        │                 │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │                    │
        │                 │                       │                    │
        │  Synthesized    │                       │                    │
        │  response       │                       │                    │
        │<─ ─ ─ ─ ─ ─ ─ ─ │                       │                    │
      User            ┌───┴──┐               ┌────┴───┐           ┌────┴────┐
       ┌─┐            │ᛟ ODIN│               │Subagent│           │ᚨ FORSETI│
       ║"│            │Router│               └────────┘           │Auditor  │
       └┬┘            └──────┘                                    └─────────┘
       ┌┼┐
        │
       ┌┴┐
```

> _Generated with PlantUML ASCII art (`plantuml -utxt`)_

**Key behaviors:**
- **Odin routes by complexity** — never does work himself, only delegates
- **Mimir uses Semble-first** — semantic search before grep/glob
- **Forseti gates all Tier 4/5 work** — no Tyr or Vidarr code is written without audit
- **Parallel dispatch** — independent work items launch simultaneously
- **Hindsight memory** — all agents use the default bank for cross-session context

---

```
                  ╱⎻⎻⎻⎻⎻⎻⎻⎻⎻⎻⎻⎻⎻⎻⎻⎻⎻⎻╲
                 ╱    ᚢᚷᚷᛞᚱᚨᛋᛁᛚ     ╲
                ╱   The World Ash Tree    ╲
               ╱____________________________╲
                         ││││
                    ═════╧╧╧╧═════
```

## 🚀 Installation

```bash
git clone git@github.com:DrB0rk/BizarHarness.git
cd BizarHarness
chmod +x install.sh
./install.sh
```

The installer copies agent definitions and config to `~/.config/opencode/`, merges the template `opencode.json`, and prints next steps.

## 📋 Prerequisites

- [opencode CLI](https://opencode.ai) installed and on your `$PATH`
- A [Hindsight](https://memory-api.polderlabs.io) API key for persistent memory
- Provider connections (via `/connect` in opencode TUI)

## 🔑 Provider Setup

After installation, run `/connect` in opencode to add your API keys:

| Provider | Models | Auth |
|----------|--------|------|
| **OpenCode Zen** | `opencode/deepseek-v4-flash-free` | Free — no key needed |
| **minimax.io** | `minimax/MiniMax-M2.7`, `minimax/MiniMax-M3` | API key from [minimax.io](https://minimax.io) |
| **OpenAI** | `openai/gpt-5.5` | ChatGPT subscription (OAuth) |

Then run `/models` to verify everything is connected.

---

```
          ╔════════════════════════════════════════╗
          ║     ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ · ᚺ ᚾ ᛁ ᛃ ᛇ ᛈ      ║
          ║     ᛉ ᛊ ᛏ ᛒ ᛖ ᛗ · ᛚ ᛝ ᛟ ᛞ           ║
          ║        Elder Futhark · 24 Runes         ║
          ╚════════════════════════════════════════╝
```

```
     ╔═══════════════════════════════════════════════╗
     ║                                               ║
     ║   May your queries be wise, your agents       ║
     ║   ever faithful, and your bugs few.           ║
     ║                                               ║
     ║       Diagrams by PlantUML ASCII art          ║
     ║       ᚱᚨᛞᛖ᛫ᚹᛖᛚ᛫ᚨᚾᛞ᛫ᛈᚱᛟᛋᛈᛖᚱ               ║
     ║       (Ráðe vel · ok prosper)                 ║
     ║                                               ║
     ╚═══════════════════════════════════════════════╝
```
