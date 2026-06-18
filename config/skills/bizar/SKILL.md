---
name: bizar
description: Use when working with, configuring, troubleshooting, or understanding the Bizar Norse-pantheon multi-agent system for opencode. Covers Odin routing, agent tiers, cost-aware dispatch, parallel implementation, and common failure modes.
---

# Bizar

Norse-pantheon multi-agent system for opencode. 13 agents across 4 cost tiers, with Odin as a pure router that always splits implementation across parallel subagents.

## Installation

```bash
git clone https://github.com/DrB0rk/BizarHarness.git
cd BizarHarness
chmod +x install.sh
./install.sh
```

## Architecture

Odin is the only primary agent. Every request hits him first. He NEVER does work — he decomposes into parallel streams and dispatches to subagents.

All subagents use Hindsight memory with **per-project banks**. Call `hindsight_list_banks` at session start to discover available banks, determine the project name, and use `bank_id: "<project-name>"` in all Hindsight calls. The default bank is for general/cross-project knowledge only.

## Agent Reference

| Agent | Model | Tier | Cost | When to Route |
|---|---|---|---|---|
| **Odin** ᛟ | MiniMax-M3 | Router | $0.30/M · $1.20/M out | Primary entry point. Decomposes and dispatches. |
| **Mimir** ᛗ | DeepSeek V4 Flash | Free | **$0** | Deep codebase research, Semble-first exploration, docs analysis |
| **Heimdall** ᚹ | DeepSeek V4 Flash | Free | **$0** | Simple edits, file ops, mechanical CRUD, quick answers |
| **Hermod** ᚱ | MiniMax-M2.7 | Mid | $0.30/M · $1.20/M out | Git ops: commit, push, PR, merge, rebase, branches, `gh` CLI |
| **Thor** ᚦ | MiniMax-M2.7 | Mid | $0.30/M · $1.20/M out | Moderate implementation, tests, debugging, refactoring |
| **Tyr** ᛏ | MiniMax-M3 | High | $0.30/M · $1.20/M out | Complex features, architecture, deep debugging, cross-cutting refactor |
| **Vidarr** ᛉ | GPT-5.5 | Ultra | ChatGPT sub | Last resort when Tyr fails or debugging is stuck |
| **Forseti** ᚨ | MiniMax-M3 | Gate | $0.30/M · $1.20/M out | Plan auditor — reviews Tyr/Vidarr plans before execution. `edit: deny`. |
| **Semble** | — | — | **$0** | MCP search tool, not an agent. Semble-first code search. |

## Odin Routing Rules

**Odin has `edit: deny`, `bash: deny`, `glob: deny`, `grep: deny`.** He literally cannot self-handle.

### Mandatory Parallelism

1. **Every request** is decomposed into independent work items
2. **Always 2+ parallel `task` calls** in a single message
3. **Implementation always splits across @thor + @tyr** (frontend/backend, file split, impl+tests)
4. If a task truly cannot be split, pair it with a parallel research or review task

### Routing Cheat Sheet

```
Research / Understanding     → @mimir  (free, Semble-first)
Quick edit / File ops        → @heimdall  (free)
Git / PR / Merge             → @hermod  (M2.7)
Moderate implementation      → @thor  (M2.7)
Complex implementation       → @tyr  (M3, after @forseti audit)
Ultimate fallback           → @vidarr  (GPT-5.5, after @forseti audit)
Plan review / Audit         → @forseti  (M3, review only)
```

### Cost Escalation

```
Free (Mimir, Heimdall) → $Mid (Thor, Hermod) → $$High (Tyr) → $$$Ultra (Vidarr)
```

Never use a paid agent for work a free agent can do. Never use Tyr for what Thor can handle.

## Troubleshooting

### Odin Self-Handles Instead of Routing

**Symptoms:** Odin runs `bash`, `glob`, `grep`, `edit`, or `write` directly instead of delegating via `task`.

**Causes:**
- Odin has executable tool permissions (`bash`, `glob`, `grep`, `edit`, `write`)
- The model defaults to self-handling when tools are available

**Fix:** Remove those permissions from Odin's `~/.config/opencode/agents/odin.md`:
```yaml
permission:
  task: allow
  read: allow
  list: allow
  todowrite: allow
  question: allow
  webfetch: allow
  websearch: allow
  # NO bash, glob, grep, edit, write
```

