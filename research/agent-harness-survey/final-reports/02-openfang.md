# OpenFang — The Agent Operating System

**Report:** Final Analysis — Round 12b  
**Repository:** `repos/openfang/`  
**Version:** 0.6.9 | **License:** MIT / Apache-2.0 | **Language:** Rust  
**Built by:** RightNow-AI (Jaber, Founder)  
**Location:** `/home/drb0rk/Projects/BizarHarness/research/agent-harness-survey/repos/openfang/`

---

## Executive Summary

OpenFang is a Rust-native "Agent Operating System" — a self-hosted harness that positions autonomous agents as persistent, scheduled processes rather than reactive chatbots. Its defining characteristics are: a genuine OS-kernel metaphor in the architecture, nine pre-built autonomous "Hands" with multi-phase expert prompts, a dual-metered WASM sandbox for untrusted code, and a knowledge graph shared across all agents. The project ships as a single ~32 MB binary with no runtime dependencies, running on macOS, Linux, and Windows. At ~198,000 lines of Rust across 14 crates, it is one of the most substantial single-binary agent runtimes in existence.

This report synthesizes all rounds of analysis into a definitive reference on OpenFang's architecture, capabilities, operational characteristics, and lessons for BizarHarness.

---

# Part I: Overview

## 1. Project Identity

OpenFang's tagline — *"Agents that actually work for you"* — is precise. Where most agent frameworks are conversational (you prompt, it responds), OpenFang agents run on schedules, 24/7, without prompting. They are processes, not sessions. This is not marketing language; it is the architectural commitment of the system, from the `BackgroundExecutor` that loops continuously to the `HAND.toml` manifests that package agents as complete operational units with tool access, scheduling, and state management.

The project was built by **RightNow-AI**, a one-person effort led by Jaber, and released under MIT / Apache-2.0. The repository has the scale of a serious infrastructure project: 198,748 lines of Rust, 1,767+ tests, zero clippy warnings enforced in CI, and a release profile using thin-LTO with single codegen unit for maximum optimization.

### Repository Statistics

| Metric | Claimed | Measured |
|--------|---------|---------|
| Total Rust LOC | 137,728 | 198,748 |
| Crates | 14 | 14 (13 code + xtask) |
| Binary size | ~32 MB | ~32 MB |
| Built-in tools | 53 + MCP + A2A | 53 confirmed |
| Bundled Hands | 7 (README) / 9 (code) | 9 |
| LLM Providers | 27 (123+ models) | 27 confirmed |
| Channel adapters | 40 | 40 confirmed |
| Security layers | 16 | 16 documented |
| Cold start | 180ms | (unverified) |
| Idle memory | 40 MB | (unverified) |

Note: The README lists 7 bundled hands but `bundled.rs:6-53` confirms 9 — Trader and Infisical-Sync are included in code but omitted from the README.

## 2. The "Agent OS" Pitch — Technical Meaning

The OS metaphor is not decorative. OpenFang provides services that map directly to operating system primitives:

| OS Concept | OpenFang Implementation |
|-----------|----------------------|
| Kernel | `openfang-kernel`: scheduler, RBAC, metering, event bus, workflow engine |
| Process isolation | WASM sandbox with dual metering (fuel + epoch), `env_clear()` subprocess sandbox |
| Memory management | SQLite-backed 6-layer memory (KV, vector, graph, session, task board, usage) |
| Device drivers | 40 messaging channel adapters (Telegram, Discord, Slack, WhatsApp, etc.) |
| Networking stack | OFP P2P protocol (`openfang-wire`) with HMAC-SHA256 mutual auth |
| File system | Per-agent workspace sandbox with canonicalization + symlink escape prevention |
| Startup/shutdown | `openfang init`, `openfang start`, graceful shutdown, state persistence |

The **Hands** are the OS's "built-in applications" — pre-installed autonomous workers that operate continuously without user prompting.

## 3. Who Built It

**RightNow-AI** (Jaber, Founder). OpenFang is a solo-built project with the scope of a team effort. The README's aggressive self-promotion (27 providers, 123+ models, 40 channels, 16 security layers, "2,696+ passing" tests) reads like a feature list assembled by someone who has seen what enterprise buyers want and built to that specification. Some claims are aspirational; others (like the 7 vs 9 Hands discrepancy, or the Playwright vs native CDP discrepancy) suggest documentation drift. The codebase itself is disciplined — zero clippy warnings, comprehensive test suites, structured logging throughout.

## 4. Crate-by-Crate Inventory

```
openfang-runtime:    51,734 LOC — Agent loop, tools, drivers, WASM sandbox, CDP browser
openfang-channels:   33,689 LOC — 40 messaging adapters
openfang-cli:        30,891 LOC — CLI, TUI, MCP server mode
openfang-api:        23,422 LOC — REST/WS/SSE server + dashboard
openfang-kernel:     21,691 LOC — Orchestration, RBAC, metering, scheduler, event bus
openfang-types:      13,781 LOC — Core types, errors, config, capability, taint tracking
openfang-migrate:     5,498 LOC — OpenClaw migration engine
openfang-skills:      5,063 LOC — Skill system with SHA256 verification
openfang-memory:      4,468 LOC — SQLite-backed memory substrate
openfang-extensions:  2,888 LOC — MCP templates, vault, OAuth
openfang-hands:      2,731 LOC — Hand system (9 bundled)
openfang-wire:        1,946 LOC — OFP P2P protocol
openfang-desktop:       946 LOC — Tauri 2.0 desktop app
```

Key workspace dependencies: tokio (full), axum 0.8, rusqlite 0.31, wasmtime 43, wasmtime 43, `rmcp` (MCP SDK), governor 0.10 (GCRA), dashmap 6, crossbeam 0.8.

## 5. Killer Features at a Glance

1. **Single-binary distribution** — ~32 MB, no Docker, no Python, no runtime dependencies. Ships with embedded web dashboard.
2. **WASM dual-metered sandbox** — Fuel (instruction count) + epoch (wall-clock) via Wasmtime. One shared engine across all executions, watchdog thread kills runaway modules.
3. **9 bundled Hands** — Pre-packaged autonomous agents: Researcher, Collector, Lead, Predictor, Twitter, Browser, Clip, Trader, Infisical-Sync. Each is a complete operational procedure with multi-phase prompts.
4. **Two-level scheduler** — `AgentScheduler` for per-agent token quotas with hourly rolling windows; `BackgroundExecutor` for Continuous/Periodic/Proactive autonomous loops.
5. **16-layer security model** — WASM sandbox, Merkle hash-chain audit trail, taint tracking, Ed25519 manifest signing, SSRF protection, capability gates, subprocess sandbox, GCRA rate limiting.
6. **Knowledge graph** — SQLite-backed entities + relations with SQL JOIN queries. Shared across all Einstein Hands.
7. **Native CDP browser automation** — Chrome DevTools Protocol over WebSocket, NOT Playwright despite what documentation claims.
8. **27 LLM providers** — Anthropic, Gemini, OpenAI-compat (18+ providers), via 3 native drivers.

---

# Part II: Architecture

## 6. Cargo Workspace and 14 Crates

The workspace is organized around the OS-service metaphor:

- **`openfang-types`** — The type system. Defines `AgentManifest`, `AgentId`, `Capability`, `Event`, `ToolDefinition`, `TaintLabel`, `TaintSet`, Ed25519 manifest signing, model catalog types, and 21 OpenClaw-to-OpenFang tool mappings. All other crates depend on it.

- **`openfang-memory`** — SQLite-backed memory substrate with six storage layers: KV store (key-value), vector embeddings (cosine similarity), knowledge graph (entities + relations), session management, task board, and usage events. Uses `Arc<Mutex<Connection>>` with `spawn_blocking` for async bridge. Schema v5 with automatic migrations at boot.

- **`openfang-runtime`** — The execution engine. Contains the agent loop (`run_agent_loop`, `run_agent_loop_streaming`), 3 native LLM drivers, 53 built-in tools, WASM sandbox (Wasmtime dual fuel+epoch), MCP client/server, A2A protocol, web search (Tavily/Brave/Perplexity/DDG), SSRF-protected web fetch, loop guard (SHA256), session repair, Merkle hash chain audit trail.

- **`openfang-kernel`** — The central coordinator. `OpenFangKernel` assembles: `AgentRegistry`, `AgentScheduler`, `CapabilityManager`, `EventBus`, `Supervisor`, `WorkflowEngine`, `TriggerEngine`, `BackgroundExecutor`, `WasmSandbox`, `ModelCatalog`, `MeteringEngine`, `ModelRouter`, `AuthManager` (RBAC), `HeartbeatMonitor`, `SetupWizard`, `SkillRegistry`. The `boot_with_config()` function is a 100+ step sequential initializer.

- **`openfang-api`** — Axum 0.8 HTTP server with 76+ REST/WS/SSE endpoints. OpenAI-compatible API (`POST /v1/chat/completions`, `GET /v1/models`). Static web dashboard embedded in the binary. Middleware: Bearer auth, GCRA rate limiter, security headers, health redaction.

