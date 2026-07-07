# Best-of-Agent-Harnesses — Round 2 Architecture

**Deep dive into the curation framework, schema design, MCP internals, tag taxonomy, and patterns across 106 projects.**

---

## 1. The Curation Methodology

### Qualification Criteria

From `CLAUDE.md:62-67` (the curation bar):

- Skip personal repos with single-digit stars or fewer than ~10 commits.
- Skip archived/abandoned projects unless historically important.
- When a project has moved org, update `github_id` to the new canonical location.
- When an official version supersedes a community version, prefer the official.

The `projects.yaml` also sets `min_stars: 0` and `allowed_licenses: ["all"]` — so the curation bar is editorial, not automatic.

### Ranking Algorithm

From `harnesses.json:349-351`: "By relevance to harness concerns (environment, orchestration, lifecycle, guardrails) and by GitHub stars (captured 2026-07-05); each project also carries an adoption-surface tier and autonomy/recovery scores."

The ranking in the MCP server (`mcp/server.py:82-145`) is more specific: projects are scored by **token overlap** between query and (description + tags + category) × 3 + log10(stars). Curated use-case intents get priority seeding with a 100-point boost. This means curation intent overrides pure popularity.

### The "Harness Quality" Definition

The list doesn't use a single numeric "quality" score. Instead, each project gets a **5-dimensional profile**:

1. **Stars** — community traction
2. **Tier** (1-4) — adoption surface area
3. **Autonomy** (0-4) — designed autonomy regime
4. **Recovery** (0-4) — failure-recovery tier
5. **License signal** — open-source / restricted / unknown

And a **category** placement plus **capability tags**. The combination lets users filter by any dimension.

### Headless-Ready ★ and Durable ✱ Markers

- **★ Headless-ready** (`README.md:106`): "designed for unattended runs, batches, and fleets (the top of the autonomy scale: step-gated → checkpoint-gated → bounded → headless)."
- **✱ Durable** (`README.md:107`): "persisted execution state survives restarts mid-task (the top of the recovery scale: none → retry → resumable → durable)."

These are the two most discriminative markers — only 8 projects are headless-ready (`llms.txt:71`), and only 8 are durable (`llms.txt:74`).

---

## 2. Schema Design

### `harnesses.json` — Operational Schema

The JSON schema has these key design decisions:

**Meta block** (`harnesses.json:2-35`): Contains versioned tier definitions, making the schema self-describing. The `tiers`, `autonomy_tiers`, and `recovery_tiers` arrays encode the ordinal ranking (position in array = rank). Each has a `_help` string for human readers.

**Use cases block** (`harnesses.json:88-236`): 14 curated intents with hand-picked `github_id` arrays. The MCP server uses this for intent-based seeding. Each intent also has a `category_title` for breadcrumb navigation.

**FAQ block** (`harnesses.json:238-358`): 13 Q&A entries with three kinds: `use-case` (maps to an intent), `derived` (computed from data), and `concept` (definitional). Each has a slug for deep linking.

**Comparisons block** (`harnesses.json:360-395`): 5 entries with slug, title, summary, url, and raw_url. The MCP server can fetch the full markdown lazily.

**Projects array** (`harnesses.json:397-3380`): 106 entries with consistent schema. Key design choices:
- `github_id` as primary key (owner/repo format)
- `tier_rank` alongside `tier` for numerical filtering
- `autonomy_rank`/`recovery_rank` alongside `autonomy`/`recovery` for same reason
- `license_signal` as a normalized three-value enum instead of raw license name
- `example` as a single curated link (not a docs root)
- `page_url` for the generated GitHub Pages site
- `slug` and `anchor_url` for linkability

**Graveyard block** (`harnesses.json:3381-3406`): Preserves archival date and last-known star count for removed projects.

### `harnesses.jsonld` — Semantic Schema

Uses `schema.org/Dataset` as root (`harnesses.jsonld:2-3`):

```json
{
  "@context": "https://schema.org",
  "@type": "Dataset",
  "mainEntity": {
    "@type": "ItemList",
    "numberOfItems": 106,
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "item": {
          "@type": "SoftwareApplication",
          "name": "...",
          "applicationCategory": "DeveloperApplication",
          "keywords": "ide"
        }
      }
    ]
  }
}
```

