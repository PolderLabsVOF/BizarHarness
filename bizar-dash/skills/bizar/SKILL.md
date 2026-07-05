---
name: biz
description: Use when working with, configuring, troubleshooting, or understanding the Bizar Norse-pantheon multi-agent system for opencode. Covers Odin routing, agent tiers, cost-aware dispatch, parallel implementation, and common failure modes.
---

# Bizar

Norse-pantheon multi-agent system for opencode. 13 agents across 4 cost tiers, with Odin as a pure router that always splits implementation across parallel subagents.

## Architecture

Odin is the only primary agent. Every request hits him first. He NEVER does work - he decomposes into parallel streams and dispatches to subagents.

All subagents use Obsidian vault memory with per-project vaults. Call `obsidian_list_vaults` at session start to discover available vaults, determine the project name, and use the matching `<project-name>` vault. The default vault is for general/cross-project knowledge only.

## Agent Reference

| Agent | Model | Tier | Cost | When to Route |
|---|---|---|---|---|
| Odin | MiniMax-M3 | Router | $0.30/M · $1.20/M | Primary entry point. Decomposes and dispatches. |
| Mimir | DeepSeek V4 Flash | Free | $0 | Deep codebase research, Semble-first exploration, docs analysis |
| Heimdall | DeepSeek V4 Flash | Free | $0 | Simple edits, file ops, mechanical CRUD, quick answers |
| Hermod | MiniMax-M2.7 | Mid | $0.30/M · $1.20/M | Git ops: commit, push, PR, merge, rebase, branches |
| Thor | MiniMax-M2.7 | Mid | $0.30/M · $1.20/M | Moderate implementation, tests, debugging, refactoring |
| Tyr | MiniMax-M3 | High | $0.30/M · $1.20/M | Complex features, architecture, deep debugging, cross-cutting refactor |
| Vidarr | GPT-5.5 | Ultra | ChatGPT sub | Last resort when Tyr fails or debugging is stuck |
| Forseti | MiniMax-M3 | Gate | $0.30/M · $1.20/M | Plan auditor - reviews Tyr/Vidarr plans before execution |
| Semble | MCP search | Free | $0 | MCP code search tool - not an agent |

## Odin Routing Rules

**Odin has `edit: deny`, `bash: deny`, `glob: deny`, `grep: deny`.** He literally cannot self-handle.

### Mandatory Parallelism

1. Every request is decomposed into independent work items
2. Always 2+ parallel `task` calls in a single message
3. Implementation always splits across @thor + @tyr (frontend/backend, file split, impl+tests)
4. If a task truly cannot be split, pair it with a parallel research or review task

### Routing Cheat Sheet

```
Research / Understanding     → @mimir  (free, Semble-first)
Quick edit / File ops        → @heimdall  (free)
Git / PR / Merge             → @hermod  (M2.7)
Moderate implementation      → @thor  (M2.7)
Complex implementation       → @tyr  (M3, after @forseti audit)
Ultimate fallback            → @vidarr  (GPT-5.5, after @forseti audit)
Plan review / Audit         → @forseti  (M3, review only)
```

### Cost Escalation

```
Free (Mimir, Heimdall) → $Mid (Thor, Hermod) → $$High (Tyr) → $$$Ultra (Vidarr)
```

Never use a paid agent for work a free agent can do. Never use Tyr for what Thor can handle.

## MiniMax Multi-Key Rotation

When using the `minimax/MiniMax-M3` or `minimax/MiniMax-M2.7` model ids, do NOT set a custom `baseURL`. The plugin rotates through keys on 429/402/5xx:

```bash
# Option A - comma-separated env var
export MINIMAX_API_KEYS="key1,key2,key3"

# Option B - numbered env vars
export MINIMAX_API_KEY="primary-key"
export MINIMAX_API_KEY_2="second-key"
export MINIMAX_API_KEY_3="third-key"
```

Rotation triggers on 429 (rate limit), 402 (quota exhausted), 500/502/503/504 (server error). Does NOT trigger on 401 (unauthorized - fix the key).

## Troubleshooting

### Odin Self-Handles Instead of Routing
**Symptoms:** Odin runs bash, glob, grep, edit, or write directly.

**Fix:** Remove those permissions from `~/.config/opencode/agents/odin.md`:
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

### Forseti Rejects Every Plan
Provide more detail: specific file paths, data flow, error handling, security implications.