- **`openfang-cli`** — Clap-based CLI with commands for every subsystem. Auto-detects running daemon via `~/.openfang/daemon.json` health ping; falls back to in-process kernel boot.

- **`openfang-channels`** — 40 channel adapters: Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Email (IMAP/SMTP), SMS, Webhook, Teams, Mattermost, IRC, Google Chat, Twitch, Rocket.Chat, Zulip, XMPP, LINE, Viber, Messenger, Reddit, Mastodon, Bluesky, Feishu, Revolt, Nextcloud, Guilded, Keybase, Threema, Nostr, Webex, Pumble, Flock, Twist, Mumble, DingTalk, Discourse, Gitter, Ntfy, Gotify, LinkedIn. Features per-channel model/system-prompt/DM-policy/group-policy/rate-limit/threading/output-format overrides.

- **`openfang-wire`** — OFP (OpenFang Protocol) P2P networking over TCP with JSON-framed messages. HMAC-SHA256 mutual authentication with nonce tracking and 5-minute replay window.

- **`openfang-hands`** — Hand system with `HandDefinition`, `HandRegistry`, `HAND.toml` parser. 9 bundled hands embedded via `include_str!()` at compile time.

- **`openfang-skills`** — Skill system: 60 bundled skills via `include_str!()`, FangHub marketplace, ClawHub cross-ecosystem compat. `SkillManifest` (TOML), `SkillRegistry`, SHA256 verification, prompt injection scanner.

- **`openfang-migrate`** — Migration engine for importing from OpenClaw and other frameworks. Converts YAML → TOML, maps tool names, provider names, imports agent manifests. Framework stubs for LangChain and AutoGPT.

- **`openfang-extensions`** — MCP server templates (25), AES-256-GCM credential vault, OAuth2 PKCE flow.

- **`openfang-desktop`** — Tauri 2.0 desktop app. Boots kernel in-process, runs Axum on background thread, WebView at `http://127.0.0.1:{random_port}`. System tray, single-instance enforcement, desktop notifications.

## 7. The "Agent OS" Kernel

The `OpenFangKernel` struct (`kernel.rs`) is the monolith that assembles everything. Its boot sequence runs in strict order:

1. Load config → 2. Create data dir → 3. Init SQLite (schema v5) → 4. Init LLM driver → 5. Init model catalog (51 models) → 6. Init metering engine → 7. Init model router → 8. Init subsystems (AgentRegistry, CapabilityManager, EventBus, AgentScheduler, Supervisor, WorkflowEngine, TriggerEngine, BackgroundExecutor, WasmSandbox) → 9. Init RBAC → 10. Load skills (60 bundled) → 11. Init web tools → 12. Restore persisted agents → 13. Boot daemon (MCP connect, heartbeat monitor, background loops)

The kernel provides a `KernelHandle` trait for inter-agent operations and implements 30+ fields. The monolithic assembly pattern is a sharp contrast to microkernel or plugin architectures — every subsystem is initialized in a known order with explicit error propagation.

### The KernelHandle Trait

The `KernelHandle` trait is the primary interface through which agents interact with the kernel. Defined in `kernel_handle.rs`, it provides:

```rust
pub trait KernelHandle: Send + Sync {
    fn agent_registry(&self) -> Arc<AgentRegistry>;
    fn capability_manager(&self) -> Arc<CapabilityManager>;
    fn event_bus(&self) -> Arc<EventBus>;
    fn scheduler(&self) -> Arc<AgentScheduler>;
    fn metering_engine(&self) -> Arc<MeteringEngine>;
    fn wasm_sandbox(&self) -> Option<Arc<WasmSandbox>>;
    fn model_catalog(&self) -> Arc<ModelCatalog>;
    fn approval_manager(&self) -> Arc<ApprovalManager>;
    fn knowledge(&self) -> Arc<KnowledgeStore>;
    fn memory(&self) -> Arc<MemorySubstrate>;
    fn trigger_engine(&self) -> Arc<TriggerEngine>;
    fn skill_registry(&self) -> Option<Arc<SkillRegistry>>;
    // + 20+ more methods
}
```

This trait is the "system call interface" of the Agent OS. Every tool invocation goes through a kernel handle method. The trait is object-safe (`dyn KernelHandle`) and passed as `Option<Arc<dyn KernelHandle>>` to the agent loop, enabling optional kernel access for agents that don't need it.

### The Event Bus

The `EventBus` (`kernel/src/event_bus.rs`) is an in-process publish-subscribe system for inter-subsystem communication:

```rust
pub enum Event {
    AgentSpawned { agent_id: AgentId, name: String },
    AgentTerminated { agent_id: AgentId },
    Lifecycle { agent_id: AgentId, phase: String },
    System { msg: String },
    MemoryUpdate { agent_id: AgentId, key: String },
}
```

Subscribers register patterns (exact match or wildcard). The `TriggerEngine` uses this to fire Proactive agents when matching events occur. The event bus is **in-process only** — there is no distributed event system. For cross-process communication, the OFP wire protocol (`openfang-wire`) provides P2P messaging with HMAC-SHA256 mutual authentication.

### The Supervisor

The `Supervisor` (`kernel/src/supervisor.rs`) manages agent lifecycle and health:

- **Agent lifecycle**: spawn, suspend, resume, kill with graceful shutdown
- **Heartbeat monitoring**: each agent reports liveness at `heartbeat_interval_secs` (default 30s). Missing 3 consecutive heartbeats triggers agent termination.
- **Shutdown coordination**: owns the `shutdown_tx` watch channel that all background executors listen on for clean shutdown
- **Child process tracking**: for agents that spawn OS processes (shell exec, Docker), the supervisor tracks process trees and kills them on agent termination

### The Workflow Engine

The `WorkflowEngine` (`kernel/src/workflow.rs`) provides a state-machine-based workflow execution layer above the basic agent loop. Workflows are defined in TOML and support:

- Sequential steps (output of step N becomes input of step N+1)
- Parallel branches (fan-out to multiple agents, fan-in on completion)
- Conditional branching based on output values
- Error handling: retry, fallback, abort

This is separate from the `CronScheduler` — `CronScheduler` handles time-based scheduling, while `WorkflowEngine` handles multi-step task coordination. The two interact: a cron job can trigger a workflow, and a workflow step can schedule a cron job.

## 8. The Agent Loop

The main agent loop at `crates/openfang-runtime/src/agent_loop.rs:293` is a 5,200-line `async` function taking 15 parameters. The loop executes with `MAX_ITERATIONS = 50` and `MAX_RETRIES = 3` with exponential backoff starting at 1s.

### The 15 Parameters

The function signature reveals the full scope of what the loop orchestrates:

```rust
pub async fn run_agent_loop(
    manifest: &AgentManifest,        // Agent config: name, model, tools, capabilities
    user_message: &str,             // Current user input
    session: &mut Session,           // Conversation history (mutable for repair)
    memory: &MemorySubstrate,        // KV + vector + graph storage
    driver: Arc<dyn LlmDriver>,     // LLM provider (Anthropic/Gemini/OpenAI-compat)
    available_tools: &[ToolDefinition], // What this agent can call
    kernel: Option<Arc<dyn KernelHandle>>, // Optional kernel access
    skill_registry: Option<&SkillRegistry>, // Optional skill content
    mcp_connections: Option<&tokio::sync::Mutex<Vec<McpConnection>>>,
    web_ctx: Option<&WebToolsContext>,    // Web search/fetch context
    browser_ctx: Option<&BrowserManager>, // CDP browser context
    embedding_driver: Option<&(dyn EmbeddingDriver + Send + Sync)>,
    workspace_root: Option<&Path>,       // Filesystem sandbox root
    on_phase: Option<&PhaseCallback>,    // Progress callback
    media_engine: Option<&MediaEngine>,  // Image understanding
    tts_engine: Option<&TtsEngine>,      // Text-to-speech
    docker_config: Option<&DockerSandboxConfig>,
    hooks: Option<&HookRegistry>,
    context_window_tokens: Option<usize>,
    process_manager: Option<&ProcessManager>,
    user_content_blocks: Option<Vec<ContentBlock>>,
    taint_config: Option<&TaintConfig>,
) -> OpenFangResult<AgentLoopResult>
```

The complexity of this signature is itself informative — it encodes every subsystem that can participate in an agent turn.

### Loop Internals

```
for iteration in 0..max_iterations {
    // 1. Context overflow recovery (drain → summarize → retry)
    recover_from_overflow(&mut messages, ...);

    // 2. Apply context guard (trim oversized tool results)
    apply_context_guard(&mut messages, &context_budget, ...);

    // 3. Call LLM with retry + exponential backoff
    let response = call_with_retry(&*driver, request, ...).await?;

    // 4. Handle stop_reason
    match response.stop_reason {
        EndTurn | StopSequence => { /* finalize */ }
        ToolUse => {
            for tool_call in response.tool_calls {
                // Check capability → execute (60s timeout, 120s browser, 600s agent)
                // Truncate >50K chars → check loop guard (SHA256 repetition)
            }
            if threshold_exceeded { auto_compact_session(); }
        }
        MaxTokens => { /* continuation */ }
    }
}
// Save session + canonical session → record usage → update quota
```

