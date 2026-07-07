# OpenFang Hands System — Deep Dive

**Round 5 — OpenFang Deep Analysis**  
**Scope:** Hands System Architecture, Lifecycle, and All 9 Bundled Hands  
**Sources:** `crates/openfang-hands/src/lib.rs`, `crates/openfang-hands/src/registry.rs`, `crates/openfang-hands/src/bundled.rs`, all 9 `bundled/*/HAND.toml`

---

## 1. HAND.toml — Full Schema

Every Hand is defined by a `HAND.toml` manifest parsed at compile time via `include_str!()` in `bundled.rs:6-53`. The schema supports two formats: flat (TOML root fields directly) and wrapped (`[hand]` table). Both parse via `parse_hand_toml()` at `lib.rs:325-331`.

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique hand identifier (e.g. `"researcher"`) |
| `name` | string | Yes | Human-readable name |
| `description` | string | Yes | Marketplace/instructional description |
| `category` | enum | Yes | `content`, `security`, `productivity`, `development`, `communication`, `data`, `finance`, `other` |
| `icon` | string | No | Emoji icon (default empty string) |
| `tools` | string[] | Yes | Tool names the agent needs access to |
| `skills` | string[] | No | Skill allowlist for spawned agent (empty = all) |
| `mcp_servers` | string[] | No | MCP server allowlist (empty = all) |
| `requires` | section[] | No | External dependencies (binary, env var, API key) |
| `settings` | section[] | No | Dashboard configuration controls |
| `agent` | section | Yes | Agent manifest template |
| `dashboard` | section | No | Metrics schema for the web dashboard |

### `[[requires]]` — External Dependencies

Each requirement entry (`lib.rs:111-135`) has:

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Unique identifier for the requirement |
| `label` | string | Human-readable description |
| `requirement_type` | enum | `binary`, `env_var`, `api_key` |
| `check_value` | string | Binary name, env var name, or API key name |
| `description` | string | Why this is needed (optional) |
| `optional` | bool | If true, unmet requirement degrades but doesn't block (default false) |
| `install` | section | Platform-specific install instructions |

Install instructions (`lib.rs:83-109`) support: `macos`, `windows`, `linux_apt`, `linux_dnf`, `linux_pacman`, `pip`, `signup_url`, `docs_url`, `env_example`, `manual_url`, `estimated_time`, `steps[]`.

Requirement checking is implemented in `registry.rs:584-611`. Binary checks use cross-platform `PATH` scanning (`registry.rs:742-760`). Python 3 gets special handling: it actually runs `python3 --version` and checks for "Python 3" in output, to avoid false positives from Windows Store shims or Python 2. Chromium gets a 4-tier lookup: env vars → PATH → known install paths → Playwright cache (`registry.rs:658-738`).

### `[[settings]]` — Dashboard Configuration

Each setting (`lib.rs:177-193`) has:

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Config key name |
| `label` | string | Display label |
| `description` | string | Explanatory text |
| `setting_type` | enum | `select`, `text`, `toggle` |
| `default` | string | Default value |
| `options` | section[] | For select-type: available choices |
| `env_var` | string | For text-type: env var to expose to agent subprocess |

Options (`lib.rs:165-175`) include `value`, `label`, `provider_env` (env var that gates "ready" badge), and `binary` (PATH check for ready badge).

Settings are resolved at activation time via `resolve_settings()` (`lib.rs:209-266`), which builds a markdown block injected into the system prompt and collects env vars for subprocess passthrough.

### `[agent]` — Agent Manifest Template

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | Agent display name |
| `description` | string | — | Agent description |
| `module` | string | `"builtin:chat"` | Execution module |
| `provider` | string | `"anthropic"` | LLM provider |
| `model` | string | `"claude-sonnet-4-20250514"` | Model ID |
| `api_key_env` | string | — | Override API key env var |
| `base_url` | string | — | Override base URL |
| `max_tokens` | u32 | `4096` | Max response tokens |
| `temperature` | f32 | `0.7` | Sampling temperature |
| `system_prompt` | string | — | Full multi-phase operational playbook |
| `max_iterations` | u32 | — | Loop iteration cap |
| `heartbeat_interval_secs` | u64 | — | Override default 30s heartbeat |

