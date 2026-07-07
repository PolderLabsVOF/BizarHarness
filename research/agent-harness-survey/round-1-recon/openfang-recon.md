# OpenFang Reconnaissance Report

**Repository**: `repos/openfang/` — Built by **RightNow-AI** (Jaber, Founder)
**Version**: 0.6.9 | **License**: MIT / Apache-2.0 | **Language**: Rust
**Location**: `/home/drb0rk/Projects/BizarHarness/research/agent-harness-survey/repos/openfang/`

---

## 1. Project Identity & Claims

OpenFang positions itself as an **"Agent Operating System"** — not a chatbot framework, not a Python wrapper around an LLM, and not a "multi-agent orchestrator." It is a full operating system for autonomous agents, built from scratch in Rust. The tagline is *"Agents that actually work for you"* — meaning they run on schedules, 24/7, without prompting.

### Key Claims (from README.md:8-10)

| Metric | Claimed Value |
|--------|-------------|
| LOC | 137,728 lines of Rust |
| Crates | 14 (13 code + xtask) |
| Tests | 1,767+ (readme says "2,696+ passing" in badge at line 23) |
| Binary size | ~32 MB single binary |
| Clippy | Zero warnings enforced |
| Bundled Hands | 7 (but actually 9 per bundled.rs) |
| Channel Adapters | 40 |
| LLM Providers | 27 (123+ models) |
| Built-in Tools | 53 + MCP + A2A |
| Security Layers | 16 |
| Cold Start | 180ms claimed |
| Idle Memory | 40 MB claimed |

### Actual Code Statistics (measured)

```
Total Rust LOC:     ~198,748 across all .rs files
openfang-runtime:    51,734  (largest crate — agent loop, tools, drivers)
openfang-channels:   33,689  (40 messaging adapters)
openfang-cli:        30,891  (CLI, TUI, MCP server mode)
openfang-api:        23,422  (REST/WS/SSE server + dashboard)
openfang-kernel:     21,691  (orchestration, RBAC, metering, scheduler)
openfang-types:      13,781  (core types, errors, config)
openfang-migrate:     5,498  (OpenClaw migration)
openfang-skills:      5,063  (skill system)
openfang-memory:      4,468  (SQLite substrate)
openfang-extensions:  2,888  (MCP templates, vault, OAuth)
openfang-hands:       2,731  (Hands system)
openfang-wire:        1,946  (OFP P2P protocol)
openfang-desktop:       946  (Tauri 2.0 desktop app)
```

### The "Agent OS" Positioning — Technical Meaning

The OS metaphor runs deep. OpenFang provides:

1. **Kernel** (`openfang-kernel`): Process scheduler, RBAC, metering, event bus, workflow engine — analogous to an OS kernel
2. **Process isolation** (`openfang-runtime`): WASM sandbox with dual metering (fuel + epoch), subprocess `env_clear()`, capability-based permissions
3. **Memory management** (`openfang-memory`): SQLite substrate with six storage layers (KV, vector, graph, session, task board, usage)
4. **Device drivers** (`openfang-channels`): 40 messaging channel adapters (like device drivers for communication platforms)
5. **Networking stack** (`openfang-wire`): OFP protocol for P2P agent communication
6. **File system**: Workspace management per agent
7. **Startup/shutdown**: `openfang init`, `openfang start`, graceful shutdown with state persistence

The **"Hands"** are analogous to built-in applications in an OS — pre-installed, ready-to-run autonomous workers.

---

## 2. Cargo Workspace Structure

From `Cargo.toml:3-18`:

### Full Crate Descriptions