**Differences from harnesses.json:**
- No ranks, tiers, autonomy, or recovery data
- No use-case index
- No FAQ or comparisons
- Projects are wrapped in `schema:ListItem` with `position`
- Uses `schema:SoftwareApplication` type with `applicationCategory: "DeveloperApplication"`
- Keywords are comma-separated strings (not arrays)

**Why both?** `harnesses.json` is the operational data layer for agents, MCP server, and site generation. `harnesses.jsonld` is the public-facing semantic web layer for search engine indexing. The operational data has editorial judgments (tiers, autonomy regimes) that would be inappropriate for schema.org consumption.

### The Capability Tag Vocabulary

From `scripts/generate.py:38-61` (the `TAG_RULES` list), the 22 canonical tags ordered by discriminative value:

1. **mcp** — MCP, Model Context Protocol, MCPs
2. **memory** — memory, session bridging, session capture, persistent, long-horizon, stateful
3. **multi-agent** — multi-agent, crew, swarm, squad, sub-agent, handoffs, group chat
4. **evals** — eval/evals/evaluation, benchmark, SWE-bench, scoring, trace reasoning, judges
5. **voice** — voice
6. **vision** — vision, screenshots, LMMs, GPT-4V, multimodal
7. **browser** — browser, Playwright, Puppeteer, headless
8. **sandbox** — sandbox, Docker, E2B, Firecracker, isolated
9. **low-code** — low-code, drag-drop, visual DAG/workflow/bot, no-code, DAG
10. **rag** — RAG, retrieval-augmented/first, hybrid search, knowledge graph
11. **tool-discovery** — tool discovery/retrieval/routing/search, on-demand tool, semantic routing
12. **training** — training, RL, reinforcement, rollout, train agents/policies
13. **workflow** — workflow, state-machine, checkpointing, durable exec, graphs
14. **typed** — type-safe, Pydantic, TypeScript-first, decorators for tools
15. **local** — self-hosted, Ollama, on-prem, run locally/on your laptop
16. **provider-agnostic** — provider-agnostic, multi-provider, 100+ LLMs/models, any LLM, swap OpenAI vs Anthropic
17. **cli** — CLI, terminal
18. **ide** — IDE, VS Code, Cursor, JetBrains
19. **tui** — TUI, Bubble Tea
20. **rust** — Rust
21. **python** — Python
22. **typescript** — TypeScript, Node.js/TS, TS

Tags are **auto-derived** from each project's description + axis string via regex patterns (`generate.py:70-80`). Projects can override with `extra_tags`. The `MAX_TAG_CHIPS = 5` limit keeps descriptions scannable (`generate.py:67`).

---

## 3. The MCP Server Internals

Located at `mcp/server.py`. 228 lines. Uses `mcp.server.fastmcp`.

### Data Loading

```python
def data() -> dict:
    global _data
    if _data is None:
        local = Path(__file__).resolve().parent.parent / "harnesses.json"
        if local.exists():
            _data = json.loads(local.read_text())
        else:
            with urllib.request.urlopen(DATA_URL, timeout=15) as r:
                _data = json.loads(r.read().decode())
    return _data
```

Three design decisions:
- **Lazy loading**: Data isn't loaded until the first tool call
- **Local-first**: Tries local filesystem before fetching from GitHub
- **Cache once**: Module-level `_data` global caches after first load

### Token Matching

```python
_STOP = {"i", "a", "an", "the", "to", "for", "of", "in", "on", "with", "and",
         "or", "my", "me", "want", "need", "agent", "agents", "ai", "llm"}

def _tokens(text: str) -> set:
    return {w for w in re.findall(r"[a-z0-9+#-]+", text.lower()) if w not in _STOP}

def _overlap(q: set, hay: set) -> set:
    hits = set()
    for w in q:
        for h in hay:
            if w == h or (len(w) >= 4 and len(h) >= 4 and (w.startswith(h) or h.startswith(w))):
                hits.add(w)
                break
    return hits
```

Notable: "agent", "agents", "ai", and "llm" are stop words — they're too generic. The inflection tolerance (4+ char prefix matching) handles "benchmark/benchmarks" and "evaluate/evaluates" without stemming.