### `[dashboard]` — Metrics Schema

```toml
[dashboard]
[[dashboard.metrics]]
label = "Queries Solved"
memory_key = "researcher_hand_queries_solved"
format = "number"   # or "percentage", "duration", "bytes", "text"
```

Metrics are read from the agent's structured memory store at display time.

---

## 2. The Multi-Phase System Prompts — Validated

OpenFang's "500+ word multi-phase expert procedure" claim is validated. The Researcher hand's system prompt (`bundled/researcher/HAND.toml:168-379`) is 211 lines (~1,200 words). The Collector, Predictor, and Lead prompts are similarly structured. Phase structure across all hands:

### Researcher Hand — 8 Phases (0–7)
- **Phase 0** — Platform Detection & Context Recovery (OS detection, memory_recall, knowledge_query)
- **Phase 1** — Question Analysis & Decomposition (factual/comparative/causal/predictive/how-to/survey)
- **Phase 2** — Search Strategy Construction (direct/expert/comparison/temporal/deep queries)
- **Phase 3** — Information Gathering Core Loop (CRAAP source evaluation, confidence scoring)
- **Phase 4** — Cross-Reference & Synthesis (2+ source verification, knowledge graph population)
- **Phase 5** — Fact-Check Pass (primary source verification, confidence levels)
- **Phase 6** — Report Generation (brief/detailed/academic/executive formats)
- **Phase 7** — State & Statistics (memory_store for dashboard metrics)

### Collector Hand — 8 Phases (0–7)
- **Phase 0** — Platform Detection & State Recovery
- **Phase 1** — Schedule & Target Initialization (first run: schedule_create, parse target)
- **Phase 2** — Source Discovery & Query Construction
- **Phase 3** — Collection Sweep (web_search + web_fetch, entity extraction)
- **Phase 4** — Knowledge Graph Construction (knowledge_add_entity/relation)
- **Phase 5** — Change Detection & Delta Analysis (compare to previous snapshot)
- **Phase 6** — Report Generation (markdown/JSON/HTML)
- **Phase 7** — State Persistence (knowledge base JSON + memory_store)

### Predictor Hand — 8 Phases (0–7)
- **Phase 0** — Platform Detection & State Recovery
- **Phase 1** — Schedule & Domain Setup (report schedule, domain templates)
- **Phase 2** — Signal Collection (20-40 queries, signal tagging by type/strength/direction)
- **Phase 3** — Accuracy Review (Brier score calculation for expired predictions)
- **Phase 4** — Pattern Analysis & Reasoning Chains (cognitive bias checks, contrarian mode)
- **Phase 5** — Prediction Formulation (calibrated confidence, falsifiable claims)
- **Phase 6** — Report Generation (accuracy dashboard, active predictions, meta-analysis)
- **Phase 7** — State Persistence

### Lead Hand — 7 Phases (0–6)
- **Phase 0** — Platform Detection
- **Phase 1** — State Recovery & Schedule Setup (ICP construction)
- **Phase 2** — Target Profile Construction (ICP stored in knowledge graph)
- **Phase 3** — Lead Discovery (multi-query web research)
- **Phase 4** — Lead Enrichment (basic/standard/deep depth)
- **Phase 5** — Deduplication & Scoring (0-100 score, ICP match + growth signals)
- **Phase 6** — Report Generation (CSV/JSON/markdown table)
- **Phase 7** — State Persistence

### The "Not a One-Liner" Claim — Validated

The claim is substantiated. The system prompts are not a single instruction but a **sequenced operational playbook** with:
1. **Named phases** with phase numbers and phase separation lines (`---`)
2. **Conditional branching** (on first run vs subsequent runs, on setting values)
3. **Output templates** for each phase (markdown structures for reports, prediction formats)
4. **Guardrails inline** (e.g., Researcher: "NEVER fabricate sources"; Browser: mandatory purchase approval gate)
5. **State management** at each phase (memory_store, knowledge_add_entity calls at specific phases)
6. **Loop points** for multi-iteration operation (schedule_create, cycle counting)

The "innovation" is not the prompt length per se but the **procedural encoding** of domain expertise into a deterministic multi-phase workflow.

---

## 3. SKILL.md Format in OpenFang