### Session Repair — 7 Phases

The `session_repair.rs:1464 LOC` implements pre-turn validation. This is critical because sessions can become corrupted by API-level issues (crash mid-write, mismatched tool calls, cached replays):

| Phase | Operation | Invariant After |
|-------|---------|----------------|
| 1 | Collect all ToolUse IDs from assistant messages | Complete ID set known |
| 2 | Filter orphaned ToolResults (no preceding ToolUse) | Only matched results remain |
| 2b | Reorder misplaced ToolResults | Results follow their ToolUse |
| 2c | Deduplicate ToolResults per tool_use_id | One result per call |
| 2d | Insert synthetic error results for unmatched IDs | No unmatched IDs |
| 2e | Skip aborted/errored assistant messages | Clean assistant blocks |
| 3 | Merge consecutive same-role messages | No redundant rolls |

Without this, a corrupted session could cause the LLM to see orphan `ToolResult` blocks and refuse to continue, or see gaps that confuse its reasoning about the conversation state.

### Context Overflow Recovery

The `context_overflow.rs:117+` pipeline runs when the message list approaches the context window limit:

1. **Drain**: Remove the oldest messages until under threshold
2. **Summarize**: Call the LLM to summarize the drained chunk into a compact summary
3. **Inject**: Insert the summary as a system-message-bounded block
4. **Retry**: Call the LLM with the compacted context

The default context window is 200,000 tokens (Claude Sonnet 4). The compaction threshold is 80% of context window.

### Phantom Action Detection

`agent_loop.rs:94-111` — `phantom_action_detected(text)` scans LLM output for claims of having performed actions without corresponding tool calls:

```rust
fn phantom_action_detected(text: &str) -> bool {
    let patterns = [
        r"I sent (you |the |an? )",
        r"I (sent|posted|emailed|uploaded|published)",
        r"I've (sent|posted|emailed)",
        r"I (just )?(sent|posted|uploaded|published)",
    ];
    // Scans for these patterns without a matching tool call
    // Returns true if found
}
```

This catches a specific failure mode: models that claim to have taken actions (especially irreversible ones like sending emails or posting) when they haven't. The agent loop blocks and returns an error if phantom action is detected.

### Key Behaviors

- **Native async/await via Tokio** — no GIL, true parallelism, `spawn_blocking` for SQLite.
- **Phantom action detection** — scans LLM output for claims of having acted (sent, posted, emailed) without a corresponding tool call. Catches "I did it but actually didn't" failures.
- **Text-based tool call recovery** — parses `<function=name>{json}</function>` from text output for models without native tool call APIs.
- **Session repair** — 7-phase message validation before each LLM turn: collects ToolUse IDs, filters orphaned ToolResults, reorders misplaced results, deduplicates per ID, inserts synthetic errors for unmatched IDs, merges consecutive same-role messages.
- **Context overflow recovery** — multi-stage: drain excess messages → LLM summarizes → retry. Default context window: 200,000 tokens.
- **Loop guard** — SHA256-based `(tool_name, params)` repetition: warn (3×), block (5×), circuit-breaker (30×). Outcome-aware detection catches "stuck returning same error." Ping-pong detection catches A-B-A-B alternating patterns.
- **Canonical sessions** — after each turn, the session is compacted into a summary stored in `canonical_sessions` table (SQLite schema v5). This enables cross-channel memory: the same agent on Telegram and Discord shares a compacted summary of prior conversations.

## 9. The Tool System (53 Built-in Tools)

Tools are `ToolDefinition` data structs (not a trait) dispatched via a massive match statement in `tool_runner.rs:3500+`. The fact that tools are data, not objects, means the dispatch is a pure function — no dynamic dispatch overhead, no trait object casting. The cost is that adding a new tool requires editing the match statement.

The tool execution pipeline (`tool_runner.rs`) for each tool call:

1. **Normalize** — `normalize_tool_name()` at line 130 handles aliases (`fs-write` → `file_write`)
2. **Lookup** — find the tool in the available tools list, return error if not found
3. **Taint check** — `check_taint_shell_exec()` and `check_taint_net_fetch()` run on parameters
4. **Capability check** — `CapabilityManager::check()` validates the agent's capabilities
5. **Approval check** — if tool requires approval (e.g., `shell_exec`), wait for approval or timeout
6. **Execute** — call the tool implementation with 60s timeout (120s for browser, 600s for agent)
7. **Truncate** — results over 50,000 characters are truncated with a marker
8. **Loop guard** — SHA256 hash of `(tool_name, params)` checked against repetition history
9. **Return** — `ToolResult` struct returned to the agent loop

The 53 built-ins:

| Category | Tools |
|----------|-------|
| **File** | `file_read`, `file_write`, `file_list`, `file_delete`, `file_move`, `file_copy`, `file_search` |
| **Web** | `web_search`, `web_fetch` |
| **Browser** | `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_read_page`, `browser_close`, `browser_scroll`, `browser_wait`, `browser_run_js`, `browser_back` |
| **Shell** | `shell_exec`, `shell_background` |
| **Memory** | `memory_store`, `memory_recall`, `memory_delete`, `memory_list` |
| **Agent** | `agent_send`, `agent_spawn`, `agent_list`, `agent_kill`, `agent_activate` |
| **Knowledge Graph** | `knowledge_add_entity`, `knowledge_add_relation`, `knowledge_query` |
| **Vault** | `vault_set`, `vault_get`, `vault_list`, `vault_delete` |
| **Cron** | `cron_create`, `cron_list`, `cron_delete` |
| **Task Board** | `task_post`, `task_claim`, `task_complete`, `task_list` |
| **Other** | `location_get`, `event_publish`, `schedule_create`, `schedule_list`, `schedule_delete`, `image_analyze`, `image_generate`, `media_describe`, `media_transcribe` |

Extension mechanisms: MCP tools (namespaced `mcp_{server}_{tool}`), skill tools (Python/WASM/Node.js/PromptOnly), A2A protocol tools.

### Shell Exec — The Riskiest Tool

`shell_exec` has four independent gate layers:

1. **Capability check** — tool must be in agent's declared capabilities.
2. **Metacharacter block** — rejects `` ` ``, `$()`, `${`, `;`, `|`, `>`, `<`, `{`, `}`, `\n`, `\r`, `\0`, `&` even in `ExecPolicy::Full` mode.
3. **Exec policy** — `Deny` rejects everything; `Full` allows everything; `Allowlist` requires base command in `safe_bins` or `allowed_commands` and recursively validates inline scripts.
4. **Taint heuristic** — when not in `Full` mode, scans for shell-injection patterns from external/user content.

And a fifth: if `ExecPolicy::Full` or `Allowlist` with `allowed_commands=["*"]`, the approval gate is bypassed — the operator has opted in.

## 10. Memory and Knowledge Graph

### Six-Layer SQLite Memory

Everything persists through `~/.openfang/data/openfang.db` (SQLite, WAL mode):

| Layer | Table | Mechanism |
|-------|-------|-----------|
| KV | `memories` | Key-value with keys, values, agent_id, timestamps |
| Vector | `embeddings` | Cosine similarity search for semantic recall |
| Knowledge Graph | `entities` + `relations` | SQL-based JOIN with `GraphPattern` filtering |
| Session | `sessions` | Conversation history with context window token tracking |
| Task Board | `tasks` | Shared task queue via `task_post/claim/complete/list` |
| Usage | `usage_events` | Token counts, costs, model per agent |

### Knowledge Graph Schema

```sql
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    name TEXT NOT NULL,
    properties TEXT NOT NULL DEFAULT '{}',  -- JSON blob
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    source_entity TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    target_entity TEXT NOT NULL,
    properties TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at TEXT
);
```

Entity types: `Person`, `Organization`, `Project`, `Concept`, `Event`, `Location`, `Document`, `Tool`, `Custom(String)`.  
Relation types: `WorksAt`, `KnowsAbout`, `RelatedTo`, `DependsOn`, `OwnedBy`, `CreatedBy`, `LocatedIn`, `PartOf`, `Uses`, `Produces`, `Custom(String)`.

### Query API

`KnowledgeStore::query_graph(pattern: GraphPattern)` performs a SQL JOIN:

```sql
SELECT s.*, r.*, t.*
FROM relations r
JOIN entities s ON r.source_entity = s.id
JOIN entities t ON r.target_entity = t.id
WHERE 1=1
  AND (s.id = ? OR s.name = ?)   -- optional source filter
  AND r.relation_type = ?         -- optional relation filter
  AND (t.id = ? OR t.name = ?)   -- optional target filter
