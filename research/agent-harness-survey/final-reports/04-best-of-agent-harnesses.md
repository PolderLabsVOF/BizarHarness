# Best-of-Agent-Harnesses: The Definitive Report

**Synthesized from:** Rounds 1–11 of the Agent Harness Survey
**Date:** 2026-07-07
**Author:** Thor (@thor)
**Source:** `repos/best-of-Agent-Harnesses/` (main branch, captured 2026-07-05/06)

---

This report is the definitive single-document synthesis of the best-of-Agent-Harnesses catalog — the most comprehensive curated reference for the agent harness ecosystem in mid-2026. It combines findings from 11 rounds of reconnaissance, architecture deep-dives, cross-references, and subsystem analyses to produce a complete picture of what this catalog is, what it contains, how it works, and what it reveals about the state of the art. The report is structured in six parts, moving from identity through schema, infrastructure, comparisons, patterns, and operational assessment.

This is not a simple listicle. It is a reference document that an engineering team could use to make a real decision about which harness to adopt, or which patterns to steal for their own implementation.

---

## Part I — The Catalog

### 1. What Is the "Best-of" Pattern?

The best-of-Agent-Harnesses repository follows the [best-of-lists](https://github.com/best-of-lists/best-of) template — a standardized framework for creating curated, ranked lists of open-source projects. The Best-of Badge (accessible at `http://bit.ly/3o3EHNN`) signals that the list is generated from structured data and follows a well-defined curation methodology documented in `create-best-of-list.md:1-39`. The template provides GitHub Actions workflows for automated setup, weekly rescoring, and PR-based updates.

This is not an organic community list assembled by hand. It is an engineered publication — a curated dataset with an editorial pipeline, automated refreshes, and a stated curation bar. The distinction matters because it means the catalog has an accountable methodology: the rules for what goes in and what stays out are explicit, not a function of who edited the README last.

The template's value proposition is credibility through methodology. A best-of list is only as trustworthy as its curation bar — and the best-of-Agent-Harnesses list makes that bar explicit. The badge is the visual signal that this list was not assembled by scraping GitHub topic tags.

### 2. Project Identity and the Harness Definition

The catalog defines its subject with unusual care. The README (`README.md:25-27`) opens with a sharp, economical definition:

> A model answers; an agent acts. An agent harness is the runtime that turns one into the other — the model thinks; the harness decides what that thinking is allowed to touch.

This is followed by an extended essay positioning the harness at the **kernel/controller layer** of the emerging AI infrastructure stack — a deliberate architectural parallel to operating systems and industrial robotics:

> Every prior wave of automation was constrained by brittleness: you scripted exact behavior, and when the world deviated, the system broke. Foundation models inverted that problem — they're flexible but directionless, stateless, and disconnected from anything real. The agent harness exists to bridge that gap: it is the orchestration infrastructure that converts a model's per-turn reasoning into sustained, tool-using, error-recovering, goal-directed behavior across time. Architecturally, it plays the role the kernel played in operating systems or the controller played in industrial robotics — mediating between raw capability and a messy environment — but with a critical difference: the "capability" it governs is general-purpose cognition, which means the harness is simultaneously a scheduler, a permission system, a memory manager, and a policy enforcement layer, all under-specified and evolving in real time.

The kernel metaphor is the most carefully chosen phrase in the entire repository. It positions the harness not as an application layer but as infrastructure — the layer that everything else depends on. This framing matters because it elevates the stakes of harness quality: if the harness is the kernel of the AI stack, then harness bugs have the same systemic consequences as kernel bugs in an operating system.

The central thesis of the catalog is stated plainly: **harness quality, not model quality, is the bottleneck** for production agentic systems. Better models make harnesses more important — more capabilities mean more failure modes, and production needs retry logic, fallbacks, and validation. The list itself is evidence for this thesis: the most-starred projects are not uniformly the newest or most-capable models, but the ones with the best harness properties (retry logic, tool surface, permission model, memory architecture).

### 3. The 106 Projects

The catalog captures **106 active projects** plus **4 in the graveyard** — archived or moved projects whose star counts and archival dates are preserved for historical reference. The star counts were captured on 2026-07-05.

Projects span a wide range of maturity levels and deployment contexts:

**Giants** (100k+ stars): OpenClaw (382k, MIT) — the dominant always-on personal agent with 28+ channels; the Claude Code/ECC ecosystem (226k, MIT) — the largest coding harness extension ecosystem; n8n (195k, Proprietary) — the workflow automation platform with LLM integration; opencode (183k, MIT) — the Go-based multi-provider terminal agent; AutoGPT (185k, MIT) — the project that launched the agent hype cycle; langflow (151k, MIT) — the visual LangChain builder; Dify (148k, Apache-2.0) — the open-source LangFlow alternative with stronger enterprise posture; awesome-cursorrules (40k, MIT) — the dominant format for progressive disclosure harnesses.

**Mid-tier** (20k–100k): MetaGPT (69k, MIT) — the software-company-simulation framework with ICLR papers; claude-mem (86k, Apache-2.0) — the dominant memory plugin for Claude Code; Daytona (72k, Apache-2.0) — the managed sandbox platform (now in maintenance); Mem0 (60k, Apache-2.0) — the universal memory layer with published benchmarks; AutoGen (60k, MIT) — now in maintenance mode with redirect to Microsoft Agent Framework; CrewAI (55k, MIT) — the highest-visibility role-based orchestration framework; goose (51k, MIT) — the Rust-based CLI harness.

**Specialized** (1k–20k): LangGraph (37k, MIT) — the only project with true durable execution + checkpoint + time-travel; Letta (24k, Apache-2.0) — the MemGPT successor with agent-runtime memory blocks; SWE-agent (15k, MIT) — the research-grade benchmark harness with state-of-the-art SWE-bench verified results; E2B (13k, Apache-2.0) — the open-source sandbox infrastructure with self-hosting path; Microsoft Agent Framework (12k, MIT) — the AutoGen successor with Python + .NET parity; PraisonAI (8k, MIT) — the Swiss-Army-knife multi-agent framework; agent-squad (8k, Apache-2.0) — the AWS-origin classifier-routed orchestrator with GroundedAgent anti-hallucination pattern.

The graveyard entries are notable: `get-shit-done` (64.6k stars, archived 2026-07-03) was a major project that went dark mid-2026. `Roo Code` (24.3k stars, archived) was a significant VS Code extension agent. These entries preserve the historical record — a critical function of the graveyard.

### 4. License and Curation Methodology

The repository and its data files are licensed under **CC-BY-SA-4.0** (`harnesses.json:10`). The MCP server (`mcp/pyproject.toml:11`) is separately MIT-licensed. This distinction is intentional: the curated dataset is share-alike (attribution required, modifications must be shared under same license); the tool that serves it is freely reusable in any context. This mirrors the best-of template's philosophy: the data belongs to the community; the automation belongs to whoever wants to run it.

**Curation bar** (from `CLAUDE.md:62-67` — the agent instructions for maintainers):
- Skip personal repos with single-digit stars or fewer than ~10 commits
- Skip archived/abandoned projects unless historically important
- When a project has moved org, update `github_id` to the new canonical location
- When an official version supersedes a community version, prefer the official

The `projects.yaml` sets `min_stars: 0` and `allowed_licenses: ["all"]` — so the curation bar is editorial, not automatic. There is no star floor and no license filter at the template level. The human editorial judgment fills that gap.

Stars are captured weekly via GitHub API through the `refresh_stars.py` script. The curation queue (`curation-queue.json`) records everything that changed between refreshes: `movers` (star count changes), `moved` (repos that changed GitHub owner), `archived` (repos that became archived with `since` date and final stars), `failed` (API failures), and `candidates` (newly discovered repos from `discover_candidates.py`). This file is the weekly audit trail that enables editorial review.

**Ranking algorithm**: Projects are ranked "by relevance to harness concerns (environment, orchestration, lifecycle, guardrails) and by GitHub stars." The MCP server's `pick_harness` tool uses a more specific scoring formula: **token overlap × 3 + log₁₀(stars)**, with curated use-case intent projects receiving a `100 - rank` boost that overrides pure keyword matching. This ensures editorial curation always influences results for common queries. The boost is additive — a hand-picked project at position 5 in a curated list receives 95 bonus points, which dominates typical token-overlap scores.

**Two-flow automation design**: Flow 1 (weekly GitHub Action) calls the GitHub API to refresh stars, discover candidates, detect archived/moved repos, and writes `curation-queue.json`. Flow 2 (a separate human-run routine) reads `curation-queue.json`, makes editorial judgments about which candidates to add and whether to drop archived projects, and never touches the API directly. This separation ensures editorial control is never automated — a human always decides what enters the catalog.

---

## Part II — The Schema

### 5. Data Files

The catalog maintains **four primary data files**, each serving a different consumer:

**`harnesses.json`** (3,407 lines) — The master structured data file. This is the operational format — full schema, ranks, tiers, use-case mappings, comparisons, FAQ. Schema:

```json
{
  "meta": {
    "name", "description", "urls", "license", "stars_captured",
    "project_count", "tiers", "tier_help",
    "autonomy_tiers", "autonomy_help",
    "recovery_tiers", "recovery_help"
  },
  "categories": [ /* 10 entries with id, title, subtitle */ ],
  "use_cases": [ /* 14 curated intents with hand-picked github_ids */ ],
  "faq": [ /* 13 Q&A entries: use-case, derived, and concept kinds */ ],
  "comparisons": [ /* 5 entries: slug, title, summary, url, raw_url */ ],
  "projects": [ /* 106 project records */ ],
  "graveyard": [ /* 4 archived projects with dates and final stars */ ]
}
```

Each project record contains: `github_id` (primary key in owner/repo format), `name`, `url`, `slug`, `page_url`, `description`, `category`, `category_title`, `stars`, `tier`, `tier_rank`, `axis`, `autonomy`, `autonomy_rank`, `recovery`, `recovery_rank`, `license_signal`, `tags[]`, `example`. Key design decisions: `tier_rank` alongside `tier` for numerical filtering; `autonomy_rank`/`recovery_rank` alongside their names for the same reason; `license_signal` as a normalized three-value enum ("open-source", "restricted", "unknown") instead of raw license name; `example` as a single curated link rather than a docs root URL.

**`harnesses.jsonld`** (1,308 lines) — JSON-LD/Dataset representation for semantic web consumption. Uses `schema.org/Dataset` as root type with `mainEntity` as an `ItemList` of `SoftwareApplication` items. Key difference from `harnesses.json`: no ranks, tiers, autonomy, or recovery data; no use-case index; no FAQ or comparisons. Projects wrapped in `schema:ListItem` with `position`. Keywords are comma-separated strings, not arrays. The meta block is entirely different — no tier definitions, just the Dataset metadata.

The dual-file design serves two different consumers: `harnesses.json` is for agents and tools that need the full operational schema; `harnesses.jsonld` is for search engines and semantic web indexers that understand schema.org types. The operational data (ranks, tiers, autonomy regimes) is intentionally excluded from the JSON-LD because it would be inappropriate for schema.org consumption — those are editorial judgments, not machine-readable facts about a software application.

**`llms.txt`** (242 lines) — Agent-readable flat-text index. Designed to be consumed by any coding agent (Claude, GPT, Gemini) by pointing them at the raw GitHub URL. Contains the full list with name, URL, stars, tier, autonomy, recovery, license, description, and tags — all in one file. Also includes the FAQ and use-case index. The README (`README.md:77`) says explicitly: "Point any agent at the raw URL." This is the simplest possible discovery interface — no API key, no tool call, just an HTTP GET.

**`curation-queue.json`** (3,079 lines) — The handoff artifact between the two automation flows. Contains six top-level keys: `generated` (date string), `movers` (list of `{id, from, to}` star count changes), `moved` (repos that changed GitHub owner), `archived` (repos that became archived with `since` date and final stars), `failed` (API failures), and `candidates` (newly discovered repos from `discover_candidates.py`). This is the weekly editorial review packet.

**`TAGS.md`** — Auto-generated tag cross-reference (`TAGS.md:4`). 106 projects across 22 canonical tags. Each tag section lists projects grouped by category, sorted by stars descending. Generated by `scripts/generate.py` along with the README.

**`feed.json`** — A JSON Feed (JSON Feed v1.1) — RSS-style syndication feed (`feed.json:1-57`). Contains weekly refresh entries with dates and star counts. Published at the GitHub Pages site.

**`projects.yaml`** (458 lines) — Best-of-generator template configuration. Defines categories, labels, and the `min_stars`/`allowed_licenses` policy. Note: this is an output of `generate.py`, not its input. Per `CLAUDE.md:47`: "Edit the Python data structures in that script — never hand-edit the three output files."

**`server.json`** — MCP registry registration file (`server.json:1-21`). Follows the `$schema` from the official MCP registry schema. Identifies the server as `io.github.RyanAlberts/agent-harnesses` version 0.1.2, published to PyPI as `agent-harnesses-mcp` with stdio transport.

### 6. Tags Taxonomy (22 Tags)

Tags are **auto-derived** from each project's description and axis string via regex patterns in `generate.py:38-61`. The tag rules are ordered by discriminative value — architectural and functional tags come before implementation-language tags. This ordering determines display order in the README's tag chips. Projects can override with `extra_tags`. A `MAX_TAG_CHIPS = 5` limit keeps the tag display scannable (`generate.py:67`).

The 22 canonical tags, with project counts and top representatives:

| Tag | Count | Top Representative |
|-----|-------|-------------------|
| `python` | 61 | 61 of 106 projects — the dominant implementation language |
| `typescript` | 25 | 25 of 106 projects |
| `mcp` | 20 | MCP, Model Context Protocol — 20 projects use MCP tools or expose an MCP server |
| `multi-agent` | 19 | ECC (226k), MetaGPT (69k) — orchestration frameworks |
| `memory` | 18 | claude-mem (86k), Mem0 (60k) — memory layers |
| `sandbox` | 17 | Codex (96k), Daytona (72k), E2B (13k) — isolated execution |
| `evals` | 14 | AutoGPT (185k), SWE-bench (5k) — evaluation infrastructure |
| `low-code` | 4 | langflow (151k), Dify (148k) — visual DAG builders |
| `workflow` | 6 | n8n (195k), langgraph (37k) — state-machine orchestration |
| `rag` | 4 | Dify (148k), llama-index (51k) — retrieval-augmented generation |
| `ide` | 4 | awesome-cursorrules (40k), Cline (64k) |
| `provider-agnostic` | 8 | opencode (183k), LiteLLM (53k) |
| `cli` | 8 | opencode (183k), Gemini CLI (106k) |
| `tool-discovery` | 5 | Composio (29k), MCP-Zero (488) |
| `training` | 4 | Agent Lightning (17k) |
| `typed` | 3 | mastra (26k), pydantic-ai (18k) |
| `browser` | 4 | OpenHands (80k), browser-use (103k) |
| `tui` | 2 | opencode (183k), crush (26k) |
| `rust` | 2 | goose (51k) |
| `voice` | 2 | rasa (21k) |
| `vision` | 2 | R2R (8k) |
| `local` | 1 | n8n (195k) — self-hosted only |

The ordering reveals a hierarchy of concern: first come the architectural tags that describe *what the harness does* (mcp, memory, multi-agent, sandbox, evals, workflow, low-code, rag), then the platform tags that describe *where it runs* (cli, ide, tui, browser, local), then the implementation tags that describe *what it's written in* (python, typescript, rust). This ordering is deliberate — it surfaces the most useful information first in tag-chip displays.

### 7. Categories (10)

The catalog defines 10 categories, each with a distinct adoption surface and use case:

| Category | Count | Top Project | Stars | Key Theme |
|----------|-------|-------------|-------|-----------|
| Progressive disclosure harnesses | 6 | awesome-cursorrules | 40k | Formats that reveal tools in layers — AGENTS.md, SKILL.md, cursorrules |
| Coding agent products | 9 | opencode | 183k | Turnkey terminal/IDE agents — everything you need in one install |
| Coding harness configs and SDKs | 9 | superpowers | 247k | Skill packs and SDKs that extend existing agents |
| Personal agent runtimes | 7 | OpenClaw | 382k | Always-on daemons with messaging channel integrations |
| Frameworks | 23 | n8n | 195k | General LLM app platforms — the largest category by count |
| Multi-agent and orchestration | 8 | MetaGPT | 69k | Multi-agent coordination with explicit handoff or role models |
| Plugins, MCPs, CLI tools | 12 | claude-mem | 86k | IDE plugins and MCP servers that extend other harnesses |
| Evaluation and benchmarking | 16 | Agent Lightning | 17k | Agent eval systems — the most fragmented category |
| Research and task-specific | 2 | gpt-researcher | 28k | Deep research agents — notably small |
| Libraries and SDKs | 14 | Daytona | 72k | Lightweight primitives — sandboxes, providers, toolkits |

The most notable pattern: **coding harness configs and SDKs** (9 projects, 247k stars for the top entry) is a distinct category from **coding agent products** (9 projects, 183k stars for the top entry). The former extends an existing harness; the latter is a complete product. This distinction — extension vs product — maps directly to the adoption surface axis.

### 8. Axes: Autonomy × Recovery, Adoption × Stars

The catalog uses two primary classification axes that together define the operational profile of any harness:

**Simplicity ↔ Capability Axis (Adoption Surface Area)** — Four tiers (`harnesses.json:14-19`):

| Tier | Rank | Meaning |
|------|------|---------|
| super simple | 1 | Format-only, single concept — a prompt format or instruction set |
| mostly simple | 2 | Thin layer — a lightweight wrapper around an API |
| slightly complex | 3 | Real SDK — a library with documented interfaces |
| complex | 4 | Platform — a full runtime with its own ecosystem |

The tier help text reads: "Adoption surface area, least to most: tier_rank 1 = format-only/single concept, 4 = platform with its own runtime and ecosystem." The tier directly predicts the learning and integration cost.

**Autonomy Axis (Designed Autonomy Regime)** — Four levels (`harnesses.json:21-27`):

| Tier | Rank | Meaning |
|------|------|---------|
| step-gated | 1 | Human approves each action before it executes |
| checkpoint-gated | 2 | Human approves at defined checkpoints |
| bounded | 3 | Can run a whole task unattended but within limits |
| headless | 4 | Built for unattended runs, batches, and fleets |

★ Headless-ready projects (marked with a star in the tables) are those at autonomy tier "headless" or "bounded" — designed for automated operation. These are the most operationally demanding projects in the catalog. Only a handful qualify for the headless+durable quadrant in the axes-grid visualization.

**Recovery Axis (Failure-Recovery Tier)** — Four levels (`harnesses.json:28-34`):

| Tier | Rank | Meaning |
|------|------|---------|
| none | 1 | Start over on failure |
| retry | 2 | Automatic retry on failure |
| resumable | 3 | Session can resume from last checkpoint on failure |
| durable | 4 | Persisted execution state survives restarts mid-task |

✱ Durable projects (marked with a double star) survive a crash mid-task. This is the top of the recovery scale. LangGraph, Letta, and Microsoft Agent Framework are the only projects in the catalog rated durable.

The **landscape visualization** (`assets/landscape.svg`) plots all 106 projects by adoption surface area (x-axis) against GitHub stars (y-axis, log scale). Colors denote categories. Largest projects in each tier are labeled. The **axes-grid visualization** (`assets/axes-grid.svg`) places all loop-owning projects by autonomy (x-axis) vs recovery (y-axis). The headless+durable quadrant (top-right) is the sparsest — confirming that the combination of autonomous operation and crash survival is genuinely rare in the ecosystem. Both visualizations regenerate from the list data on every refresh.

---

## Part III — The MCP Server

### 9. Six Tools

The MCP server at `mcp/server.py` (228 lines) is built on `mcp.server.fastmcp`. It exposes 6 tools, each serving a distinct discovery need:

**`pick_harness(use_case, max_complexity, min_autonomy, min_recovery, open_source_only, limit)`** — The flagship tool. Takes a natural-language use case description, applies four structured filters (complexity cap, autonomy floor, recovery floor, OSS-only), then scores and ranks all matching projects. Returns JSON with ranked picks, each carrying a `why` field that explains the selection reasoning in plain language. This is the tool that replaces reading 106 READMEs.

**`search_harnesses(query, limit)`** — Keyword search across name, github_id, description, tags, and category. Exact name match receives a +50 bonus — so "opencode" returns the opencode entry first regardless of star count. The default limit is 5; the maximum is configurable.

**`get_harness(github_id)`** — Full project record by github_id. The authoritative single-project lookup. Returns all fields including the curated example link and all tags.

**`list_comparisons()`** — Lists the 5 decision guides with their slugs, titles, and one-sentence summaries. Enables an agent to discover that comparison documents exist before loading them.

**`get_comparison(slug)`** — Full markdown of a comparison guide. Loads from local `comparisons/` directory or fetches from the raw GitHub URL. This means the MCP server can serve full decision guides without bundling them into the JSON payload.

**`list_categories()`** — Returns the 10 categories, 14 use-case intents, and all tier definitions with project counts. Enables discovery of the organizational vocabulary.

### 10. Scoring Algorithm

The `pick_harness` scoring formula (`server.py:82-145`):

```
score = token_overlap × 3 + log₁₀(max(stars, 2))
```

Token overlap is computed across description + tags + category, each weighted equally at 3×. Stars use a log scale because star counts span orders of magnitude (from 488 for MCP-Zero to 382,000 for OpenClaw); raw star arithmetic would make the largest projects dominant regardless of relevance.

With **seeded boosting** for curated intents: hand-picked projects in the 14 use-case arrays receive `100 - rank` bonus points. For a curated list of 5 projects, the top entry receives 95 bonus points, the second receives 90, and so on. Since typical token-overlap scores are in the range of 10-50, the curated boost always dominates for matching queries.

Token matching uses a custom approach (`server.py:45-59`):
- Stop words exclude the 20 most generic terms in agent discourse: `{"i", "a", "an", "the", "to", "for", "of", "in", "on", "with", "and", "or", "my", "me", "want", "need", "agent", "agents", "ai", "llm"}`. These are too generic to discriminate.
- Inflection tolerance: 4+ character tokens match if either is a prefix of the other (handles "benchmark/benchmarks", "evaluate/evaluates", "mcp/mcps")
- The overlap function computes the intersection of the query token set and the project field token set

### 11. Filter Implementation

The filter chain in `pick_harness` applies in strict sequence:

```
1. max_complexity tier check  (skip if tier_rank > max_rank)
2. min_autonomy check         (skip if autonomy_rank < min_a)
3. min_recovery check         (skip if recovery_rank < min_r)
4. open_source_only check     (skip if license_signal != "open-source")
5. Token overlap check        (skip if no overlap AND not seeded)
```

The critical design decision is filter #5: a project with zero token overlap is still eligible if it is a seeded curated pick for the matching use case. This means a project's inclusion in a use-case intent list acts as an override — it survives the keyword filter.

Data loading is **lazy and local-first** (`server.py:29-38`): on first tool call, the server checks for `harnesses.json` in the same directory as `server.py`. If found, it loads locally. If not found (e.g., after pip install), it fetches from `raw.githubusercontent.com`. A module-level `_data` global caches after first load — subsequent calls reuse the same data without file I/O or network requests.

Deployment is clean: published to PyPI as `agent-harnesses-mcp`. One-line MCP install: `claude mcp add agent-harnesses -- uvx agent-harnesses-mcp`. Registered in the official MCP registry as `io.github.RyanAlberts/agent-harnesses` (version 0.1.2).

---

## Part IV — The Comparison Pages

The catalog publishes 5 head-to-head decision guides. These are the most practical artifacts in the entire repository — real documents making real recommendations with named trade-offs. They follow a consistent template: header with claim and scope, comparison table with key dimensions, situation-based recommendations, shared/commonalities section, and footer with attribution.

### 12. "How to Pick a Harness" — Six Questions

The canonical decision guide (`comparisons/how-to-pick-a-harness.md:3-28`) is the most architecturally significant document in the catalog. Its six questions form a decision tree that applies to any harness selection, not just the ones in this list:

**Q1: "What do you actually want it to do?"** — Maps to the 14 curated use cases. This is the first elimination step. A team that cannot answer this question clearly will choose the wrong harness. The 14 intents range from "Turnkey coding agent" (opencode, Cline, Codex, Gemini CLI, OpenHands, crush) to "Build your own harness from scratch" (Claude Agent SDK, Google ADK, AutoHarness, SWE-agent, RepoMaster, claw-code-agent).

**Q2: "How much do you want to adopt?"** — Maps to the simplicity↔capability tier. The key insight: "Pick the *lowest* tier that solves the job." This is an anti-Not-Invented-Here philosophy — prefer skill packs on existing harnesses over new frameworks. If a team needs a coding agent, they should first ask whether adding awesome-cursorrules to their existing setup solves it, before reaching for LangGraph.

**Q3: "How much rope does it need?"** — Maps to the autonomy axis. A crucial framing: "autonomy is co-constructed — the harness's approval defaults shape real-world behavior as much as the model does." A harness that defaults to headless operation will be used as a headless system, regardless of what the team intended.

**Q4: "What happens when it breaks?"** — Maps to the recovery axis. "For anything unattended, resumable is the floor, durable is the production bar. A headless harness with no recovery story is an incident generator." This question separates research-grade from ship-grade.

**Q5: "Who pays for the tokens?"** — The **post-June 2026 billing reality**. This is the most novel question in any technology decision guide published in 2026. It captures the industry shift where programmatic agent usage (API calls made by agents on behalf of users) now draws from a separate credit pool, distinct from a user's personal ChatGPT subscription. This changes the economics of which harnesses are viable at scale.

**Q6: "Can you walk away from it?"** — Portability. Prefers open formats (AGENTS.md, SKILL.md), standard protocols (MCP), permissive licenses. The question is not just "can you leave this harness?" but "can you take your skills and agents with you when you do?"

Three worked examples apply all six questions to real scenarios: "I want to review code while I sleep," "I want a personal assistant in Telegram," and "I want a multi-agent pipeline that survives deployments."

### 13. OpenClaw vs Hermes

The "loudest harness argument of 2026" (`comparisons/openclaw-vs-hermes.md:3`). Both are MIT-licensed, self-hosted, always-on personal agents with 200k+ stars. Both have active communities and regular releases. But their design philosophies are opposite:

| Dimension | OpenClaw | Hermes |
|-----------|----------|--------|
| The bet | **Presence** — one event loop, unbounded memory, feels like a person | **Discipline** — separated execution domains, bounded user model (~3k chars), feels like a harness |
| Proactivity | Native HEARTBEAT: agents can self-trigger on schedules | Script-gated wake-ups: proactive actions require explicit scripting |
| Ecosystem | 13,700+ community skills (ClawHub) | Self-generated skills via autonomous learning loop (Curator) |
| Security | Relaxed by default | Restrictive by default |
| Release tempo | 82 releases/year — fast-moving, frequently breaking | 6 releases/year — conservative |
| Learning loop | None autonomous | Closed loop (Curator + skill auto-creation) |

The field report section (`openclaw-vs-hermes.md:27-30`) provides four primary-source findings with attribution and caveats:

1. **Migration is driven by update churn, not features.** OpenClaw's 82 releases/year means users who want stability choose Hermes. Hermes's 6 releases/year means users who want the latest capabilities choose OpenClaw.

2. **The learning loop is real but double-edged.** Good patterns get automated and preserved; bad patterns get "etched in stone" alongside them. Hermes' ability to learn from user corrections is also its ability to learn from user mistakes.

3. **The run-both consensus.** The most practical outcome observed in the field: run OpenClaw as the orchestrator (presence, proactivity) and Hermes as the executor (discipline, bounded model), interoperating over the ACP (Agent Communication Protocol). This is the most resilient architecture.

4. **Trust the threads less than usual.** Concerns about astroturfing in community skill libraries — the quality signal on 13,700 skills is not uniform.

The billing section (`openclaw-vs-hermes.md:34-41`) explains the April→June 2026 Anthropic policy changes and the three-field-validated cost optimization hierarchy: wake less → two-tier routing → slim the tool list.

### 14. Terminal Coding Agents Comparison

The key architectural insight (`comparisons/terminal-coding-agents.md:5`): "What actually differs between them is the **harness** — the agent loop, provider wiring, sandboxing, and extension model — not the chat-in-a-terminal experience, which has converged."

Five tools compared, all producing the same chat-in-terminal UX:

| Tool | Stars | Differentiation |
|------|-------|----------------|
| **opencode** | 183k | Maximum freedom, biggest community, client/server split, Go-based TUI, 20+ AI providers |
| **Gemini CLI** | 106k | First-party Gemini, generous free tier, 1M token context, native Google Search grounding |
| **Codex** | ~50k | Strongest default isolation (sandboxed execution), ChatGPT Plus OAuth integration |
| **goose** | 51k | Harness without a bundled UI, MCP/ACP extensions, Rust-based |
| **crush** | 26k | Nicest TUI, session persistence, FSL-1.1-MIT license caveat |

The insight is that the terminal UX has fully converged — all five tools offer essentially the same interface. The differentiation is entirely in the harness properties beneath: sandbox isolation, provider breadth, extension model, and session persistence.

### 15. Multi-Agent Orchestration Comparison

Four coordination models compared (`comparisons/multi-agent-orchestration.md`):

| Framework | Coordination Model | Best For |
|-----------|-------------------|---------|
| OpenAI Agents SDK | **Handoffs** — pass the conversation to a specialist when you can't continue | Least framework, cheapest to walk away |
| CrewAI | **Roles/org charts** — named roles with goals and backstories collaborating in sequence or hierarchy | Fastest demo, non-engineer readability |
| AutoGen | **Conversation/group chat** — agents in a group chat, manager picks next speaker | Genuinely conversational problems |
| LangGraph | **Explicit state machine** — nodes and edges define the workflow graph | Production, restarts, durable execution |

The "unfashionable default" section (`multi-agent-orchestration.md:26`) is a healthy reality check: most multi-agent use cases are "one orchestrator delegating to stateless sub-tasks" — expressible with a `for` loop. The recommendation is to reach for a framework only when the coordination problem genuinely exceeds what a `for` loop can express.

The coordination model shapes the whole codebase. Picking wrong here is expensive — the coordination model is the architectural foundation, and changing it later is a rewrite.

### 16. Memory Layers Comparison

Three fundamentally different shapes (`comparisons/memory-layers.md`):

| Framework | Shape | Best For | Memory Ownership |
|-----------|-------|---------|-----------------|
| Mem0 | Memory API | Any agent, scoped memories | Application-owned |
| claude-mem | Claude Code plugin | Perfect recall for Claude Code | Harness-owned |
| Letta | Agent runtime | Memory-first agent design | Agent-owned |

The framing question: "Who owns the memory — the application, the agent, or the harness?" This determines the deployment topology. Application-owned (Mem0) means the application controls what is remembered; the agent is a consumer. Harness-owned (claude-mem) means the harness controls recall; the agent inherits memory from the IDE session. Agent-owned (Letta) means the agent has persistent identity; the agent controls what it remembers about its users.

The 2026 production stack covers all four memory surfaces (working, session, long-term facts, identity/persona) with **two products** or one product plus Obsidian: a memory-primitive library (Mem0 or Letta) and a human-readable archive (Obsidian + git).

---

## Part V — The Pattern Catalog

### 17. Recurring Architectural Patterns Across 106 Projects

Synthesizing across all 11 rounds of analysis, eight recurring patterns emerge as the fundamental vocabulary of agent harness design:

**Tool-call loop** — The foundational pattern. Model generates structured tool calls, harness executes them, results feed back to model. Used by approximately 80% of projects. This is the dominant paradigm. All variations — permission gates, state machines, event queues — are built on top of this base.

**Agent loop with permission gates** — The tool-call loop augmented with human approval at each step (step-gated) or at defined checkpoints (checkpoint-gated). Used by Cline, Aider, Open Interpreter, and any harness where the default is "ask before acting." The permission gate is not just a safety feature — it is aUX decision about the default behavior of the system.

**State machine / graph** — Explicitly defined transitions between LLM-calling nodes with persistent state. LangGraph's `StateGraph`, n8n's DAG workflows, Microsoft Agent Framework's workflow graphs. The graph is the most general coordination primitive — any workflow can be expressed as a graph, but not every workflow needs to be.

**Event loop with input queue** — Messages, heartbeats, crons, webhooks as unified events. OpenClaw's gateway treats all inputs as events on a single queue. Hermes' gateway does the same across 17+ platform adapters. This pattern enables always-on operation and proactive behavior.

**Memory hierarchy** — Working memory / episodic memory / persistent storage with retrieval. Letta (MemGPT's memory blocks), Mem0 (append-only facts), claude-mem (3-layer progressive disclosure). The memory hierarchy pattern appears in every system that needs to operate across multiple sessions.

**Progressive disclosure** — Index first, details on demand. AGENTS.md loads the table of contents before the full content; MCP-Zero builds a tool index before invoking any tool; ToolGen generates tool definitions on demand from descriptions. This pattern addresses the context window problem by deferring detail until it is needed.

**Multi-agent handoff** — Agents transfer control via call-center escalation (OpenAI Agents SDK's handoffs), role-based collaboration (CrewAI's crew processes), or conversational group chat (AutoGen's group chat). The handoff primitive is the minimum necessary ingredient for multi-agent coordination.

**Plugin/skill ecosystem** — Harness loads skills/plugins from a directory or registry. superpowers (247k stars), Anthropic Skills (50+ skills), ClawHub (13,700+ skills), ECC (261 skills). The size of the skill ecosystem is a significant factor in adoption — teams prefer harnesses with established skill libraries. The plugin model also determines the harness's extensibility ceiling: a harness with a rich plugin SDK can absorb new capabilities without core changes; a harness without one requires fork-and-modify.

**Common API shapes** — The tool-call interface has converged on two shapes across the industry. The first is the **MCP / OpenAI function-calling convention**: `{"type": "function", "name": "...", "input": {...}}` — used by MCP, OpenAI Agents SDK, and most modern harnesses. The second is the **Python decorator DSL**: `@tool`, `@agent`, `@workflow` — used by pydantic-ai, mastra, and strands-agents. These two shapes represent the two dominant paradigms: structured protocol (MCP) vs. embedded DSL (Python decorators). The MCP shape is more portable across languages; the decorator shape is more ergonomic in Python codebases.

**Common deployment topologies** — Five deployment shapes recur across the 106 projects. CLI local (installed on the user's machine — opencode, Codex, Gemini CLI). Docker sandbox (self-hosted in a container, optionally with a web UI — OpenHands, Agent Zero). Daemon plus chat app (runs as a background service, interfaced via messaging APIs — OpenClaw, Hermes, Khoj). Cloud hosted (serverless or managed — E2B, Daytona, Cloudflare Agents). IDE extension (VS Code or JetBrains plugin — Cline, Continue). Library dependency (imported as a package in the user's codebase — langgraph, pydantic-ai, CrewAI). The deployment topology determines the operational burden and the integration surface — teams should match the deployment topology to their deployment context.

### 18. Convergent Patterns

The 2026 multi-agent landscape has converged on several definitive architectural choices:

**Graph as the durable substrate.** LangGraph, Microsoft Agent Framework, CrewAI Flows, OpenAI Agents SDK (handoffs as linear graphs), MetaGPT SOPs (Standard Operating Procedures as message-passing graphs) — all converge on graph vocabulary for durable workflows. The reasons are practical: graphs are checkpointable (save state at each node), replayable (resume from any checkpoint), statically inspectable (visualize the workflow), and serializable (store the workflow definition as data). This convergence is the most significant architectural signal in the catalog.

**Tool calls as the inter-agent IPC.** The Agent-as-tool pattern (OpenAI Agents SDK `AgentTool`, Microsoft Agent Framework agents-as-skills, agent-squad SupervisorAgent) is the most testable inter-agent primitive. An agent calling another agent as a tool gets a return value, can write unit tests against the interface, and sees the interaction as a single tool call in traces. This is more tractable than message-passing or group chat.

**External memory layers for cross-session facts.** The framework handles in-run state (messages, scratchpad, intermediate results); an external memory layer handles cross-session facts (entities, preferences, learned patterns). Mem0 is the most common pairing. No framework in the catalog bundles both well — LangGraph handles durable execution but outsources memory to Mem0 or its own Store API.

**OpenTelemetry-class observability as non-negotiable.** Built-in tracing (OpenAI Agents SDK), LangSmith visualization (LangGraph), OpenTelemetry built-in (Microsoft Agent Framework), CrewAI AMP telemetry. The standard has shifted from "add a logging library" to "export OpenTelemetry spans by default." This is a significant maturation signal.

**MCP as the standard tool protocol.** The MCP / OpenAI function-calling convention `{"type": "function", "name": "...", "input": {...}}` is the emerging industry standard. Projects that deviate (custom tool formats, proprietary protocols) face integration costs that projects using MCP do not.

### 19. Divergent Patterns

Where projects meaningfully disagree — and the disagreements reveal genuine architectural philosophy:

**Autonomy philosophy.** OpenClaw bets on **presence** — unbounded memory, native heartbeats, proactive behavior. The design thesis is that an always-on agent should feel like a present colleague, not a reactive tool. Hermes bets on **discipline** — separated execution domains, bounded user model (~3k chars), script-gated proactivity. The design thesis is that an agent should not accumulate unbounded state about a user without active management. Neither is wrong; they serve different deployment contexts and user preferences.

**Memory ownership.** Mem0 (application-owned, scoped memories, multi-tenant API), Letta (agent-owned, memory blocks with character limits, server-side persistence), claude-mem (harness-owned, Claude Code plugin with 3-layer retrieval). Each answer to "who owns the memory?" implies a different deployment topology and a different answer to "what happens when the agent is replaced?"

**Recovery ambition.** Only LangGraph, Letta, and Microsoft Agent Framework have true durable execution — checkpoint + resume after crash. Most projects stop at "resumable" — they save session state (conversation history, tool outputs) but cannot replay mid-task execution state. The durable/resumable split is the sharpest quality distinction in the catalog. It separates production-grade from research-grade.

**Scope philosophy.** Hermes (1.3M LOC, 17+ platform adapters, 6 execution backends, 1,976-line Curator), OpenFang (198K LOC Rust, single binary, 16 security layers), OpenClaw (155 packages, 82 releases/year, 28+ channel integrations), BizarHarness (smallest, focused on coding harness). Larger scope enables more deployment contexts and use cases; smaller scope enables faster iteration, lower cognitive overhead, and more predictable behavior. The right scope depends on the target user. The catalog captures the full range, which is itself useful — a team can find the harness that matches their scope tolerance.

**Common failure modes** — The catalog implicitly documents failure modes by what it tracks. Six recurring failure modes appear across the projects: model hallucination (addressed by tool verification, sandboxed execution, permission gates — `round-2-architecture/best-of-architecture.md:402-403`); infinite loops (addressed by step limits, cost budgets, human-in-the-loop — tracked via the autonomy axis); token bloat (addressed by progressive disclosure, context management, tool retrieval — the memory hierarchy pattern); crash/lost state (addressed by checkpointing, durable execution, session persistence — the recovery axis); cost explosion (addressed by routing by model tier, budget caps, open-weight alternatives — the billing question in Q5 of the decision guide); and lock-in (addressed by open formats, standard protocols, permissive licenses — Q6 of the decision guide). Each failure mode has become a design pressure that shaped the axes and tiers of the catalog itself.

**The "headless+durable" quadrant is the rarest achievement.** Of the 106 projects, only LangGraph, Letta, and Microsoft Agent Framework qualify for both headless operation and durable execution. This combination — the ability to run unattended AND survive crashes mid-task — is the hardest engineering problem in the catalog. It requires both a checkpointing system and a recovery mechanism. Most projects achieve one or the other but not both. This is the production bar for agent harness engineering: not "can it run?" but "can it run unattended, recover from crashes, and keep working?"

---

## Part VI — Operational Characteristics

### 20. Strengths as a Discovery Tool

The catalog's primary value is **structured discovery** — making the agent harness landscape navigable rather than an undifferentiated wall of GitHub search results. This is a genuine gap: the number of agent harness projects on GitHub grew from dozens to hundreds between 2023 and 2026, and the quality variance is enormous. A team that tries to evaluate these projects by reading READMEs will spend weeks and still miss the key distinctions. The catalog converts 106 discrete evaluation tasks into one structured lookup.

The catalog also has a secondary value that is less obvious: it **names the design space**. Before the catalog existed, there was no shared vocabulary for discussing harness properties. Terms like "autonomy," "recovery," "adoption surface," and "headless-ready" did not have canonical definitions in the agent harness discourse. The catalog gave these concepts names and ordinal scales. This is a knowledge management contribution, not just a tool recommendation contribution. Teams that use the catalog's vocabulary communicate more precisely about what they need, which leads to better harness selection and better integration design.

**The MCP server is the killer feature.** Rather than reading 106 READMEs, an agent calls `pick_harness` with a natural-language description and receives ranked, reasoned recommendations. The curated seeding ensures that for common queries ("I need a coding agent for my terminal"), the right answers appear first — not just the most-starred. The `why` field in each result explains the selection reasoning in plain language, so a human can evaluate the recommendation.

**The 5-dimensional project profile** (stars, tier, autonomy, recovery, license) enables precise filtering that GitHub search cannot provide. A user who needs "headless + durable + open-source" can filter to exactly those projects. A user who needs "super simple + step-gated" gets a completely different slice. These filters map to operational realities, not to topic tags.

**The comparison pages are the most practical output.** The catalog does not just list projects — it curates the decision. "OpenClaw vs Hermes" is a document a team can read in 10 minutes and make a decision. The 6-question "How to pick a harness" is a reusable decision framework that applies to any technology selection in the agent harness space. These documents compete not with other harnesses but with consulting firms selling evaluation frameworks.

**The tag taxonomy is the right vocabulary.** 22 tags ordered by discriminative value, auto-derived from descriptions, is more useful than a free-form keyword cloud. It creates a shared language for discussing what a harness does — "that project is `multi-agent + sandbox + python`" conveys more than "it does AI stuff."

**Two-flow automation keeps humans in control.** Flow 1 (GitHub API refresh) writes `curation-queue.json`. Flow 2 (human editorial review) reads it and decides what enters the catalog. This separation ensures the curation bar is never bypassed by automation pressure.

### 21. Weaknesses

**Curation lag.** The weekly refresh cycle means star counts and project additions lag the live ecosystem. Projects that surge in popularity take days to reflect. Projects that go dormant may persist longer than warranted if no one files an editorial note. The curation queue helps but it is reactive, not predictive.

**No deep architectural analysis.** The catalog describes what exists, not how it works internally. A project can be in the catalog without anyone having read its source code. The architecture deep-dives in Rounds 4-11 were required to surface the actual design decisions — the catalog alone would not tell you that LangGraph has checkpoint-based durable execution or that OpenFang has WASM dual-metered sandboxing.

**Catalog not codebase.** Best-of is a curated list of 106 projects, not a project itself. It provides discovery but not capability. Teams use it to pick a harness, then they build with that harness. The catalog cannot be deployed, extended, or customized — it is a reference document.

**Shallow coverage of the long tail.** 106 projects is comprehensive for the top-of-market, but the long tail of small, specialized, or early-stage harnesses is not captured. The curation bar (editorial, not automatic) means projects below the radar may never appear. A project with 500 stars that is technically sophisticated but not yet widely known will not appear.

**The schema is under-utilized by the MCP server.** `harnesses.json` contains rich data (14 use cases with curated picks, 13 FAQ entries, 5 comparison documents with full markdown). The MCP server exposes only `pick_harness`, `search_harnesses`, and `get_harness`. The FAQ, use-case, and comparison data is accessible only through the generated README or direct file access. An agent using the MCP server cannot discover the comparison documents without out-of-band knowledge.

**No evaluation of quality.** Stars and tier rankings are proxies for community traction, not for code quality, security, or production readiness. Two projects at the same star level can have radically different maintenance burdens. Hermes (1.3M LOC, solo-maintained) and LangGraph (MIT, team-maintained, Klarna production users) have comparable star counts but very different operational risk profiles.

### 22. Lessons for Bizar

The catalog offers seven concrete lessons for BizarHarness, each traceable to specific findings in the survey:

**1. Structured discovery is the primary value.** The MCP server + curated seeding + structured filtering is a more powerful discovery mechanism than any marketing or documentation. Bizar should build an equivalent MCP server for its own capabilities — `pick_harness` becomes `bizar_init`, `bizar_run_agent`, `bizar_search_skills`. This is the most direct pattern to steal. The implementation hint from `bizar-alignment.md B.11`: use the official `@modelcontextprotocol/sdk` TypeScript SDK, expose tools for project initialization, agent dispatch, skills search, memory search, graph query, and audit.

**2. Axes > categories for filtering.** The autonomy × recovery grid is more useful than a flat category list because it maps directly to operational concerns — can this run unattended? does it survive crashes? Bizar's existing tier system (Odin → Thor → Tyr → Vidarr) is already an implicit autonomy axis; adding an explicit recovery dimension would make it navigable in the same way the catalog's axes are navigable.

**3. Comparison pages are the highest-signal artifact.** The "How to pick a harness" 6-question framework is the most-cited output of the entire catalog. Bizar should publish 3 comparison docs: Bizar vs opencode (value of multi-agent dispatch vs single-agent terminal), Bizar vs Claude Code (multi-agent tiered dispatch vs single-session chat), Bizar multi-agent vs LangGraph (Bizar's tier-gated Forseti-audited dispatch vs LangGraph's explicit state machine). See `bizar-alignment.md B.12`.

**4. The 6-question decision framework is generalizable.** Define job → minimize adoption surface → match risk tolerance → plan for failure → account for costs → ensure exit. This applies to any technology selection in Bizar's ecosystem — not just picking external harnesses but also picking internal architectural patterns.

**5. Closed learning loop is the hardest differentiator.** Hermes' Curator (1,976 lines) is the only system in the survey with a complete autonomous self-improvement cycle: skill auto-creation after complex tasks → usage tracking → idle-triggered fork review → archive/pin/delete transitions. Mem0's benchmarked single-pass retrieval algorithm + claude-mem's 3-layer progressive disclosure + trajectory capture = the three components of a closed learning loop. Bizar's `AGENTS_SELF_IMPROVEMENT.md` is the write path; the missing step is a review pass that runs when the user invokes it (`bizar review`). See `bizar-alignment.md B.1`.

**6. Graph vocabulary is winning.** LangGraph, MAF, CrewAI Flows, OpenAI Agents SDK all converged on the same graph vocabulary for workflows. Bizar's internal dispatch should adopt explicit edges — "depends on", "parallelizable with", "audit-required before" — even if the user-facing UX remains role-based. This is the implementation path toward durable replay: if Bizar's trajectories are stored as graph states, not just text logs, replay becomes a graph traversal.

**7. The catalog proves the taxonomy works.** 22 tags, 10 categories, 4 autonomy tiers, 4 recovery tiers — this vocabulary is precise enough to be useful and compact enough to be memorized. Bizar should adopt this vocabulary for its own capability documentation: agent capabilities as tags, deployment contexts as categories, autonomy tiers for dispatch decisions, recovery tiers for session persistence.

---

## Appendix: Key File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `harnesses.json` | 3,407 | Master structured data — all 106 projects |
| `harnesses.jsonld` | 1,308 | Semantic web layer — schema.org Dataset |
| `llms.txt` | 242 | Agent-readable flat index |
| `TAGS.md` | 517+ | Auto-generated tag cross-reference |
| `mcp/server.py` | 228 | MCP server — 6 tools, lazy loading |
| `curation-queue.json` | 3,079 | Weekly editorial handoff artifact |
| `feed.json` | 57 | RSS-style syndication feed |
| `comparisons/how-to-pick-a-harness.md` | 37 | 6-question decision guide |
| `comparisons/openclaw-vs-hermes.md` | 49 | Personal agent design philosophy comparison |
| `comparisons/terminal-coding-agents.md` | 34 | opencode vs Codex vs Gemini CLI vs goose vs crush |
| `comparisons/multi-agent-orchestration.md` | 30 | OpenAI Agents SDK vs CrewAI vs AutoGen vs LangGraph |
| `comparisons/memory-layers.md` | 30 | Mem0 vs claude-mem vs Letta |
| `scripts/generate.py` | 1,905 | Master generator — produces all output files |
| `scripts/refresh_stars.py` | 165 | Star refresh + curation-queue writer |
| `scripts/discover_candidates.py` | 104 | Candidate discovery via GitHub topic search |

---

*Report synthesized from: `round-1-recon/best-of-recon.md` (378 lines), `round-2-architecture/best-of-architecture.md` (481 lines), `round-3-crossref/cross-reference.md` (769+ lines), `round-3-crossref/bizar-alignment.md` (396 lines), `round-3-crossref/deep-subsystems.md` (365 lines), `round-7-bestof-deep/coding-harnesses.md` (487 lines), `round-7-bestof-deep/multi-agent-memory.md` (814 lines), and raw catalog files at `repos/best-of-Agent-Harnesses/`. All claims are traceable to specific file:line references in source documents.*