OpenFang uses `SKILL.md` for domain expertise reference content, similar to Hermes. The key difference is **when and how it's injected**.

### OpenFang SKILL.md

- Each Hand bundles a `SKILL.md` at `bundled/<id>/SKILL.md`
- Content is embedded via `include_str!()` at `bundled.rs:10-12` (compile time)
- Attached to `HandDefinition.skill_content` at `bundled.rs:64-66`
- The skill content is injected into the agent context at runtime by the kernel
- The `runtime` field in the SKILL.md frontmatter specifies how to execute it: `"prompt_only"` ( Researcher, Collector, Predictor, Lead, Twitter, Trader, Browser), `"python"` (Infisical-Sync), or WASM

### Hermes SKILL.md Comparison

| Aspect | Hermes | OpenFang |
|--------|--------|----------|
| **Format** | YAML frontmatter + markdown body | YAML frontmatter + markdown body |
| **Storage** | Files at `~/.hermes/skills/` | Embedded in Rust binary via `include_str!()` |
| **Loading** | Dynamic file system scan at startup | Compile-time inclusion |
| **Update** | Agent can `patch`/`edit` during conversations | Agent can `file_write` at runtime but no auto-curation |
| **Authoring** | Autonomous skill creation + curator review | Hand author writes at compile time |
| **Runtime** | `prompt_only` or code (Python/WASM/Node) | `prompt_only`, `python`, or WASM |
| **Learning loop** | Yes — auto-create, usage track, curator review | No — static content |

The fundamental difference: **Hermes skills are self-improving; OpenFang SKILL.md files are static knowledgebases**. Hermes creates skills autonomously after complex tasks; OpenFang relies on hand-crafted expertise.

### SKILL.md Frontmatter Schema (OpenFang)

```yaml
---
name: researcher-hand-skill
version: "1.0.0"
description: "Expert knowledge for AI deep research — methodology..."
runtime: prompt_only
---
```

The `runtime: prompt_only` value means the skill content is appended to the system prompt verbatim. Code-based skills would have `runtime: python` or `runtime: wasm` with actual executable content.

---

## 4. Hand Lifecycle

### Cold Start: `openfang hand activate X`

The full activation flow:

1. **CLI command**: `openfang hand activate <hand_id> [--config KEY=VAL]` at `crates/openfang-cli/src/main.rs`
2. **Registry lookup**: `HandRegistry::activate()` (`registry.rs:351-382`) validates the hand exists and is not already active
3. **Requirements check**: `HandRegistry::check_requirements()` (`registry.rs:448-464`) — returns `Vec<(HandRequirement, bool)>`
4. **Readiness computation**: `HandRegistry::readiness()` (`registry.rs:536-560`) — combines requirements + instance state into `HandReadiness { requirements_met, active, degraded }`
5. **Settings resolution**: `resolve_settings()` (`lib.rs:209-266`) — builds prompt block + env vars from user config
6. **Kernel spawns agent**: `HandInstance` created with `status: Active`, `agent_id: None` initially
7. **Agent assigned**: kernel calls `HandRegistry::set_agent()` (`registry.rs:417-425`) to link the `AgentId`
8. **State persisted**: `HandRegistry::persist_state()` (`registry.rs:105-123`) writes `hands.json` to survive daemon restarts

### State Transitions

```
[Inactive] --activate()--> [Active] --deactivate()--> [Inactive]
                            |
                            +--pause()--> [Paused] --resume()--> [Active]
                            |
                            +--error()--> [Error(msg)]
```

`pause()` and `resume()` (`registry.rs:395-413`) only update the instance status — the underlying agent continues running. This is "pause without losing state" because the agent's session in SQLite is untouched.

### Run Cycles (BackgroundExecutor)

Each Einstein Hand runs via the `BackgroundExecutor` (`crates/openfang-kernel/src/background.rs`). Schedule modes at `background.rs:21-200`:

- **Reactive**: Chat-only, no background loop
- **Continuous { check_interval_secs }**: Self-prompt on interval
- **Periodic { cron }**: Simplified cron schedule
- **Proactive { conditions }**: Event-triggered

The hand's `schedule_create` tool (`bundled/*/HAND.toml` system prompt phase 1) instructs the LLM to call `schedule_create` to register its own recurrence. The `BackgroundExecutor` fires on schedule and calls the agent's loop.