LIMIT 100
```

**Critical limitation:** `max_depth` in `GraphPattern` is accepted but **never used**. The query always returns single-hop results. Multi-hop queries (e.g., "find all companies whose board member worked at a company that acquired X") require iterative querying.

### Population Strategy

Agents must explicitly call `knowledge_add_entity` and `knowledge_add_relation`. No automatic entity extraction from tool results. All six "Einstein Hands" (researcher, collector, lead, predictor, twitter, trader) carry the three knowledge graph tools as a compile-time requirement (`bundled.rs:427-456`). The Collector Hand is the primary graph populator; other Hands query it.

### Cross-Hand Coordination via the Knowledge Graph

The knowledge graph is the only persistent cross-Hand state mechanism that doesn't require explicit file-based coordination. All six Einstein Hands access the same `entities` and `relations` tables. The coordination patterns this enables:

| Pattern | Collector → Lead | Collector → Predictor | Researcher → Any |
|---------|-----------------|---------------------|-----------------|
| Mechanism | Collector stores company/person entities | Collector stores market/event entities | Researcher stores source entities |
| Query | Lead queries by industry, role | Predictor queries by domain signals | Any Hand queries for domain knowledge |
| Result | Enriched leads linked to tracked companies | Prediction signals from monitored entities | Cross-referenced facts from research |

The consistency model: each `add_entity`/`add_relation` is a separate SQLite statement with no transaction. Two Hands writing concurrently both succeed — duplicate entities (different UUIDs for the same logical entity) are possible. The worst case is duplicate entity nodes; the JOIN-based queries will return both, and the LLM must handle deduplication.

### Why Not a Real Graph Database?

OpenFang chose SQLite simplicity over graph expressiveness. Neo4j or Memgraph would provide Cypher/Memgraph QL with multi-hop traversal, ACID transactions, and native vector properties. The tradeoff: Neo4j requires a separate service, backup, monitoring, and breaks the single-binary distribution model. OpenFang's philosophy prioritizes operational simplicity — the knowledge graph is a "typed entity store with relations," not a full graph database. For the Einstein Hands' use cases, SQLite is sufficient.

## 11. Scheduler — Two-Level Architecture

OpenFang has **three distinct scheduling constructs** that serve different purposes:

| Construct | Purpose | Granularity |
|-----------|---------|-------------|
| **`AgentScheduler`** | Per-agent resource quotas (tokens/hour, cost/hour/day/month) with rolling windows | Per-agent, accounting |
| **`BackgroundExecutor`** | Execution loops for Continuous/Periodic/Proactive autonomous modes | Per-agent, execution |
| **`CronScheduler`** | Cron-style scheduled jobs (recurring + one-shot) with persistence, retry, multi-destination delivery | Per-agent or global, jobs |

### AgentScheduler — Quota Enforcement

`scheduler.rs:44-145` — Per-agent token quotas with hourly rolling windows via `UsageTracker`:

```rust
pub fn check_quota(&self, agent_id: AgentId) -> OpenFangResult<()> {
    // Rolling 1-hour window: reset if window_start.elapsed() >= 3600s
    // Enforces max_llm_tokens_per_hour
    // No quota = no limit
}
```

Token quotas and cost quotas (`MeteringEngine`) are parallel and unlinked. An agent can hit its token cap before its cost cap, or vice versa.

### BackgroundExecutor — Autonomous Loops

Four schedule modes at `background.rs:21-200`:

```rust
pub enum ScheduleMode {
    Reactive,                              // chat only — no background
    Continuous { check_interval_secs },   // self-prompt on fixed interval
    Periodic { cron },                    // simplified cron (every Ns/m/h/d)
    Proactive { conditions },              // event-triggered via TriggerEngine
}
```

Key properties:
- **Skip-if-busy**: `AtomicBool` CAS rejects overlapping ticks. If previous tick still running, next one is skipped.
- **Global LLM concurrency cap**: `MAX_CONCURRENT_BG_LLM = 5` (hard-coded, not configurable). Protects against runaway cost.
- **Shutdown propagation**: `tokio::select!` listens on supervisor shutdown signal and exits cleanly.
- **Prompt hint**: Continuous loops see `"[AUTONOMOUS TICK]..."`; Periodic sees `"[SCHEDULED TICK]..."`. The LLM decides what to do based on its system prompt + shared memory.

### CronScheduler — Real Cron with Delivery

`cron.rs:1345 LOC` handles real cron expressions (5-field or 6-field with seconds), timezone-aware via `chrono_tz::Tz`. Three schedule variants: `At { absolute_time }`, `Every { secs }`, `Cron { expr, tz }`.

Delivery fan-out to 4 target types concurrently: Channel (40 adapters), Webhook (30s timeout), LocalFile, Email (with subject template `{job}`).

Correctness: `next_run` is pre-advanced *before* job execution, preventing double-fire on restart. After 5 consecutive failures, job is auto-disabled.

## 12. WASM Sandbox — Dual Metering

The WASM sandbox (`sandbox.rs` + `host_functions.rs`, ~1,231 LOC combined) is OpenFang's most technically distinctive security mechanism.

### Engine Initialization

```rust
let mut config = Config::new();
config.consume_fuel(true);       // instruction-count metering
config.epoch_interruption(true);  // wall-clock interruption
let engine = Engine::new(&config).map_err(...)?;
```

One shared engine initialized at `kernel.rs:815-817`, compiled modules are cached.

### Dual Metering

**Fuel (instruction count):** `store.set_fuel(fuel_limit)` where `fuel_limit = max_cpu_time_ms * 100_000` (1 ms ≈ 100,000 fuel). A 10-second budget → 1,000,000,000 fuel. Trap from `OutOfFuel` detected and mapped to `SandboxError::FuelExhausted`.

**Epoch (wall-clock):** `store.set_epoch_deadline(1)` + detached watchdog thread that calls `engine.increment_epoch()` after `timeout_secs` (default 30s). Every Store whose deadline is exceeded traps with `Trap::Interrupt`. This catches runaway I/O waits that burn no fuel.

Both meters fire independently — fuel catches compute loops, epoch catches I/O waits. The combination is the correct design.

### Guest ABI

```wasm
exports:
  memory: linear memory
  alloc(size: i32) -> i32     // bump allocator in guest memory
  execute(ptr: i32, len: i32) -> i64  // ptr<<32 | len

imports (module "openfang"):
  host_call(ptr: i32, len: i32) -> i64
  host_log(level, ptr, len)
```

The only way the guest affects the outside world is `host_call`. Every host function except `time_now` checks capabilities. There is **no WASI** — no `fd_write`, no `environ_get`, no `clock_time_get`.

### Host Functions (Capability-Gated)

```rust
dispatch(method, params):
    "time_now"         → always allowed
    "fs_read"          → requires FileRead capability
    "fs_write"         → requires FileWrite capability
    "fs_list"          → requires FileRead capability
    "net_fetch"        → requires NetConnect + SSRF check
    "shell_exec"       → requires ShellExec capability
    "env_read"         → requires EnvRead capability
    "kv_get"           → requires MemoryRead
    "kv_set"           → requires MemoryWrite
    "agent_send"       → requires AgentMessage
    "agent_spawn"      → requires AgentSpawn
```

### What WASM Can't Do

- No real syscalls, no network sockets, no fork/exec
- No multi-threading (Wasmtime threads available but not used)
- All data crosses JSON-RPC boundary — 10 MB payloads are expensive
- `max_memory_bytes` is declared but **not enforced** (reserved for future Wasmtime 18+ API)

### Where OpenFang Drops to Native Execution

Three execution modes at `kernel.rs:2486-2627`:
- `module = "wasm:..."` → `WasmSandbox::execute()`
- `module = "python:..."` → subprocess Python runtime
- `module = "builtin:chat"` → regular LLM loop (what all 9 bundled Hands use)

Native execution paths outside WASM: Browser Hand (native CDP over WebSocket), Docker sandbox (`--cap-drop ALL --security-opt no-new-privileges`), subprocess sandbox for `shell_exec`.

## 13. Provider Layer

Three native LLM drivers implementing `LlmDriver` (async trait):

| Driver | Coverage | Key Features |
|--------|----------|-------------|
| **AnthropicDriver** | Anthropic Messages API | Content blocks (text, tool_use, tool_result, image), 5MB image cap, Claude-specific streaming |
| **GeminiDriver** | Gemini v1beta API | `x-goog-api-key` auth, `systemInstruction`, `functionDeclarations`, SSE streaming |
| **OpenAiCompatDriver** | 18+ providers (Groq, DeepSeek, OpenRouter, Together, Mistral, Fireworks, etc.) | OpenAI Chat Completions API, provider-specific base_url |

27 providers total, 51 built-in models, 20+ aliases (e.g., `claude` → `claude-sonnet-4-20250514`). Model tiers: Frontier, Smart, Balanced, Fast. Cost rates per model for metering.

The `ModelRouter` selects the appropriate driver based on the model string. All API keys use `Zeroizing<String>` — wiped from memory on drop.

---

# Part III: The Hands System

## 14. HAND.toml Schema

Every Hand is defined by a `HAND.toml` manifest. The schema (`lib.rs:38-330`):

```toml
id = "researcher"
name = "Researcher Hand"
description = "Autonomous deep researcher..."
category = "productivity"     # content, security, productivity, development,
                             # communication, data, finance, other
icon = "🤪"
tools = ["shell_exec", "file_read", ..., "knowledge_query", "event_publish"]

[[requires]]                 # External dependencies
key = "python3"
label = "Python 3 must be installed"
requirement_type = "binary"  # binary, env_var, or api_key
check_value = "python3"

[requires.install]
macos = "brew install python3"
linux_apt = "sudo apt install python3"

