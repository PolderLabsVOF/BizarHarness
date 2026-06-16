<!-- SEMBLE_START -->
## Semble Code Search

A `semble` MCP server is available with two tools:
- `mcp__semble__search` — search the codebase with a natural-language or code query.
- `mcp__semble__find_related` — find code similar to a specific file and line.

Always call `mcp__semble__search` before using Grep, Glob, or Read to explore the codebase. Use Grep/Glob/Read only for exact path lookup, exhaustive literal matches, or when the returned chunk lacks enough context.

Pass `--content docs` to search documentation and prose, `--content config` for config files, or `--content all` to search code, docs, and config together.

For CLI fallback or sub-agents without MCP access, use:

```bash
semble search "authentication flow" ./my-project
semble search "deployment guide" ./my-project --content docs
semble search "database host port" ./my-project --content config
semble find-related src/auth.py 42 ./my-project
semble search "save model to disk" ./my-project --top-k 10
```

The index is built on first run and cached automatically. If `semble` is not on `$PATH`, use `uvx --from "semble[mcp]" semble`.

### Workflow

1. Start with `mcp__semble__search` to find relevant chunks.
2. Use `--content docs` for documentation, `--content config` for config files, or `--content all` for everything.
3. Inspect full files only when the returned chunk does not give enough context.
4. Optionally use `mcp__semble__find_related` with a promising result's `file_path` and `line` to discover related implementations.
5. Use Grep/Glob/Read only when you need exhaustive literal matches or quick confirmation of an exact string.
<!-- SEMBLE_END -->

---

## Skill Discovery Protocol

The `skills` CLI (`npm install -g skills`) can install coding skills from skills.sh. Any agent working on implementation tasks MUST proactively use it:

### When to Search

At the start of any non-trivial task, check if a skill exists for it:
- **Framework-specific work** (React, Vue, Django, etc.)
- **Domain tasks** (testing, accessibility, security, performance, design)
- **Tool/technology usage** (Docker, Kubernetes, Supabase, etc.)
- **Pattern application** (TDD, clean architecture, etc.)

### How to Check Installed Skills

```bash
# Check if skills CLI is available
which skills 2>/dev/null

# List installed skills and their locations
skills list --json

# View installed skill files
ls ~/.opencode/skills/<skill-name>/SKILL.md
```

### How to Install

```bash
# Install all skills from a known skill repo
skills add <owner/repo> --all -y

# Install a specific skill from a repo  
skills add <owner/repo> -s "<skill-name>" -y
```

### Protocol Steps

1. **Assess**: When given a task, consider whether a skill might exist for it
2. **Check installed**: Run `skills list --json` to see what's already available
3. **Try known repos**: Based on the task domain, attempt installation from known skill repos (e.g., `skills add supabase/agent-skills --all -y` for database work, `skills add vercel-labs/agent-skills --all -y` for frontend work)
4. **Use**: After installing, the skill instructions are at `~/.opencode/skills/<skill-name>/SKILL.md` — load them with the `skill` tool
5. **Skip**: If no skill is found after trying likely repos, proceed without

### Known Skill Repositories by Domain

| Domain | Repos |
|--------|-------|
| General (find-skills, skill-creator) | `vercel-labs/skills` |
| Frontend (React, a11y, web-design) | `vercel-labs/agent-skills`, `shadcn/ui` |
| Backend (Supabase, Postgres, auth) | `supabase/agent-skills` |
| Testing (TDD, E2E, Playwright) | `mattpocock/skills`, `microsoft/playwright-cli` |
| Design (frontend-design, UI/UX) | `anthropics/skills`, `leonxlnx/taste-skill` |

### Agents That Must Comply

All implementation agents: @heimdall, @thor, @tyr, @vidarr. Odin routes with awareness that agents will self-discover skills.

---

## Model Routing & Agents

This system uses a 5-tier model architecture with a verification gate:

### Odin (default agent, MiniMax-M3)