### Deactivate

`HandRegistry::deactivate()` (`registry.rs:385-392`) removes the instance from the in-memory `DashMap`. The agent itself is killed by the kernel. State persists in SQLite — sessions, memories, knowledge graph entries all survive.

---

## 5. State Persistence Between Runs

### Where Each Hand Persists State

| Storage | Mechanism | Survives Restart? |
|---------|-----------|-------------------|
| **Agent session** | SQLite `sessions` table | Yes |
| **Structured memory** | SQLite `kv_store` (per-agent) | Yes |
| **Knowledge graph** | SQLite `entities` + `relations` | Yes |
| **Canonical session** | SQLite `canonical_sessions` | Yes |
| **Schedule registry** | In-memory `DashMap` | No — restored from agent's `schedule_create` calls |
| **Hand instance registry** | `~/.openfang/hands.json` (JSON file) | Yes |
| **Hand source files** | `~/.openfang/hands/<id>/` directory | Yes |
| **Knowledge base JSON** | `collector_knowledge_base.json` (file in workspace) | Yes |
| **Predictions ledger** | `predictions_database.json` (file in workspace) | Yes |
| **Leads database** | `leads_database.json` (file in workspace) | Yes |

### The "Pause Without Losing State" Claim — Traced

From R1 (`openfang-recon.md:118-120`): "Hands work for you — meaning they run on schedules, 24/7, without prompting. The 'pause without losing state' claim."

Tracing it:
1. `pause()` at `registry.rs:395-403` sets `status = HandStatus::Paused` on the `HandInstance`
2. The agent continues running — its session in SQLite is unaffected
3. When resumed, the agent resumes its session mid-conversation
4. The agent's internal state (memory_recall data, knowledge graph) persists in SQLite regardless of pause/resume
5. The schedule itself is NOT paused — pausing a hand instance doesn't pause the cron schedule. The `BackgroundExecutor` checks instance status before firing (`registry.rs:536-560`: `active` means `status == HandStatus::Active`)

The claim is **partially accurate**: agent session state is preserved across pause/resume. But the schedule continues firing — pausing the hand means the agent won't process new schedule events.

### Migration System (MIGRATION.md)

The `openfang-migrate` crate handles OpenClaw → OpenFang migrations. The knowledge graph and session data are migrated via the SQLite schema. The migration system does NOT handle Hand definitions — Hands are bundled in the binary.

---

## 6. Inter-Hand Communication

### Do Hands Talk to Each Other?

Direct Hand-to-Hand communication is **not implemented**. There is no message-passing between Hand instances. However, three indirect channels exist:

### Shared Knowledge Graph

All six "Einstein Hands" (lead, collector, predictor, researcher, twitter, trader) carry `knowledge_add_entity`, `knowledge_add_relation`, and `knowledge_query` tools (`bundled.rs:426-456`). The knowledge graph (`crates/openfang-memory/src/knowledge.rs`) is backed by the shared SQLite database. Any Hand can query what another Hand has stored.

Example: The Collector stores entities about a company (people, products, events). The Lead Hand can `knowledge_query` for those entities when scoring leads.

### Event Bus

All six Einstein Hands plus Infisical-Sync carry `event_publish`. The `TriggerEngine` (`crates/openfang-kernel/src/trigger.rs`) pattern-matches events and can trigger other agents. But there is no Hand-to-Hand direct event emission — events are published to the kernel's event bus, not to specific Hand instances.

### Shared Memory Namespace

Hands use the same `AgentId` (`00000000-...01`) for cross-agent data storage via `memory_store`/`memory_recall`. This is the "shared workspace" — any Hand can store structured data that other Hands can recall.

### Task Board

All Hands have access to `task_post`, `task_claim`, `task_complete`, `task_list`. The shared task queue in SQLite (`task_queue` table) allows Hands to coordinate work.

---

## 7. The 9 Bundled Hands — Detailed Analysis

### 1. Clip Hand (`clip`)
**What it does**: Transforms long-form video (YouTube URL or local file) into vertical shorts with captions and thumbnails, ready for TikTok/Reels/Shorts.