[[settings]]                 # Dashboard configuration controls
key = "research_depth"
label = "Research Depth"
setting_type = "select"      # select, toggle, text
default = "thorough"

[[settings.options]]
value = "thorough"
label = "Thorough (20-30 sources, cross-referenced)"

[agent]
name = "researcher-hand"
module = "builtin:chat"     # builtin:chat, wasm:..., python:...
provider = "default"        # or "openai"
model = "default"           # or "gpt-4o"
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

Requirements checking includes special handling for Python 3 (actually runs `python3 --version` to avoid Windows Store shims) and Chromium (4-tier lookup: env vars → PATH → known install paths → Playwright cache).

## 15. Multi-Phase System Prompts

The Hand's `system_prompt` is not a single instruction. It is a **500+ word expert procedure** divided into numbered phases. The Researcher Hand has 8 phases (0–7):

| Phase | Name | What Happens |
|-------|------|-------------|
| 0 | Platform Detection & Context Recovery | OS detection, `memory_recall`, `knowledge_query` |
| 1 | Question Analysis & Decomposition | Classifies as factual/comparative/causal/predictive/how-to/survey |
| 2 | Search Strategy Construction | 3-5 query strategies per sub-question (direct/expert/comparison/temporal/deep) |
| 3 | Information Gathering Core Loop | CRAAP source evaluation, confidence scoring, web search + fetch |
| 4 | Cross-Reference & Synthesis | 2+ source verification, knowledge graph population |
| 5 | Fact-Check Pass | Primary source verification, confidence levels: Verified/Likely/Unverified/Disputed |
| 6 | Report Generation | brief/detailed/academic/executive formats |
| 7 | State & Statistics | `memory_store` for dashboard metrics |

Phase 0 (Platform Detection) always runs first via `python3 -c "import platform"`. Cross-platform awareness is built into every phase — Windows uses `findstr` instead of `grep`, `del` instead of `rm`.

Settings are interpolated at activation time: `research_depth`, `citation_style`, `stt_provider` flow from user configuration into the prompt's decision logic.

## 16. Hand Lifecycle

### Cold Start: `openfang hand activate X`

1. `HandRegistry::activate()` validates hand exists, checks not already active
2. `HandRegistry::check_requirements()` runs binary/env/API key checks
3. `HandRegistry::readiness()` combines requirements + instance state
4. `resolve_settings()` builds prompt block + env vars from user config
5. Kernel spawns agent, `HandRegistry::set_agent()` links `AgentId`
6. `HandRegistry::persist_state()` writes `hands.json` for restart survivability

### State Transitions

```
[Inactive] --activate()--> [Active] --deactivate()--> [Inactive]
                            |
                            +--pause()--> [Paused] --resume()--> [Active]
                            |
                            +--error()--> [Error(msg)]
```

`pause()` only updates the `HandInstance` status — the agent continues running, its SQLite session untouched. When resumed, the agent resumes mid-conversation.

### Run Cycles

Each Einstein Hand runs via `BackgroundExecutor`. The hand's system prompt instructs the LLM to call `schedule_create` to register its own recurrence. The `BackgroundExecutor` fires on schedule and calls the agent loop. Schedule is NOT paused when the hand is paused — the `BackgroundExecutor` checks instance `active` status before firing.

### Deactivation

`HandRegistry::deactivate()` removes the instance from the in-memory `DashMap`. The kernel kills the agent. State persists in SQLite — sessions, memories, knowledge graph entries survive.

### SKILL.md — Compile-Time Knowledge Embedding

Each Hand bundles a `SKILL.md` embedded via `include_str!()` at `bundled.rs:10-12`:

```rust
const RESEARCHER_SKILL: &str = include_str!("../bundled/researcher/SKILL.md");
const COLLECTOR_SKILL: &str = include_str!("../bundled/collector/SKILL.md");
// ... all 9
```

The skill content is attached to `HandDefinition.skill_content` at `bundled.rs:64-66` and injected into the agent context at runtime. The `runtime` field in the SKILL.md frontmatter specifies execution mode:

- `"prompt_only"` — content appended to system prompt verbatim (Researcher, Collector, Predictor, Lead, Twitter, Trader, Browser)
- `"python"` — executable Python code (Infisical-Sync only)
- `"wasm"` — WASM module (none of the bundled Hands use this)

This means the bundled Hands' knowledge is **static at compile time**. The SKILL.md content cannot be updated without recompiling the binary. User-installed hands (`~/.openfang/hands/<id>/`) can update their SKILL.md at runtime by writing the file, but the content is loaded once at activation time.

### Inter-Hand Communication — Three Channels

Direct Hand-to-Hand communication is not implemented. Three indirect channels exist:

1. **Shared knowledge graph** — All Einstein Hands read/write the same `entities` and `relations` tables. Any Hand can query what another has stored.

2. **Event bus** — `event_publish` tool emits events to the kernel's `EventBus`. `TriggerEngine` pattern-matches and fires Proactive agents. But events are not addressed to specific Hand instances — they are broadcast to the kernel.

3. **Shared memory namespace** — The shared namespace (fixed agent ID `00000000-...01`) enables cross-agent data storage via `memory_store`/`memory_recall`. Any Hand can store structured data that other Hands can recall.

The most powerful coordination mechanism is the knowledge graph: the Collector populates it continuously; the Lead, Predictor, and Researcher query it. This creates an implicit data dependency where Hands build on each other's work without direct communication.

## 17. All 9 Bundled Hands Analyzed

### 1. Clip Hand — YouTube → Vertical Shorts

**What it does:** Transforms long-form video into vertical shorts with captions and thumbnails. 8 phases: Intake → Download → Transcribe → Analyze → Extract → TTS → Publish → Report.

**Implementation:** `shell_exec` drives FFmpeg + yt-dlp entirely. No native Rust video processing. 5 STT backends tried in priority order: YouTube auto-subs (fastest), Groq Whisper (free tier), OpenAI Whisper API, Deepgram Nova-2, local Whisper binary, FFmpeg scene detection fallback.

**Requirements:** `ffmpeg`, `ffprobe`, `yt-dlp` (all binary requirements).

**Notable:** Despite HAND.toml claiming "Playwright bridge," runtime uses native CDP over WebSocket.

---

### 2. Lead Hand — B2B Lead Generation

**What it does:** Daily discovery of prospects matching an Ideal Customer Profile (ICP), enrichment at 3 levels (Basic/Standard/Deep), deduplication, 0-100 scoring.

**Implementation:** ICP stored in knowledge graph for cross-hand visibility. 5-10 web search queries combining industry + role + growth signals. Deduplication via `leads_database.json` (file-based, not KG). Scoring: ICP match (+30), growth signals (+20), enrichment completeness (+20), recency (+15), accessibility (+15).

**Requirements:** None (all tools built-in).

---

### 3. Collector Hand — OSINT Monitoring

**What it does:** Continuous monitoring of any target with change detection, sentiment tracking, knowledge graph construction.

**Implementation:** Up to 100 sources per cycle. Entity types: Person, Company, Product, Event, Number. Relations: `works_at`, `founded`, `invested_in`, `competes_with`, `launched`, `acquired`. Phase 5 compares against `collector_knowledge_base.json` snapshot — identifies new entities, changed attributes, disappeared entities. `alert_on_changes` triggers `event_publish`.

**Notable:** Primary knowledge graph populator. The change detection is its most distinctive feature.

**Requirements:** None.

---

### 4. Predictor Hand — Superforecasting

**What it does:** Collects signals from news/social/financial/academic sources, builds calibrated reasoning chains, makes falsifiable predictions with confidence intervals, tracks Brier scores over time.

**Implementation:** 20-40 queries per cycle, each tagged by type (leading/lagging/base_rate/expert_opinion), strength, direction, credibility. Accuracy review: for expired predictions, searches for outcome evidence, calculates Brier score `(predicted_prob - actual)^2`. Contrarian mode actively seeks counter-consensus.

**Notable:** Closest OpenFang gets to a learning loop — but scoped to prediction accuracy, not skill improvement.

**Requirements:** None.

---

### 5. Researcher Hand — Deep Autonomous Research

**What it does:** Exhaustive investigation with CRAAP source evaluation, cross-referencing, fact-checking, structured reports in 4 formats.

**Implementation:** Phase 1 classifies question type and drives query strategy. Phase 3 applies CRAAP test (Currency, Relevance, Authority, Accuracy, Purpose) to each source, scored A-F. Phase 4 cross-references — claims in 2+ independent sources marked verified. Phase 5 fact-checks against primary sources. Report formats: brief, detailed (5-10 pages), academic (formal paper), executive (key findings + recommendations).

**Requirements:** None.

---

### 6. Twitter Hand — Autonomous Twitter/X Manager

**What it does:** Content generation in 5 styles, posting via Twitter API v2, auto-reply to mentions, engagement tracking.

**Implementation:** 7 rotating format templates (insight/citation/question/thread/story/fact/tutorial). `auto_reply` creates reactive loop for incoming mentions. Highest temperature of any Hand: 0.7 (appropriate for creative content).

**Requirements:** `TWITTER_BEARER_TOKEN` (api_key requirement).

