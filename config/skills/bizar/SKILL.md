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

All subagents use Obsidian vault memory with **per-project vaults**. Call `obsidian_list_vaults` at session start to discover available vaults, determine the project name, and use the matching `<project-name>` vault. The default vault is for general/cross-project knowledge only.

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

## When to use Glyphs (visual plans)

Glyphs are the dashboard's `/artifacts/<slug>/artifact.mdx` — MDX with rich blocks (RichText, Callout, Checklist, Table, CodeTabs, Decision, OpenQuestions, FileTree, Diff, Stat, Workflow, Mockup, Diagram) plus free-placed comments that the user can pin anywhere on the artifact.

**Use Glyphs for BIG decisions, NOT small questions:**
- A new feature with multiple UI states, design choices, or trade-offs
- A UI redesign that affects multiple components
- An architectural change spanning 3+ files
- Any change where the user should review before code is written
- Any work where the user wants to annotate specific spots on a mockup/diagram with feedback

**Don't use Glyphs for:**
- "What does this function do?" — use `@frigg` or the `read` tool
- A simple bug fix with one obvious cause — just fix it
- Single-file changes with no design questions
- Anything that can be answered in one sentence

When the user says "show me a plan", "let's review the design", "I want to see the UI options", or "what should this look like" — that's a Glyph trigger. When they say "fix this bug", "what does X do", "rename this" — that's a direct edit, not a Glyph.

## How to create a Glyph

1. Write `artifacts/<slug>/artifact.mdx` with frontmatter (`title`, `status`, `kind: plan|recap`) and blocks
2. Write `artifacts/<slug>/meta.json` with `{ title, slug, status, author, created, lastEdited }`
3. Write `artifacts/<slug>/comments.json` as `[]` initially (comments added via the dashboard)
4. Use the full block vocabulary — see `glyphs-research.md` in Obsidian or the dashboard's `/api/artifacts/<slug>/render` for the JSON shape

Templates available:
- `templates/plan/plan.mdx.template` — forward planning (before code)
- `templates/plan/plan.canvas.template` — legacy canvas (don't use; replaced by MDX)

## How to read glyph feedback

When the user clicks "Submit to agent" on a glyph in the dashboard, the dashboard writes a structured `artifacts/<slug>/feedback.md` file and marks `meta.json` `status: review`. That file contains:

- All free-placed comments with `(x, y)` coordinates and text
- Answers to OpenQuestions (one `Q:` / `A:` block per question)
- The original MDX source

Read it with the `read_glyph_feedback` tool (preferred — returns parsed frontmatter + body + counts), or read the file directly with the `read` tool.

After reading the feedback, regenerate the glyph's `artifact.mdx` to address every comment and apply every answer. Then write the regenerated MDX back to `artifacts/<slug>/artifact.mdx` (and update `meta.json` if the title/summary changes).

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
- `minimax/MiniMax-M2.7` — M2.7
- `minimax/MiniMax-M3` — M3
- `openai/gpt-5.5` — GPT-5.5

### MiniMax direct provider 404 errors

When using the `minimax/MiniMax-M3` or `minimax/MiniMax-M2.7` model ids, do NOT set a custom `baseURL` on the `minimax` provider — opencode ships a built-in MiniMax provider that resolves the correct API endpoint. Adding an explicit baseURL is a common cause of 404s.

### MiniMax rate-limit / quota failures

**Symptoms:** A session dies with HTTP 429, 402, or 5xx from the MiniMax API. The user has multiple MiniMax accounts and wants them to share the load.

**Cause:** opencode has no built-in multi-key rotation; it reads one key from `auth.json` and uses it for the entire session. Hitting that key's rate limit or quota is fatal.

**Fix:** Set additional keys via env vars. The `bizar` plugin rotates through them on 429/402/5xx automatically.

```bash
# Option A — single comma-separated env var
export MINIMAX_API_KEYS="key1,key2,key3"

# Option B — numbered env vars (read in order, gaps skipped)
export MINIMAX_API_KEY="primary-key"
export MINIMAX_API_KEY_2="second-key"
export MINIMAX_API_KEY_3="third-key"
```

Rotation policy:
- Triggers on 429 (rate limit), 402 (quota exhausted), 500/502/503/504 (server error)
- Does NOT trigger on 401 (unauthorized — your key is wrong; fix the key, don't rotate)
- Does NOT trigger on other 4xx (client error — the request itself is bad)
- Network errors (ECONNRESET etc.) DO trigger rotation
- Caps at N attempts where N = number of configured keys (try each once)
- If all keys fail, the last error response is returned so opencode surfaces it normally
- Round-robin on success: the next request starts on the next key, spreading load across accounts

Single-key mode is unchanged — if only `MINIMAX_API_KEY` is set (or no key rotation env vars at all), the plugin works exactly as before.

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
| `~/.config/opencode/opencode.json` | Main config (no external baseURL needed) |
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