| Crate | Description | Key Dependencies |
|---|---|---|
| **openfang-types** | Core types: `AgentManifest`, `AgentId`, `Capability`, `Event`, `ToolDefinition`, `KernelConfig`, `OpenFangError`, taint tracking (`TaintLabel`, `TaintSet`), Ed25519 manifest signing, model catalog types, tool compatibility (21 OpenClaw-to-OpenFang mappings) | serde, chrono, uuid, ed25519-dalek, sha2 |
| **openfang-memory** | SQLite-backed memory substrate (schema v5). KV store, vector embeddings (cosine similarity), knowledge graph (entities + relations), session management, task board, usage events, canonical sessions for cross-channel memory. Uses `Arc<Mutex<Connection>>` + `spawn_blocking` for async bridge. | rusqlite, rmp-serde, reqwest (optional) |
| **openfang-runtime** | Agent execution engine. Agent loop (`run_agent_loop`, `run_agent_loop_streaming`), 3 native LLM drivers (Anthropic, Gemini, OpenAI-compat covering 20 providers), 53 built-in tools, WASM sandbox (Wasmtime dual fuel+epoch), MCP client/server, A2A protocol, web search (Tavily/Brave/Perplexity/DDG), web fetch (SSRF-protected), loop guard (SHA256-based), session repair, Merkle hash chain audit trail, embedding driver. | wasmtime, rmcp (MCP SDK), reqwest, rusqlite |
| **openfang-wire** | OpenFang Protocol (OFP) — P2P agent-to-agent networking over TCP with JSON-framed messages. HMAC-SHA256 mutual authentication (nonce + constant-time verify via `subtle`). `PeerNode` + `PeerRegistry`. | hmac, sha2, subtle |
| **openfang-kernel** | Central coordinator. `OpenFangKernel` assembles: `AgentRegistry`, `AgentScheduler`, `CapabilityManager`, `EventBus`, `Supervisor`, `WorkflowEngine`, `TriggerEngine`, `BackgroundExecutor`, `WasmSandbox`, `ModelCatalog`, `MeteringEngine`, `ModelRouter`, `AuthManager` (RBAC), `HeartbeatMonitor`, `SetupWizard`, `SkillRegistry`. Implements `KernelHandle` for inter-agent operations. | cron (cron parsing), crossbeam, dashmap |
| **openfang-api** | HTTP API server (Axum 0.8). 76+ REST/WS/SSE endpoints. OpenAI-compatible API (`POST /v1/chat/completions`, `GET /v1/models`). A2A endpoints. Static web dashboard embedded in the binary. Middleware: Bearer auth, GCRA rate limiter, security headers, health redaction. | axum, tower-http, governor, argon2 |
| **openfang-cli** | Clap-based CLI binary (`openfang`). Commands: `init`, `start`, `stop`, `status`, `doctor`, `agent`, `workflow`, `trigger`, `migrate`, `skill`, `channel`, `hand`, `config`, `chat`, `dashboard`, `mcp`, `add`, `remove`, `vault`, `new`, `models`, `cron`, `uninstall`. Daemon auto-detect: checks `~/.openfang/daemon.json`, falls back to in-process kernel. | clap, ratatui, reqwest (blocking) |
| **openfang-channels** | 40 channel adapters implementing `ChannelAdapter` trait. Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Email (IMAP/SMTP), SMS, Webhook, Teams, Mattermost, IRC, Google Chat, Twitch, Rocket.Chat, Zulip, XMPP, LINE, Viber, Messenger, Reddit, Mastodon, Bluesky, Feishu, Revolt, Nextcloud, Guilded, Keybase, Threema, Nostr, Webex, Pumble, Flock, Twist, Mumble, DingTalk, Discourse, Gitter, Ntfy, Gotify, LinkedIn. Features: `AgentRouter`, `BridgeManager`, `ChannelRateLimiter`, `formatter.rs`, `ChannelOverrides` (model/system_prompt/DM-policy/group-policy/rate-limit/threading/output-format). | reqwest, tokio-tungstenite, lettre, imap, rumqttc |
| **openfang-migrate** | Migration engine for importing from OpenClaw and other frameworks. Converts YAML → TOML, maps tool names, maps provider names, imports agent manifests, copies memory files, converts channel configs. Framework stubs for LangChain and AutoGPT. | serde_yaml, json5, walkdir |
| **openfang-skills** | Skill system: 60 bundled skills compiled via `include_str!()`, FangHub marketplace, ClawHub cross-ecosystem compat. `SkillManifest` (TOML), `SkillRegistry`, SHA256 verification, prompt injection scanner. Skill types: Python, Node.js, WASM, PromptOnly. | zip (archive extraction), reqwest, sha2 |
| **openfang-desktop** | Tauri 2.0 desktop app. Boots kernel in-process, runs Axum on background thread, WebView at `http://127.0.0.1:{random_port}`. System tray, single-instance enforcement, desktop notifications, hide-to-tray. | tauri 2, tauri-plugin-notification, notification, shell, single-instance, dialog, global-shortcut, autostart, updater |
| **openfang-hands** | Hand system: 9 bundled autonomous capability packages. `HandDefinition`, `HandRegistry`, `HAND.toml` parser, `HandCategory` enum (Content, Security, Productivity, Development, Communication, Data, Finance, Other), requirement checking (binary on PATH, env var, API key). | dashmap, sha2 |
| **openfang-extensions** | Extension/integration system. 25 MCP server templates, AES-256-GCM credential vault, OAuth2 PKCE flow. "One-click" MCP server setup (`openfang add github`). | aes-gcm, argon2, zeroize, reqwest |
| **xtask** | Build automation (cargo-xtask pattern). | (build tools) |

