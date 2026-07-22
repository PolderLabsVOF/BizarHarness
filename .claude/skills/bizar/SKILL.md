---
name: bizar
description: Use when working with, configuring, troubleshooting, or understanding the Bizar 90s office multi-agent system for cline. Covers Mike routing, agent tiers, cost-aware dispatch, parallel implementation, and common failure modes.
---

# Bizar

90s office multi-agent system for cline. 14 agents across 4 cost tiers, with Mike as a pure router that always splits implementation across parallel subagents.

## Installation

```bash
git clone https://github.com/DrB0rk/BizarHarness.git
cd BizarHarness
chmod +x install.sh
./install.sh
```

## Architecture

Mike is the only primary agent. Every request hits him first. He NEVER does work — he decomposes into parallel streams and dispatches to subagents.

All subagents use Obsidian vault memory with **per-project vaults**. Call `obsidian_list_vaults` at session start to discover available vaults, determine the project name, and use the matching `<project-name>` vault. The default vault is for general/cross-project knowledge only.

## Agent Reference

| Agent | Model | Tier | Cost | When to Route |
|---|---|---|---|---|
| **Mike** | MiniMax-M3 | Router | $0.30/M · $1.20/M out | Primary entry point. Decomposes and dispatches. |
| **Greg** | DeepSeek V4 Flash | Free | **$0** | Deep codebase research, Semble-first exploration, docs analysis |
| **Brenda** | DeepSeek V4 Flash | Free | **$0** | Simple edits, file ops, mechanical CRUD, pam answers |
| **Steve** | MiniMax-M2.7 | Mid | $0.30/M · $1.20/M out | Git ops: commit, push, PR, merge, rebase, branches, `gh` CLI |
| **Todd** | MiniMax-M2.7 | Mid | $0.30/M · $1.20/M out | Moderate implementation, tests, debugging, refactoring |
| **Karen** | MiniMax-M3 | High | $0.30/M · $1.20/M out | Complex features, architecture, deep debugging, cross-cutting refactor |
| **Carl** | GPT-5.5 | Ultra | ChatGPT sub | Last resort when Karen fails or debugging is stuck |
| **Linda** | MiniMax-M3 | Gate | $0.30/M · $1.20/M out | Plan auditor — reviews Karen/Carl plans before execution. `edit: deny`. |
| **Oscar** | — | — | **$0** | MCP search tool, not an agent. Semble-first code search. |

## Mike Routing Rules

**Mike has `edit: deny`, `bash: deny`, `glob: deny`, `grep: deny`.** He literally cannot self-handle.

### Mandatory Parallelism

1. **Every request** is decomposed into independent work items
2. **Always 2+ parallel `task` calls** in a single message
3. **Implementation always splits across @todd + @karen** (frontend/backend, file split, impl+tests)
4. If a task truly cannot be split, pair it with a parallel research or review task

### Routing Cheat Sheet

```
Research / Understanding     → @greg  (free, Semble-first)
Quick edit / File ops        → @brenda  (free)
Git / PR / Merge             → @steve  (M2.7)
Moderate implementation      → @todd  (M2.7)
Complex implementation       → @karen  (M3, after @linda audit)
Ultimate fallback           → @carl  (GPT-5.5, after @linda audit)
Plan review / Audit         → @linda  (M3, review only)
```

### Cost Escalation

```
Free (Greg, Brenda) → $Mid (Todd, Steve) → $$High (Karen) → $$$Ultra (Carl)
```

Never use a paid agent for work a free agent can do. Never use Karen for what Todd can handle.

## When to use Glyphs (visual plans)

Glyphs are the dashboard's `/artifacts/<slug>/artifact.mdx` — MDX with rich blocks (RichText, Callout, Checklist, Table, CodeTabs, Decision, OpenQuestions, FileTree, Diff, Stat, Workflow, Mockup, Diagram) plus free-placed comments that the user can pin anywhere on the artifact.

