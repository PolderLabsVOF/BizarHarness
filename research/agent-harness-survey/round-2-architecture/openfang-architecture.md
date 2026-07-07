# OpenFang Architecture Deep Dive

**Repository**: `repos/openfang/` | **Version**: 0.6.9 | **Language**: Rust (edition 2021)
**Total LOC**: ~198,748 across 13 crates + xtask

---

## 1. The Agent Loop (Rust)

### Entry Point

The main agent loop entry point is `run_agent_loop()` at `crates/openfang-runtime/src/agent_loop.rs:293`. It takes **15 parameters**:

```rust
pub async fn run_agent_loop(
    manifest: &AgentManifest,
    user_message: &str,
    session: &mut Session,
    memory: &MemorySubstrate,
    driver: Arc<dyn LlmDriver>,
    available_tools: &[ToolDefinition],
    kernel: Option<Arc<dyn KernelHandle>>,
    skill_registry: Option<&SkillRegistry>,
    mcp_connections: Option<&tokio::sync::Mutex<Vec<McpConnection>>>,
    web_ctx: Option<&WebToolsContext>,
    browser_ctx: Option<&crate::browser::BrowserManager>,
    embedding_driver: Option<&(dyn EmbeddingDriver + Send + Sync)>,
    workspace_root: Option<&Path>,
    on_phase: Option<&PhaseCallback>,
    media_engine: Option<&crate::media_understanding::MediaEngine>,
    tts_engine: Option<&crate::tts::TtsEngine>,
    docker_config: Option<&openfang_types::config::DockerSandboxConfig>,
    hooks: Option<&crate::hooks::HookRegistry>,
    context_window_tokens: Option<usize>,
    process_manager: Option<&crate::process_manager::ProcessManager>,
    user_content_blocks: Option<Vec<ContentBlock>>,
) -> OpenFangResult<AgentLoopResult>
```

This is a massive function that handles the full lifecycle of a single agent turn.

### Loop Internals (agent_loop.rs:506-680+)

The core loop at line 506:

```rust
for iteration in 0..max_iterations {
    // 1. Context overflow recovery
    let recovery = recover_from_overflow(&mut messages, &system_prompt, available_tools, ctx_window);

    // 2. Apply context guard (trim oversized tool results)
    apply_context_guard(&mut messages, &context_budget, available_tools);

    // 3. Call LLM with retry + exponential backoff
    let mut response = call_with_retry(&*driver, request, ...).await?;

    // 4. Handle stop_reason
    match response.stop_reason {
        EndTurn | StopSequence => { /* finalize */ }
        ToolUse => {
            // 5. For each tool call:
            for tool_call in response.tool_calls {
                // a. Check capability
                // b. Execute with 60s timeout (120s for browser, 600s for agent)
                // c. Truncate if >50K chars
                // d. Check loop guard
            }
            // 6. Auto-compact if threshold exceeded (80% of context window)
        }
        MaxTokens => { /* handle continuation */ }
    }
}
```

### Key Constants
- `MAX_ITERATIONS = 50` (agent_loop.rs:35)
- `MAX_RETRIES = 3` with exponential backoff starting at 1s (line 38-41)
- `TOOL_TIMEOUT_SECS = 120` (line 47) — raised from 60s for browser/coding
- `AGENT_TOOL_TIMEOUT_SECS = 600` (line 53) — 10 minutes for inter-agent delegation
- `MAX_CONTINUATIONS = 5` (line 85) — raised from 3 for long-form generation
- Default context window: 200,000 tokens (line 225)

### Differences from Python-Based Agents

| Aspect | OpenFang (Rust) | Python Frameworks (LangGraph, CrewAI, AutoGen) |
|--------|-----------------|------------------------------------------------|
| **Concurrency** | Native async/await (Tokio). No GIL. | Async via asyncio. GIL-bound for CPU work. |
| **Memory model** | Zero-cost abstractions. `Arc<Mutex<>>` for SQLite. | Reference counting + GC pauses. |
| **Binary size** | ~32 MB single binary, no runtime deps | 100-500 MB with pip venv |
| **Cold start** | 180ms (claimed). Streams kernel at boot. | 2-6 seconds (Python import overhead) |
| **Idle memory** | ~40 MB | 180-400 MB |
| **Safety** | Compile-time. Zero clippy warnings enforced. | Runtime. No equivalent guarantee. |
| **WASM** | Native wasmtime integration | Requires separate WASM runtimes |

