# Best-of-Agent-Harnesses — Round 1 Reconnaissance

**Source:** `repos/best-of-Agent-Harnesses/` (branch: `main`, captured 2026-07-06)
**Author:** Ryan Alberts (RyanAlberts)  
**License:** CC-BY-SA-4.0  
**Project count:** 106 active, 4 in graveyard  
**Stars captured:** 2026-07-05

---

## 1. Project Identity & Claims

### The "best-of" Pattern

This repo follows the [best-of-lists](https://github.com/best-of-lists/best-of) template — a standardized framework for creating curated, ranked lists of open-source projects. The Best-of Badge (`http://bit.ly/3o3EHNN`) signals the list is generated from structured data and follows a well-defined curation methodology (`create-best-of-list.md:1-39`). The template provides GitHub Actions workflows for automated setup, weekly rescoring, and PR-based updates.

### What Is an Agent Harness? — The Definition

The README (`README.md:25-27`) defines the term at the heart of the entire list:

> A model answers; an agent acts. An agent harness is the runtime that turns one into the other — the model thinks; the harness decides what that thinking is allowed to touch.

The definition continues with an extended essay (`README.md:27`) explaining why harnesses matter:

> Every prior wave of automation was constrained by brittleness: you scripted exact behavior, and when the world deviated, the system broke. Foundation models inverted that problem — they're flexible but directionless, stateless, and disconnected from anything real. The agent harness exists to bridge that gap: it is the orchestration infrastructure that converts a model's per-turn reasoning into sustained, tool-using, error-recovering, goal-directed behavior across time. Architecturally, it plays the role the kernel played in operating systems or the controller played in industrial robotics — mediating between raw capability and a messy environment — but with a critical difference: the "capability" it governs is general-purpose cognition, which means the harness is simultaneously a scheduler, a permission system, a memory manager, and a policy enforcement layer, all under-specified and evolving in real time.

This is the most carefully crafted definition in the entire repo. It positions agent harnesses at the **kernel/controller** layer of the emerging AI infrastructure stack — a deliberate architectural parallel to operating systems and industrial robotics.

### Why Harnesses Matter

From `README.md:31`: "Better models make harnesses more important: more capabilities mean more failure modes, and production needs retry logic, fallbacks, and validation. Harness quality — not just model quality — determines whether agents actually ship."

This is the list's central thesis: **harness quality, not model quality, is the bottleneck** for production agentic systems.

### License

The repository and its data files are licensed under **CC-BY-SA-4.0** (`harnesses.json:10`). The MCP server (`mcp/pyproject.toml:11`) is separately MIT-licensed.

---

## 2. Data Files

### `harnesses.json` (3407 lines)

The master structured data file. Schema (`harnesses.json:1-359`):

```json
{
  "meta": { /* name, description, urls, license, stars_captured, project_count,
              tiers, tier_help, autonomy_tiers, autonomy_help, recovery_tiers, recovery_help */ },
  "categories": [ /* 10 categories with id, title, subtitle */ ],
  "use_cases": [ /* 14 curated intents with hand-picked github_ids */ ],
  "faq": [ /* 13 Q&A entries: use-case, derived, and concept kinds */ ],
  "comparisons": [ /* 5 comparison docs with slug, title, summary, raw_url */ ],
  "projects": [ /* 106 project records */ ],
  "graveyard": [ /* 4 archived/moved projects */ ]
}
```

Each project record (`harnesses.json:398-424`, sample):
```json
{
  "name": "awesome-cursorrules",
  "github_id": "PatrickJS/awesome-cursorrules",
  "url": "https://github.com/PatrickJS/awesome-cursorrules",
  "slug": "awesome-cursorrules",
  "anchor_url": "...",
  "page_url": "https://ryanalberts.github.io/.../h/awesome-cursorrules/",
  "description": "...",
  "category": "progressive-disclosure",
  "category_title": "Progressive disclosure harnesses",
  "stars": 40225,
  "tier": "super simple",
  "tier_rank": 1,
  "axis": "super simple (content bundle)",
  "autonomy": "n/a",
  "autonomy_rank": 0,
  "recovery": "n/a",
  "recovery_rank": 0,
  "license_signal": "open-source",
  "tags": ["ide"],
  "example": { "label": "PyTorch cursorrules", "url": "..." }
}
```

**Key fields:** `github_id` (primary key), `stars` (numerical), `tier`/`tier_rank` (1-4 adoption surface), `autonomy`/`autonomy_rank` (0-4), `recovery`/`recovery_rank` (0-4), `license_signal` (one of "open-source", "restricted", "unknown"), `tags` (auto-derived capability chips), `example` (one concrete link per project).

### `harnesses.jsonld` (1308 lines)

A JSON-LD/Dataset representation for semantic web consumption (`harnesses.jsonld:1-50`). Uses `schema.org/Dataset` as the root type with `mainEntity` as an `ItemList` of `SoftwareApplication` items. Each project gets a reduced record: name, url, description, `applicationCategory: "DeveloperApplication"`, and keywords (from tags).

**Why both?** `harnesses.json` is the operational data format — full schema, ranks, tiers, use-case mappings, comparisons, FAQ. `harnesses.jsonld` is the SEO/semantic-web layer — it makes Google and other crawlers understand this is a dataset of software applications.

### `llms.txt` (242 lines)

An agent-readable flat-text index (`llms.txt`). Designed to be consumed by any coding agent (Claude, GPT, Gemini) by pointing them at the raw GitHub URL. Contains the full list with name, URL, stars, tier, autonomy, recovery, license, description, and tags — all in one file. Also includes the FAQ and use-case index. `README.md:77` says: "Point any agent at the raw URL."

### `curation-queue.json` (3079 lines)

The handoff artifact between two automation flows (`write_queue.py:1-12`). Contains six top-level keys:

- `generated` — date string
- `movers` — list of `{id, from, to}` star count changes
- `moved` — repos that changed GitHub owner
- `archived` — repos that became archived with `since` date and final stars
- `failed` — API failures
- `candidates` — newly discovered repos (filled by `discover_candidates.py`)

This file is the weekly audit trail — it records exactly what changed between refreshes.

### `feed.json`

A JSON Feed (JSON Feed v1.1) — RSS-style syndication feed (`feed.json:1-57`). Contains weekly refresh entries with dates and star counts. Published at `https://ryanalberts.github.io/best-of-Agent-Harnesses/feed.json`.

### `projects.yaml` (458 lines)

This is the **best-of-generator template configuration file** (`projects.yaml:1-50`). It defines categories, labels, and the `min_stars`/`allowed_licenses` policy. The actual project data is in `generate.py` — `projects.yaml` is an output of `generate.py`, not its input (per `CLAUDE.md:47`: "Edit the Python data structures in that script — never hand-edit the three output files").

### `server.json`

The MCP registry registration file (`server.json:1-21`). Follows the `$schema` from `static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json`. Identifies the server as `io.github.RyanAlberts/agent-harnesses` version 0.1.2, published to PyPI as `agent-harnesses-mcp` with stdio transport.

### `TAGS.md`

Auto-generated tag cross-reference (`TAGS.md:4`). 106 projects across 22 canonical tags. Each tag section lists projects grouped by category, sorted by stars descending. Generated by `scripts/generate.py` along with the README.

---

## 3. The MCP Server

Located at `mcp/server.py` (228 lines). Built on `mcp.server.fastmcp`.

### Architecture

- **Lazy data loading** (`server.py:29-38`): On first tool call, loads `harnesses.json` from local filesystem (relative to `server.py`) or falls back to fetching from `raw.githubusercontent.com`. Cached in module-level `_data` global.
- **Token-based search** (`server.py:45-59`): Converts text to token sets (lowercased, stop-word filtered). Token matching tolerates inflections: 4+ char tokens match if either is a prefix of the other.

### Tools Exposed

1. **`pick_harness(use_case, max_complexity, min_autonomy, min_recovery, open_source_only, limit)`** (`server.py:82-145`) — The flagship tool. Takes a natural-language use case, applies four filters (complexity cap, autonomy floor, recovery floor, OSS-only), then scores projects by: (a) curated intent match (highest-scored — if the query overlaps with a curated use-case intent, those hand-picked projects get priority), then (b) token overlap with description/tags/category × 3 + log10(stars). Returns JSON with ranked picks, each with a reason.

2. **`search_harnesses(query, limit)`** (`server.py:148-168`) — Keyword search across name, github_id, description, tags, and category. Exact name match gets +50 bonus.

3. **`get_harness(github_id)`** (`server.py:171-178`) — Full record for one project by github_id.

4. **`list_comparisons()`** (`server.py:182-187`) — Lists the 5 decision guides.

5. **`get_comparison(slug)`** (`server.py:190-204`) — Full markdown of a comparison guide. Loads from local `comparisons/` directory or fetches from raw GitHub URL.

6. **`list_categories()`** (`server.py:207-220`) — The 10 categories, 14 use-case intents, and all tier definitions with project counts.

### Deployment

Published to PyPI as `agent-harnesses-mcp` (`mcp/pyproject.toml:6`). One-line MCP install: `claude mcp add agent-harnesses -- uvx agent-harnesses-mcp` (`README.md:81`). Registered in the [official MCP registry](https://registry.modelcontextprotocol.io) as `io.github.RyanAlberts/agent-harnesses` (`server.json:3`).

---

## 4. The Axes / Taxonomy

### Simplicity ↔ Capability Axis (Adoption Surface Area)

Four tiers (`harnesses.json:14-19`):

| Tier | Tier Rank | Meaning |
|------|-----------|---------|
| super simple | 1 | Format-only, single concept |
| mostly simple | 2 | Thin layer |
| slightly complex | 3 | Real SDK |
| complex | 4 | Platform with its own runtime and ecosystem |

The tier_help says: "Adoption surface area, least to most: tier_rank 1 = format-only/single concept, 4 = platform with its own runtime and ecosystem."

### Autonomy Axis (Designed Autonomy Regime)

Four levels (`harnesses.json:21-27`):

| Tier | Rank | Meaning |
|------|------|---------|
| step-gated | 1 | Human approves each action |
| checkpoint-gated | 2 | Approval at checkpoints |
| bounded | 3 | Can run a whole task unattended |
| headless | 4 | Built for unattended runs and fleets |

**Headless-ready** projects (marked ★ in the tables) are those at autonomy tier "headless" or "bounded" — designed for automated operation.

### Recovery Axis (Failure-Recovery Tier)

Four levels (`harnesses.json:28-34`):

| Tier | Rank | Meaning |
|------|------|---------|
| none | 1 | Start over |
| retry | 2 | Automatic retry |
| resumable | 3 | Session can resume from last checkpoint |
| durable | 4 | Persisted execution state survives restarts |

**Durable** projects (marked ✱) are those at recovery tier "durable" — they survive a crash mid-task.

### Visualizations

- **`assets/landscape.svg`** — All 106 projects plotted by adoption surface area (x-axis, the simplicity↔capability tier) against GitHub stars (y-axis, log scale). Colors denote categories. Largest projects in each tier are labeled.
- **`assets/axes-grid.svg`** — All loop-owning projects placed by autonomy (x-axis) vs recovery (y-axis). The headless+durable quadrant (top-right) is the sparsest — only a handful of projects qualify.

Both regenerate from the list data on every refresh (`README.md:41`).

---

## 5. Comparison Pages

The repo includes 5 comparison documents, each a head-to-head decision guide:

### 1. How to Pick a Harness (`comparisons/how-to-pick-a-harness.md`)

Six sequential questions (`comparisons/how-to-pick-a-harness.md:3-28`):

1. **What do you actually want it to do?** — Start from the job, not the framework.
2. **How much do you want to adopt?** — Pick the lowest simplicity↔capability tier that solves the job.
3. **How much rope does it need?** — Match autonomy tier to actual risk tolerance.
4. **What happens when it breaks?** — For anything unattended, resumable is the floor, durable is the production bar.
5. **Who pays for the tokens?** — Post-June 2026 reality: programmatic usage draws from a separate credit pool.
6. **Can you walk away from it?** — Prefer open formats (AGENTS.md, SKILL.md), standard protocols (MCP), permissive licenses.

Three worked examples at the end: code review while sleeping, personal assistant in Telegram, multi-agent pipeline that survives deploys.

### 2. OpenClaw vs Hermes (`comparisons/openclaw-vs-hermes.md`)

The "loudest harness argument of 2026" (`openclaw-vs-hermes.md:3`). Both are MIT-licensed, self-hosted, always-on personal agents — but opposite design philosophies:

| Dimension | OpenClaw | Hermes |
|-----------|----------|--------|
| The bet | **Presence** — one event loop, unbounded memory | **Discipline** — separated domains, bounded user model |
| Proactivity | Native HEARTBEAT | Script-gated wake-ups |
| Ecosystem | 13,700+ community skills | Self-generated skills via learning loop |
| Security | Relaxed by default | Restrictive by default |
| Release tempo | 82 releases; fast-moving, frequently breaking | 6 releases; conservative |

Key field report findings: migration is driven by update churn not features; the learning loop is real but double-edged (bad patterns get "etched in stone"); run-both consensus (OpenClaw as orchestrator, Hermes as executor, interoperating over ACP).

### 3. Terminal Coding Agents (`comparisons/terminal-coding-agents.md`)

opencode vs Codex vs Gemini CLI vs crush vs goose. Five tools with a converged chat-in-terminal experience but different harness bets:

- **opencode** — maximum freedom, biggest community, client/server split
- **Gemini CLI** — first-party Gemini, generous free tier
- **Codex** — strongest default isolation (sandboxed execution)
- **goose** — harness without a bundled UI, MCP/ACP extensions
- **crush** — nicest TUI, session persistence, FSL-1.1-MIT caveat

### 4. Multi-Agent Orchestration (`comparisons/multi-agent-orchestration.md`)

OpenAI Agents SDK vs CrewAI vs AutoGen vs LangGraph. Four coordination models:

| Framework | Coordination Model | Best For |
|-----------|-------------------|----------|
| OpenAI Agents SDK | Handoffs | Least framework, cheapest to walk away |
| CrewAI | Roles/org charts | Fastest demo, non-engineer readability |
| AutoGen | Conversation/group chat | Genuinely conversational problems |
| LangGraph | Explicit state machine | Production, restarts, durable execution |

The "unfashionable default": a majority of multi-agent use cases are one orchestrator + stateless sub-tasks, expressible with a `for` loop.

### 5. Agent Memory Layers (`comparisons/memory-layers.md`)

Mem0 vs claude-mem vs Letta. Three fundamentally different shapes:

| Framework | Shape | Best For |
|-----------|-------|----------|
| Mem0 | Memory API | Any agent, scoped memories |
| claude-mem | Claude Code plugin | Perfect recall for Claude Code |
| Letta | Agent runtime | Memory-first agent design |

The framing question: "Who owns the memory — the application or the agent?"

---

## 6. Use Case Index

The README's "Pick by use case" section (`README.md:55-70`) maps 14 reader intents to 3-7 curated picks each:

1. Turnkey coding agent → opencode, Cline, Codex, Gemini CLI, OpenHands, crush
2. Always-on personal agent → OpenClaw, Hermes, Khoj, Agent Zero, OpenHarness
3. Extend coding agents with skills → Anthropic Skills, ECC, superpowers, GStack, pmstack
4. Build your own harness from scratch → Claude Agent SDK, Google ADK, AutoHarness, SWE-agent, RepoMaster, claw-code-agent
5. Drop-in memory layer → Mem0, claude-mem, agentlog, agno, letta
6. Hundreds-to-thousands of tools → MCP-Zero, ToolGen, ToolRAG, langgraph-bigtool
7. Multi-agent orchestration → openai-agents-python, crewAI, autogen, Microsoft Agent Framework, PraisonAI, agent-squad
8. General LLM app framework → langgraph, langchain, llama-index, pydantic-ai, agno
9. Low-code / visual workflows → langflow, Flowise, Dify, n8n
10. Browser-using agents → browser-use, WebVoyager, puppeteer-real-browser-mcp
11. Sandboxed code execution → E2B, Daytona, smolagents, OpenHands
12. Evaluate/benchmark agents → SWE-bench, AgencyBench, inspect_ai, WebArena, ARC-AGI-2, VitaBench
13. Deep research agents → deepagents, gpt-researcher, openagents
14. Provider-agnostic LLM pipe → LiteLLM, vercel/ai

The use-case intents are carried in `harnesses.json` (`harnesses.json:88-236`) as structured data with hand-picked `github_id` arrays.

---

## 7. Automation

### GitHub Actions Workflows

The `.github/workflows/` directory contains 5 workflows:

| Workflow | Purpose |
|----------|---------|
| `weekly-rescore.yml` | Weekly star refresh + candidate discovery |
| `update-best-of-list.yml` | Generate README from project data |
| `setup-best-of-list.yml` | One-time repo setup from template |
| `publish-mcp.yml` | Publish MCP server to PyPI |
| `pages.yml` | Deploy GitHub Pages site |

### `scripts/` Directory (6 scripts)

| Script | Purpose |
|--------|---------|
| `generate.py` | **Master generator** (1905 lines). All project data, categories, auto-tag rules, and tier definitions. Produces `harnesses.json`, `harnesses.jsonld`, `llms.txt`, `TAGS.md`, `README.md`, and `projects.yaml`. |
| `refresh_stars.py` | Refreshes GitHub star counts via API. Rewrites star values in `generate.py`, bumps `STARS_CAPTURED` date. Creates `curation-queue.json` as handoff to Flow 2. Requires `GH_TOKEN`. |
| `discover_candidates.py` | Searches GitHub for new candidate repos by topic (`topic:ai-agents`, etc.) and keyword. Feeds into `curation-queue.json`'s `candidates` array. |
| `write_queue.py` | Writes `curation-queue.json` — the Flow 1→Flow 2 handoff artifact. |
| `check_integrity.py` | Validates data integrity. |
| `build_site.py` | Builds the GitHub Pages site. |

### Two-Flow Design

The refresh pipeline uses a careful two-flow architecture (`refresh_stars.py:152-153`):

- **Flow 1** (weekly GitHub Action): Calls GitHub API to refresh stars, discover candidates, detect archived/moved repos. Writes `curation-queue.json`.
- **Flow 2** (separate Claude routine): Reads `curation-queue.json`, makes editorial judgments (which candidate to add, whether to drop archived), never touches the API directly.

This separation ensures editorial control is never automated.

---

## 8. The Graveyard

`harnesses.json:3381-3406` records 4 projects in the graveyard: `get-shit-done` (64.6k stars, archived 2026-07-03), `Roo Code` (24.3k stars, archived), `spring-ai-tool-search-tool` (76 stars), and `coderClaw` (3 stars). The graveyard preserves historical star counts and archival dates.

---

## 9. Generated Site

The GitHub Pages site at `https://ryanalberts.github.io/best-of-Agent-Harnesses/` provides:
- One page per harness (`/h/<slug>/`)
- Filter by capability, autonomy, and recovery
- Searchable interface
- Feed at `/feed.json`
- Updated on every refresh via `pages.yml`

---

## Key File Reference Index

| File | Lines | Purpose |
|------|-------|---------|
| `README.md` | 1-243+ | Main list and documentation |
| `harnesses.json` | 1-3407 | Master structured data |
| `harnesses.jsonld` | 1-1308 | Semantic web layer |
| `llms.txt` | 1-242 | Agent-readable flat index |
| `TAGS.md` | 1-517+ | Tag cross-reference |
| `mcp/server.py` | 1-228 | MCP server implementation |
| `mcp/pyproject.toml` | 1-24 | PyPI package config |
| `server.json` | 1-21 | MCP registry registration |
| `curation-queue.json` | 1-3079 | Weekly handoff artifact |
| `feed.json` | 1-57 | RSS-style syndication |
| `projects.yaml` | 1-458 | Best-of template config |
| `scripts/generate.py` | 1-1905 | Master generator |
| `scripts/refresh_stars.py` | 1-165 | Star refresh pipeline |
| `scripts/discover_candidates.py` | 1-104 | Candidate discovery |
| `scripts/write_queue.py` | 1-36 | Queue writer |
| `comparisons/how-to-pick-a-harness.md` | 1-37 | 6-question decision guide |
| `comparisons/openclaw-vs-hermes.md` | 1-49 | Personal agent comparison |
| `comparisons/terminal-coding-agents.md` | 1-34 | Coding agent comparison |
| `comparisons/multi-agent-orchestration.md` | 1-30 | Multi-agent comparison |
| `comparisons/memory-layers.md` | 1-30 | Memory layer comparison |
| `CLAUDE.md` | 1-67 | Agent instructions for maintainers |
| `create-best-of-list.md` | 1-39 | Meta-doc for new best-of lists |
| `latest-changes.md` | 1-6 | Trending up projects |