### Workspace-Level Dependencies (Cargo.toml:27-157)

Key workspace dependencies:
- **Async runtime**: tokio (full features), tokio-stream
- **Web server**: axum 0.8, tower, tower-http
- **Database**: rusqlite 0.31 (bundled, serde_json feature)
- **WASM**: wasmtime 43
- **Security**: sha2, ed25519-dalek, hmac, zeroize, subtle, aes-gcm, argon2
- **CLI**: clap 4, ratatui 0.29 (TUI dashboard), colored
- **MCP**: rmcp 1.2 (official Rust MCP SDK with client, stdio, SSE transports)
- **HTTP client**: reqwest 0.12 (rustls-tls, streaming, multipart)
- **Rate limiting**: governor 0.10 (GCRA algorithm)
- **Serialization**: serde, serde_json, toml 0.9, rmp-serde (MessagePack)
- **Cron**: cron 0.16
- **Concurrency**: dashmap 6, crossbeam 0.8

### Profile Configuration (Cargo.toml:159-170)

```toml
[profile.release]
lto = true
codegen-units = 1
strip = true
opt-level = 3
```

`release-fast` profile uses thin-LTO and codegen-units=8 for faster iteration.

---

## 3. The "Hands" Concept

Hands are OpenFang's core innovation — pre-built autonomous capability packages that run independently on schedules. They are "agents that work for you" rather than chatbots you prompt.

### HAND.toml Manifest Format

From `crates/openfang-hands/src/bundled/researcher/HAND.toml` and the parsed struct in `crates/openfang-hands/src/lib.rs:38-108`:

```toml
id = "researcher"
name = "Researcher Hand"
description = "Autonomous deep researcher..."
category = "productivity"    # Content, Security, Productivity, Development, Communication, Data, Finance, Other
icon = "\U0001F9EA"
tools = ["shell_exec", "file_read", "file_write", ..., "knowledge_query", "event_publish"]

# Declare external dependencies
[[requires]]
key = "python3"
label = "Python 3 must be installed"
requirement_type = "binary"  # binary, env_var, or api_key
check_value = "python3"

[requires.install]
macos = "brew install python3"
linux_apt = "sudo apt install python3"
manual_url = "https://www.python.org/downloads/"

# Configurable settings (rendered in dashboard)
[[settings]]
key = "research_depth"
label = "Research Depth"
setting_type = "select"     # select, toggle, text
default = "thorough"

[[settings.options]]
value = "thorough"
label = "Thorough (20-30 sources, cross-referenced)"

[agent]
name = "researcher-hand"
module = "builtin:chat"     # builtin:chat, wasm:..., python:...
provider = "default"        # or override: "openai"
model = "default"           # or override: "gpt-4o"
max_tokens = 16384
temperature = 0.3
max_iterations = 25
heartbeat_interval_secs = 120
system_prompt = """... (multi-phase operational playbook) ..."""

[dashboard]
[[dashboard.metrics]]
label = "Queries Solved"
memory_key = "researcher_hand_queries_solved"
format = "number"
```

### Multi-Phase System Prompts

Each Hand's system prompt is a **500+ word expert procedure** divided into numbered phases. For example, the Researcher Hand has 7 phases:

- **Phase 0** — Platform Detection & Context
- **Phase 1** — Question Analysis & Decomposition (factual, comparative, causal, predictive, how-to, survey)
- **Phase 2** — Search Strategy Construction (direct, expert, comparison, temporal, deep queries)
- **Phase 3** — Information Gathering Core Loop (with CRAAP source evaluation)
- **Phase 4** — Cross-Reference & Synthesis (source_verification enabled)
- **Phase 5** — Fact-Check Pass (confidence levels: Verified, Likely, Unverified, Disputed)
- **Phase 6** — Report Generation (brief, detailed, academic, executive styles)
- **Phase 7** — State & Statistics (memory_store for dashboard metrics)