**How it implements it** (8 phases: Intake → Download → Transcribe → Analyze → Extract → TTS → Publish → Report):
- **Intake**: `web_fetch` or `shell_exec` with `yt-dlp` to download video
- **Transcribe**: 5 STT backends tried in order: Groq Whisper (fastest, free), OpenAI Whisper API, Deepgram Nova-2, YouTube auto-subs (via `yt-dlp --write-auto-subs`), Local Whisper binary, FFmpeg scene detection fallback
- **Analyze**: LLM processes transcript to identify "golden moments" — high-engagement segments
- **Extract**: FFmpeg clips segments with `ffmpeg -ss START -to END -i input.mp4`
- **Caption**: Burn captions using `ffmpeg subtitles` filter or Python `capraise` library
- **Thumbnail**: FFmpeg generates frame captures, LLM selects best
- **Vertical crop**: FFmpeg `-vf "crop=ih*9/16:ih"` for 9:16 format
- **State**: `memory_store` for stats, files written to workspace

**File**: `bundled/clip/HAND.toml` (598 lines)

**Interesting**: Despite the TOML claiming "Playwright bridge", the actual implementation uses native CDP over WebSocket for browser automation. The Clip Hand uses FFmpeg + yt-dlp entirely through `shell_exec`.

**Requirements**: `ffmpeg`, `ffprobe`, `yt-dlp` (all binary requirements)

---

### 2. Lead Hand (`lead`)
**What it does**: Daily B2B lead generation — discovers prospects matching an Ideal Customer Profile (ICP), enriches them with company/person data, deduplicates, scores 0-100, delivers CSV/JSON/markdown reports.

**How it implements it**:
- **ICP construction**: From user settings (industry, role, company_size, geo_focus) stored as knowledge graph entity
- **Discovery**: 5-10 web search queries combining industry + role + growth signals
- **Enrichment** (3 levels): Basic (name/title/company), Standard (+ employee count, tech stack), Deep (+ funding, news, social)
- **Deduplication**: Normalized company+person name matching against `leads_database.json`
- **Scoring**: ICP match (+30), growth signals (+20), enrichment completeness (+20), recency (+15), accessibility (+15)
- **Knowledge graph**: Stores lead entities and company entities with `knowledge_add_entity`, links via `knowledge_add_relation`

**File**: `bundled/lead/HAND.toml` (335 lines)

**Interesting**: The Lead hand explicitly stores its ICP in the knowledge graph for cross-hand visibility. Other hands (Collector, Predictor) could theoretically query this ICP.

**Requirements**: None (all tools are built-in)

---

### 3. Collector Hand (`collector`)
**What it does**: OSINT-grade continuous monitoring of any target (company, person, technology, market). Builds a living knowledge graph, detects changes between cycles, publishes events on significant changes.

**How it implements it**:
- **Phase 0-1**: Platform detection, `memory_recall` of previous state, `knowledge_query` for existing entities
- **Phase 2**: Query construction based on `focus_area` (market/business/competitor/person/technology/general)
- **Phase 3**: Collection sweep — up to 100 sources per cycle via `web_search` + `web_fetch`
- **Phase 4**: Knowledge graph construction — entities (Person/Company/Product/Event/Number) + relations (works_at/founded/invested_in/competes_with/launched/acquired/mentioned_in)
- **Phase 5**: Change detection — compares current state against `collector_knowledge_base.json` snapshot, scores changes (critical/important/minor)
- **Phase 6**: Report generation in markdown/JSON/HTML
- **Phase 7**: State persistence

**File**: `bundled/collector/HAND.toml` (345 lines)

**Interesting**: The Collector is the primary **knowledge graph populator**. Its Phase 4 explicitly builds entities and relations that all other Einstein Hands can query. The change detection in Phase 5 is its most distinctive feature — no other Hand does differential analysis.

**Requirements**: None

---

### 4. Predictor Hand (`predictor`)
**What it does**: Superforecasting engine — collects signals from news/social/financial/academic sources, builds calibrated reasoning chains, makes falsifiable predictions with confidence intervals, tracks Brier scores over time.