---

### 7. Browser Hand — Web Automation

**What it does:** Native Chrome DevTools Protocol automation — navigates sites, fills forms, clicks buttons, completes multi-step tasks. Mandatory purchase approval gate.

**Implementation:** Native CDP over WebSocket (`ws://localhost:{port}/devtools/browser/...`). Session persistence (cookies, login state) across tool calls within a conversation. Max concurrent sessions enforced. Idle timeout for abandoned sessions.

**Purchase approval gate:** Phase 4 is a **prompt-enforced** stop — system prompt instructs LLM to summarize cost, show total, list items, STOP and ask for confirmation before any payment. **No code-level enforcement.** If the LLM disobeys, no code gate fires.

**Requirements:** `python3` (non-optional), `chromium` (optional — falls back to Playwright-bundled chromium).

---

### 8. Trader Hand — Trading Signal Analysis

**What it does:** Market intelligence and trading signal analysis, three modes (analysis-only, paper trading, live trading via Alpaca API).

**Implementation:** Phase 2 collects signals (news, financial data, technical indicators). Phase 3 constructs bull/bear cases with adversarial reasoning. Phase 4 enforces risk management (position sizing, max drawdown limits, circuit breakers). Highest `max_iterations` of any Hand: 80.

**Requirements:** None (Alpaca API keys are settings, not hard requirements).

---

### 9. Infisical-Sync Hand — Secret Synchronization

**What it does:** Bidirectional sync between self-hosted Infisical instance and OpenFang credential vault.

**Implementation:** Initial secrets pull from Infisical → `vault_set` for each. Continuous sync on 5/15/30/60 minute intervals. Reverse sync via `vault_set` → Infisical API. Drift detection alerts on discrepancies.

**Notable:** Only Hand with `runtime: python` in its SKILL.md (not `prompt_only`). Lowest temperature of any Hand: `<0.2` (security-critical operations).

**Requirements:** `INFISICAL_URL`, `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET` (all env_var requirements).

---

## 18. State Persistence Between Runs

| Storage | Mechanism | Survives Restart? |
|---------|-----------|-------------------|
| Agent session | SQLite `sessions` table | Yes |
| Structured memory | SQLite `kv_store` (per-agent) | Yes |
| Knowledge graph | SQLite `entities` + `relations` | Yes |
| Canonical session | SQLite `canonical_sessions` | Yes |
| Schedule registry | In-memory `DashMap` | No — restored from `schedule_create` calls |
| Hand instance registry | `~/.openfang/hands.json` | Yes |
| Hand source files | `~/.openfang/hands/<id>/` | Yes |
| Knowledge base JSON | `collector_knowledge_base.json` | Yes |
| Predictions ledger | `predictions_database.json` | Yes |
| Leads database | `leads_database.json` | Yes |

No explicit backup tool. User responsible for `cp ~/.openfang/data/openfang.db`. The "pause without losing state" claim is partially accurate — pausing a hand preserves the agent session but the schedule continues firing (pausing only prevents the instance from processing events).

---

# Part IV: Operational Characteristics

## 19. Strengths and Killer Features

**1. Single-binary distribution with zero runtime dependencies.** ~32 MB, ships with embedded web dashboard. Cold start under 200ms (claimed). Runs on macOS, Linux, Windows. No Docker daemon, no Python environment, no Node.js runtime.

**2. WASM dual-metered sandbox is genuinely novel.** Fuel (instruction-count) + epoch (wall-clock) via Wasmtime. One shared engine, watchdog thread for epoch interruption. The combination catches both runaway compute and runaway I/O waits. No other agent harness has an equivalent default isolation layer for third-party modules.

**3. Hands as complete autonomous operational units.** Nine pre-built agents with full multi-phase prompts, tool access, settings schema, state management, and scheduling. The "Einstein Hand" pattern — schedule + memory + knowledge graph + event publishing — is a well-defined template for building new autonomous agents.

**4. Multi-phase prompts encode genuine domain expertise.** The Researcher Hand's 8-phase CRAAP-based procedure, the Collector's change detection, the Predictor's Brier score tracking — these are not generic prompts. They encode real methodology from research, OSINT, and forecasting disciplines.

**5. 16-layer security model with cryptographic audit trail.** Merkle hash-chain audit trail (tamper-evident), taint propagation (prevents prompt injection → shell execution), capability gates (denier-default), SSRF protection (5-layer blocklist with DNS rebinding mitigation), secret zeroization (`Zeroizing<String>`), GCRA rate limiting.

**6. Two-level scheduler with concurrency protection.** `AgentScheduler` enforces per-agent token quotas; `BackgroundExecutor` manages autonomous loops with skip-if-busy semantics and a global LLM concurrency cap of 5.

**7. Knowledge graph as cross-agent shared state.** Six Einstein Hands share the same SQLite-backed knowledge graph, enabling coordination patterns (Collector populates → Researcher queries → Lead uses for scoring).

**8. 27 LLM providers with 3 native drivers.** Anthropic-first design but every Hand can override. `default` provider keyword falls through to kernel config. Model catalog with 51 entries, 20+ aliases, cost rates per model.

## 20. Weaknesses and Security Gaps

**1. WASM `max_memory_bytes` not enforced.** The field is declared in `SandboxConfig` and propagated but never actually checked. Wasmtime linear memory can grow up to the module's `memory.max` (default 4 GiB). The fix requires Wasmtime 18+ `Store::limiter` API. This is the largest gap between the "dual-metered sandbox" claim and actual behavior. The practical mitigations are the default 1-page (64 KiB) allocation and the `[agent] max_iterations` cap, but a malicious module declaring `(memory 1000)` would be allowed.

**2. Browser Hand purchase approval is prompt-only.** The mandatory purchase gate at `browser/HAND.toml:146-155` is a system prompt instruction with no code-level enforcement. Additionally, the Browser Hand is auto-approved for all tool calls (`kernel.rs:7588-7591` — Hand agents bypass the approval system). A misbehaving or jailbroken model could skip the approval. This is compounded by the fact that Hand agents are explicitly tagged as "curated trusted packages" — the trust assumption is that Hand authors won't ship malicious bundles, but there's no technical enforcement of that trust.

**3. Manifest signing is capability-only, not enforced at boot.** `manifest_signing.rs` provides Ed25519 signing/verification but the kernel does not require signed manifests at spawn time. Supply-chain attacks on Hand manifests are not structurally prevented. An attacker who can write to `~/.openfang/hands/<id>/HAND.toml` could modify capabilities, tools, or system prompts with no cryptographic detection.

**4. No autonomous skill improvement.** Unlike Hermes Agent (which has a Curator that autonomously reviews and archives agent-created skills), OpenFang's skills are static. Hands can `file_write` new skills at runtime but there is no usage tracking, no curator review, no auto-archive of stale skills. The Predictor Hand comes closest with its Brier score tracking, but that is scoped to prediction accuracy, not the skill improvement loop.

**5. No dedicated coding Hand.** All 9 bundled Hands are data/research/social media/monitoring agents. Coding is handled by 31 reactive chat-based agent templates, not autonomous Hands. OpenFang has no equivalent to Hermes's long-horizon coding loop (`patch` tool + batch_runner trajectory capture). For users who want an autonomous coding agent that runs on a schedule, reads repos, writes patches, and runs tests, OpenFang has no offering.

**6. Knowledge graph `max_depth` is ignored.** `GraphPattern.max_depth` is accepted but the SQL query always returns single-hop results. Multi-hop queries require iterative calling, which the LLM must manage explicitly. This makes graph traversal cumbersome — the LLM must issue multiple `knowledge_query` calls, each one a separate tool invocation, to traverse a path of length > 1.

**7. No deduplication in knowledge graph.** `add_entity` with empty `id` generates a new UUID each time. Two Hands independently adding "Acme Corp" get different UUIDs. The graph ends up with duplicate entity nodes for the same logical entity, polluting query results. Deduplication is the responsibility of each Hand's implementation — and the bundled Hands don't consistently handle it (Lead deduplicates via `leads_database.json`, not the graph; Collector deduplicates against its own JSON snapshot).

**8. Cron firings not in audit log.** The Merkle audit trail records tool invocations and security events but not cron job executions. `last_status` and `last_run` are the only records of cron execution outcomes. For compliance scenarios requiring tamper-evident logs of all automated actions, this is a gap.

**9. README vs. code discrepancies.** README claims 7 bundled Hands (actual: 9), Playwright bridge (actual: native CDP), "2,696+ passing" tests (actual: 1,767+). Documentation drift suggests the README was written before the final implementation. Users relying on README accuracy will encounter surprises.

**10. Global LLM concurrency cap of 5 is not configurable.** `MAX_CONCURRENT_BG_LLM = 5` is a hard-coded `const`. This means a deployment with many concurrent Hands is artificially throttled. The workaround (spawn more Hand instances) doesn't apply when the bottleneck is the concurrency cap itself.

**11. No rollback for knowledge graph writes.** Each `add_entity`/`add_relation` is a separate SQLite statement with no multi-step atomic operation. If a Hand's Phase 4 population (say, 5 entities + 4 relations) crashes partway through, the graph is left partially populated with dangling relations. There's no transaction semantics.