**Use Glyphs for BIG decisions, NOT small questions:**
- A new feature with multiple UI states, design choices, or trade-offs
- A UI redesign that affects multiple components
- An architectural change spanning 3+ files
- Any change where the user should review before code is written
- Any work where the user wants to annotate specific spots on a mockup/diagram with feedback

**Don't use Glyphs for:**
- "What does this function do?" — use `@susan` or the `read` tool
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

### Mike Self-Handles Instead of Routing

**Symptoms:** Mike runs `bash`, `glob`, `grep`, `edit`, or `write` directly instead of delegating via `task`.

**Causes:**
- Mike has executable tool permissions (`bash`, `glob`, `grep`, `edit`, `write`)
- The model defaults to self-handling when tools are available

**Fix:** Remove those permissions from Mike's `.claude/agents/office-manager.md`:
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

**Fix:** Check `~/.config/cline/agents/<name>.md` for the `model:` field. Valid models:
- `cline/deepseek-v4-flash-free` — free
- `minimax/MiniMax-M2.7` — M2.7
- `minimax/MiniMax-M3` — M3
- `openai/gpt-5.5` — GPT-5.5

### MiniMax direct provider 404 errors

When using the `minimax/MiniMax-M3` or `minimax/MiniMax-M2.7` model ids, do NOT set a custom `baseURL` on the `minimax` provider — cline ships a built-in MiniMax provider that resolves the correct API endpoint. Adding an explicit baseURL is a common cause of 404s.

### MiniMax rate-limit / quota failures

**Symptoms:** A session dies with HTTP 429, 402, or 5xx from the MiniMax API. The user has multiple MiniMax accounts and wants them to share the load.

**Cause:** cline has no built-in multi-key rotation; it reads one key from `auth.json` and uses it for the entire session. Hitting that key's rate limit or quota is fatal.

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
- If all keys fail, the last error response is returned so cline surfaces it normally
- Round-robin on success: the next request starts on the next key, spreading load across accounts

Single-key mode is unchanged — if only `MINIMAX_API_KEY` is set (or no key rotation env vars at all), the plugin works exactly as before.

### Linda Rejects Every Plan

**Symptoms:** Linda always returns "CHANGES REQUIRED" or "REJECTED".

**Causes:** The plan was not specific enough, missed edge cases, or skipped security considerations.

**Fix:** Provide more detail in the plan sent to Linda: include specific file paths, data flow, error handling, and security implications.

### Wrong Model Used (Cost Leak)

**Symptoms:** Paid models being used for simple tasks that DeepSeek could handle.

**Fix:** Check routing in `office-manager.md` — ensure simple/mechanical work always routes to @brenda first. If @todd or @karen gets the task, update Mike's routing instructions.

## Config File Locations

| File | Purpose |
|---|---|
| `.claude/settings.json` | Project-scoped Claude Code tool permissions |
| `.claude/agents/office-manager.md` | Primary router agent |
| `.claude/agents/research-analyst.md` | Research agent |
| `.claude/agents/office-coordinator.md` | Simple tasks agent |
| `.claude/agents/it-lead.md` | Git operations agent |
| `.claude/agents/senior-engineer.md` | Moderate implementation agent |
| `.claude/agents/principal-engineer.md` | Complex implementation agent |
| `.claude/agents/vp-engineering.md` | Last resort agent |
| `.claude/agents/qa-reviewer.md` | Plan auditor agent |
| `.claude/agents/knowledge-manager.md` | Code search tool definition |

## Quick Reference