The Clip Hand has 8 phases: Intake → Download → Transcribe → Analyze → Extract → TTS (optional) → Publish (optional) → Report.

### SKILL.md Format

Each Hand bundles a `SKILL.md` providing domain expertise reference injected into the LLM context at runtime. The skill content is embedded via `include_str!("../bundled/<id>/SKILL.md")` at compile time (`crates/openfang-hands/src/bundled.rs:10-12`).

### Guardrails System

Guardrails are approval gates for sensitive actions. The Browser Hand enforces a **mandatory purchase approval gate**:
```markdown
## Phase 4 — MANDATORY Purchase/Payment Approval
**CRITICAL RULE**: Before completing ANY purchase, payment, or form submission
that involves money:
1. Summarize what you are about to buy/pay for
2. Show the total cost
3. List all items in the cart
4. STOP and ask the user for explicit confirmation
5. Only proceed after receiving clear approval
```
(Sourced from `bundled/browser/HAND.toml:146-155`)

### All 9 Bundled Hands

| Hand ID | Name | Description | Category | Max Iterations | Temperature | Key Tools |
|---------|------|-------------|----------|----------------|-------------|-----------|
| **clip** | Clip Hand | YouTube → vertical shorts pipeline (8 phases). FFmpeg + yt-dlp + 5 STT backends | Content | 40 | 0.4 | shell_exec, file_read, file_write, file_list, web_fetch |
| **lead** | Lead Hand | Daily B2B lead generation. Discovers prospects matching ICP, enriches, scores 0-100 | Data | — | <0.5 | web_search, web_fetch, memory, knowledge_graph, schedule |
| **collector** | Collector Hand | OSINT-grade monitoring. Change detection, sentiment tracking, knowledge graph construction | Data | — | — | event_publish, memory, knowledge_graph, schedule |
| **predictor** | Predictor Hand | Superforecasting engine. Brier scores, contrarian mode, confidence intervals | Data | — | 0.5 | web_search, memory, knowledge_graph, schedule |
| **researcher** | Researcher Hand | Deep autonomous researcher. CRAAP criteria, cross-referencing, APA format | Productivity | 25 | 0.3 | web_search, web_fetch, shell_exec, file, memory, knowledge_graph, schedule |
| **twitter** | Twitter Hand | Autonomous Twitter/X account manager. 7 rotating formats, engagement scheduling | Communication | — | 0.7 | event_publish, memory, knowledge_graph, schedule |
| **browser** | Browser Hand | Web automation with CDP. Playwright bridge, session persistence, purchase approval gate | Productivity | 60 | 0.3 | browser_navigate/click/type/screenshot/read_page/close, web_search |
| **trader** | Trading Hand | Automated trading signal analysis and execution | Data | 80 | 0.3 | event_publish, memory, knowledge_graph, schedule |
| **infisical-sync** | Infisical Sync Hand | Secret synchronization with Infisical. Security-focused, low temperature | Security | — | <0.2 | vault_set/get/list/delete, shell_exec, knowledge_graph |

The README.md:80-88 only lists 7 (missing Trader and Infisical Sync), but `bundled.rs:6-53` confirms 9 bundled hands.

**"Einstein Hands"** (lead, collector, predictor, researcher, twitter, trader) are a subset that all must have `schedule_create`, `schedule_list`, `schedule_delete`, `memory_store`, `memory_recall`, `knowledge_add_entity`, `knowledge_add_relation`, and `knowledge_query` tools (`bundled.rs:248-456`).

---

## 4. Subsystem Inventory

### CLI Binary Entry Point
- **File**: `crates/openfang-cli/src/main.rs` (7,478 lines)
- **Binary name**: `openfang`
- **CLI framework**: clap 4 with derive macros
- **Architecture**: Detects running daemon via `~/.openfang/daemon.json` health ping → talks over HTTP. Falls back to in-process kernel boot for commands that don't need a running daemon.

### Dashboard (Web UI)
- **Not on port 4200 by default** — the port is configurable via `config.toml:6-10` (`api_listen = "127.0.0.1:50051"`). Port 4200 is the daemon default example.
- **Stack**: Embedded HTML/CSS/JS served by the Axum server. The HTML skeleton is in `crates/openfang-api/static/index_head.html` and `index_body.html`.
- **Dashboard JS**: `crates/openfang-api/static/js/pages/hands.js` shows interactive browser viewer for the Browser Hand.
- **Features**: Hands management, channel setup, agent chat, provider configuration, credential vault.
- **Auth**: Bearer token auth, localhost bypass for CLI.