### Async Runtime
**Tokio** with full features (`Cargo.toml:29`). `spawn_blocking` bridges SQLite operations. `tokio::select!` used throughout for shutdown signals and timeouts.

### Error Recovery
- **Loop guard** (`agent_loop.rs:490-498`): SHA256-based `(tool_name, params)` repetition detection. Three-phase: warn (3×), block (5×), circuit-break (30×).
- **Session repair** (`validate_and_repair()`): Drops orphaned ToolResult messages, removes empty messages, merges consecutive same-role.
- **Context overflow recovery** (`recover_from_overflow()`): Multi-stage pipeline that drains messages, summarizes, and retries.
- **Phantom action detection** (`agent_loop.rs:94-111`): Scans LLM output for claims of having sent/posted/emailed without calling tools.
- **Silent failure retry**: One-shot retry when LLM returns empty (0 input tokens → silently failed request).
- **Text-based tool call recovery** (`recover_text_tool_calls()`): Parses `<function=name>{json}</function>` from text output (for models without native tool call APIs).

---

## 2. Tool Execution System

### Tool Interface

From `crates/openfang-types/src/tool.rs:1-27`:
```rust
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,  // JSON Schema
}
```

Not a trait — a data struct. The dispatch is a massive match statement in `tool_runner.rs`.

### Dispatch Architecture

The tool runner in `crates/openfang-runtime/src/tool_runner.rs` (5,014 lines) uses a pattern of:

```rust
// In the ToolRunner struct (impl block around line 3500+):
async fn execute_tool_inner(&self, tool_call: &ToolCall) -> ToolResult {
    match tool_call.name.as_str() {
        "file_read" => self.cmd_file_read(&params).await,
        "web_search" => self.cmd_web_search(&params).await,
        "browser_navigate" => self.cmd_browser_navigate(&params).await,
        // ... 53 tools total
    }
}
```

### Tool Categories (from prompt_builder.rs:508-545)

| Group | Tools |
|-------|-------|
| **Files** | file_read, file_write, file_list, file_delete, file_move, file_copy, file_search |
| **Web** | web_search, web_fetch |
| **Browser** | browser_navigate, browser_click, browser_type, browser_screenshot, browser_read_page, browser_close, browser_scroll, browser_wait, browser_evaluate, browser_select, browser_back |
| **Shell** | shell_exec, shell_background |
| **Memory** | memory_store, memory_recall, memory_delete, memory_list |
| **Agents** | agent_send, agent_spawn, agent_list, agent_kill, agent_activate |
| **Knowledge** | knowledge_add_entity, knowledge_add_relation, knowledge_query |
| **Vault** | vault_set, vault_get, vault_list, vault_delete |
| **Task** | task_post, task_claim, task_complete, task_list |

### Sandboxing

1. **WASM Dual Metering**: Wasmtime with fuel metering (instruction count) + epoch interruption (wall-clock). Watchdog thread in `kernel.rs:890`. Configurable via `SandboxConfig`.
2. **Subprocess Sandbox** (`subprocess_sandbox.rs`): `cmd.env_clear()` + selective env passthrough. Process tree isolation with cross-platform kill.
3. **Path Traversal Prevention**: `safe_resolve_path()` / `safe_resolve_parent()` on all file operations. Symlink escape prevention.
4. **SSRF Protection**: `is_ssrf_target()` blocks private IPs (10.x, 172.16-31.x, 192.168.x), cloud metadata (169.254.169.254), DNS rebinding.

### Streaming Output

`run_agent_loop_streaming()` variant at `agent_loop.rs` sends `StreamEvent` through an `mpsc::Sender` for real-time message streaming to WebSocket/SSE clients.

### Resource Limits
- All tool results truncated to 50,000 characters
- 60s default timeout (120s browser, 600s agent)
- Loop guard circuit breaker at 30× same tool call

---

## 3. Scheduler / Cron System

### Two-Level Architecture

**Level 1: AgentScheduler** (`scheduler.rs:44-145`)
- Per-agent resource quotas (tokens/hour, tool calls/hour)
- Hourly rolling window via `UsageTracker`
- `check_quota()` returns `QuotaExceeded` error if over limit
- `token_headroom()` returns remaining budget