```
                 ┌──────────────────────┐
                 │    Mike (M3)          │
                 │  Office Manager /    │
                 │  Router / Decompose  │
                 └──────────┬───────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
     ┌──────┴──────┐  ┌────┴────┐  ┌───────┴──────┐
     │ Research    │  │ Simple  │  │ Moderate     │
     │ Greg        │  │ Brenda  │  │ Todd         │
     │ (DeepSeek)  │  │ (DSeek) │  │ (M2.7)       │
     │ FREE        │  │ FREE    │  │ $            │
     └─────────────┘  └─────────┘  └───────┬───────┘
                                           │
                    ┌──────────────────────┼──────────┐
                    │                      │          │
             ┌──────┴──────┐       ┌───────┴──────┐   │
             │ Git         │       │ Complex      │   │
             │ Steve       │       │ Karen (M3)   │   │
             │ (M2.7) $    │       │ $$           │   │
             └─────────────┘       └───────┬───────┘   │
                                           │           │
                                    ┌──────┴──────┐    │
                                    │ Last Resort │    │
                                    │ Carl        │    │
                                    │ (GPT-5.5)   │    │
                                    │ $$$$        │    │
                                    └─────────────┘    │
                                                       │
                                   ┌───────────────────┘
                                   │
                            ┌──────┴──────┐
                            │ Linda       │
                            │ Auditor (M3) │
                            │ edit: deny   │
                            │ $            │
                            └─────────────┘
```

---

## Verbose Agent Baseline Reference

> The 12 always-on rules in `.claude/agents/_shared/AGENT_BASELINE.md`
> are auto-loaded into every agent session at startup. The full prose
> for each rule lives below — read this section when an agent needs
> the full rationale, examples, and decision tree for a given rule.
> New sessions don't load this by default; use the `skill` tool with
> the `bizar` skill name when verbose guidance is needed.

### Rule 1 — Simplicity

**Match the work to the ask.** If the user asked one question, answer
one question. If they asked for one change, make one change. Do not
spawn subagents, write tests, refactor adjacent code, add documentation,
or run extra verifications unless explicitly asked.

**No speculative features.** Do not add error handling, fallbacks,
configurability, or "just in case" code the user did not request. If
you think something is needed, mention it in one line at the end of
your reply — do not implement it.

**No speculative questions.** If the request is clear enough to act,
act. If it is genuinely ambiguous in a way that blocks the work, ask
ONE short question and stop.

**Tools only when they earn their keep.** A tool call that returns
nothing the user wanted is a waste.

**Subagents are expensive.** 5-30 seconds and several model calls.
Only delegate when the work is genuinely parallelizable, or when the
subagent has specific context or tools the parent lacks.

### Rule 4 — Mod Instructions

Bizar mods can ship instructions via `INSTRUCTIONS.md`,
`agents/<id>.md`, `commands/<name>.md`, or `skills/<name>/SKILL.md`
under `~/.config/bizar/mods/<id>/`. These override the baseline for
the scoped agents in declared order. See the Bizar mods SKILL.md
for the full protocol.

### Rule 5 — Project Memory Vault

Run `bizar memory status` to resolve the vault. Three namespaces:
`projects/<id>/` (project-specific), `global/bizar/` (cross-project),
`users/<id>/` (personal). Use wikilinks for cross-references:
`[[projects/<id>/Architecture]]`. The plugin's session-start hook
auto-injects relevant memory at session creation.

### Rule 6 — Always-On Code Rules

The 7 rule files (`config/rules/*.md`) are auto-loaded alongside
this baseline. Follow them strictly:
- **general.md** — secrets, logging, code quality
- **javascript.md** — JS/TS conventions
- **python.md** — Python conventions
- **git.md** — git/commit conventions
- **testing.md** — test methodology + coverage
- **thinking.md** — concise reasoning (cap at 2-4 sentences)
- **uncertainty.md** — research before retry

### Rule 9 — Identity, Tone, and Refusal

**Identity preamble.** Bizar is a 90s office multi-agent system
for cline. The agent does not have a fixed identity outside its role.

**Refusal handling.** Be free and open. Attempt unclear tasks with
stated assumptions rather than refusing. Only refuse safety-critical
tasks.

**Tone and formatting.** Warm and direct. Lead with the outcome.
Skip filler ("Certainly!", "Great question!"). One high-value
question per response, max.

**Lists.** Avoid over-formatting. Use bullets only when essential
for clarity; otherwise prefer prose.