### Scheduler
- **File**: `crates/openfang-kernel/src/scheduler.rs` (191 lines)
- **Two-level**: 
  - `AgentScheduler` — per-agent token quotas with hourly rolling windows (Token Bucket)
  - `BackgroundExecutor` — autonomous mode loops (Continuous, Periodic, Proactive)
- **Cron**: Simplified "every N s/m/h/d" format in `background.rs:254-284`, falls back to 300s for unparseable.

### Knowledge Graph
- **File**: `crates/openfang-memory/src/knowledge.rs` (346 lines)
- **Backend**: SQLite (not in-memory). Two tables: `entities` and `relations`.
- **Query**: SQL-based pattern matching with `GraphPattern` filtering by source/relation/target
- **Tools**: `knowledge_add_entity`, `knowledge_add_relation`, `knowledge_query`

### Tool Framework
- **File**: `crates/openfang-runtime/src/tool_runner.rs` (5,014 lines)
- **53 built-in tools** including:
  - File operations: file_read, file_write, file_list, file_delete, file_move, file_copy, file_search
  - Web: web_search, web_fetch
  - Browser: browser_navigate/click/type/screenshot/read_page/close/scroll/wait/run_js/back
  - Shell: shell_exec, shell_background
  - Memory: memory_store/recall/delete/list
  - Agent: agent_send/spawn/list/kill/activate
  - Knowledge graph: knowledge_add_entity/add_relation/query
  - Image: image_analyze, image_generate
  - Media: media_describe, media_transcribe
  - Cron: cron_create/list/delete
  - Vault: vault_set/get/list/delete
  - Other: location_get, event_publish
- **Extension**: MCP tools (namespaced as `mcp_{server}_{tool}`), skill tools (Python/WASM/Node.js/PromptOnly)

### Approval Gates
- **Capability-based**: No hardcoded approval. The Browser Hand's purchase gate is a **system prompt directive** enforced by the LLM via instruction, not by the runtime.
- **WASM Sandbox**: Dual metering (fuel + epoch) with watchdog thread (`kernel.rs:883-890`).
- **CapabilityManager**: DashMap-based, checks before every tool invocation.

### 5 STT Backends (Clip Hand)
From `bundled/clip/HAND.toml:60-89`:
1. **Local Whisper** (`whisper` binary) — `whisper_local`
2. **Groq Whisper API** (`groq_whisper`) — fastest, free tier
3. **OpenAI Whisper API** (`openai_whisper`) — via curl
4. **Deepgram Nova-2** (`deepgram`) — via curl
5. **YouTube auto-subs** — `yt-dlp --write-auto-subs --sub-lang en --sub-format json3`
6. **Fallback**: FFmpeg scene detection + silence detection (no STT)

### Playwright Bridge (Browser Hand)
- **Actual implementation**: Native Chrome DevTools Protocol (CDP) over WebSocket, NOT Playwright. The HAND.toml requires Python for Playwright but the runtime connects directly to Chromium.
- **File**: `crates/openfang-runtime/src/browser.rs` (1,362 lines)
- **Architecture**: `CdpConnection` (WebSocket to `ws://localhost:.../devtools/browser/...`), JSON-RPC over WebSocket for all commands
- **Commands**: Navigate, Click, Type, Screenshot, ReadPage, Close, Scroll, Wait, RunJs, Back
- **Security**: SSRF check in Rust before navigate. All page content wrapped with `wrap_external_content()` markers. Session limits (max concurrent, idle timeout, 1 per agent).

---

## 5. Runtime Architecture

### How an Agent Actually Executes

The kernel boot sequence (`docs/architecture.md:70-156`):

1. Load config → 2. Create data dir → 3. Init SQLite (schema v5) → 4. Init LLM driver → 5. Init model catalog (51 models) → 6. Init metering engine → 7. Init model router → 8. Init subsystems (AgentRegistry, CapabilityManager, EventBus, AgentScheduler, Supervisor, WorkflowEngine, TriggerEngine, BackgroundExecutor, WasmSandbox) → 9. Init RBAC → 10. Load skills (60 bundled) → 11. Init web tools → 12. Restore persisted agents → 13. Boot daemon (MCP connect, heartbeat monitor, background loops)