```rust
pub struct AgentScheduler {
    quotas: DashMap<AgentId, ResourceQuota>,
    usage: DashMap<AgentId, UsageTracker>,
    tasks: DashMap<AgentId, JoinHandle<()>>,
}
```

**Level 2: BackgroundExecutor** (`background.rs:21-200`)
- Manages autonomous mode task loops
- Three schedule modes:

```rust
pub enum ScheduleMode {
    Reactive,                                          // Chat only — no background
    Continuous { check_interval_secs: u64 },           // Self-prompt on interval
    Periodic { cron: String },                         // Simplified cron schedule
    Proactive { conditions: Vec<String> },             // Event-triggered
}
```

### Simplified Cron Parsing

From `background.rs:254-284`:
- `"every 30s"` → 30 seconds
- `"every 5m"` → 300 seconds
- `"every 1h"` → 3600 seconds
- `"every 2d"` → 172800 seconds
- Unparseable → falls back to 300s

### Proactive Triggers

From `background.rs:211-243`:
- `event:agent_spawned` → AgentSpawned pattern
- `event:agent_terminated` → AgentTerminated
- `event:lifecycle` → Lifecycle
- `event:system` → System
- `event:memory_update` → MemoryUpdate
- `memory:some_key` → MemoryKeyPattern
- `all` → All events

### Failure Handling
- **Skip-if-busy**: When a tick fires while the previous is still running, it's skipped (`background.rs:84-91`)
- **Global LLM concurrency semaphore**: `MAX_CONCURRENT_BG_LLM = 5` (`background.rs:18`). Limits simultaneous LLM calls across all background agents.
- **Shutdown signal**: Watch channel from Supervisor cleanly terminates all loops (`background.rs:77-81`)
- **Abort**: `handle.abort()` on agent kill

---

## 4. The "Hands" as a Pattern

### HAND.toml Schema

From `crates/openfang-hands/src/lib.rs:38-330` (the `HandDefinition` struct):

```rust
pub struct HandDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: HandCategory,
    pub icon: String,
    pub tools: Vec<String>,
    pub requires: Vec<HandRequirement>,
    pub settings: Vec<HandSetting>,
    pub agent: HandAgentConfig,
    pub dashboard: HandDashboardConfig,
    pub skill_content: Option<String>,
}

pub struct HandAgentConfig {
    pub name: String,
    pub description: String,
    pub module: String,         // "builtin:chat"
    pub provider: String,       // "default" or specific
    pub model: String,          // "default" or specific
    pub max_tokens: u32,        // default: 4096
    pub temperature: f32,       // default: 0.7
    pub max_iterations: Option<u32>,
    pub heartbeat_interval_secs: Option<u64>,
    pub system_prompt: String,  // multi-phase operational playbook
}
```

### Lifecycle

From `crates/openfang-hands/src/registry.rs:158-175` and `kernel.rs:892-906`:

1. **Compile-time**: 9 bundled hands are embedded via `include_str!("../bundled/<id>/HAND.toml")` and `include_str!("../bundled/<id>/SKILL.md")` in `bundled.rs:6-53`
2. **Kernel boot**: `HandRegistry::load_bundled()` parses all 9 TOML → `HandDefinition` → SHA256 audit hash
3. **Custom loading**: `HandRegistry::load_custom()` loads user-installed hands from `~/.openfang/hands/<id>/`
4. **Activation**: `openfang hand activate researcher` → spawns agent from the hand's `agent.toml` config
5. **Running**: Agent enters its schedule mode (continuous, periodic, proactive, or reactive)
6. **Deactivation**: Agent killed, state persisted

### State Persistence Between Runs
Hand state is stored in SQLite via `memory_store` / `memory_recall` tools. Each Hand is instructed in its system prompt to save state after every run:
```rust
// From Researcher Hand prompt:
memory_store `researcher_hand_state`: total_queries, total_sources_cited, reports_generated
```

### Cross-Hand Communication
Hands communicate through:
1. **Shared Knowledge Graph**: All Einstein hands can read/write the same graph via `knowledge_add_entity`, `knowledge_add_relation`, `knowledge_query`
2. **Event Bus**: `event_publish` tool with pattern-matching triggers (`TriggerEngine`)
3. **Shared Memory**: The shared memory namespace (fixed agent ID `00000000-...01`) enables cross-agent data sharing
4. **Task Board**: Shared task queue via `task_post/claim/complete/list`