### Scoring Formula (for `pick_harness`)

```
score = token_overlap * 3 + log10(max(stars, 2))
```

With **seeded boosting** for curated intents: hand-picked projects get `100 - rank` score (descending by position in the curated list). This ensures editorial curation always beats keyword matching for common queries.

### Filter Chain

```
1. max_complexity tier check  (skip if tier_rank > max_rank)
2. min_autonomy check         (skip if autonomy_rank < min_a)
3. min_recovery check         (skip if recovery_rank < min_r)
4. open_source_only check     (skip if license_signal != "open-source")
5. Token overlap check        (skip if no overlap and not seeded)
```

### Brief Response Shape

```python
{
    "name", "github_id", "url", "page_url", "stars", "tier",
    "autonomy", "recovery", "license_signal", "category",
    "description", "tags",
    "why": "reason string"   // only in pick_harness
}
```

### Comparison Tool Design

`list_comparisons` returns metadata from `harnesses.json`. `get_comparison(slug)` loads the full markdown — either locally from `comparisons/{slug}.md` or from the raw GitHub URL. This means the MCP server can serve full decision guides without bundling them into the JSON.

---

## 4. The Decision Pages — Deep Analysis

### "How to Pick a Harness" — The 6 Questions

This is the most architecturally significant document (`comparisons/how-to-pick-a-harness.md`). Its six questions form a decision tree:

**Q1: "What do you actually want it to do?"** — Maps to the 14 curated use cases. The first elimination step.

**Q2: "How much do you want to adopt?"** — Maps to the simplicity↔capability tier. The key insight: "Pick the *lowest* tier that solves the job." This is an anti-Not-Invented-Here philosophy — prefer skill packs on existing harnesses over new frameworks.

**Q3: "How much rope does it need?"** — Maps to the autonomy axis. A crucial framing: "autonomy is co-constructed — the harness's approval defaults shape real-world behavior as much as the model does."

**Q4: "What happens when it breaks?"** — Maps to the recovery axis. "A headless harness with no recovery story is an incident generator."

**Q5: "Who pays for the tokens?"** — The **post-June 2026 billing reality**. This is the most novel question — unique to this list. It captures the industry shift where programmatic agent usage now draws from separate credit pools.

**Q6: "Can you walk away from it?"** — Portability. Prefers open formats, standard protocols, permissive licenses.

The three worked examples show how to apply all six questions to real scenarios.

### "OpenClaw vs Hermes" — The Design Philosophy War

The comparison identifies the root architectural split (`openclaw-vs-hermes.md:11`):

- **OpenClaw** optimizes for **presence** — one event loop treating messages, heartbeats, crons, and webhooks as a single input queue. Unbounded memory of the user. Feels like a person.
- **Hermes** optimizes for **discipline** — separated execution domains, bounded user model (~3k chars), script-gated wake-ups. Feels like a harness, by design.

The field reports section (`openclaw-vs-hermes.md:27-30`) provides **four primary-source claims** with attribution and caveats:

1. Migration is driven by update churn, not features (OpenClaw's 82 releases vs Hermes's 6)
2. The learning loop is real and double-edged (good patterns get automated, bad ones get "etched in stone")
3. Run-both consensus (orchestrator/executor pattern over ACP with mutual repair)
4. Trust the threads less than usual (astroturfing concerns)

The billing section (`openclaw-vs-hermes.md:34-41`) explains the April→June 2026 Anthropic policy changes and the three-field-validated cost optimization hierarchy: wake less → two-tier routing → slim the tool list.

### "Terminal Coding Agents" — The Harness Over UI Insight

The key architectural insight (`terminal-coding-agents.md:5`): "What actually differs between them is the **harness** — the agent loop, provider wiring, sandboxing, and extension model — not the chat-in-a-terminal experience, which has converged."

This is the list's core taxonomy in action: it separates the **harness** from the **shell** or **UI**.

### "Multi-Agent Orchestration" — Coordination Models

Four architectural patterns (`multi-agent-orchestration.md:8`): handoffs, roles, conversational group chat, and explicit state machines. The key warning: "Picking wrong here is expensive: the coordination model shapes your whole codebase."