### Agent Uses Wrong Model

**Symptoms:** A subagent uses DeepSeek when it should use M3, or uses GPT-5.5 for a simple edit.

**Causes:** The agent's `model:` field in its `.md` file is wrong or the provider isn't configured.

**Fix:** Check `~/.config/opencode/agents/<name>.md` for the `model:` field. Valid models:
- `opencode/deepseek-v4-flash-free` — free
- `minimax/MiniMax-M2.7` — M2.7 (capital M in model ID)
- `minimax/MiniMax-M3` — M3 (capital M in model ID)
- `openai/gpt-5.5` — GPT-5.5

### Minimax 404 Errors

**Symptoms:** 404 errors when calling minimax models.

**Cause:** A `baseURL: "https://api.minimax.io/v1"` was set in the provider config, which conflicts with the ai-sdk minimax provider's internal URL construction.

**Fix:** Remove any `baseURL` from the minimax provider section. The minimax API key in `auth.json` is sufficient. Example fix:
```diff
- "baseURL": "https://api.minimax.io/v1"
```
The provider uses the correct default URL internally.

### Forseti Rejects Every Plan

**Symptoms:** Forseti always returns "CHANGES REQUIRED" or "REJECTED".

**Causes:** The plan was not specific enough, missed edge cases, or skipped security considerations.

**Fix:** Provide more detail in the plan sent to Forseti: include specific file paths, data flow, error handling, and security implications.

### Wrong Model Used (Cost Leak)

**Symptoms:** Paid models being used for simple tasks that DeepSeek could handle.

**Fix:** Check routing in `odin.md` — ensure simple/mechanical work always routes to @heimdall first. If @thor or @tyr gets the task, update Odin's routing instructions.

## Config File Locations

| File | Purpose |
|---|---|
| `~/.config/opencode/opencode.json` | Main config (no minimax baseURL) |
| `~/.config/opencode/AGENTS.md` | Routing table and conventions |
| `~/.config/opencode/agents/odin.md` | Primary router agent |
| `~/.config/opencode/agents/mimir.md` | Research agent |
| `~/.config/opencode/agents/heimdall.md` | Simple tasks agent |
| `~/.config/opencode/agents/hermod.md` | Git operations agent |
| `~/.config/opencode/agents/thor.md` | Moderate implementation agent |
| `~/.config/opencode/agents/tyr.md` | Complex implementation agent |
| `~/.config/opencode/agents/vidarr.md` | Last resort agent |
| `~/.config/opencode/agents/forseti.md` | Plan auditor agent |
| `~/.config/opencode/agents/semble-search.md` | Code search tool definition |

## Quick Reference

```
                 ┌──────────────────────┐
                 │     Odin ᛟ (M3)      │
                 │   Router / Decompose  │
                 └──────────┬───────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
     ┌──────┴──────┐  ┌────┴────┐  ┌───────┴──────┐
     │ Research    │  │ Simple  │  │ Moderate     │
     │ Mimir ᛗ     │  │ Heimdall│  │ Thor ᚦ       │
     │ (DeepSeek)  │  │ (DSeek) │  │ (M2.7)       │
     │ FREE        │  │ FREE    │  │ $            │
     └─────────────┘  └─────────┘  └───────┬───────┘
                                           │
                    ┌──────────────────────┼──────────┐
                    │                      │          │
             ┌──────┴──────┐       ┌───────┴──────┐   │
             │ Git         │       │ Complex      │   │
             │ Hermod ᚱ    │       │ Tyr ᛏ (M3)   │   │
             │ (M2.7) $    │       │ $$           │   │
             └─────────────┘       └───────┬───────┘   │
                                           │           │
                                    ┌──────┴──────┐    │
                                    │ Last Resort │    │
                                    │ Vidarr ᛉ   │    │
                                    │ (GPT-5.5)   │    │
                                    │ $$$$        │    │
                                    └─────────────┘    │
                                                       │
                                   ┌───────────────────┘
                                   │
                            ┌──────┴──────┐
                            │ Forseti ᚨ   │
                            │ Auditor (M3) │
                            │ edit: deny   │
                            │ $            │
                            └─────────────┘
```