**How it implements it**:
- **Phase 2**: 20-40 queries across source types; each signal tagged by type (leading/lagging/base_rate/expert_opinion), strength, direction, credibility
- **Phase 3**: Accuracy review — for each expired prediction, searches for outcome evidence, calculates Brier score `(predicted_prob - actual)^2`, updates calibration
- **Phase 4**: Reasoning chains with cognitive bias checks (anchoring, narrative bias, overconfidence, base rate neglect); contrarian mode actively seeks counter-consensus
- **Phase 5**: Prediction formulation with structured format (PREDICTION/CONFIDENCE/TIME HORIZON/REASONING CHAIN/KEY ASSUMPTIONS/RESOLUTION CRITERIA)
- **Phase 6**: Report with accuracy dashboard, Brier score, calibration analysis
- **Phase 7**: Persistence to `predictions_database.json` + `memory_store`

**File**: `bundled/predictor/HAND.toml` (381 lines)

**Interesting**: The Predictor's `track_accuracy` feature creates a genuine feedback loop — it scores its own predictions and adjusts calibration. This is the closest OpenFang gets to Hermes's learning loop concept, but it's scoped to prediction accuracy, not skill improvement.

**Requirements**: None

---

### 5. Researcher Hand (`researcher`)
**What it does**: Autonomous deep researcher — exhaustive investigation with CRAAP source evaluation, cross-referencing, fact-checking, and structured reports in multiple formats (brief/detailed/academic/executive).

**How it implements it** (8 phases, validated above):
- **Phase 1**: Question type detection (factual/comparative/causal/predictive/how-to/survey) drives query strategy
- **Phase 2**: 3-5 query strategies per sub-question (direct/expert/comparison/temporal/deep)
- **Phase 3**: CRAAP test applied to each source, scored A-F
- **Phase 4**: Cross-reference pass — claims appearing in 2+ independent sources marked verified
- **Phase 5**: Fact-check against primary sources for critical claims
- **Phase 6**: Report generation with 4 format templates
- **Phase 7**: Statistics update via `memory_store` + optional `event_publish`

**File**: `bundled/researcher/HAND.toml` (400 lines)

**Interesting**: The Researcher explicitly stores entities and relations in the knowledge graph (Phase 4), but its primary output is a human-readable report. It has the most structured output format of all Hands.

**Requirements**: None

---

### 6. Twitter Hand (`twitter`)
**What it does**: Autonomous Twitter/X account manager — generates content in one of 5 styles (professional/casual/witty/educational/provocative/inspirational), schedules posts, auto-replies to mentions, tracks engagement metrics.

**How it implements it**:
- **Phase 0-1**: Platform detection, schedule setup, style configuration
- **Phase 2**: Content generation using 7 rotating format templates (insight/citation/question/thread/story/fact/tutorial)
- **Phase 3**: Posting via Twitter API v2 (Bearer Token auth), respects `post_frequency` setting
- **Phase 4**: Engagement monitoring — auto-reply to mentions and replies if `auto_reply` enabled
- **Phase 5**: Performance tracking via `memory_store` (posts today, engagement rate, follower delta)
- **Phase 6**: Report generation

**File**: `bundled/twitter/HAND.toml` (408 lines)

**Requirements**: `TWITTER_BEARER_TOKEN` (api_key requirement)

**Interesting**: Unlike other Einstein Hands, the Twitter Hand has the highest temperature (0.7) — appropriate for creative content generation. The `auto_reply` feature creates a reactive loop where the Hand responds to incoming mentions.

---

### 7. Browser Hand (`browser`)
**What it does**: Web automation via native Chrome DevTools Protocol (CDP) over WebSocket — navigates sites, fills forms, clicks buttons, completes multi-step tasks. Mandatory purchase approval gate before any payment.

**How it implements it** (8 phases):
- **Phase 0-1**: Setup, chromium detection
- **Phase 2**: Task interpretation — decomposes natural language task into CDP commands
- **Phase 3**: Navigation loop — `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_read_page`
- **Phase 4**: **MANDATORY** purchase/payment approval gate (prompt-enforced, not code-enforced): summarizes cost, shows total, lists items, **stops and asks for user confirmation** before any payment
- **Phase 5**: Session persistence — stores browser state to resume interrupted tasks
- **Phase 6**: Report generation with screenshots
- **Phase 7**: State cleanup (`browser_close`)

