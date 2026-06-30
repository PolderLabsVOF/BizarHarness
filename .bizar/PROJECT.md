# BizarHarness

Norse-pantheon multi-agent system for opencode. 12 agents across 4 cost tiers with cost-aware routing.

## Stack
- Config: YAML + Markdown agent definitions
- Models: DeepSeek V4 Flash Free, MiniMax-M2.7, MiniMax-M3, GPT-5.5
- Memory: Bizar Memory Service (local Markdown + Git-backed; `.bizar/memory.json`)
- Search: Semble MCP
- Skills: 5 bundled (BizarHarness, self-improvement, C++ coding standards, C++ testing, Embedded ESP-IDF)
- Diagrams: PlantUML ASCII art

## Architecture
Odin (primary router) decomposes every request into parallel streams and dispatches to subagents. Never executes work himself. Implementation always split across Thor (M2.7) + Tyr (M3) in parallel. Forseti audits all complex plans before execution.

**Parallel Execution Protocol:** Harness now enforces sibling-awareness when dispatching parallel agents. Odin prepends a `## PARALLEL EXECUTION CONTEXT` block to each subagent prompt listing concurrent siblings, disjoint file scopes, and git rules. Subagents obey a strict file-scope boundary — no writes outside their assigned area. Only Hermod performs write-level git operations (commit, push, branch management). If a task cannot be decomposed into disjoint file scopes, agents dispatch sequentially. This is a prompt-level discipline bridge until OpenCode upstream `isolation: worktree` support (PR #21680) lands.

**Per-project knowledge graph:** Bizar integrates `graphify` (https://github.com/safishamsi/graphify) for per-project code knowledge graphs. Run `bizar init` to bootstrap — it creates `.bizar/graph/` containing `graph.json` (NetworkX node-link), `GRAPH_REPORT.md` (human-readable summary), and `graph.html` (interactive visualization). Query with `bizar graph query/path/explain`, update incrementally with `bizar graph update`, watch for changes with `bizar graph watch`. Requires Python 3.10+ and `graphifyy` (pip install graphifyy).

Agents have **self-skill-discovery capability** — they can proactively find and install Skills CLI packs by domain (e.g., `skills add supabase/agent-skills --all -y` for database work) during execution. The Skill Discovery Protocol is documented in `config/AGENTS.md` and in individual agent files.

**Vör Research-First Protocol**: Vör must read PROJECT.md and check Hindsight banks before asking any questions. Questions are only allowed after research is exhausted, and must reference actual project files/frameworks/patterns — never ask generic discovery questions.

## Bundled Skills
- **BizarHarness** — task-planning and BizarHarness framework skill
- **Self-improvement** — AGENTS_SELF_IMPROVEMENT.md maintenance and lesson logging
- **C++ coding standards** — C++17/20 conventions, naming, header hygiene, const correctness
- **C++ testing** — Google Test/Google Mock patterns, embedded test fixtures, coverage
- **Embedded ESP-IDF** — ESP32/ESP-IDF build system, FreeRTOS, Kconfig, flash partitioning

## Conventions
- Agent files: YAML frontmatter + Markdown body in `config/agents/`
- Agent count: 12 (Odin, Vör, Frigg, Mimir, Heimdall, Hermod, Thor, Baldr, Tyr, Vidarr, Forseti, Quick)
- Every agent uses Hindsight memory with per-project banks (never default)
 - Project data lives in `.bizar/` folder (not at project root). See `.bizar/README.md` for the canonical subdirectory layout.
- Self-improvement entries appended at every task completion
- Memory setup: per-project Hindsight bank with `bank_id: "<project-name>"` — default bank reserved for general/system knowledge only
- MiniMax models require `interleaved: { field: "reasoning_details" }` and `reasoning: true` in opencode.json provider config — without it, thinking tokens leak into visible output
- CLI structure: single `bizar` binary, no `bizar-dash` binary. Dashboard commands under `bizar dash <sub>`.
- In-process imports: cross-package integration uses named exports and direct imports, not subprocess spawn. See `bizar-dash/package.json#exports` for the `dash-cli` subpath.

## Entry Points
- Install: `./install.sh`
- Config: `~/.config/opencode/`
- Repo: `github.com/DrB0rk/BizarHarness`

## Memory

- Backend: Bizar Memory Service (local Obsidian-compatible Markdown + Git-shared sync)
- Default mode: `local-only` (vault at `.obsidian/`); opt into `managed` for cross-project sharing
- Shared memory repo: `~/.local/share/bizar/memory/bizar-memory/` with namespaces `projects/<id>/`, `global/bizar/`, `users/<id>/`
- Canonical truth: Markdown. LightRAG is a derived index (rebuildable from Markdown). Git is the collaboration layer. Phase 2 (v4.1.0) adds a LightRAG scaffold for semantic search — disabled by default, opt-in via `.bizar/memory.json`.
- Hindsight MCP is disabled by default. The Bizar Memory Service replaces it.
- Agents use the dashboard REST API at `/api/memory/*` (canonical) or `/api/obsidian/*` (back-compat).