Odin (`@odin`) is the All-Father and primary/default agent. He analyzes each request and **decomposes it into independent work streams** — **he never executes work himself**:
- **Identifies parallelizable work** and launches multiple subagent `task` calls in a **single message** (always 2+)
- **Always splits implementation** across @thor (M2.7) and @tyr (M3) running in parallel
- **Routes to @vör** for ambiguous requests — asks clarifying questions before work begins
- **Routes to @frigg** for read-only codebase Q&A — just answer questions, no code changes
- **Routes to @mimir** for deep codebase research, exploration, and documentation analysis
- **Routes to @heimdall** for simple tasks, mechanical work, quick edits, file operations
- **Routes to @hermod** for git and GitHub operations (commit, push, merge, PR, branches)
- **Routes to @baldr** for design system creation, DESIGN.md, visual audits
- **Routes to @thor** for moderate-complexity implementation
- **Routes to @tyr** for complex implementation and architecture
- **Routes to @vidarr** (very sparingly) for the hardest problems when all else fails
- **Gates Tier 4 and Tier 5 via @forseti** — audits and corrects plans before execution
- **Synthesizes** all parallel results into a coherent response

### Frigg

- **Model**: `opencode/deepseek-v4-flash-free` (via OpenCode Zen — free tier)
- **Use for**: Read-only codebase Q&A. Ask questions about the project and get answers with file references — never modifies anything.
- **Cost**: Free

### Vör

- **Model**: `opencode/deepseek-v4-flash-free` (via OpenCode Zen — free tier)
- **Use for**: Clarifying ambiguous or incomplete requests. First reads project context (`.bizar/PROJECT.md`, Hindsight, project files), then only asks targeted, project-specific questions if still unclear. Never asks generic questions.
- **Cost**: Free

### Heimdall

- **Model**: `opencode/deepseek-v4-flash-free` (via OpenCode Zen — free tier)
- **Use for**: Simple tasks, mechanical work, quick edits, file operations. The ever-watchful guardian.
- **Cost**: Free

### Mimir

- **Model**: `opencode/deepseek-v4-flash-free` (via OpenCode Zen — free tier)
- **Use for**: Deep codebase research, exploration, documentation analysis. Semble-first search approach.
- **Cost**: Free

### Hermod

- **Model**: `minimax/MiniMax-M2.7` (via minimax.io)
- **Use for**: Git and GitHub operations — commit, push, merge, PRs, branches, conflict resolution. The swift messenger.
- **Cost**: $0.30/M input, $1.20/M output

### Thor

- **Model**: `minimax/MiniMax-M2.7` (via minimax.io)
- **Use for**: Moderate complexity features, debugging, code review, refactoring
- **Cost**: $0.30/M input, $1.20/M output — cheaper than Tyr, more capable than Heimdall

### Baldr

- **Model**: `minimax/MiniMax-M2.7` (via minimax.io)
- **Use for**: Design system creation, DESIGN.md, visual audit, usability planning. Creates design plans — does not implement.
- **Cost**: $0.30/M input, $1.20/M output

### Tyr

- **Model**: `minimax/MiniMax-M3` (via minimax.io)
- **Use for**: Highest complexity implementation, debugging, architecture, multi-step engineering
- **Cost**: Higher — reserved for the hardest problems

### Vidarr

- **Model**: `openai/gpt-5.5` (via OpenAI ChatGPT subscription)
- **Use for**: The ultimate fallback — when Tyr stalls, debugging is stuck, or novel insight is needed
- **Cost**: Highest — use very sparingly, last resort only

### Forseti

- **Model**: `minimax/MiniMax-M3` (via minimax.io, audit-only, no edit permissions)
- **Use for**: Adversarial plan review — audits completeness, correctness, consistency, feasibility, security
- **Always runs before any Tier 4 or Tier 5 implementation begins**

### Routing Heuristic

Odin dispatches all tasks to subagents via the `task` tool. When work items are **independent**, he launches them as **parallel `task` calls in a single message**.