### Multi-Phase System Prompts — Architecture

The prompts are structured as **executable playbooks** with:
1. **Phase 0 — Platform Detection**: Always runs first. Detects OS (python3 -c "import platform...") so all subsequent commands are cross-platform compatible.
2. **Operational phases**: 5-8 numbered phases with specific sub-steps, tool calls, and verification steps.
3. **Settings interpolation**: Settings like `research_depth`, `citation_style`, `stt_provider` are read from the user's configuration (via `memory_recall` or env var) and flow into the prompt's decision logic.
4. **State update phase**: Always the final phase — updates memory + dashboard metrics via `memory_store`.
5. **Error handling**: Explicit instructions for failure modes (CAPTCHA blocking, rate limiting, missing tools).

---

## 5. Knowledge Graph Internals

### Backend
**SQLite** — not in-memory, not petgraph, not a dedicated graph DB.
File: `crates/openfang-memory/src/knowledge.rs:16-19`

```rust
#[derive(Clone)]
pub struct KnowledgeStore {
    conn: Arc<Mutex<Connection>>,
}
```

### Schema

**Entities table:**
```sql
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    name TEXT NOT NULL,
    properties TEXT,        -- JSON blob
    created_at TEXT,
    updated_at TEXT
)
```

**Relations table:**
```sql
CREATE TABLE relations (
    id TEXT PRIMARY KEY,
    source_entity TEXT NOT NULL REFERENCES entities(id),
    relation_type TEXT NOT NULL,
    target_entity TEXT NOT NULL REFERENCES entities(id),
    properties TEXT,        -- JSON blob
    confidence REAL,
    created_at TEXT
)
```

### Query Pattern

From `knowledge.rs:83-188` — SQL-based JOIN with optional filters:
```sql
SELECT s.id, s.entity_type, s.name, ..., r.id, r.relation_type, r.target, ..., t.id, t.entity_type, t.name, ...
FROM relations r
JOIN entities s ON r.source_entity = s.id
JOIN entities t ON r.target_entity = t.id
WHERE 1=1
  AND (s.id = ?1 OR s.name = ?1)   -- optional source filter
  AND r.relation_type = ?2          -- optional relation filter
  AND (t.id = ?3 OR t.name = ?3)   -- optional target filter
LIMIT 100
```

### Confidence Scoring
Relations have a `confidence: f32` field (0.0-1.0). The Researcher Hand system prompt instructs adding confidence based on source reliability.

### Population Strategy (How Each Hand Uses It)

| Hand | How It Uses Knowledge Graph |
|------|----------------------------|
| **Researcher** | Stores concepts, people, organizations found during research. Links findings to their sources. Stores research plans and sub-questions. |
| **Collector** | Builds a knowledge graph around monitored targets. Stores entities (companies, people, topics) and relations (events, changes, sentiment shifts). |
| **Lead** | Stores prospects (Person/Organization entities). Links to enrichment data (Company → Industry, Person → Role). |
| **Predictor** | Stores predictions as entities, links to supporting evidence, signals, and outcome data. |
| **Twitter** | Stores audience segments, content themes, engagement patterns. |
| **Trader** | Stores market signals, positions, correlations. |
| **Infisical-Sync** | Stores secret mappings and sync relationship data. |

All Einstein hands must have `knowledge_add_entity`, `knowledge_add_relation`, `knowledge_query` tools (`bundled.rs:427-456`).

---

## 6. Browser Hand / Playwright Bridge

### Truth: Native CDP, Not Playwright

Despite the HAND.toml requiring Python for Playwright, the actual browser automation is **native Chrome DevTools Protocol over WebSocket**, implemented entirely in Rust.

File: `crates/openfang-runtime/src/browser.rs` (1,362 lines)

### Architecture

```rust
// browser.rs:44-55 — Command enum
pub enum BrowserCommand {
    Navigate { url: String },
    Click { selector: String },
    Type { selector: String, text: String },
    Screenshot,
    ReadPage,
    Close,
    Scroll { direction: String, amount: i32 },
    Wait { selector: String, timeout_ms: u64 },
    RunJs { expression: String },
    Back,
}
```

### CDP Connection