**File**: `bundled/browser/HAND.toml` (254 lines)

**Requirements**: `python3` (non-optional), `chromium` (optional — can fall back to Playwright-bundled chromium)

**Critical gap**: The purchase approval gate is **system-prompt-enforced only** (see `browser/HAND.toml:146-155`). If the LLM disobeys the instruction to stop before purchases, there's no code-level enforcement. This is a prompt-injection vulnerability — a malicious webpage could potentially craft a prompt injection that convinces the LLM to skip the approval.

**Interesting**: The TOML claims "Playwright bridge" but the runtime (`crates/openfang-runtime/src/browser.rs`) uses native CDP over WebSocket. This discrepancy between TOML documentation and actual implementation was noted in R1.

---

### 8. Trader Hand (`trader`)
**What it does**: Market intelligence and trading signal analysis — multi-signal analysis, bull/bear reasoning, calibrated confidence scoring, strict risk management, portfolio-level analytics. Three modes: analysis-only, paper trading, live trading (Alpaca API).

**How it implements it**:
- **Phase 2**: Signal collection — news, financial data, technical indicators
- **Phase 3**: Bull/bear case construction with adversarial reasoning
- **Phase 4**: Risk management enforcement — position sizing, max drawdown limits, circuit breakers
- **Phase 5**: Signal generation with confidence scores
- **Phase 6**: Report generation with portfolio analytics
- **Phase 7**: Portfolio state persistence

**File**: `bundled/trader/HAND.toml` (740 lines, longest HAND.toml)

**Requirements**: None (Alpaca API keys are settings, not hard requirements)

**Interesting**: The Trader Hand has `max_iterations = 80` — the highest of any Hand. This reflects the complexity of multi-step financial analysis. Its `event_publish` tool lets it emit trading signals that other systems (or the Dashboard) can consume.

---

### 9. Infisical-Sync Hand (`infisical-sync`)
**What it does**: Bidirectional secret synchronization between a self-hosted Infisical instance and the OpenFang credential vault. Serves as the security infrastructure for all Hands that need secrets.

**How it implements it**:
- **Phase 0**: Platform detection, Infisical credentials validation via Machine Identity auth
- **Phase 1**: Initial secrets pull from Infisical → `vault_set` for each secret
- **Phase 2**: Continuous sync on configurable interval (5/15/30/60 minutes)
- **Phase 3**: Reverse sync — agent can push new secrets back to Infisical via `vault_set` → Infisical API
- **Phase 4**: Drift detection — compares local vault to Infisical, alerts on discrepancies

**File**: `bundled/infisical-sync/HAND.toml` (412 lines)

**Requirements**: `INFISICAL_URL`, `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` (all env_var requirements)

**Interesting**: The Infisical-Sync Hand is the only Hand with `runtime: python` in its SKILL.md (not `prompt_only`). Its skill content includes Python code for the Infisical API client. It uses `temperature < 0.2` — the lowest temperature of any Hand, appropriate for security-critical operations.

---

## 8. Hand Authoring — How to Write a New Hand

### Minimum Required

A Hand is a directory containing at minimum:

```
my-hand/
  HAND.toml    # Required
  SKILL.md     # Optional (recommended)
```

### HAND.toml Minimum

```toml
id = "my-hand"
name = "My Hand"
description = "What this does"
category = "productivity"  # or content/security/etc.
tools = ["shell_exec"]      # at minimum one tool

[agent]
name = "my-hand-agent"
system_prompt = "You are a my-hand agent..."
```

### Where It Goes

1. **Bundled** (compiled into binary): Add to `crates/openfang-hands/bundled/<id>/` + register in `bundled.rs`
2. **Workspace** (loaded at runtime): Install via `openfang hand install /path/to/my-hand` → stored at `~/.openfang/hands/<id>/`
3. **Marketplace** (future): Via FangHub

### What Compiles It Into the Binary

For bundled Hands, the `include_str!()` macro at `bundled.rs:6-53` embeds the TOML and SKILL.md content at compile time. Adding a new bundled Hand requires:
1. Creating `crates/openfang-hands/bundled/<id>/HAND.toml` and `SKILL.md`
2. Adding the tuple to `bundled_hands()` in `bundled.rs`
3. The Rust compiler handles the rest