### Agent Lifecycle

```
spawn → [Running] ↔ [Running] → [Terminated]
           ↓ shutdown                  ↑ reboot/restore
       [Suspended] ────────────────────┘
```

Agent loop (`crates/openfang-runtime/src/agent_loop.rs:293-5493`):

1. Load session from memory
2. Recall memories (vector similarity or text search)
3. Build system prompt (base + memories + stability guidelines)
4. Build messages → strip images (store separately)
5. Run session repair (validate + fix message history)
6. Inject canonical context
7. FOR iteration in 0..max_iterations:
   a. Context overflow recovery
   b. Build context budget → trim oversized tool results
   c. Call LLM (with retry + exponential backoff)
   d. Parse response → tool calls or end turn
   e. Execute tool (60s timeout, 120s for browser, 600s for agent tools)
   f. Check loop guard (SHA256-based repetition detection)
   g. Compact session if threshold exceeded
8. Save session + canonical session
9. Record usage → update quota tracking
10. Return `AgentLoopResult`

### Multi-Tenancy / Isolation

- **Capability-based**: Each agent has explicit tool, memory, network, shell capabilities. Child agents cannot exceed parent capabilities (`validate_capability_inheritance()`).
- **WASM dual metering**: Fuel (instruction count) + epoch (wall-clock) via Wasmtime + watchdog thread.
- **Subprocess sandbox**: `env_clear()` + selective env passthrough.
- **Per-agent quotas**: Token-per-hour limits, memory limits.
- **Merkle audit trail**: Tamper-evident logging of all agent actions.

---

## 6. Knowledge Graph System

### Backend
- **SQLite** (not in-memory, not petgraph). File: `crates/openfang-memory/src/knowledge.rs:16-19`
- **Access**: `Arc<Mutex<Connection>>` wrapped in `KnowledgeStore` struct

### Schema (two tables)
```sql
entities (id, entity_type, name, properties, created_at, updated_at)
relations (id, source_entity, relation_type, target_entity, properties, confidence, created_at)
```

### Entity Types
From `crates/openfang-types/src/memory.rs:135-157`:
```rust
pub enum EntityType {
    Person, Organization, Project, Concept, Event,
    Custom(String), // extensible
}
```

### Relation Types
```rust
pub enum RelationType {
    WorksAt, KnowsAbout, RelatedTo, DependsOn,
    OwnedBy, CreatedBy, LocatedIn, PartOf, Uses, Produces,
    Custom(String),
}
```

### Population Strategy
- **Tools**: `knowledge_add_entity`, `knowledge_add_relation`, `knowledge_query` (defined in `tool_runner.rs:850-898`)
- **Agent-driven**: The Researcher, Collector, Lead, Predictor, Twitter, and Trader hands all have explicit instructions to populate the graph during their operational cycles
- **All Einstein hands** must carry all three knowledge graph tools (`bundled.rs:427-456`)

### Query Interface
`KnowledgeStore::query_graph(pattern: GraphPattern)` returns `Vec<GraphMatch>` with source entity, relation, target entity triple. SQL-based JOIN with optional WHERE filters on source/relation/target. Limited to 100 results.

---

## 7. Tool Framework

### Tool Trait Definition

From `crates/openfang-types/src/tool.rs:1-27`:
```rust
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,  // JSON Schema
}
```

This is a **data struct, not a trait**. Tools are dispatched via a large match statement in `tool_runner.rs`.

### Built-in Tools (53)

| Category | Tools |
|----------|-------|
| **File** | file_read, file_write, file_list, file_delete, file_move, file_copy, file_search |
| **Web** | web_search, web_fetch |
| **Browser** | browser_navigate, browser_click, browser_type, browser_screenshot, browser_read_page, browser_close, browser_scroll, browser_wait, browser_run_js, browser_back |
| **Shell** | shell_exec, shell_background |
| **Memory** | memory_store, memory_recall, memory_delete, memory_list |
| **Agent** | agent_send, agent_spawn, agent_list, agent_kill, agent_activate |
| **Knowledge Graph** | knowledge_add_entity, knowledge_add_relation, knowledge_query |
| **Image** | image_analyze, image_generate |
| **Media** | media_describe, media_transcribe |
| **Cron** | cron_create, cron_list, cron_delete |
| **Vault** | vault_set, vault_get, vault_list, vault_delete |
| **Other** | location_get, event_publish, schedule_create, schedule_list, schedule_delete |
| **Task Board** | task_post, task_claim, task_complete, task_list |