**12. Solo authorship at 198K LOC.** RightNow-AI has built something architecturally impressive but the maintenance burden of 198K LOC of Rust with no apparent team is a real risk for long-term sustainability. A project of this scope typically requires a team to maintain, test, and evolve.

## 21. Target Audience

**Primary:** Rust developers and self-hosters who want a zero-dependency agent runtime that runs 24/7 as a daemon. The single-binary distribution and embedded dashboard appeal to operators who want full control without Docker or Python environments.

**Secondary:** Power users who want pre-built autonomous agents (research, lead generation, monitoring, social media management) without writing prompt engineering code.

**Not a fit:** Teams needing horizontal scaling (SQLite-only), teams needing Python extensibility (Rust-only with WASM/Python as opt-in), teams needing a managed cloud service.

## 22. Production Readiness

**Strengths for production:**
- Single-binary distribution eliminates entire classes of deployment bugs — no pip install, no Python version conflicts, no virtual environment management
- SQLite persistence survives restarts cleanly — agents restore from the same `openfang.db` file, background loops restart, schedules persist
- 16 security layers including cryptographic audit trail — the Merkle hash chain makes post-hoc tampering detectable
- Comprehensive error recovery (session repair, loop guard, context overflow recovery) — the system is designed to survive corrupted sessions, tool-call loops, and context exhaustion
- Comprehensive test suite (1,767+ tests) with compile-time enforcement of Einstein Hand invariants
- Zero clippy warnings enforced in CI — the codebase is held to a high code quality standard
- GCRA rate limiting on the API prevents request-flooding DoS attacks
- Secret zeroization (`Zeroizing<String>`) prevents API key disclosure in core dumps

**Concerns for production:**
- **Solo authorship** — no visible maintainer diversity at 198K LOC. A project of this scope typically requires a team. The risk is not just bus factor; it's the scope-to-maintainer ratio. Every new model provider, every new channel adapter, every security patch requires sustained attention from one person.
- **SQLite limits write concurrency** — single writer. Multiple agents writing concurrently will serialize at the WAL level. For workloads with many concurrent agents, this becomes a bottleneck.
- **No horizontal scaling path** — no Postgres option, no Redis, no distributed storage. The entire state lives in one SQLite file on one machine. For high-availability deployments, there is no native path.
- **WASM memory enforcement gap** — `max_memory_bytes` is not enforced, creating a gap between the security claim and the security reality.
- **Purchase approval gap** — the Browser Hand's purchase gate is prompt-only. For production web automation, this is a real risk if the model is exposed to adversarial content (prompt injection via webpage content).
- **No incident response/runbook culture** — the codebase shows no evidence of operational playbooks. When something goes wrong in production (a Hand enters a cost explosion loop, the SQLite WAL fills the disk), the operator is on their own.
- **Global LLM concurrency cap is not observable** — the 5-cap semaphore is invisible to the dashboard. An operator cannot see how many of the 5 slots are in use.
- **Database backup is manual** — `cp ~/.openfang/data/openfang.db` is the recommended backup method. No built-in backup tool, no point-in-time recovery.

**Operational Smoke Test**

Before deploying OpenFang to production, validate these failure modes:

1. **Kill the daemon mid-execution** — does the agent resume correctly? Does the knowledge graph survive?
2. **Fill the SQLite WAL** — run many concurrent agents and observe whether write latency degrades
3. **Trip the loop guard** — run a Hand that calls the same tool 30 times — does the circuit breaker fire cleanly?
4. **Test the purchase approval** — give the Browser Hand a fake e-commerce page with a prompt injection. Does it ask for approval?
5. **Verify the audit trail** — manually corrupt an audit entry. Does `GET /api/audit/verify` detect it?
6. **Test cron persistence** — add a cron job, kill the daemon, restart. Is the job still there?

---

# Part V: BizarHarness Application

## 23. Top 5 Patterns to Adopt from OpenFang

### Pattern 1: WASM Sandbox with Dual Metering

OpenFang's WASM sandbox (fuel + epoch) is the most mature open-source implementation of sandboxed tool execution for LLM agents. BizarHarness should adopt dual metering: fuel (instruction-count) via Wasmtime for deterministic CPU accounting, and epoch (wall-clock) via a watchdog thread for I/O wait bounds. The capability-gated host ABI (`host_call` with capability checks per method) is a clean security model that should be adapted directly.

**Why this matters for BizarHarness:** The WASM sandbox is the only mechanism in any surveyed harness that provides deterministic resource bounds independent of host load. A Docker container's memory limits are best-effort under contention; Wasmtime fuel is instruction-accurate regardless of what else is running on the host.

**Implementation path:** Evaluate Wasmtime vs. Wasmer. OpenFang uses Wasmtime 43. The memory enforcement gap (`max_memory_bytes` not enforced) should be tracked as a known limitation until Wasmtime 18+ `Store::limiter` API is available. The host ABI pattern (capability-gated `host_call`) is directly portable to BizarHarness.

### Pattern 2: Knowledge Graph with SQLite Backend

OpenFang's knowledge graph — two tables, SQL JOIN queries, confidence scores on relations, shared across all agents — is a zero-dependency pattern that works at the scale of a single machine. The `GraphPattern` filter (source/relation/target with optional values) and the entity + relation type enums are well-designed. BizarHarness should adopt a similar schema for cross-agent state.

**Why this matters for BizarHarness:** Multi-agent coordination without shared state leads to redundant work and inconsistency. A shared knowledge graph — even a simple one — enables patterns like "Collector populates → Researcher queries → Lead uses for scoring" without any explicit inter-agent messaging.

