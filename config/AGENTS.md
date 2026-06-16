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

### Odin (default agent, DeepSeek)

Odin (`@odin`) is the All-Father and primary/default agent. He analyzes each request and routes it — **he never executes work himself**:
- **Routes to @heimdall** for simple tasks, research, codebase exploration, and mechanical work
- **Routes to @hermod** for git and GitHub operations (commit, push, merge, PR, branches)
- **Routes to @thor** for moderate-complexity work that needs more reasoning
- **Routes to @tyr** for the most complex implementation, debugging, and architectural work
- **Routes to @vidarr** (very sparingly) for the hardest problems when all else fails
- **Gates Tier 4 and Tier 5 via @forseti** — audits and corrects plans before execution

### Heimdall

- **Model**: `opencode/deepseek-v4-flash-free` (via OpenCode Zen — free tier)
- **Use for**: Simple tasks, research, codebase exploration, and mechanical work. The ever-watchful guardian.
- **Cost**: Free

### Hermod

- **Model**: `minimax/MiniMax-M2.7` (via minimax.io)
- **Use for**: Git and GitHub operations — commit, push, merge, PRs, branches, conflict resolution. The swift messenger.
- **Cost**: $0.30/M input, $1.20/M output

### Thor

- **Model**: `minimax/MiniMax-M2.7` (via minimax.io)
- **Use for**: Moderate complexity features, debugging, code review, refactoring
- **Cost**: $0.30/M input, $1.20/M output — cheaper than Tyr, more capable than Heimdall

### Tyr

- **Model**: `minimax/MiniMax-M3` (via minimax.io)
- **Use for**: Highest complexity implementation, debugging, architecture, multi-step engineering
- **Cost**: Higher — reserved for the hardest problems

### Vidarr

- **Model**: `opencode/gpt-5.5` (via OpenCode Zen — ChatGPT subscription access)
- **Use for**: The ultimate fallback — when Tyr stalls, debugging is stuck, or novel insight is needed
- **Cost**: Highest — use very sparingly, last resort only

### Forseti

- **Model**: `minimax/MiniMax-M3` (via minimax.io, audit-only, no edit permissions)
- **Use for**: Adversarial plan review — audits completeness, correctness, consistency, feasibility, security
- **Always runs before any Tier 4 or Tier 5 implementation begins**

### Routing Heuristic

| Task Type | Route To |
|-----------|----------|
| File lookup, search, ls, info | @heimdall |
| Quick questions, explanations | @heimdall |
| Simple edit, rename, format | @heimdall |
| Mechanical CRUD, boilerplate | @heimdall |
| Git commit, push, pull | @hermod |
| Branching, merging, rebasing | @hermod |
| Pull request management | @hermod |
| Merge conflict resolution | @hermod |
| GitHub operations (gh CLI) | @hermod |
| Moderate feature implementation | @thor |
| Non-trivial debugging | @thor |
| Code review, refactoring | @thor |
| Writing tests (medium complexity) | @thor |
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

1. **Session start**: `hindsight_recall` for task-relevant context
2. **During work**: `hindsight_retain` for architectural decisions, conventions, context
3. **Task completion**: `hindsight_retain` summary with `project:<name>` tags
4. **Project knowledge**: Create mental models for sustained project context

---

## Hindsight MCP Server

The Hindsight MCP server is already configured. All agents interact with it through MCP tools. No bank_id is needed — the default bank is used automatically.