```rust
// browser.rs:85-90 — Low-level CDP WebSocket connection
struct CdpConnection {
    write: Arc<Mutex<SplitSink<WsStream, WsMessage>>>,
    pending: Arc<DashMap<u64, oneshot::Sender<Result<serde_json::Value, String>>>>,
    next_id: AtomicU64,
    _reader_handle: tokio::task::JoinHandle<()>,
}
```

The connection:
1. Launches Chromium process (or connects to existing via `CHROME_PATH`)
2. Gets devtools URL from Chromium's stdout
3. Opens WebSocket to `ws://host:port/devtools/browser/...`
4. Sends JSON-RPC commands over WebSocket
5. Results are returned via `oneshot` channels matched by request ID

### Session Persistence
- Cookies and login state persist across tool calls within a conversation
- Browser auto-closes when the agent loop ends
- Max concurrent sessions enforced
- Idle timeout for abandoned sessions

### Purchase Approval Gate

From the HAND.toml system prompt (browser/HAND.toml:146-155), the gate is **prompt-enforced**:
```markdown
## Phase 4 — MANDATORY Purchase/Payment Approval
NEVER auto-complete purchases. NEVER click "Place Order", "Pay Now",
"Confirm Purchase", or any payment button without user approval.
```

There is no separate code-enforced approval mechanism. The LLM is instructed to stop and present a summary. If it disobeys, there's no code-level blocker — the CapabilityManager would need to recognize a "purchase" action, which it doesn't. The system prompt is the only gate.

---

## 7. Clip Hand Pipeline (8 Phases)

From `bundled/clip/HAND.toml` (598 lines):

**Phase 1 — Intake**: `yt-dlp --dump-json "URL"` or `ffprobe -v quiet -print_format json -show_format`

**Phase 2 — Download**: 
```
yt-dlp -f "bv[height<=1080]+ba/b[height<=1080]" --restrict-filenames ...
yt-dlp --write-auto-subs --sub-lang en --sub-format json3 ...
```

**Phase 3 — Transcribe**: 5 STT backends in priority order:
1. YouTube auto-subs (fastest — no transcription needed)
2. Groq Whisper API (`curl https://api.groq.com/...`)
3. OpenAI Whisper API
4. Deepgram Nova-2
5. Local Whisper (`whisper audio.wav --model small --word_timestamps true`)
6. Fallback: FFmpeg scene detection + silence detection

**Phase 4 — Analyze & Pick Segments**: The LLM reads the full transcript and identifies 3-5 viral clip segments (30-90s each) based on hooks, emotion, insight density.

**Phase 5 — Extract & Process**:
```
ffmpeg -ss <start> -to <end> -i source.mp4 ... clip_N.mp4
ffmpeg -i clip_N.mp4 -vf "crop=ih*9/16:ih:..." clip_N_vert.mp4
# Generate SRT captions from transcript word timestamps
# Burn captions: subtitles=clip_N.srt:force_style='...'
# Optional TTS: edge-tts, openai_tts, or elevenlabs
# Generate thumbnail: ffmpeg -i clip_N.mp4 -ss 2 -frames:v 1 ...
```

**Phase 6 — Publish (Optional)**: Telegram (`sendVideo`) and/or WhatsApp Cloud API (upload media → send message).

**Phase 7 — Report**: Output table + memory_store stats.

**Phase 0 (always first)**: OS detection via `python -c "import platform; print(platform.system())"`.

### Integration Details
- **FFmpeg**: Used for crop, scale, subtitle burn-in, audio extraction, TTS overlay
- **yt-dlp**: Video download from 1000+ sites
- **No native Rust video processing** — all video work is shell_exec
- **Cross-platform awareness**: Windows uses `findstr` instead of `grep`, forward slashes in filter paths, `del` instead of `rm`

---

## 8. Provider / Model Layer

### LLM Driver Trait

From `docs/architecture.md:333-354`:
```rust
#[async_trait]
pub trait LlmDriver: Send + Sync {
    async fn send_message(&self, model: &str, system_prompt: &str,
        messages: &[Message], tools: &[ToolDefinition]) -> Result<LlmResponse, OpenFangError>;
    async fn send_message_streaming(&self, ...) -> Result<LlmResponse, OpenFangError>;
    fn key_required(&self) -> bool;
}
```

### Three Native Drivers