### Extension Mechanism
1. **MCP tools**: Connected via `rmcp` crate (stdio or SSE). Namespaced as `mcp_{server}_{tool}`. Configured in `config.toml`.
2. **Skill tools**: Python, Node.js, WASM, or PromptOnly. 60 bundled via `include_str!()`. Loaded by `SkillRegistry`.
3. **A2A tools**: Google's Agent-to-Agent protocol for inter-system communication.

### Tool Execution
- **Timeout**: 60s default, 120s for browser, 600s for inter-agent calls. Configurable via `OPENFANG_TOOL_TIMEOUT_SECS` env var.
- **Truncation**: Results over 50K chars are truncated with a marker.
- **Loop Guard**: SHA256-based `(tool_name, params)` hashing with warn (3), block (5), circuit-breaker (30) thresholds.
- **Recovery**: `recover_text_tool_calls()` extracts function calls from text output (for models that don't use native tool_call APIs).

---

## 8. Approval / Guardrails System

### 16 Security Systems

From README.md:210-228 and SECURITY.md:46-81:

| # | System | Implementation |
|---|--------|---------------|
| 1 | WASM Dual-Metered Sandbox | Wasmtime fuel metering + epoch interruption. Watchdog thread kills runaway. (`kernel.rs`) |
| 2 | Merkle Hash-Chain Audit Trail | Every action cryptographically linked to previous. (`audit.rs`) |
| 3 | Information Flow Taint Tracking | `TaintLabel`, `TaintSet` in `openfang-types/src/taint.rs` |
| 4 | Ed25519 Signed Agent Manifests | `manifest_signing.rs` — identity and capability set signing |
| 5 | SSRF Protection | `is_ssrf_target()` blocks private IPs, cloud metadata, DNS rebinding |
| 6 | Secret Zeroization | `Zeroizing<String>` on all API key fields, wiped on drop |
| 7 | OFP Mutual Authentication | HMAC-SHA256 nonce-based, constant-time verification |
| 8 | Capability Gates | Role-based access control. `CapabilityManager.check()` on every action |
| 9 | Security Headers | CSP, X-Frame-Options, HSTS, X-Content-Type-Options on every response |
| 10 | Health Endpoint Redaction | `/api/health` returns minimal info; `/api/health/detail` requires auth |
| 11 | Subprocess Sandbox | `env_clear()` + selective variable passthrough. Process tree isolation |
| 12 | Prompt Injection Scanner | Detects override attempts, data exfiltration patterns, shell references |
| 13 | Loop Guard | SHA256-based tool call loop detection with circuit breaker |
| 14 | Session Repair | 7-phase message history validation and auto-recovery |
| 15 | Path Traversal Prevention | Canonicalization with symlink escape prevention |
| 16 | GCRA Rate Limiter | Cost-aware token bucket rate limiting per IP |

### Approval Queue

The Browser Hand implements **mandatory purchase approval** via the system prompt, not via a code gate. It's a behavioral instruction to the LLM: "NEVER auto-complete purchases. NEVER click payment buttons without user approval." The LLM self-enforces this through the prompt instructions.

Actual tool-level gating is done through **CapabilityManager** which checks each agent's declared capabilities before allowing tool execution. If a tool is not in the agent's capability list, it returns a "Permission denied" error to the LLM.

---

## Key Observations

1. **Massive scope**: 198K LOC of Rust for what is essentially a solo/early-stage project is extraordinary. Some numbers in the README may be aspirational (53 tools vs 23 mentioned in architecture.md).
2. **README vs Reality**: README claims 7 bundled hands; code reveals 9. README mentions Playwright bridge; actual browser automation uses native CDP over WebSocket.
3. **Hands are prompt-driven**: Despite the sophisticated infrastructure, Hands are primarily **well-crafted system prompts** backed by tool access. The real innovation is in the prompt engineering and scheduling.
4. **SQLite-centric**: Everything (memory, graph, sessions, usage) goes through SQLite. No specialized graph database.
5. **No audio/video code in Rust**: The Clip Hand drives everything through shell_exec (ffmpeg, yt-dlp, curl) — no native Rust video processing.
6. **Anthropic-first**: Default model is `claude-sonnet-4-20250514` with `ANTHROPIC_API_KEY` as the primary env var.