The "unfashionable default" section (`multi-agent-orchestration.md:26`) is a healthy reality check: most multi-agent use cases are "one orchestrator delegating to stateless sub-tasks" — expressible with a `for` loop.

### "Agent Memory Layers" — Ownership Model

The framing question (`memory-layers.md:26`): "Who owns the memory?" Application-owned → Mem0. Agent-owned → Letta. Harness-owned → claude-mem. This is a clean architectural classification by ownership boundary.

---

## 5. Tags Taxonomy — Full Cross-Reference

From `TAGS.md:10`, the 22 tags with project counts:

| Tag | Projects | Top Representative |
|-----|----------|-------------------|
| `mcp` | 20 | opencode (183k) |
| `memory` | 18 | claude-mem (85.9k), Mem0 (60.1k) |
| `multi-agent` | 19 | ECC (226k), MetaGPT (69.2k) |
| `evals` | 14 | AutoGPT (185k), SWE-bench (5.3k) |
| `voice` | 2 | rasa (21.2k), openai-agents-js (3.3k) |
| `vision` | 2 | R2R (7.9k), WebVoyager (1.1k) |
| `browser` | 4 | OpenHands (79.5k), browser-use (103k) |
| `sandbox` | 17 | Codex (95.6k), Daytona (72.3k) |
| `low-code` | 4 | langflow (151k), Dify (148k) |
| `rag` | 4 | Dify (148k), llama-index (50.7k) |
| `tool-discovery` | 5 | MCP-Zero (488), Composio (29.1k) |
| `training` | 4 | Agent Lightning (17.4k) |
| `workflow` | 6 | n8n (195k), langgraph (36.5k) |
| `typed` | 3 | mastra (25.8k), pydantic-ai (18.2k) |
| `local` | 1 | n8n (195k) |
| `provider-agnostic` | 8 | opencode (183k), LiteLLM (52.7k) |
| `cli` | 8 | opencode (183k), Gemini CLI (106k) |
| `ide` | 4 | awesome-cursorrules (40.2k), Cline (64.3k) |
| `tui` | 2 | opencode (183k), crush (26.1k) |
| `rust` | 2 | goose (50.7k), claw-code-agent (524) |
| `python` | 61 | 61 of 106 projects |
| `typescript` | 25 | 25 of 106 projects |

### How Tags Are Assigned

Tags are **auto-derived** from description text via regex in `generate.py:38-61`. The tag rules are ordered by "discriminative value (most useful first)" — architectural/functional tags (mcp, memory, multi-agent) come before implementation tags (python, typescript). The ordering determines display order in README tag chips.

### Tag Combinations in Use Cases

The most common tag combinations reveal architectural clusters:
- `mcp` + `multi-agent` + `python`/`typescript` — the modern agent stack
- `sandbox` + `evals` — evaluation infrastructure
- `memory` + `multi-agent` — stateful orchestration
- `memory` + `cli` + `python` — personal agent toolchains

---

## 6. All 10 Categories — Top Projects

| Category | Count | Top Project | Stars | Key Theme |
|----------|-------|-------------|-------|-----------|
| Progressive disclosure harnesses | 6 | awesome-cursorrules | 40.2k | Formats that reveal tools in layers |
| Coding agent products | 9 | opencode | 183k | Turnkey terminal/IDE agents |
| Coding harness configs and SDKs | 9 | superpowers | 247k | Skill packs and SDKs |
| Personal agent runtimes | 7 | OpenClaw | 382k | Always-on daemons |
| Frameworks | 23 | n8n | 195k | General LLM app platforms |
| Multi-agent and orchestration | 8 | MetaGPT | 69.2k | Multi-agent coordination |
| Plugins, MCPs, CLI tools | 12 | claude-mem | 85.9k | IDE plugins and MCP servers |
| Evaluation and benchmarking | 16 | Agent Lightning | 17.4k | Agent eval systems |
| Research and task-specific | 2 | gpt-researcher | 28.1k | Deep research agents |
| Libraries and SDKs | 14 | Daytona | 72.3k | Lightweight primitives |

