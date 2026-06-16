# BizarHarness

Norse-pantheon multi-agent system for opencode. 10 agents across 4 cost tiers with cost-aware routing.

## Stack
- Config: YAML + Markdown agent definitions
- Models: DeepSeek V4 Flash Free, MiniMax-M2.7, MiniMax-M3, GPT-5.5
- Memory: Hindsight MCP (memory-api.polderlabs.io)
- Search: Semble MCP
- Diagrams: PlantUML ASCII art

## Architecture
Odin (primary router) decomposes every request into parallel streams and dispatches to subagents. Never executes work himself. Implementation always split across Thor (M2.7) + Tyr (M3) in parallel. Forseti audits all complex plans before execution.

Agents have **self-skill-discovery capability** — they can proactively find and install Skills CLI packs by domain (e.g., `skills add supabase/agent-skills --all -y` for database work) during execution. The Skill Discovery Protocol is documented in `config/AGENTS.md` and in individual agent files.

**Vör Research-First Protocol**: Vör must read PROJECT.md and check Hindsight banks before asking any questions. Questions are only allowed after research is exhausted, and must reference actual project files/frameworks/patterns — never ask generic discovery questions.

## Conventions
- Agent files: YAML frontmatter + Markdown body in `config/agents/`
- Agent count: 10 (Odin, Vör, Mimir, Heimdall, Hermod, Thor, Baldr, Tyr, Vidarr, Forseti)
- Every agent uses Hindsight memory with per-project banks (never default)
- Project data lives in `.bizar/` folder
- Self-improvement entries appended at every task completion
- Memory setup: per-project Hindsight bank with `bank_id: "<project-name>"` — default bank reserved for general/system knowledge only

## Entry Points
- Install: `./install.sh`
- Config: `~/.config/opencode/`
- Repo: `github.com/DrB0rk/BizarHarness`
