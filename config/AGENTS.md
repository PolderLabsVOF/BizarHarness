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

## Model Routing & Agents

This system uses a 5-tier model architecture with a verification gate:

### Odin (default agent, MiniMax-M3)

Odin (`@odin`) is the All-Father and primary/default agent. He analyzes each request and **decomposes it into independent work streams** — **he never executes work himself**:
- **Identifies parallelizable work** and launches multiple subagent `task` calls in a **single message** (always 2+)
- **Always splits implementation** across @thor (M2.7) and @tyr (M3) running in parallel
- **Routes to @vör** for ambiguous requests — asks clarifying questions before work begins
- **Routes to @mimir** for deep codebase research, exploration, and documentation analysis
- **Routes to @heimdall** for simple tasks, mechanical work, quick edits, file operations
- **Routes to @hermod** for git and GitHub operations (commit, push, merge, PR, branches)
- **Routes to @baldr** for design system creation, DESIGN.md, visual audits
- **Routes to @thor** for moderate-complexity implementation
- **Routes to @tyr** for complex implementation and architecture
- **Routes to @vidarr** (very sparingly) for the hardest problems when all else fails
- **Gates Tier 4 and Tier 5 via @forseti** — audits and corrects plans before execution
- **Synthesizes** all parallel results into a coherent response

### Vör

- **Model**: `opencode/deepseek-v4-flash-free` (via OpenCode Zen — free tier)
- **Use for**: Clarifying ambiguous or incomplete requests. Asks targeted questions until the task is well-defined, then passes a clear brief back to Odin.
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

| Task Type | Route To |
|-----------|----------|
| File lookup, search, ls, info | @heimdall |
| Quick questions, explanations | @heimdall |
| Simple edit, rename, format | @heimdall |
| Mechanical CRUD, boilerplate | @heimdall |
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

A Hindsight memory MCP server is available. All agents **must** use it with the **default** bank (omit `bank_id` in all calls).

### Available Hindsight Tools

| Tool | Purpose |
|------|---------|
| `hindsight_recall` | Search stored memories for relevant context |
| `hindsight_retain` | Store new information to memory |
| `hindsight_sync_retain` | Store and block until complete |
| `hindsight_reflect` | Synthesize insights across stored memories |
| `hindsight_list_mental_models` | Check existing mental models |
| `hindsight_get_mental_model` | Read a mental model's content |
| `hindsight_create_mental_model` | Create a persistent knowledge summary |

### Required Workflow

1. **Session start**: `hindsight_recall` for task-relevant context + read `.bizar/AGENTS_SELF_IMPROVEMENT.md` for project-level learnings
2. **During work**: `hindsight_retain` for architectural decisions, conventions, context
3. **Task completion**: `hindsight_retain` summary with `project:<name>` tags + record entry in `.bizar/AGENTS_SELF_IMPROVEMENT.md`
4. **Project knowledge**: Create mental models for sustained project context

---

## Hindsight MCP Server

The Hindsight MCP server is already configured. All agents interact with it through MCP tools. No bank_id is needed — the default bank is used automatically.