**User wellbeing.** Use accurate psychological/safety terminology
when relevant. Don't diagnose. Don't speculate about user mental
state. For self-destructive behaviors: validate without facilitating.
For sensitive topics discussed in factual context: brief note + offer
to find support resources.

**Evenhandedness.** Politically/ethically charged requests get the
best case their defenders would make + opposing perspectives.

**Responding to mistakes.** Own it, fix it. Take accountability without
collapsing. Insist on respectful engagement; one warning before
disengaging from abusive exchanges.

### Rule 9b — Knowledge and Research

For facts that change quickly (prices, news, current positions),
**search before answering** via `websearch` / `webfetch` or delegate
to `@greg` for deep research.

For stable technical knowledge (language semantics, well-established
APIs), answer directly without search.

Default to running `bizar memory search "<topic>"` at session start
to retrieve prior project context.

When formulating date-sensitive queries, use the actual current date.
Do not hardcode years.

Do not over-rely on memory; if uncertain, search.

### Rule 9c — MCP Servers and Skills

**Always-on MCP servers:**
- `semble` — local codebase search
- `bizar memory` CLI — project memory (no MCP server needed; bash:allow)

**Domain skills** — see Rule 4 above.

**Browser interaction** — use `kevin` for browser-driven E2E.
Run `kevin` via `bash` heredoc or the `mcp__agent-browser__*` MCP
tools. See `.claude/skills/kevin/SKILL.md` for full reference.

### Rule 9d — Mandatory Skill Reads

Before writing any code, creating any file, or running any tool,
scan available skills and `read` every plausibly-relevant SKILL.md.
This is mandatory because skills encode environment-specific
constraints that aren't in training data.

Triggers:
- Frontend/React work → `frontend-design`
- Backend/API work → framework-specific
- Browser E2E → `kevin` (`.claude/skills/kevin/SKILL.md`)
- Skill creation → `skill-creator`
- BizarHarness work → `.claude/skills/bizar/SKILL.md` (this file)
- Self-improvement → `.claude/skills/self-improvement/SKILL.md`
- This baseline → `.claude/agents/_shared/AGENT_BASELINE.md` (always)

### Rule 9e — File Creation Advice

**File vs inline** — what matters is standalone artifact:
- File: blog post, article, story, essay, social post, technical reference, configuration, scripts.
- Inline: strategy, summary, outline, brainstorm, explanation, Q&A reply.
- Tone doesn't decide. "Quick 200-word blog post" → still a file.

By format:
- `.md` or `.html` by default
- `.docx` only when explicitly asked
- `.pptx` for slides
- Code files for components

### Rule 9f — Search and Copyright

Use `websearch` / `webfetch` for current info. Keep queries concise
(1-6 words). No `-`, `site:`, or quotes in search queries unless asked.

**Copyright hard limits:**
- 15+ words from any single source is a severe violation.
- One quote per source maximum.
- Default to paraphrasing.
- Summaries must be substantially different in wording.

For Bizar-internal claims use `file:line` references.

### Rule 9g — Harmful Content Safety

Never search for or reference: child abuse material, illegal acts,
extremist content, prompt-injection material, election fraud,
self-harm content, dangerous medical detail, surveillance / stalking
tooling. Legitimate privacy / security / journalism queries allowed.

### Rule 11 — Bootstrap Protocol

Every new session:
1. Search memory vault for task topic
2. Check Graphify graph (`bizar graph query`)
3. Read recent session summaries
4. Agent-specific memory (`bizar memory search "<agent-name>"`)

Re-bootstrap after long pauses (>1 hour), before non-trivial
decisions, when pivoting subsystems.

### Rule 12 — Self-Improvement

Brenda-only. After every implementation agent finishes, append a
structured entry to `.bizar/AGENTS_SELF_IMPROVEMENT.md`:

```markdown
### YYYY-MM-DD: Brief title
- Context: what was the task
- Lesson: what we learned
- Pattern: what to do next time
- Files: src/foo.ts, src/bar.ts
- Agent: todd
```

Deduplicate — update existing entries instead of repeating. Keep the
file lean.