1. **AnthropicDriver**: Native Messages API. Content blocks (text, tool_use, tool_result, image). 5MB image cap. Claude-specific streaming.
2. **GeminiDriver**: Native v1beta API. `x-goog-api-key` auth, `systemInstruction`, `functionDeclarations`, `streamGenerateContent?alt=sse`.
3. **OpenAiCompatDriver**: OpenAI Chat Completions API. Covers 18+ providers with different `base_url` configs.

### 27 Providers (from README.md:363-371)

Anthropic, Gemini, OpenAI, Groq, DeepSeek, OpenRouter, Together, Mistral, Fireworks, Cohere, Perplexity, xAI, AI21, Cerebras, SambaNova, HuggingFace, Replicate, Ollama, vLLM, LM Studio, Qwen, MiniMax, Zhipu, Moonshot, Qianfan, Bedrock.

### Provider Configuration

From the `KernelConfig` and `ProviderInfo` struct:
```rust
pub struct ProviderInfo {
    pub name: String,
    pub driver_type: String,   // "anthropic", "gemini", "openai_compat"
    pub base_url: String,
    pub key_env_var: String,
    pub auth_status: AuthStatus,  // Detected, NotDetected
}
```

### Retry / Rate Limiting
- Exponential backoff for 429 (rate limited) and 529 (overloaded) responses
- All API keys use `Zeroizing<String>` — wiped on drop

### Model Catalog
- 51 builtin models across 20+ families
- 20+ aliases (e.g., `claude` → `claude-sonnet-4-20250514`)
- Model tiers: Frontier, Smart, Balanced, Fast
- Cost rates per model for metering

### Async Batching
Not truly batched — each agent turn makes one LLM call. The global semaphore (`MAX_CONCURRENT_BG_LLM = 5`) limits concurrent LLM calls across background agents (`background.rs:18`).

---

## 9. Predictor Hand — Brier Scores

From the bundled tests (`bundled.rs:138-152`) and system prompt introspection:

- **Temperature**: 0.5 (balanced between creativity and determinism)
- **Category**: Data
- **Key tools**: web_search, memory_store/recall, knowledge_add_entity/relation/query, schedule management
- **Brier scores**: The system prompt instructs tracking prediction accuracy using Brier scores (mean squared error between probability predictions and binary outcomes)
- **Contrarian mode**: A setting that instructs the agent to deliberately argue against consensus views and assign probability distributions that differ from the mainstream
- **Self-tracking**: Calibration data stored in memory via `memory_store` for dashboard display

The full system prompt includes phases for:
1. Signal collection from multiple sources
2. Calibrated reasoning chains with confidence intervals
3. Prediction publication with explicit probability estimates
4. Outcome tracking vs prediction

---

## 10. Researcher Hand — CRAAP Criteria

The Researcher Hand implements academic-grade source evaluation in its system prompt (`researcher/HAND.toml:232-238`):

```
Source quality evaluation (CRAAP test):
- Currency: When was it published? Is it still relevant?
- Relevance: Does it directly address the question?
- Authority: Who wrote it? What are their credentials?
- Accuracy: Can claims be verified? Are sources cited?
- Purpose: Is it informational, persuasive, or commercial?
```

Each source is scored: A (authoritative), B (reliable), C (useful), D (weak), F (unreliable).

### Cross-Referencing
When `source_verification` is enabled (default: true), the LLM must:
1. Verify every key claim across 2+ independent sources
2. Flag single-source claims
3. Note contradictions

### APA Formatting
Configurable via `citation_style` setting — supports `inline_url`, `footnotes`, `academic_apa`, `numbered`.

### Report Styles
Four output styles: brief, detailed (5-10 pages), academic (formal paper), executive (key findings + recommendations).

---

## 11. Long-Horizon Coding

OpenFang does **not** have a dedicated "Coding Hand" in the 9 bundled Hands. However:

- The `agents/` directory contains **31 agent templates** including `coder/`, `code-reviewer/`, `debugger/`, `test-engineer/`, `architect/` — these are regular chat agents with coding-oriented system prompts, not autonomous Hands.
- **Tools available**: `shell_exec`, `file_read`, `file_write`, `file_list`, `file_search`, `file_delete` — sufficient for code editing.
- **No autonomous coding Hand**: Unlike OpenClaw's approach, OpenFang doesn't have a Hand that autonomously reads/writes code on a schedule. Coding agents are reactive (chat-based).