The `bundled.rs:75-456` test suite enforces compile-time invariants:
- All 9 hands parse successfully
- All Einstein hands have `schedule_create/list/delete`, `memory_store/recall`, `knowledge_add_entity/relation/query`
- Infisical-Sync has all required vault tools

---

## 9. Comparison to Hermes Skills

| Aspect | OpenFang Hands | Hermes Skills |
|--------|---------------|---------------|
| **Abstraction level** | Complete agent configuration (prompt + tools + settings + state) | Domain expertise content (prompt + optional code) |
| **What it packages** | Agent manifest + multi-phase prompt + tool requirements | Knowledge base + execution runtime |
| **Lifecycle** | Static (defined at compile time, updated by file_write at runtime) | Self-improving (auto-created, curated, archived) |
| **Tool declaration** | Explicit in `tools[]` in HAND.toml | Implicit — any tool can be used |
| **Settings** | Declarative dashboard controls with schema | No declarative settings system |
| **Scheduling** | Built-in via Einstein Hand requirements | Via cron tool |
| **State management** | Multi-layer (session, KV, graph, file) | Per-provider (Honcho, Mem0, etc.) |
| **Learning loop** | None | Curator + usage tracking |
| **Multi-instance** | Yes — `instance_name` allows multiple per hand_id | Single per agent |
| **Marketplace** | FangHub (planned) | `hermes skills` CLI + curated list |
| **Compilation** | `include_str!()` embeds in Rust binary | Dynamic file loading at runtime |

### Which Is More Powerful?

**For pre-packaged autonomous agents**: OpenFang Hands are more powerful — they package the complete operational procedure, tool requirements, settings schema, and state management. Hermes skills are content-only; the agent loop, scheduling, and tool configuration are separate concerns.

**For autonomous improvement**: Hermes skills are more powerful — the curator autonomously reviews and transitions skills, tracks usage, and auto-archives stale skills. OpenFang has no equivalent.

**The fundamental architectural difference**: Hermes is an agent framework with a skill system layered on top. OpenFang is an "Agent OS" where Hands are the primary abstraction and the loop/scheduler/memory are OS-level services.

---

## Code References

| Claim | File:Line |
|-------|-----------|
| HandDefinition struct | `lib.rs:360-395` |
| HandRequirement struct | `lib.rs:111-135` |
| HandInstallInfo struct | `lib.rs:83-109` |
| HandSetting struct | `lib.rs:177-193` |
| HandAgentConfig struct | `lib.rs:276-301` |
| parse_hand_toml (flat + wrapped) | `lib.rs:325-331` |
| resolve_settings | `lib.rs:209-266` |
| bundled_hands (all 9) | `bundled.rs:6-53` |
| HandRegistry activate | `registry.rs:351-382` |
| HandRegistry pause/resume | `registry.rs:395-413` |
| HandRegistry persist_state | `registry.rs:105-123` |
| HandRegistry load_state | `registry.rs:129-155` |
| HandRegistry check_requirements | `registry.rs:448-464` |
| HandRegistry readiness | `registry.rs:536-560` |
| check_python3_available | `registry.rs:618-628` |
| check_chromium_available | `registry.rs:659-738` |
| which_binary | `registry.rs:742-760` |
| check_option_available | `registry.rs:767-791` |
| install_from_path | `registry.rs:240-289` |
| Einstein hands compile-time test | `bundled.rs:248-456` |
| Researcher system prompt | `bundled/researcher/HAND.toml:168-379` |
| Collector system prompt | `bundled/collector/HAND.toml:157-324` |
| Predictor system prompt | `bundled/predictor/HAND.toml:177-360` |
| Lead system prompt | `bundled/lead/HAND.toml:172-314` |
| Clip HAND.toml | `bundled/clip/HAND.toml:1-598` |
| Browser HAND.toml | `bundled/browser/HAND.toml:1-254` |
| Twitter HAND.toml | `bundled/twitter/HAND.toml:1-408` |
| Trader HAND.toml | `bundled/trader/HAND.toml:1-740` |
| Infisical-Sync HAND.toml | `bundled/infisical-sync/HAND.toml:1-412` |
| Researcher SKILL.md frontmatter | `bundled/researcher/SKILL.md:1-7` |