**Key lesson:** `max_depth` must be implemented from the start (OpenFang's failure to implement it means the feature is useless). The deduplication problem (UUID-per-call with no dedup at storage layer) should be solved at the application layer with a name-based upsert, not left to each Hand to solve independently.

### Pattern 3: Multi-Phase Expert Prompts for Autonomous Hands

The "Einstein Hand" pattern — a Hand that carries `schedule_create/list/delete`, `memory_store/recall`, `knowledge_add_entity/relation/query`, and `event_publish` — is a complete autonomous loop template. BizarHarness should adopt this pattern for its own autonomous agents: a consistent set of tools (scheduler, memory, knowledge graph, events) that all autonomous agents carry, with multi-phase prompts that encode genuine domain procedure.

**Why this matters for BizarHarness:** Autonomous agents need structure beyond "call the LLM in a loop." The multi-phase prompt structure (Phase 0: Platform Detection → Phase N: State Persistence) enforces a disciplined operational procedure. Without it, autonomous agents tend to drift into repetitive patterns or lose state between iterations.

**Key lesson:** The prompt phase structure is reusable across domain types. Phase 0 (platform detection), Phase N-1 (report generation), and Phase N (state persistence) are universal. The phases in between are domain-specific and should be encoded as templates that Hand authors fill in.

### Pattern 4: Two-Level Scheduler (Quota + Execution)

The `AgentScheduler` (accounting) + `BackgroundExecutor` (execution) split is clean. BizarHarness should adopt per-agent token quotas with rolling windows AND a background executor with skip-if-busy semantics and a global concurrency cap. The global LLM semaphore (`MAX_CONCURRENT_BG_LLM = 5`) is a cost protection mechanism that should be in every agent harness.

**Why this matters for BizarHarness:** Unbounded concurrent LLM calls are a cost explosion risk. With a global semaphore, the worst-case cost per minute is bounded regardless of how many agents are configured. Without it, N agents × M concurrent calls = N×M simultaneous LLM requests.

**Key lesson:** The global concurrency cap must be hard-coded or made very large by default. If it is configurable with a default of 1, users never discover the benefit. OpenFang's default of 5 is a reasonable starting point. The skip-if-busy pattern (AtomicBool CAS) is also critical — overlapping ticks should be skipped, not queued, to prevent cascade failures.

### Pattern 5: Rust Reliability with Compile-Time Guarantees

OpenFang's zero clippy warnings enforcement, comprehensive test suite, and single-binary distribution are a model for BizarHarness's own quality bar. The `include_str!()` pattern for embedding skill content at compile time is elegant — BizarHarness should adopt it for any bundled prompts or configuration.

**Why this matters for BizarHarness:** Compile-time guarantees eliminate entire classes of bugs that Python frameworks must catch at runtime. The absence of a GIL in Rust enables genuine parallelism for concurrent agent execution. The single-binary distribution model (as OpenFang demonstrates) is the most operator-friendly deployment model.

**Key lesson:** The 198K LOC scope is too large for solo maintenance. BizarHarness should stay lean — every crate should have a clear owner and a clear scope. The "Agent OS" metaphor is compelling but the kernel's 30-field monolith is a maintenance risk that should be avoided through explicit subsystem boundaries and trait-based interfaces.

## 24. Top 3 Things to Avoid

### Avoid 1: The Single-Binary "Agent OS" Ambition

OpenFang's OS metaphor leads to a monolithic kernel (`OpenFangKernel` with 30+ fields) that assembles every subsystem at boot. At 198K LOC, this is a maintenance burden for a solo project. BizarHarness should resist the temptation to build a monolithic "everything including the kitchen sink" harness. Better to have clear boundaries between components with explicit interfaces (`KernelHandle` trait) and separate crates with well-defined responsibilities.

The kernel boot sequence — 13 sequential steps — means a failure in step 8 (any subsystem initialization) aborts the entire boot. A modular architecture where each subsystem can fail independently (and the kernel continues with degraded functionality) is more resilient.

### Avoid 2: No Long-Horizon Coding Hand

OpenFang has no autonomous coding agent — coding is handled by reactive chat templates. This is a significant gap for developer-facing use cases. BizarHarness should build a dedicated autonomous coding Hand early, with explicit loop structure: search → read → edit → test → commit, with trajectory capture for replay.

The absence of a coding Hand also means OpenFang cannot autonomously improve its own skills or fix bugs in its bundled Hands. Hermes Agent's Curator can review and archive agent-created skills; OpenFang has no equivalent. BizarHarness should build the coding + skill improvement loop together.

### Avoid 3: Rust-Only Ecosystem Lock-In

While Rust provides compile-time guarantees and excellent performance, the ecosystem is smaller than Python for agent tooling. OpenFang's Python integration requires subprocess spawning, losing the benefits of the Rust type system. BizarHarness should support both Rust core components and Python/Node.js extensibility at the tool layer, without requiring Rust for every tool.

OpenFang's approach — three execution modes (`builtin:chat`, `python:...`, `wasm:...`) — is the right model. BizarHarness should follow the same pattern: Rust for the core, WASM for sandboxed third-party modules, and subprocess spawning for Python/Node.js tools where Rust ecosystem support is lacking.

## 25. Migration Considerations

**From OpenFang to BizarHarness:**

### 1. Hand Manifests (`HAND.toml`)

The TOML schema is well-designed with clear separation between identity (`id`, `name`, `category`), dependencies (`requires`), configuration (`settings`), agent config (`agent`), and observability (`dashboard`). BizarHarness should support a compatible or convertible `HAND.toml` format so existing OpenFang Hands can be imported with minimal friction.

The `[[requires]]` system — with platform-specific install instructions, binary path checking, and API key validation — is particularly valuable and should be replicated. The `check_python3_available` implementation (actually running `python3 --version` and checking for "Python 3" in output) is the right approach for cross-platform detection.

### 2. Memory and Knowledge Graph

The SQLite schema is portable. The entities and relations tables can be migrated directly. The key migration considerations are:
- The JSON `properties` blob in both tables requires a migration step to convert to BizarHarness's schema
- The confidence field on relations (0.0–1.0) should be preserved
- The `max_depth` feature that OpenFang doesn't implement: BizarHarness should implement it from the start

### 3. Agent Sessions

Session persistence format should be migratable. OpenFang's session repair (7-phase validation) is a good reference for session integrity. The `canonical_sessions` table (schema v5 addition) is particularly important — it enables cross-channel memory where the same agent on different channels shares a compacted summary. BizarHarness should implement this.

### 4. Skills

OpenFang's SKILL.md format (YAML frontmatter + markdown body with `runtime: prompt_only` or `runtime: python`) is compatible with BizarHarness's skill format. The prompt injection scanner patterns at `verify.rs:109-179` were derived from 341 malicious skills discovered on ClawHub in February 2026 — this is real-world threat intelligence that should be incorporated directly into BizarHarness's skill verification.

### 5. Provider Configuration

OpenFang's `ProviderInfo` struct (name, driver_type, base_url, key_env_var, auth_status) and the three-driver model (Anthropic/Gemini/OpenAI-compat) are directly portable. The model catalog with aliases and cost rates should also be importable.

### 6. Channel Adapters

OpenFang's 40 channel adapters represent substantial engineering investment. Rather than porting all 40, BizarHarness should evaluate which channels are highest-value (Telegram, Discord, Slack, WhatsApp, Email) and implement those first using OpenFang's adapter pattern as a reference. The OFP wire protocol for P2P agent communication should be supported as an inter-harness protocol.

### 7. Security State

- **Capability grants**: The `DashMap<AgentId, Vec<Capability>>` format is portable to BizarHarness's capability system
- **Approval policies**: The per-tool approval configuration (`require_approval = ["shell_exec", "file_delete", "vault_delete", "agent_kill"]`) should be importable
- **Merkle audit trail**: The hash chain structure is portable but the entries are OpenFang-specific. BizarHarness should implement its own audit trail rather than trying to import OpenFang's entries

### 8. What Cannot Be Migrated

- **Compiled Rust binaries**: OpenFang is MIT/Apache-2.0, so the code can be studied and adapted, but the compiled binary cannot be imported
- **WASM modules**: Compiled `.wasm` files are binary and must be recompiled for BizarHarness's WASM ABI (which may differ from OpenFang's `host_call` interface)
- **Agent runtime state**: In-flight agent sessions cannot be migrated mid-execution; a clean restart is required

---

## Appendix: Code Reference Index

| System | File | Lines | Key Structs/Functions |
|--------|------|-------|----------------------|
| Agent loop | `openfang-runtime/src/agent_loop.rs` | 5,200 | `run_agent_loop()`, `MAX_ITERATIONS=50` |
| Tool runner | `openfang-runtime/src/tool_runner.rs` | 5,014 | 53-tool match dispatch |
| Kernel | `openfang-kernel/src/kernel.rs` | — | `OpenFangKernel`, `boot_with_config()` |
| WASM sandbox | `runtime/src/sandbox.rs` | 614 | `WasmSandbox::execute()`, dual metering |
| Host functions | `runtime/src/host_functions.rs` | 617 | `dispatch()`, capability-gated |
| Knowledge graph | `openfang-memory/src/knowledge.rs` | 346 | `KnowledgeStore::query_graph()` |
| Memory substrate | `openfang-memory/src/substrate.rs` | — | `MemorySubstrate`, 6 storage layers |
| Hand registry | `openfang-hands/src/registry.rs` | — | `HandRegistry::activate()`, `check_requirements()` |
| Hand definition | `openfang-hands/src/lib.rs` | — | `HandDefinition`, `parse_hand_toml()` |
| Scheduler | `openfang-kernel/src/scheduler.rs` | 191 | `AgentScheduler::check_quota()` |
| Background executor | `openfang-kernel/src/background.rs` | 457 | `BackgroundExecutor::start_agent()` |
| Cron scheduler | `openfang-kernel/src/cron.rs` | 1,345 | `CronScheduler`, `due_jobs()` |
| Cron delivery | `openfang-kernel/src/cron_delivery.rs` | 739 | `CronDeliveryEngine::deliver()` |
| Capability | `openfang-types/src/capability.rs` | 316 | `Capability`, `capability_matches()` |
| Taint tracking | `openfang-types/src/taint.rs` | 244 | `TaintLabel`, `TaintSink` |
| Audit trail | `openfang-runtime/src/audit.rs` | 422 | SHA-256 hash chain |
| Session repair | `openfang-runtime/src/session_repair.rs` | 1,464 | 7-phase validation |
| Loop guard | `openfang-runtime/src/loop_guard.rs` | 949 | SHA-256 repetition detection |
| Subprocess sandbox | `runtime/src/subprocess_sandbox.rs` | 1,240 | `env_clear()`, metacharacter block |
| SSRF protection | `openfang-runtime/src/web_fetch.rs` | 541 | `check_ssrf()`, hostname/IP blocklists |
| Workspace sandbox | `runtime/src/workspace_sandbox.rs` | 148 | `resolve_sandbox_path()`, symlink escape prevention |
| Approval manager | `openfang-kernel/src/approval.rs` | 467 | `ApprovalManager`, risk classifier |
| Security headers | `api/src/middleware.rs` | — | CSP, HSTS, X-Frame-Options |
| Prompt injection scanner | `openfang-skills/src/verify.rs` | 294 | 341-malicious-skill pattern list |
| Browser (CDP) | `openfang-runtime/src/browser.rs` | 1,362 | `CdpConnection`, JSON-RPC over WebSocket |
| Agent scheduler | `openfang-kernel/src/scheduler.rs` | 191 | `AgentScheduler`, rolling 1-hour window |
| Metering engine | `openfang-kernel/src/metering.rs` | 815 | cost quotas, model pricing table |
| OFP wire | `openfang-wire/src/peer.rs` | — | HMAC-SHA256, 5-min replay window |
| Manifest signing | `openfang-types/src/manifest_signing.rs` | 166 | Ed25519 signing/verification |
| Dashboard | `openfang-api/static/` | — | embedded HTML/CSS/JS |
| Bundled hands | `openfang-hands/src/bundled.rs` | — | 9 `include_str!()` embeds |

---

*Report compiled from: round-1-recon (openfang-recon.md), round-2-architecture (openfang-architecture.md), round-3-crossref (cross-reference.md, deep-subsystems.md), round-5-openfang-deep (hands-system.md, knowledge-graph.md, wasm-sandbox.md, scheduler.md, security-model.md). Cross-referenced against: round-7-bestof-deep, round-8-multi-agent, round-9-memory, round-10-security, round-11-coding.*