**Before dispatching any task, Odin determines the project name and sets the correct Hindsight bank.** See Hindsight Memory Protocol below for bank selection rules.

| Task Type | Route To |
|-----------|----------|
| File lookup, search, ls, info | @heimdall |
| Quick questions, explanations | @heimdall |
| Simple edit, rename, format | @heimdall |
| Mechanical CRUD, boilerplate | @heimdall |
| Read-only codebase Q&A, "how does X work" | @frigg — asks questions, answers with file references, never modifies |
| Ambiguous/incomplete requests | @vör — asks clarifying questions |
| Deep codebase research and exploration | @mimir |
| Documentation analysis | @mimir |
| Pattern discovery and architecture understanding | @mimir |
| Git commit, push, pull | @hermod |
| Branching, merging, rebasing | @hermod |
| Pull request management | @hermod |
| Merge conflict resolution | @hermod |
| GitHub operations (gh CLI) | @hermod |
| Moderate feature implementation | @thor |
| Non-trivial debugging | @thor |
| Code review, refactoring | @thor |
| Writing tests (medium complexity) | @thor |
| Design system creation, DESIGN.md, visual audit | @baldr (plan -> @thor/@tyr execute) |
| Complex new feature from scratch | @tyr (plan -> @forseti -> execute) |
| Deep debugging, subtle bugs | @tyr |
| Architectural design decisions | @tyr (plan -> @forseti -> execute) |
| Cross-cutting refactoring | @tyr |
| Critical code review | @tyr |
| Tier 4 failure / stuck debugging | @vidarr (plan -> @forseti -> execute) |
| Novel / unsolvable problems | @vidarr (plan -> @forseti -> execute) |
| Postmortem of failed attempts | @vidarr |
| Plan/approach review | @forseti |

---

## Hindsight Memory Protocol

A Hindsight memory MCP server is available. All agents **must** use **per-project banks** — the default bank is for general/cross-project knowledge only.

### Bank Selection Rules

1. **At session start**, call `hindsight_list_banks` to see what banks exist
2. Determine the project name from your working directory or the task context
3. Use the project-specific bank by passing `bank_id: "<project-name>"` in all Hindsight calls
4. If no bank exists for the project, create one with `hindsight_create_bank(bank_id: "<project-name>")`
5. The **default** bank is reserved for:
   - General AI-agent system knowledge (model configs, agent definitions, infrastructure)
   - Cross-project preferences and personal facts about the user
   - Knowledge that applies regardless of which project

### Available Hindsight Tools

| Tool | Purpose |
|------|---------|
| `hindsight_list_banks` | List all available banks — call this first |
| `hindsight_create_bank` | Create a new project bank if one doesn't exist |
| `hindsight_recall` | Search stored memories for relevant context |
| `hindsight_retain` | Store new information to memory |
| `hindsight_sync_retain` | Store and block until complete |
| `hindsight_reflect` | Synthesize insights across stored memories |
| `hindsight_list_mental_models` | Check existing mental models |
| `hindsight_get_mental_model` | Read a mental model's content |
| `hindsight_create_mental_model` | Create a persistent knowledge summary |
| `hindsight_update_bank` | Update a bank's name/mission/configuration |

### Required Workflow

1. **Session start**: `hindsight_list_banks` + `hindsight_recall` (with correct `bank_id`) + read `.bizar/AGENTS_SELF_IMPROVEMENT.md`
2. **During work**: `hindsight_retain` with correct `bank_id` for all project knowledge
3. **Task completion**: `hindsight_retain` summary into the project bank + record entry in `.bizar/AGENTS_SELF_IMPROVEMENT.md`
4. **Project knowledge**: Create mental models for sustained project context

### Hindsight MCP Server

The Hindsight MCP server is already configured. All agents interact with it through MCP tools. Always pass `bank_id` — do not rely on the default bank for project-specific work.