---

## 12. Dashboard / Web UI

### Stack
- **Backend**: Axum 0.8 HTTP server (`openfang-api`)
- **Frontend**: Raw HTML/CSS/JS served as static files embedded in the Rust binary
- **HTML skeleton**: `crates/openfang-api/static/index_head.html` + `index_body.html`
- **JavaScript**: In the API static JS directory (`pages/hands.js` has interactive browser viewer)
- **Fonts**: Inter (UI), Geist Mono (code) via Google Fonts
- **Theme color**: `#6366f1` (indigo)

### What's Surfaced
From the API routes (`crates/openfang-api/src/routes.rs`):
- Agent management (list, create, chat, kill)
- Hands management (list, activate, deactivate, info, instance management)
- Channel setup (list, config, test, enable/disable)
- Model/provider browser (51 models, 20 providers, aliases)
- Skill management (list, install, create, remove)
- Workflow management (list, create, run)
- Trigger management (list, create, delete)
- Crawl/Vault management (vault CRUD)
- Health/status endpoints

### API Endpoints
- 76+ REST endpoints under `/api/`
- OpenAI-compatible: `POST /v1/chat/completions`, `GET /v1/models`
- A2A endpoints: `/.well-known/agent.json`, `/a2a/*`
- WebSocket for real-time agent chat
- SSE for streaming responses

### Auth Model
- **Bearer token** when configured (`config.toml:5`: `api_key`)
- **Localhost bypass** for CLI daemon communication
- **RBAC multi-user**: Owner/Admin/User/Viewer role hierarchy (`AuthManager`)
- **CORS restricted** to localhost when no API key configured
- **Security headers** on every response (CSP, X-Frame-Options, HSTS)

### Browser Viewer
The Hands dashboard includes an interactive browser viewer (`hands.js:523-540`) that polls for screenshots from the Browser Hand and displays them with page title, URL, and content.

---

## 13. State Persistence

### SQLite Database
Everything goes through `~/.openfang/data/openfang.db` (SQLite).

Schema v5 from `crates/openfang-memory/src/migration.rs`:
1. **V1 — Core**: agents, sessions, memory entries
2. **V2 — Collab**: task board, shared memory namespace
3. **V3 — Embeddings**: vector storage column
4. **V4 — Usage**: `usage_events` table with token counts, cost estimates
5. **V5 — Canonical sessions**: cross-channel memory with compaction summaries

### Migration System
`run_migrations()` in `openfang-memory/src/migration.rs` automatically runs on kernel boot. Schema is forward-only.

### Data Stored in SQLite
| Table | Purpose |
|-------|---------|
| `agents` | Agent manifests, capabilities, state (Running/Suspended/Terminated) |
| `sessions` | Conversation history with context window token tracking |
| `memories` | KV store with keys, values, agent_id, timestamps |
| `embeddings` | Vector embeddings for semantic search |
| `entities` | Knowledge graph entities |
| `relations` | Knowledge graph relations |
| `tasks` | Shared task board |
| `usage_events` | Token counts, costs, model per agent |
| `canonical_sessions` | Cross-channel memory summaries |

### Backup Strategy
No explicit backup tool. Persistence is file-based (SQLite file). User responsible for `cp ~/.openfang/data/openfang.db` backups.

### Restart Survivability
Agents are restored on kernel boot (`kernel.rs` boot sequence step 12: "Restore persisted agents"). State (`Running`/`Suspended`) is maintained. Background loops restart for Continuous/Periodic agents.

---

## 14. Security Model

### 16-Layer Defense in Depth

Architecture documented in `SECURITY.md:46-81` and `docs/architecture.md:513-579`:

1. **Capability Gates** — Every tool invocation checked against granted capabilities
2. **Capability Inheritance Validation** — Child agents cannot exceed parent capabilities
3. **WASM Dual Metering** — Fuel (instructions) + epoch (time) via Wasmtime
4. **Subprocess Isolation** — `env_clear()`, restricted PATH, no secret leakage
5. **SSRF Protection** — Private IP blocks, DNS rebinding prevention, cloud metadata filtering
6. **Path Traversal Prevention** — `safe_resolve_path()` with symlink protection
7. **Secret Zeroization** — `Zeroizing<String>` on all API key fields
8. **Ed25519 Manifest Signing** — Agent identity and capability set verification
9. **OFP Mutual Authentication** — HMAC-SHA256, nonce-based, constant-time
10. **Merkle Audit Trail** — Tamper-evident logging chain
11. **Information Flow Taint Tracking** — Taint labels propagate through execution
12. **Prompt Injection Scanner** — Skill content scanned for attacks
13. **Loop Guard** — SHA256-based tool repetition detection
14. **Health Endpoint Redaction** — Minimal info on public endpoint
15. **Security Headers** — CSP, X-Frame-Options, HSTS on every response
16. **GCRA Rate Limiter** — Per-IP cost-aware token buckets