**New entrants vs established:** The list captures 2026's most dynamic categories. Coding agent products (opencode at 183k, Gemini CLI at 106k) and personal agent runtimes (OpenClaw at 382k, Hermes at 210k) are the fastest-growing. Frameworks (23 projects) is the largest but most mature category.

---

## 7. The "Agent Harness" Definition — Extended Analysis

From `README.md:25-27`, the full definition:

> A model answers; an agent acts. An agent harness is the runtime that turns one into the other — the model thinks; the harness decides what that thinking is allowed to touch.

And the extended essay:

> Architecturally, it plays the role the kernel played in operating systems or the controller played in industrial robotics — mediating between raw capability and a messy environment — but with a critical difference: the "capability" it governs is general-purpose cognition, which means the harness is simultaneously a scheduler, a permission system, a memory manager, and a policy enforcement layer, all under-specified and evolving in real time.

### Metaphors Decoded

- **Kernel (OS)**: The harness mediates between "software" (the model's cognition) and "hardware" (the outside world), just as an OS kernel mediates between applications and hardware.
- **Controller (industrial robotics)**: The harness translates goals into tool-using, error-recovering sequences, just as a robot controller translates high-level commands into motor movements with sensor feedback.
- **Scheduler**: Decides when the model acts, what order, and how to interleave concurrent tasks.
- **Permission system**: Decides what the model is allowed to touch (files, networks, APIs, money).
- **Memory manager**: Decides what the model remembers across turns (working memory, episodic memory, persistent storage).
- **Policy enforcement layer**: Decides which rules the model must follow (rate limits, cost controls, safety constraints, organizational policies).

### The Critical Difference

The essay emphasizes that unlike an OS kernel (which governs deterministic capability) or a robot controller (which governs physical capability), the agent harness governs **general-purpose cognition**. This means:
- The boundaries of what it governs are under-specified (what does "safe" mean?)
- The rules evolve in real time (the model learns, the environment changes)
- The harness must be simultaneously binding (preventing harm) and flexible (enabling novel behavior)

---

## 8. Patterns Extracted from the 106 Projects

### Recurring Architectural Patterns

1. **Tool-call loop** — The foundational pattern: model generates structured tool calls, harness executes them, results fed back to model. Used by ~80% of projects.

2. **Agent loop with permission gates** — The tool-call loop augmented with human approval at each step (step-gated) or at checkpoints (checkpoint-gated). Used by Cline, Aider, Open Interpreter.

3. **State machine / graph** — Explicitly defined transitions between LLM-calling nodes with persistent state. LangGraph, n8n, Microsoft Agent Framework.

4. **Event loop with input queue** — Messages, heartbeats, crons, webhooks as unified events. OpenClaw, Hermes, personal agent runtimes.

5. **Memory hierarchy** — Working memory / episodic memory / persistent storage with retrieval. Letta (MemGPT), Mem0, claude-mem.

6. **Progressive disclosure** — Index first, details on demand. AGENTS.md, MCP-Zero, ToolGen, langgraph-bigtool.

7. **Multi-agent handoff** — Agents transfer control via call-center escalation (OpenAI Agents SDK), role-based collaboration (CrewAI), or conversational group chat (AutoGen).

8. **Plugin/skill ecosystem** — The harness loads skills/plugins from a directory or registry. superpowers, ECC, Anthropic Skills, ClawHub (OpenClaw's 13,700+ skills).

### Common API Shapes

- **Use tool(): `{"type": "function", "name": "...", "input": {...}}`** — The MCP / OpenAI function-calling convention
- **Use decorators: `@tool`, `@agent`, `@workflow`** — Python DSL pattern (pydantic-ai, strands-agents)
- **Use YAML/JSON config: `config.yaml`** — Declarative agent definition (SWE-agent, n8n)
- **Use graph builder: `StateGraph` / `add_node` / `add_edge`** — LangGraph's explicit graph construction
- **Use role/crew: `Agent(role="...", goal="...")`** — CrewAI's declarative role definition

### Common Deployment Topologies

- **CLI local** — Installed and run on user's machine (opencode, Codex, Gemini CLI)
- **Docker sandbox** — Self-hosted in Docker, optionally with web UI (OpenHands, Agent Zero)
- **Daemon + chat app** — Runs as background service, interfaced via messaging APIs (OpenClaw, Hermes, Khoj)
- **Cloud hosted** — Serverless (Cloudflare Agents) or managed (E2B, Daytona)
- **IDE extension** — VS Code / JetBrains plugin (Cline, Continue)
- **Library dependency** — Imported as a package in user's codebase (langgraph, pydantic-ai, CrewAI)

### Common Failure Modes Addressed by the List

1. **Model hallucination** → tool verification, sandboxed execution, permission gates
2. **Infinite loops** → step limits, cost budgets, human-in-the-loop
3. **Token bloat** → progressive disclosure, context management, tool retrieval
4. **Crash/lost state** → checkpointing, durable execution, session persistence
5. **Cost explosion** → routing by model tier, budget caps, open-weight alternatives
6. **Lock-in** → open formats (AGENTS.md, SKILL.md), standard protocols (MCP), permissive licenses

---

## 9. Lessons for Bizar

### How the Curation Is Organized

The best-of-Agent-Harnesses curation framework is a template others can fork and adapt (`create-best-of-list.md`). The key organizational decisions:

- **One source of truth** (`generate.py`) that produces all derived outputs
- **Two-flow design** (API refresh → editorial judgment) keeping human oversight in the loop
- **Structured data first** (`harnesses.json`) with flat-text (`llms.txt`) and semantic-web (`harnesses.jsonld`) as derived views
- **Decision guides** are separate markdown documents, referenced but not embedded in the data

### Tag Taxonomy Reuse for Bizar

The tag vocabulary is clean, well-ordered, and auto-derived from descriptions. Bizar could adopt a similar pattern:

- **Architectural tags** (mcp, memory, multi-agent, sandbox, workflow) — map to capability concerns
- **Language tags** (python, typescript, rust) — map to implementation language
- **Platform tags** (cli, ide, tui, low-code) — map to UI/integration surface
- **Domain tags** (evals, training, rag, tool-discovery) — map to use case

The auto-tagging through regex patterns is low-maintenance and could be adapted for Bizar's own module documentation.

### Comparison Page Structure

Each comparison follows a consistent template:
1. **Header** with claim and scope
2. **Comparison table** with key dimensions
3. **"Pick by situation"** sections with concrete recommendations
4. **Shared/commonalities** section
5. **Footer** with attribution and reference

This pattern is directly reusable for Bizar's own technology decision documentation.

### MCP Server as a Discovery Layer

The MCP server is the most architecturally interesting component for Bizar. It provides:

- **Tool-based discovery** — agents don't parse markdown, they call `pick_harness`
- **Structured filtering** — complexity, autonomy, recovery as first-class filter dimensions
- **Curated seeding** — editorial picks boosted above keyword matches
- **Lazy comparison loading** — decision guides fetched on demand from markdown

Bizar could build a similar MCP server for its own harness capabilities — exposing project initialization, agent dispatch, and module discovery as structured tools.

### The 6-Question Decision Framework

The "How to pick a harness" framework is a generalizable pattern for any technology selection:
1. Define the job (not the tool)
2. Minimize adoption surface area
3. Match risk tolerance to guarantees
4. Plan for failure
5. Account for ongoing costs (especially the hidden ones)
6. Ensure exit is possible

This framework could be adapted for Bizar's own technology selection documentation.

---

## Key Insights Summary

1. **104 projects + 4 graveyard**, spanning 10 categories from "super simple" formats to "complex" product suites
2. **5-dimensional project profile**: stars, tier, autonomy, recovery, license
3. **22 canonical tags** auto-derived from descriptions, ordered by discriminative value
4. **14 curated use-case intents** with hand-picked picks — the strongest signal for recommendations
5. **MCP server with 6 tools**: dual-path scoring (curated intent boost + token overlap + log stars)
6. **JSON + JSON-LD duality**: operational data (harnesses.json) vs semantic web (harnesses.jsonld)
7. **Two-flow automation pipeline**: Flow 1 (API) → curation-queue.json → Flow 2 (editorial)
8. **5 comparison guides** following a consistent architectural template
9. **Post-June 2026 billing reality** is an explicit decision dimension unique to this list
10. **The kernel/controller framing** positions agent harnesses as the emerging OS layer for AI