### Tool Approval Architecture
- **Not a separate queue UI** — approval is prompt-enforced for purchases
- **Capability enforcement** is automatic — `CapabilityManager.check()` on every tool call
- **Disabled tools** are filtered from the LLM's tool list entirely
- **No human-in-the-loop queue** in the current codebase for tools (unlike some other agent frameworks)

### Network Egress Controls
- `Capability::NetConnect(String)` — agent must be granted permission per host
- "Defense in depth" with SSRF protection as second layer
- Localhost-only fallback when no API key configured

---

## 15. Observability

### Logging
- **Crate**: `tracing` + `tracing-subscriber` with env-filter and JSON format (Cargo.toml:47-48)
- **Structured fields**: All log entries use `agent = %name`, `id = %agent_id`, `iteration`, etc.
- **Log levels**: debug, info, warn across the codebase

### Key Tracing Points
- `kernel.rs`: Boot sequence logging at each init step
- `agent_loop.rs`: Each iteration logged with iteration count, tool calls, token usage
- `background.rs`: Continuous/Periodic ticks logged with agent name and interval
- `browser.rs`: CDP commands and responses
- `skill_registry.rs`: Skill load/unload events
- `hand_registry.rs`: Hand load events with SHA256 hashes

### Metrics
- **MeteringEngine**: Cost tracking per model family (20+ model families)
- **AgentScheduler.usage**: Token counts per agent with rolling hourly window
- **Dashboard metrics**: Hands publish metrics via `memory_store` (e.g., `researcher_hand_queries_solved`, `browser_hand_pages_visited`)

### Audit Trail
- **Merkle hash chain** (`audit.rs`): Every action cryptographically linked to prior
- **Verification**: `/api/audit/verify` endpoint to verify chain integrity
- **Debug modes**: `openfang doctor` runs diagnostic health checks with optional `--repair` flag

### Health Endpoints
- `GET /api/health` — Public, minimal (up/down)
- `GET /api/health/detail` — Requires auth, shows DB stats, agent counts, subsystem status

---

## Key Architectural Takeaways

1. **Rust strength is fully leveraged**: 198K LOC, zero clippy warnings, ~32MB binary, 180ms cold start. The compile-time guarantees eliminate entire classes of bugs that Python frameworks must catch at runtime.

2. **Hands are prompt engineering at scale**: The most innovative aspect of OpenFang is not the Rust infrastructure (solid as it is) but the 500+ word multi-phase system prompts that make Hands autonomous. Each Hand is essentially a very detailed SOP executed by an LLM.

3. **Monolithic kernel pattern**: OpenFangKernel is a single struct with 30+ fields that assembles everything. The `boot_with_config()` function is a 100+ step sequential initializer. This is a sharp contrast to microkernel or plugin architectures.

4. **SQLite as universal substrate**: Memory, knowledge graph, sessions, tasks, usage — all in one SQLite file. No Postgres, no Redis, no specialized vector DB. This limits horizontal scaling but keeps the binary self-contained.

5. **Prompt-enforced security**: Despite 16 security layers, the Browser Hand's purchase approval gate is purely a system prompt instruction with no code-level enforcement. This is a significant architectural choice (and potential risk).

6. **No separate coding Hand**: Unlike data/research/browser Hands, OpenFang doesn't bundle an autonomous coding agent. Coding is handled by chat-based agents from the template library.

7. **The Einstein Hand pattern**: A consistent template for autonomous Hands: schedule tools + memory tools + knowledge graph tools + event publishing = a complete autonomous loop.

8. **Vendor lock-in avoidance**: Three native LLM drivers with 27 providers. Default is Anthropic but every Hand can override. The `default` provider keyword falls through to kernel config.
