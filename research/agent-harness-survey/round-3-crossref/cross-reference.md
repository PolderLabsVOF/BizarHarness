# Agent Harness Cross-Reference Report

**Synthesized from:** Hermes Agent (Round 1+2), OpenFang (Round 1+2), OpenClaw (Round 1+2), Best-of-Agent-Harnesses (Round 1+2)  
**Date:** 2026-07-06  
**Purpose:** Comprehensive comparison of four agent harness systems with implications for BizarHarness design

---

## 1. The Comparison Matrix (Master Table)

| Dimension | Hermes Agent | OpenFang | OpenClaw | Best-of (Catalog) |
|-----------|-------------|----------|----------|-------------------|
| **Primary Language + LOC** | Python 3.11–3.13, ~1.3M | Rust, ~198,748 | TypeScript ESM, ~854K | N/A (catalog of 106 projects) |
| **License + Governance** | MIT / Nous Research | MIT + Apache-2.0 / RightNow-AI | MIT / OpenClaw org | CC-BY-SA-4 (data), MIT (MCP server) |
| **Distribution** | `curl` install script, PyPI (`uv`-managed) | Single ~32MB Rust binary | npm (`openclaw`), native macOS/iOS/Android apps, Docker | MCP server on PyPI (`agent-harnesses-mcp`) |
| **Core Abstraction** | `AIAgent` class — the narrow waist | "Agent OS" kernel metaphor — scheduler, RBAC, metering, event bus | Gateway (control plane HTTP/WS server) + Agent Runtime (the actual product) | N/A — catalog of abstractions |
| **Agent Loop Pattern** | `run_conversation()` → `agent/conversation_loop.py:518` (~3,900-line loop body) | `run_agent_loop()` at `crates/openfang-runtime/src/agent_loop.rs:293` (5,200 lines) | `runEmbeddedAgent()` at `src/agents/embedded-agent-runner/run.ts` | Various — loop + tool dispatch dominant (~80% of catalog) |
| **Context Management** | Per-turn prefetch via `MemoryManager`, LLM summarization, FTS5 session search, prompt caching is sacred (byte-stable) | Vector similarity recall, knowledge graph, session repair (7-phase validation), context budget trimming | System prompt assembly (3 modes: full/minimal/none), cache boundary markers, session compaction | Varies — memory hierarchy in ~18 tagged projects |
| **Tool Execution Model** | AST auto-discovery, `registry.register()` pattern, `check_fn` gating, 100+ tools, blocked-tools-for-subagents | Match dispatch, 53 built-in, WASM dual-metered sandbox (fuel + epoch), SSRF protection, loop guard (SHA256) | Multi-layer policy pipeline (sandbox → profile → provider → sender → group → subagent), 19 audit modules | Varies — MCP tool format dominant, tool discovery in 5 projects |
| **Memory Architecture** | 3-tier: session (SQLite FTS5 WAL) + long-term (pluggable providers) + LLM summarization. Providers: Honcho, Mem0, Supermemory, etc. | 6-layer SQLite: KV, vector (cosine), knowledge graph (entities+relations), session, task board, usage. Canonical sessions for cross-channel | 3-backend: `memory-core` (embedding+SQLite), `memory-wiki` (structured entries), `memory-lancedb` (LanceDB). Root-memory-files. Per-agent SQLite DBs | Mem0, Letta, claude-mem patterns in 18 projects |
| **Multi-Agent Model** | `ThreadPoolExecutor` subagents, RPC via `delegate_task` with zero-context-cost pattern, parallel batch mode | Hands as parallel "processes" with shared knowledge graph, event bus (`event_publish`), task board | Gateway multiplexes channels; per-channel agent routing; subagent spawning (`subagent-spawn.ts`) with configurable model + depth limits; ACP protocol | 30+ orchestration patterns cataloged (CrewAI, AutoGen, LangGraph, etc.) |
| **Scheduling Model** | Built-in cron (`cron/scheduler.py`), natural-language scheduling, skip_memory=True, per-job skills/model overrides | 2-level: `AgentScheduler` (per-agent token quotas, hourly rolling window) + `BackgroundExecutor` (Reactive/Continuous/Periodic/Proactive) | `cron-on-exit` via gateway-supervisor watcher — survives per-turn CLI teardown (`DESIGN-cron-on-exit.md`). Wake + system event RPC | Various patterns across catalog |
| **Long-Horizon Coding** | `patch` (string replace), 6 terminal backends (local/Docker/SSH/Singularity/Modal/Daytona), `batch_runner.py` for trajectory generation + compression | No dedicated coding hand; 31 agent templates for chat-based coding; `shell_exec` + file tools | `bash-tools.ts` (PTY + sandbox), `sandbox.ts`, `workspace.ts`, Codex integration, `code-mode.ts` | Varies — opencode, Codex, Gemini CLI in "turnkey coding agent" use case |
| **Provider Abstraction** | `ProviderProfile` discovery, 18+ bundled providers, model fallback chain, `agentskills.io` compatible | 27 providers (123+ models), 3 native drivers (Anthropic/Gemini/OpenAI-compat), 51 model catalog entries | 30+ provider plugins via `ProviderPlugin` interface, OAuth subscriptions, model fallback, 21 provider extensions listed | LiteLLM, vercel/ai patterns — 8 projects tagged `provider-agnostic` |
| **Multi-Channel/Messaging** | 17+ platforms via gateway (`gateway/platforms/`), per-platform `BasePlatform` ABC, stream relay | 40 channel adapters in `openfang-channels` crate | 28+ channels: 3 built-in (iMessage, Telegram, WebChat) + 25 official plugins. macOS/iOS/Android native apps | Various — personal agent runtimes in catalog (OpenClaw 382k ⭐, Hermes 210k ⭐) |
| **State Persistence** | SQLite FTS5 WAL mode (`hermes_state.py`), batch_runner trajectories → separate output dirs | SQLite schema v5 (`openfang-memory`), 6 storage layers, Merkle hash-chain audit | SQLite-first: Kysely helpers for global state DB + per-agent SQLite DBs. Session compaction | Varies — durable execution in 8 projects |
| **Security Model** | Approval gates (`tools/approval.py`), prompt injection scanning, subagent auto-deny, TIRITH policy framework, file write deny-lists | 16 security layers: WASM metering, Merkle audit trail, capability gates, SSRF protection, path traversal prevention, GCRA rate limiting | 19 security audit modules: channel security, exec safety, config safety, plugin code safety, SSRF, secrets masking, DM pairing | Varies — sandbox tag on 17 projects |
| **Observability** | 3 log files (`agent.log`, `errors.log`, `gateway.log`), `hermes logs` command, usage + billing tracking | `tracing` crate, structured JSON logs, metrics via `MeteringEngine`, Merkle audit trail, `openfang doctor` | Log/trace/debug subsystems, diagnostic phases, health endpoints, restart tracing | Varies |
| **Self-Improvement / Learning Loop** | **CLOSED LOOP**: Skill auto-creation → usage tracking → Curator (idle-triggered fork review) → archive/pin. Honcho dialectic user modeling. `curator.py:1` | No explicit learning loop. Hands create/revise skills via prompt, not autonomous lifecycle | No explicit autonomous loop. Skill workshops exist; subagent lifecycle managed but no auto-improvement | Mem0, Letta, claude-mem patterns — "who owns memory?" question |
| **Target Audience** | Developers who want a self-improving CLI/daemon with full platform reach | Rust users who want a self-hosted "Agent OS" with strong security | General users who want an always-on personal AI across all their messaging platforms and devices | Developers/researchers picking a harness for a specific job |
| **Strengths (1 line)** | Only system with a closed, autonomous skill improvement loop and 6 execution backends | Only system with an OS-kernel metaphor, WASM sandboxing, and hands as multi-phase autonomous agents | Widest channel coverage (28+) with native cross-platform apps and real-time voice | Only curated harness discovery service with autonomy/recovery axes and an MCP tool |
| **Weaknesses (1 line)** | 1.3M LOC creates extreme cognitive overhead; Python GIL limits true parallelism | Aspirational scope (198K LOC) with no dedicated coding hand; purchase gate is prompt-enforced only | 155 packages + 82 releases/year creates severe update churn; complex dependency graph | Curation lag; no deep architectural analysis; catalog not codebase |
| **Killer Feature** | Closed learning loop + RPC zero-context-cost subagents + 6 terminal backends | Agent OS kernel metaphor + 9 bundled Hands (multi-phase prompts) + WASM dual-metered sandbox | 28+ channel integrations + native macOS/iOS/Android apps + Canvas visual workspace + voice | MCP-based harness discovery with editorial curation (autonomy/recovery/license axes) |

---

## 2. The Agent Loop: A Deep Comparison

### 2.1 Hermes — The Threaded Turn Loop

**Location:** `agent/conversation_loop.py:518` (extracted from the original `run_agent.py:5745`)

```python
def run_conversation(user_message, system_message, conversation_history, task_id):
    # === PROLOGUE ===
    ctx = build_turn_context(agent, user_message, ...)  # sanitize, restore system prompt, prefetch memory
    
    messages = ctx.messages  # system prompt + history + user message + tools
    
    # === MAIN LOOP ===
    while (api_call_count < max_iterations and budget.remaining > 0) or budget_grace_call:
        if interrupt_requested: break
        
        response = client.chat.completions.create(
            model=model, messages=messages, tools=tool_schemas, stream=True, ...
        )
        
        if response.tool_calls:
            for tool_call in parallelize(response.tool_calls):  # parallel when safe
                result = handle_function_call(tool_call.name, tool_call.arguments, task_id)
                messages.append(tool_result_message(result))
            api_call_count += 1
        else:
            return response.content  # final text response
        
        budget.consume(response.usage)
    
    # === POST-TURN ===
    fire_hooks('post_llm_call', 'post_tool_call')
    memory.sync_turn(user_msg, assistant_response)
    curator.trigger_if_idle()
    title.generate_if_needed()
    trajectory.save_if_enabled()
```

**Key behaviors:**
- **Synchronous, single-threaded** per conversation — one thread, blocking model calls
- **Interrupt-aware** — `_interrupt_requested` flag checked before each API call
- **Grace call** — `_budget_grace_call` permits one extra turn after budget exhaustion
- **Streaming** — responses are streamed; tool calls and text extracted from stream chunks
- **Prompt caching sacred** — system prompt built once, never mutated mid-conversation
- **Parallel tool execution** — `_should_parallelize_tool_batch` in `tool_dispatch_helpers.py` runs independent tools concurrently

### 2.2 OpenFang — The Rust Async Loop

**Location:** `crates/openfang-runtime/src/agent_loop.rs:293` (5,200 lines — the largest single function)

```rust
pub async fn run_agent_loop(
    manifest: &AgentManifest, user_message: &str, session: &mut Session,
    memory: &MemorySubstrate, driver: Arc<dyn LlmDriver>,
    available_tools: &[ToolDefinition], kernel: Option<Arc<dyn KernelHandle>>,
    // ... 13 more parameters
) -> OpenFangResult<AgentLoopResult> {
    // Load session → recall memories → build system prompt → strip images
    // → run session repair (7-phase validation)
    
    for iteration in 0..max_iterations {  // max_iterations = 50 (line 35)
        // 1. Context overflow recovery (multi-stage: drain → summarize → retry)
        recover_from_overflow(&mut messages, &system_prompt, available_tools, ctx_window);
        
        // 2. Apply context guard (trim oversized tool results)
        apply_context_guard(&mut messages, &context_budget, available_tools);
        
        // 3. Call LLM with retry + exponential backoff
        let mut response = call_with_retry(&*driver, request, ...).await?;
        
        // 4. Handle stop_reason: EndTurn/StopSequence/ToolUse/MaxTokens
        match response.stop_reason {
            EndTurn | StopSequence => { /* finalize */ }
            ToolUse => {
                for tool_call in response.tool_calls {
                    // Check capability → execute with 60s timeout (120s browser, 600s agent)
                    // Truncate >50K chars → check loop guard (SHA256 repetition)
                }
                if threshold_exceeded { auto_compact_session(); }
            }
            MaxTokens => { /* continuation */ }
        }
    }
    // Save session + canonical session → record usage → update quota
}
```

**Key behaviors:**
- **Native async/await** via Tokio — no GIL, true parallelism
- **Three retry modes**: rate limit (429), overload (529), empty response (silent retry)
- **Loop guard**: SHA256-based `(tool_name, params)` hashing — warn (3×), block (5×), circuit-breaker (30×)
- **Phantom action detection**: Scans LLM output for claims of having acted without calling tools
- **Text-based tool call recovery**: Parses `<function=name>{json}</function>` for models without native tool_call APIs

### 2.3 OpenClaw — The Gateway-Mediated Loop

**Location:** `src/agents/embedded-agent-runner/run.ts` (the `runEmbeddedAgent()` function)

```
Message arrives → embedded-agent-runner
  → resolve tools + system prompt (3 modes: full/minimal/none)
  → call LLM (via provider-http / transport-stream)
  → handle tool calls (via agent-tools.ts — 1196 lines of assembly)
  → manage context window (embed/compact/rotate)
  → deliver reply → wait for next turn
```

Key `agent-tools.ts` (1196 lines) operations:
1. Gather core + shell + channel + OpenClaw + plugin + MCP + Tool Search tools
2. Apply 6 policy layers: sandbox → profile → provider → sender → group → subagent
3. Wrap with abort signals, before-tool-call hooks, parameter validation, workspace path guards
4. Support deferred follow-ups, memory flush, tool display configuration

### 2.4 Best-of — The Catalog of Loop Patterns

From `best-of-architecture.md:364-381`, the 106-project catalog reveals these dominant patterns:

| Pattern | Prevalence | Examples |
|---------|-----------|----------|
| Tool-call loop (model → tools → model) | ~80% of projects | Hermes, OpenFang, OpenClaw |
| Agent loop + permission gates | Significant | Cline, Aider, Open Interpreter |
| State machine / graph | Notable | LangGraph, n8n, Microsoft Agent Framework |
| Event loop + input queue | Notable | OpenClaw, Hermes (gateway) |
| Memory hierarchy | ~18 tagged projects | MemGPT, Mem0, claude-mem |
| Multi-agent handoff | ~19 tagged projects | CrewAI, AutoGen, OpenAI Agents SDK |

### 2.5 Common Patterns Across All Systems

1. **Tool dispatch loop** — universal: model outputs tool calls, harness executes, results feed back
2. **Budget/iteration limiting** — all three systems cap turns: Hermes (90 default), OpenFang (50), OpenClaw (configurable)
3. **Streaming** — all three stream LLM output; tool results are extracted from stream chunks
4. **Context overflow handling** — all three detect and compress when approaching context limits
5. **Retry logic** — exponential backoff for rate limits (429) and server errors (500s)

### 2.6 Hermes-Specific Twists

- **Grace call** after budget exhaustion — one extra turn permitted explicitly
- **Parallel tool batching** inside a single turn via `_should_parallelize_tool_batch`
- **Fork-based curation** — `curator.py` spawns a forked `AIAgent` to review skills (avoids prompt cache pollution)
- **RPC zero-context-cost pattern** — `delegate_task` + `registry.dispatch()` collapses multi-step pipelines into single turns

### 2.7 OpenFang-Specific Twists

- **Native async Rust** — Tokio runtime, `spawn_blocking` for SQLite, `tokio::select!` for shutdown signals
- **WASM dual-metered sandbox** — fuel (instruction count) + epoch (wall-clock) via Wasmtime + watchdog thread
- **50-iteration cap** with circuit breaker at 30× same tool call
- **Phantom action detection** — catches models claiming to have acted without calling tools
- **Text-based tool call recovery** — for models without native tool call APIs

### 2.8 OpenClaw-Specific Twists

- **Gateway as control plane** — the HTTP/WS gateway owns auth, routing, sessions; the agent runtime is a downstream service
- **Lazy loading everywhere** — `createLazyRuntimeModule()`, gateway server itself behind dynamic import
- **Dual channel facade/runtime** — lightweight `channel.ts` for startup, full `channel.runtime.ts` for runtime
- **Channel multiplexing** — gateway routes messages from 28+ channels into a unified agent runtime
- **Multi-layer tool policy pipeline** — 6 stacked policy layers (sandbox/profile/provider/sender/group/subagent) applied in order

---

## 3. Tool Execution: The Five Models

### 3.1 Hermes: AST-Discovered Registry with `check_fn` Gating

**Discovery:** `tools/registry.py:58` — AST scan for `registry.register()` at module level. Only files that actually call the register function are imported — helper modules are skipped automatically.

```python
registry.register(
    name="example_tool",
    toolset="example",
    schema={"name": "example_tool", "description": "...", "parameters": {...}},
    handler=lambda args, **kw: example_tool(param=args.get("param"), task_id=kw.get("task_id")),
    check_fn=check_requirements,        # runtime availability gate
    requires_env=["EXAMPLE_API_KEY"],    # env var gating
)
```

**Gating mechanisms:**
- `check_fn`: zero-arg callable returning bool — tool omitted from schema if False
- `requires_env`: list of required environment variables
- Subagent blocked tools: `delegate_task`, `clarify`, `memory`, `send_message`, `execute_code`, `cronjob`
- `DELEGATE_BLOCKED_TOOLS` in `delegate_tool.py:45`

**Subagent isolation:** Subagents get a **restricted toolset** — `DELEGATE_BLOCKED_TOOLS` at line 45 strips six tools. For `role="orchestrator"`, `delegate_task` is re-enabled (gated by config).

**Long-running tool handling:** `is_async=True` handlers bridged via persistent event loops (`_get_worker_loop()` in `model_tools.py`). Activity callbacks report liveness.

### 3.2 OpenFang: Match Dispatch + WASM Dual-Metered Sandbox

**Dispatch:** `crates/openfang-runtime/src/tool_runner.rs:3500+` — massive match statement over 53 tool names. Not a trait — a data struct with a function dispatch table.

**53 built-in tools:**
- File: `file_read`, `file_write`, `file_list`, `file_delete`, `file_move`, `file_copy`, `file_search`
- Web: `web_search`, `web_fetch`
- Browser: `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_read_page`, `browser_close`, `browser_scroll`, `browser_wait`, `browser_run_js`, `browser_back`
- Shell: `shell_exec`, `shell_background`
- Memory: `memory_store`, `memory_recall`, `memory_delete`, `memory_list`
- Agent: `agent_send`, `agent_spawn`, `agent_list`, `agent_kill`, `agent_activate`
- Knowledge graph: `knowledge_add_entity`, `knowledge_add_relation`, `knowledge_query`
- Vault: `vault_set`, `vault_get`, `vault_list`, `vault_delete`
- Cron: `cron_create`, `cron_list`, `cron_delete`
- Task: `task_post`, `task_claim`, `task_complete`, `task_list`
- Other: `location_get`, `event_publish`, `schedule_create`, `schedule_list`, `schedule_delete`

**WASM sandbox:** Wasmtime with fuel metering (instruction count) + epoch interruption (wall-clock). Watchdog thread kills runaway. Configurable via `SandboxConfig`. The Browser Hand's CDP automation uses native Chrome DevTools Protocol over WebSocket, NOT Playwright despite what HAND.toml says.

**SSRF protection:** `is_ssrf_target()` blocks 10.x, 172.16–31.x, 192.168.x private IPs, plus cloud metadata (169.254.169.254), DNS rebinding.

**Extension:** MCP tools (namespaced `mcp_{server}_{tool}`), skill tools (Python/WASM/Node.js/PromptOnly), A2A protocol tools.

### 3.3 OpenClaw: Multi-Layer Policy Pipeline

**Tool assembly:** `agent-tools.ts:1196` builds the effective tool surface:
1. Gather: core tools + shell tools + channel tools + OpenClaw tools + plugin tools + MCP tools + Tool Search tools
2. Apply 6 policy layers in order: sandbox → profile → provider → sender → group → subagent

**Policy layers (from `tool-policy-pipeline.ts`):**
- **Sandbox policy**: allowlist/denylist enforcement for sandboxed execution
- **Profile policy**: per-user configuration
- **Provider policy**: provider-specific tool restrictions
- **Sender policy**: who is sending the message (DM policy, pairing)
- **Group policy**: group chat restrictions
- **Subagent policy**: subagent depth limits, blocked tools for child agents

**Security audit modules (19 total):** `audit*.ts` covering channel security, config safety, exec safety, gateway exposure, plugin code safety, model hygiene, filesystem security, sandbox auditing, synced folders safety.

**SSRF protection:** `src/plugin-sdk/ssrf-*.ts` — server-side request forgery prevention.

**Secrets management:** `src/secrets/` — encrypted credential storage, secret refs, input masking.

### 3.4 Best-of: The Tool Pattern Spectrum

From the catalog (~18 projects tagged `tool-discovery`):
- **MCP-Zero** — on-demand semantic tool routing
- **ToolGen** — dynamic tool generation from descriptions
- **Composio** — 100+ tool integrations

The dominant tool format is the **MCP / OpenAI function-calling convention**: `{"type": "function", "name": "...", "input": {...}}`. This is the emerging industry standard across all four systems.

### 3.5 Which Model Is Most Production-Ready?

| System | Production Readiness | Rationale |
|--------|---------------------|-----------|
| **OpenFang** | Highest for self-hosted | WASM sandbox + 16 security layers + Merkle audit trail + GCRA rate limiting = defense in depth. Single binary distribution simplifies ops. |
| **OpenClaw** | Highest for consumer-facing | 19 audit modules + native app distribution + 28 channels + voice = most complete consumer product. TypeScript ecosystem simplifies debugging. |
| **Hermes** | High for developers | 100+ tools + 6 backends + approval gates + learning loop = full-featured. But 1.3M LOC creates maintenance burden. |
| **Best-of catalog** | Reference only | Describes what exists; not a production system itself. |

### 3.6 Which Model Is Most Flexible?

**OpenClaw** — the multi-layer policy pipeline with plugin SDK and 155 packages means any capability can be extended without touching core. The `openclaw/plugin-sdk/*` subpath import rule enforces clean boundaries.

### 3.7 Which Has the Best Security Story?

**OpenFang** has the most defense-in-depth architecture (16 security systems, cryptographic audit trail, capability-based access control), but the purchase approval gate is **prompt-enforced only** — a significant architectural risk. The WASM sandbox is genuinely novel.

**OpenClaw** has the most comprehensive audit surface (19 modules covering all attack vectors) but lacks the WASM sandboxing that OpenFang has.

**Hermes** has the most battle-tested approval flows across diverse platforms (Telegram DMs, Discord webhooks, etc.) but the model falls back to "ask the user" for sensitive operations.

---

## 4. Memory Architecture Comparison

### 4.1 Hermes — Three-Tier with Pluggable Providers

| Layer | Storage | Mechanism |
|-------|---------|-----------|
| **Short-term** | In-memory message list | `AIAgent.messages` — OpenAI-format, compressed by `conversation_compression.py` |
| **Medium-term** | SQLite FTS5 WAL | `hermes_state.py:SessionDB` — session metadata, full message history, FTS5 virtual table |
| **Long-term** | Pluggable providers | `MemoryProvider` ABC: `prefetch()`, `sync_turn()`, `get_tool_schemas()`, `system_prompt_block()` |

**Memory trigger pattern:**
- Pre-turn: `MemoryManager.prefetch_all(user_message)` → injected as context block (NOT system prompt, preserving cache)
- Post-turn: `MemoryManager.sync_all(user_msg, assistant_response)` → providers persist the turn
- Background: `queue_prefetch_all()` schedules async prefetch for next turn
- Idle: Curator fires → skill review via forked `AIAgent`

**Pluggable providers:** Honcho (dialectic user modeling), Mem0, Supermemory, Byterover, Hindsight, Holographic, OpenViking, RetainDB. Only one active at a time (enforced by `MemoryManager`).

**Key insight:** Prompt caching is sacred — memory is injected as context block, not appended to system prompt. This preserves the byte-stability guarantee that allows prompt caching.

### 4.2 OpenFang — Six-Layer SQLite with Knowledge Graph

| Layer | Storage | Mechanism |
|-------|---------|-----------|
| **KV** | SQLite | Key-value store with keys, values, agent_id, timestamps |
| **Vector** | SQLite + embedding column | Cosine similarity search for semantic recall |
| **Knowledge Graph** | SQLite entities + relations | SQL-based JOIN with `GraphPattern` filtering, 100 result limit, confidence scores |
| **Session** | SQLite | Conversation history with context window token tracking |
| **Task Board** | SQLite | Shared task queue via `task_post/claim/complete/list` |
| **Usage** | SQLite | Token counts, costs, model per agent |

**Knowledge graph schema:**
```sql
entities (id, entity_type, name, properties JSON, created_at, updated_at)
relations (id, source_entity, relation_type, target_entity, properties JSON, confidence f32, created_at)
```

**Entity types:** Person, Organization, Project, Concept, Event, Custom(String)  
**Relation types:** WorksAt, KnowsAbout, RelatedTo, DependsOn, OwnedBy, CreatedBy, LocatedIn, PartOf, Uses, Produces, Custom(String)

**Query:** `KnowledgeStore::query_graph(pattern: GraphPattern)` — SQL JOINs with optional source/relation/target filters, 100 result cap.

**All Einstein hands** (researcher, collector, lead, predictor, twitter, trader) carry `knowledge_add_entity`, `knowledge_add_relation`, `knowledge_query` tools — this is a compile-time requirement encoded in `bundled.rs:427-456`.

### 4.3 OpenClaw — Three-Backend Memory with SQLite Core

| Backend | Storage | Mechanism |
|---------|---------|----------|
| **memory-core** | SQLite + vector index | Embedding-based semantic search, multimodal (text + images), Qdrant-compatible queries |
| **memory-wiki** | Structured entries | Wiki-style with structured entries, links, and diffs |
| **memory-lancedb** | LanceDB | Alternative vector backend via LanceDB |
| **root-memory-files** | Flat files | `root-memory-files.ts` handles discovery of root-level memory files |
| **Per-agent DB** | SQLite | `agents/<agentId>/agent/openclaw-agent.sqlite` for agent-scoped state/cache |
| **Global state DB** | SQLite | `state/openclaw.sqlite` for global runtime state and plugin KV |

**Storage rule (from `AGENTS.md:storage-default`):** "SQLite only. Do not add JSON/JSONL/TXT/sidecar files for OpenClaw-owned runtime state, caches, queues, registries, indexes, cursors, checkpoints, or plugin scratch data."

**Kysely requirement:** All SQLite access uses Kysely helpers, not raw SQL strings — except for schema DDL, migrations, low-level DB bootstrap, or narrowly justified SQLite primitives.

### 4.4 Best-of — Ownership Model Question

The best-of comparison (`comparisons/memory-layers.md`) frames the key question: **"Who owns the memory?"**

| Owner | Projects | Shape |
|-------|---------|-------|
| Application-owned | Mem0 | Memory API — any agent can use it, scoped memories |
| Agent-owned | Letta | Agent runtime — memory-first agent design |
| Harness-owned | claude-mem | Claude Code plugin — perfect recall for Claude Code |

---

## 5. Multi-Agent Coordination

### 5.1 Hermes — ThreadPoolExecutor + RPC

**Mechanism:** `tools/delegate_tool.py:197-205` — `ThreadPoolExecutor` with configurable `max_workers` (default 3):
```python
with ThreadPoolExecutor(
    max_workers=max_workers,
    initializer=_set_subagent_approval_cb,
    initargs=(approval_callback,),
) as executor:
    futures = [executor.submit(_run_single_child, params) for params in tasks]
    for future in as_completed(futures):
        results.append(future.result(timeout=child_timeout))
```

**Message-passing:** `_run_single_child()` returns a `dict` with `summary`, `success`, `error`, `output`. The parent sees only the delegation call + summary, never intermediate tool calls.

**RPC pattern:** `registry.dispatch()` lets Python scripts call tools without LLM context — multi-step pipelines collapse into zero-context-cost turns.

**Batch mode:** `delegate_task(tasks=[{...}, {...}, ...])` — multiple children run concurrently.

**Context isolation:** Each child gets fresh `AIAgent` instance with its own `task_id`, focused system prompt, and restricted toolset. No parent history shared.

### 5.2 OpenFang — Hands as Parallel Processes

**Mechanism:** Hands are named agents spawned via `openfang hand activate <id>`. Each hand has:
- `HandDefinition` with `agent.toml`-style config
- Multi-phase system prompt (500+ word expert procedure)
- Tool allowlist (e.g., Researcher hand: `web_search`, `web_fetch`, `shell_exec`, `file`, `memory`, `knowledge_graph`, `schedule`)
- Schedule mode (Continuous/Periodic/Proactive/Reactive)

**Cross-Hand communication:**
1. **Shared knowledge graph** — all Einstein hands read/write the same graph
2. **Event bus** — `event_publish` tool with `TriggerEngine` pattern matching
3. **Shared memory namespace** — fixed agent ID `00000000-...01` for cross-agent data
4. **Task board** — shared queue via `task_post/claim/complete/list`

**31 agent templates** in `agents/` directory: `coder/`, `code-reviewer/`, `debugger/`, `test-engineer/`, `architect/` — these are reactive chat agents, not autonomous Hands.

### 5.3 OpenClaw — Gateway Multiplexing + Subagent Spawning

**Mechanism:** The gateway (`src/gateway/server.impl.ts:1869`) routes messages from 28+ channels to appropriate agent sessions. Per-channel routing + channel-specific policies.

**Subagent system:** `subagent-spawn.ts` + `subagent-registry.ts`:
- Spawning: configurable model, workspace, context
- Registry: SQLite-persisted, tracks lifecycle
- Depth control: `subagent-depth.ts` limits nesting
- Delivery: `subagent-announce-*.ts` delivers results back to main agent
- Liveness: `subagent-run-liveness.ts`, `subagent-run-timeout.ts`

**ACP protocol:** Agent Communication Protocol for external agent-to-agent communication.

**Blocked tools for subagents:** `agent-tools.policy.ts:50-61` — `SUBAGENT_TOOL_DENY_ALWAYS` includes `gateway`, `agents_list`, `session_status`, `cron`, `sessions_send`.

### 5.4 Five Recurring Coordination Primitives

From `best-of-architecture.md:375-381`, the catalog reveals five coordination primitives that recur across 106 projects:

| Primitive | Mechanism | Hermes | OpenFang | OpenClaw |
|-----------|-----------|--------|----------|----------|
| **Handoffs** | Call-center escalation model | Via RPC + delegate_task | Via event bus | Via ACP + subagent announce |
| **Roles/org charts** | Named agent types with goals | Via system prompt + delegation | Via HAND.toml categories | Via subagent spawning with labels |
| **Group chat** | Conversational multi-agent | Via ThreadPoolExecutor batch | Via shared knowledge graph | Via gateway multiplexing |
| **State machine** | Explicit transitions between states | No native SM (external only) | Via WorkflowEngine | Via cron triggers + event |
| **Event-driven** | Unified input queue (messages + crons + webhooks) | Via gateway platform adapters | Via BackgroundExecutor + TriggerEngine | Via gateway-supervisor + cron-on-exit |

---

## 6. Long-Horizon Coding Capabilities

### 6.1 Hermes

**File editing:** `patch` tool in `tools/file_operations.py:534` — exact string replacement (not AST-based). Uses `difflib` for unified diff generation.

**Code search:** `search_files` wraps `grep`/`rg` through the terminal backend — regex + file glob + path restriction, works across all 6 backends.

**Test runner:** Via `terminal` tool. Repo tests via `scripts/run_tests.sh` with credential isolation, UTC timezone, subprocess isolation per test file.

**Git workflow:** Raw `git` commands through terminal backend. No dedicated git tool. `patch` + `terminal` form the long-horizon loop: search → read → edit → test → commit.

**Dependency management:** Via `terminal` tool + shell commands.

**Workspace management:** Multi-repo via terminal backend switching (Docker/SSH/Modal/Daytona for remote repos).

**Trajectory capture:** `batch_runner.py` + `trajectory_compressor.py` — parallel batch processing with checkpointing, LLM summarization compression targeting configurable token budget (default 16K). Trajectories stored separately from main session DB.

**Run unsupervised for hours:** Via cron (`cron/scheduler.py`) + batch_runner for parallel trajectory generation. One-shot long tasks via increased `max_iterations` + `budget_grace_call`.

### 6.2 OpenFang

**File editing:** `file_read`, `file_write`, `file_search` tools — raw string operations, no dedicated patch tool.

**No dedicated coding hand:** Unlike the research/data/social media Hands, OpenFang has no autonomous coding agent. Coding is handled by 31 agent templates in the `agents/` directory (coder, code-reviewer, debugger, test-engineer, architect) — these are reactive chat-based, not autonomous.

**Browser automation:** The Browser Hand (`browser/HAND.toml`) uses native CDP over WebSocket, NOT Playwright despite what the TOML says.

**Trajectory/training:** Not present in the codebase — no `batch_runner` equivalent.

**Run unsupervised:** Via `BackgroundExecutor` with Continuous/Periodic/Proactive modes. Einstein hands (researcher, collector, lead, predictor, twitter, trader) are designed for autonomous operation with `schedule_create/list/delete` + `memory_store/recall` + knowledge graph tools.

### 6.3 OpenClaw

**File editing:** Bash tools (`bash-tools.ts`) with PTY support + sandbox + process supervisor. `workspace.ts` for workspace management.

**Codex integration:** `code-mode.ts` + `extensions/codex/` — OpenAI Codex progressively folded into `openai` provider path.

**Subagent for coding:** Subagent spawning with configurable model (`subagent-spawn.ts`). Can spawn a coding-specific subagent with different model than parent.

**Long-running process handling:** `src/process/supervisor/` — `spawn()` → `wait()` → exit/terminate lifecycle. Dual adapter system: `child.ts` (raw child) + `pty.ts` (PTY-based). Graceful cancel: 5000ms between SIGTERM and SIGKILL. Output capture: 1MB max with truncation markers.

**Run unsupervised:** Cron-on-exit via gateway-supervisor (`DESIGN-cron-on-exit.md`) — survives per-turn CLI teardown. The design document (lines 14-16) explicitly addresses the problem: CLI backends kill detached process groups at turn end; the gateway-supervisor-owned watcher solves this.

---

## 7. Scheduling & Cron

### 7.1 Hermes — Built-in Cron with Natural Language

**Location:** `cron/scheduler.py:3.6K` + `cron/jobs.py:2K`

- File-based job store at `~/.hermes/cron/jobs.json`
- `tick()` loop called every 60s by the gateway
- File lock for cross-process safety
- Schedule formats: duration strings (`"30m"`), "every" phrases (`"every 2h"`), cron expressions, ISO timestamps
- Per-job: skills loading, model/provider overrides, pre-run data-collection scripts, `context_from` chaining
- 3-minute hard interrupt on cron sessions; `skip_memory=True` by default
- Cron deliveries land in their own session (not main conversation) to preserve message-role alternation

### 7.2 OpenFang — Two-Level Scheduler

**Level 1: AgentScheduler** (`scheduler.rs:44-145`)
- Per-agent resource quotas (tokens/hour, tool calls/hour)
- Hourly rolling window via `UsageTracker`
- `check_quota()` returns `QuotaExceeded` if over limit
- `token_headroom()` returns remaining budget

**Level 2: BackgroundExecutor** (`background.rs:21-200`)
- Three schedule modes:
  - `Reactive` — chat only, no background
  - `Continuous { check_interval_secs }` — self-prompt on interval
  - `Periodic { cron }` — simplified cron schedule
  - `Proactive { conditions }` — event-triggered
- Global LLM concurrency semaphore: `MAX_CONCURRENT_BG_LLM = 5`
- Skip-if-busy: tick skipped when previous still running

### 7.3 OpenClaw — Cron-on-Exit Design

**The problem:** CLI backends run each turn as a supervisor-spawned detached process group that is `SIGTERM→SIGKILL`'d at turn end. Any process the agent backgrounds via `exec` dies with the turn.

**The solution (`DESIGN-cron-on-exit.md`):** A new cron `schedule kind: "on-exit"` executed by a gateway-supervisor-owned watcher:

```
CronSchedule gains { kind: "on-exit"; command: string; cwd?: string }
computeNextRunAtMs() returns undefined for on-exit → time-based timer never fires it
createCronExitWatchers() → backed by getProcessSupervisor()
  → spawns command via supervisor.spawn({ mode:"child", scopeKey:"cron-exit:<jobId>", captureOutput:true })
  → await run.wait() → persist (job disabled) BEFORE fire → fire via existing cron pipeline
```

Key design: persist-before-fire (fail-closed: if store write or `wait()` rejects, job does NOT fire) prevents double-fire on gateway restart. One-shot by default.

### 7.4 Best-of — Cron Pattern Catalog

The catalog doesn't prescribe a cron model. The relevant projects in the "always-on personal agent" use case (OpenClaw, Hermes, Khoj, Agent Zero, OpenHarness) each implement scheduling differently. The `on-exit` pattern in OpenClaw is novel and not yet widespread in the catalog.

---

## 8. Provider / Model Abstraction

### 8.1 Hermes

**Mechanism:** `providers/` registry of `ProviderProfile` objects:
- Discovery: `plugins/model-providers/<name>/` → `$HERMES_HOME/plugins/model-providers/<name>/` → `providers/<name>.py` (legacy)
- Profile contents: name, aliases, base URL template, API mode (chat_completions vs codex_responses), model list, context length defaults, pricing info
- User plugins override bundled ones on name collision

**Model capability detection:** `agent/model_metadata.py` — context length tables per model, `estimate_messages_tokens_rough()` for cheap estimation. Provider-specific adapters: `anthropic_adapter.py`, `gemini_native_adapter.py`, `codex_responses_adapter.py`.

**Fallback chain:** Configured in `config.yaml` under `model.fallback`. Provider errors classified by `error_classifier.py` → retry with exponential backoff.

**What `hermes model` does:** `hermes_cli/models.py` — interactive selection UI listing all registered providers and models.

### 8.2 OpenFang

**27 providers:** Anthropic, Gemini, OpenAI, Groq, DeepSeek, OpenRouter, Together, Mistral, Fireworks, Cohere, Perplexity, xAI, AI21, Cerebras, SambaNova, HuggingFace, Replicate, Ollama, vLLM, LM Studio, Qwen, MiniMax, Zhipu, Moonshot, Qianfan, Bedrock.

**3 native drivers:**
1. `AnthropicDriver` — Native Messages API, Content blocks, 5MB image cap
2. `GeminiDriver` — Native v1beta API, `x-goog-api-key` auth, `systemInstruction`
3. `OpenAiCompatDriver` — Covers 18+ providers with different `base_url` configs

**Model catalog:** 51 built-in models, 20+ aliases, model tiers (Frontier/Smart/Balanced/Fast), cost rates per model.

### 8.3 OpenClaw

**30+ provider plugins:** Via `ProviderPlugin` interface in `src/plugin-sdk/`. Each provides model catalog, stream handler, auth, onboarding.

Provider plugins (21 listed): `anthropic`, `anthropic-vertex`, `openai`, `google`, `google-gemini`, `azure-openai`, `aws-bedrock`, `minimax`, `moonshot`, `deepseek`, `xai`, `groq`, `together`, `fireworks`, `perplexity`, `cohere`, `mistral`, `lmstudio`, `ollama`, `openrouter`, `nvidia`.

**OAuth subscriptions:** Unique among the three systems — OpenClaw supports OAuth-based provider authentication, not just API keys.

**Model selection:** `model-selection.ts` selects best model per turn based on channel capability requirements, tool schema projections, provider availability with failover, auth profile state, cost awareness.

### 8.4 Best-of — LiteLLM / Vercel Patterns

From `harnesses.json:361-363`: 8 projects tagged `provider-agnostic` use LiteLLM, vercel/ai, or similar unified provider interfaces. The best-of comparison notes: "LiteLLM, vercel/ai patterns" are the dominant approach for provider-agnostic routing.

---

## 9. State Persistence

### 9.1 Hermes

- **SQLite FTS5 WAL mode** (`hermes_state.py:SessionDB`) — session metadata, full message history, FTS5 virtual table for text search
- **Trajectory storage:** Separate output directories from batch_runner, NOT in main session DB
- **Session source tagging:** `'cli'`, `'telegram'`, etc.
- **Compression-triggered splitting:** `parent_session_id` chains link compressed sessions
- **Session listing:** Roots + branch children visible; subagent and compression runs hidden

### 9.2 OpenFang

- **SQLite schema v5** (`openfang-memory/src/migration.rs`):
  - V1: agents, sessions, memory entries
  - V2: task board, shared memory namespace
  - V3: vector storage column
  - V4: usage_events table
  - V5: canonical sessions (cross-channel memory with compaction summaries)
- **Backup:** No explicit backup tool — user responsible for `cp ~/.openfang/data/openfang.db`
- **Restart survivability:** Agents restored on kernel boot; state (Running/Suspended) maintained; background loops restart

### 9.3 OpenClaw

- **SQLite-first storage** (enforced in `AGENTS.md`): "Do not add JSON/JSONL/TXT/sidecar files for OpenClaw-owned runtime state"
- **Global state DB:** `state/openclaw.sqlite` — global runtime state, plugin KV data
- **Per-agent DB:** `agents/<agentId>/agent/openclaw-agent.sqlite` — agent-scoped state/cache
- **Kysely helpers** for all SQLite access
- **Session compaction** (`compaction*.ts`, ~15 files): automatic conversation summarization, planning worker, token-aware, preserves tool results and attachment references

---

## 10. Security Model

### 10.1 Hermes

| Layer | Mechanism |
|-------|-----------|
| **Tool approval gates** | `tools/approval.py` — prompt approval + write approval; in CLI mode prompts user, in gateway mode queues for approve/deny |
| **Subagent auto-deny** | `_subagent_auto_deny()` — subagent threads cannot prompt user; opt-in YOLO mode |
| **Prompt injection scanning** | `tools/threat_patterns.py` — shared scanner for context files and tool result processing |
| **File write deny-lists** | `tools/file_operations.py:48` — `WRITE_DENIED_PATHS` and `WRITE_DENIED_PREFIXES` |
| **Website policy** | `tools/website_policy.py` — URL allow/deny lists |
| **Provider auth** | `.env` secrets only (not `config.yaml`); `OPTIONAL_ENV_VARS` dict with metadata; setup wizard collects and saves |
| **TIRITH security** | `tools/tirith_security.py` — policy-as-code security framework |
| **Secrets scoping** | `agent/secret_scope.py` — scoping for provider credentials |
| **Gateway pairing** | `gateway/pairing.py` — DM pairing for gateway security |

### 10.2 OpenFang

16 security layers (`SECURITY.md:46-81` + `docs/architecture.md:513-579`):

| # | System | Implementation |
|---|--------|----------------|
| 1 | WASM Dual-Metered Sandbox | Wasmtime fuel metering + epoch interruption |
| 2 | Merkle Hash-Chain Audit Trail | Every action cryptographically linked to previous |
| 3 | Information Flow Taint Tracking | `TaintLabel`, `TaintSet` in `openfang-types/src/taint.rs` |
| 4 | Ed25519 Signed Agent Manifests | `manifest_signing.rs` |
| 5 | SSRF Protection | `is_ssrf_target()` blocks private IPs, cloud metadata |
| 6 | Secret Zeroization | `Zeroizing<String>` on all API key fields |
| 7 | OFP Mutual Authentication | HMAC-SHA256 nonce-based |
| 8 | Capability Gates | Role-based access control via `CapabilityManager.check()` |
| 9 | Security Headers | CSP, X-Frame-Options, HSTS on every response |
| 10 | Health Endpoint Redaction | `/api/health` minimal; `/api/health/detail` requires auth |
| 11 | Subprocess Sandbox | `env_clear()` + selective variable passthrough |
| 12 | Prompt Injection Scanner | Detects override attempts, data exfiltration patterns |
| 13 | Loop Guard | SHA256-based tool call repetition detection |
| 14 | Session Repair | 7-phase message history validation and auto-recovery |
| 15 | Path Traversal Prevention | Canonicalization with symlink escape prevention |
| 16 | GCRA Rate Limiter | Cost-aware token bucket rate limiting per IP |

**Critical gap:** The Browser Hand's purchase approval gate is **prompt-enforced only** — a system prompt instruction with no code-level enforcement. If the LLM disobeys, there's no code-level blocker.

### 10.3 OpenClaw

19 audit modules (`src/security/audit*.ts`):

| Module Category | Coverage |
|----------------|---------|
| Channel security | DM policy, read-only accounts, source config |
| Config safety | Symlinks, include paths, dangerous config flags |
| Exec safety | Safe binaries, sandbox host, execution surface |
| Gateway exposure | HTTP auth, tools-over-HTTP, auth selection |
| Plugin code safety | Read-only scope, trust model, code analysis |
| Model hygiene | Model references, small-model risk |
| Filesystem security | Windows ACLs, path policies |
| Sandbox auditing | Docker config, browser sandbox |
| Synced folders | Multi-device sync safety |

**Additional mechanisms:** SSRF protection (`ssrf-*.ts`), secrets masking (`secret-mask.ts`), install policy (`install-policy.ts`), DM pairing (default: must pair before DMs work), anti-bot-loop protection.

### 10.4 Best-of — Threat Model Catalog

The catalog doesn't prescribe security models but the tag vocabulary shows what's valued: `sandbox` (17 projects), `mcp` (20 projects, which includes MCP's security model). The most common security pattern is tool approval gates for sensitive operations.

---

## 11. Observability

### 11.1 Hermes

| Component | Detail |
|-----------|--------|
| **Log files** | 3 profile-aware files: `agent.log` (INFO+), `errors.log` (WARNING+), `gateway.log` (INFO+) in `~/.hermes/logs/` |
| **Log command** | `hermes logs` with `--follow`, `--level`, `--session` options |
| **Trajectory replay** | Via `batch_runner.py` — full message sequences in JSONL format |
| **Session history** | `hermes_state.py` preserves full message history with timestamps |
| **Usage tracking** | `agent/usage_pricing.py`, `agent/credits_tracker.py`, `agent/billing_view.py`, `agent/account_usage.py` |
| **Gateway `/usage` slash command** | Wires to `fetch_account_usage()` |
| **Portal billing** | `hermes_cli/nous_billing.py` — Nous Portal integration |

### 11.2 OpenFang

| Component | Detail |
|-----------|--------|
| **Logging** | `tracing` + `tracing-subscriber`, JSON format, structured fields (`agent`, `id`, `iteration`) |
| **Tracing points** | Kernel boot, agent loop iterations, background ticks, CDP commands, skill load/unload, hand load |
| **Metrics** | `MeteringEngine` — cost tracking per model family; `AgentScheduler.usage` — rolling hourly token counts |
| **Dashboard** | Hands publish metrics via `memory_store` (e.g., `researcher_hand_queries_solved`) |
| **Audit trail** | Merkle hash chain (`audit.rs`) — tamper-evident, `/api/audit/verify` endpoint |
| **Doctor** | `openfang doctor` — diagnostic health checks with optional `--repair` flag |

### 11.3 OpenClaw

| Component | Detail |
|-----------|--------|
| **Logging** | `src/logger/` — subsystem-based logging, diagnostic phases, log level configuration |
| **Startup tracing** | `emitStartupTrace()` with `OPENCLAW_GATEWAY_STARTUP_TRACE` |
| **Health checks** | Gateway readiness endpoint, channel health monitoring, process supervisor state, doctor subsystem |
| **Diagnostics** | `src/infra/diagnostic-events.ts` — structured diagnostic event emission |
| **Restart tracing** | `src/gateway/restart-trace.ts` |

### 11.4 Best-of — Standard Patterns

Observability patterns across the 106-project catalog are varied. The most common: log levels (debug/info/warn), structured logging, metrics dashboards, and trace/replay for debugging agent behavior.

---

## 12. Self-Improvement / Learning Loops

### 12.1 Hermes — The Only Closed Learning Loop

This is the most architecturally significant differentiator. Hermes has a **complete, autonomous self-improvement cycle**:

**Step 1 — Memory persistence:** Every turn stored in SQLite FTS5. `MemoryManager` orchestrates pluggable providers (Honcho, Mem0, etc.) with `prefetch()` (per-turn recall) and `sync_turn()` (per-turn write).

**Step 2 — Skill auto-creation:** After complex tasks, the agent autonomously creates skills via `skill_manage(action="create")` in `tools/skill_manager_tool.py`. Skills are `SKILL.md` files with YAML frontmatter stored in `~/.hermes/skills/`.

**Step 3 — Usage tracking:** `tools/skill_usage.py` records `use_count`, `patch_count`, `last_activity_at`, and state transitions per skill. The agent can `patch` and `edit` its own skills during conversations.

**Step 4 — Curator review:** `agent/curator.py` (1,976 lines) — background skill maintenance:
- Idle-triggered (not cron-based): fires when agent is idle and last run was > `interval_hours` (default 7 days)
- Spawns a forked `AIAgent` to review agent-created skills
- Auto-transitions: `active → stale → archived` based on usage
- Pinning: users can exempt skills from auto-transitions
- Never deletes: max destructive action is archive → `~/.hermes/skills/.archive/`
- `curator_backup.py` creates pre-run tar.gz snapshots

**Step 5 — Honcho dialectic user modeling:** One of the memory provider plugins, implementing dialectic-based user modeling that tracks preferences, behavior patterns, and interaction history across sessions.

**Step 6 — FTS5 session search with LLM summarization:** Session search results are LLM-summarized before being shown to the agent.

**Total self-improvement files:** `agent/curator.py` (1,976), `tools/skill_manager_tool.py`, `tools/skills_tool.py`, `agent/memory_manager.py`, `agent/memory_provider.py`, `tools/skill_usage.py`.

### 12.2 OpenFang — No Explicit Learning Loop

Despite sophisticated infrastructure (198K LOC, 16 security layers), OpenFang has **no autonomous skill improvement system**. Skills are:
- Bundled at compile time via `include_str!()` in `bundled.rs`
- Loaded from `~/.openfang/hands/<id>/` at runtime
- SHA256-audited at load time

Hands can revise their own skill content via `file_write`, but there is no:
- Autonomous skill creation after complex tasks
- Usage tracking for skill effectiveness
- Curator-style review of agent-created skills
- FTS5 or vector search for memory-driven skill improvement

**What OpenFang does have:** The knowledge graph enables agents to build up persistent understanding of the world. The Researcher hand explicitly stores source credibility and cross-references. But this is information persistence, not skill self-improvement.

### 12.3 OpenClaw — Skill Workshops, No Autonomy

OpenClaw has skill infrastructure but not autonomous self-improvement:
- **Skill workshops:** `skills/` directory with bundled skills
- **Skill management:** CRUD tools for skills
- **No curator:** No background review process for agent-created skills
- **No usage tracking:** Skills don't track their own effectiveness

### 12.4 Best-of — Memory Patterns, Not Learning Loops

The catalog identifies 18 projects tagged `memory` (Mem0, claude-mem, Letta, etc.) but none of the comparison pages describe an autonomous learning loop. The best-of's `openclaw-vs-hermes.md:27-30` notes: "The learning loop is real but double-edged — bad patterns get 'etched in stone' alongside good ones."

**Verdict:** Hermes is unique among all 106 cataloged projects in having a **closed, autonomous skill improvement loop** with idle-triggered curator review. This is its most distinctive architectural feature.

---

## 13. Unique Innovations Per Repo

### 13.1 Hermes — What Nobody Else Has

1. **Closed learning loop** — Only system with autonomous skill creation → usage tracking → curator review → archive lifecycle
2. **RPC zero-context-cost turns** — `delegate_task` + `registry.dispatch()` collapses multi-step pipelines into single LLM turns
3. **Six terminal backends** — Local, Docker, SSH, Singularity, Modal, Daytona. All other systems support one or two.
4. **AST-based tool auto-discovery** — `_module_registers_tools()` using Python AST; only files that call `registry.register()` are imported
5. **Fork-based curation** — Curator spawns a forked `AIAgent` to review skills (avoids prompt cache pollution)
6. **Batch trajectory generation + compression** — `batch_runner.py` + `trajectory_compressor.py` for training data pipelines
7. **agentskills.io compatibility** — `GitHubSource` in `tools/skills_hub.py` fetches skills from any GitHub repo

### 13.2 OpenFang — What Nobody Else Has

1. **Agent OS kernel metaphor** — Scheduler, RBAC, metering, event bus, workflow engine — analogous to an OS kernel. OpenClaw has a gateway but OpenFang has a full kernel.
2. **Hands as multi-phase autonomous agents** — 500+ word expert procedure system prompts with 6-8 numbered phases (Researcher: 7 phases, Clip: 8 phases)
3. **WASM dual-metered sandbox** — Fuel (instruction count) + epoch (wall-clock) via Wasmtime + watchdog. No other system has this.
4. **Merkle hash-chain audit trail** — Every action cryptographically linked to previous. Tamper-evident logging.
5. **16 security layers** — Most defense-in-depth of any system
6. **Knowledge graph with confidence scoring** — SQLite-based entities + relations with 0.0-1.0 confidence on relations
7. **Native CDP browser automation** — Chrome DevTools Protocol over WebSocket in Rust (not Playwright despite HAND.toml)
8. **Einstein Hand pattern** — Compile-time requirement that 6 hand types all carry the same 8 tools (`knowledge_*`, `schedule_*`, `memory_*`)

### 13.3 OpenClaw — What Nobody Else Has

1. **28+ channel integrations** — Widest multi-channel coverage (iMessage built-in, 27 more via plugins)
2. **Native cross-platform apps** — macOS (Swift/SwiftUI/WKWebView), iOS, Android — all first-party
3. **Canvas visual workspace** — Persistent HTML/CSS/JS rendering surface accessible to the LLM, with A2UI rendering protocol
4. **Voice/Talk real-time pipeline** — Realtime voice conversations with STT → LLM → TTS, agent consult during calls, barge-in
5. **Gateway-supervisor cron-on-exit** — Solves the "background processes die at turn end" problem that plagues all CLI-based agents
6. **19 security audit modules** — Most comprehensive audit surface of any system
7. **Lazy channel loading** — `channel.ts` (lightweight facade) + `channel.runtime.ts` (full impl); gateway server itself behind dynamic import
8. **Plugin SDK with strict boundary enforcement** — `openclaw/plugin-sdk/*` subpath imports only; enforced by import cycle checks
9. **ClawSweeper** — Automated PR review bot with structured policy
10. **macOS MLX TTS** — Apple Silicon native text-to-speech via MLX

### 13.4 Best-of — What Nobody Else Has

1. **Curated harness discovery service** — MCP server with 6 tools for picking harnesses by use case, complexity, autonomy, recovery
2. **Autonomy/recovery axes** — Only framework that makes designed autonomy regime and failure-recovery tier explicit taxonomy
3. **Editorial curation with two-flow pipeline** — Flow 1 (API refresh) → curation-queue.json → Flow 2 (human editorial judgment)
4. **Agent-readable `llms.txt`** — Flat-text index designed for any coding agent to consume directly
5. **Post-June 2026 billing as explicit decision dimension** — The best-of comparison explicitly addresses the shift in how programmatic agent usage is billed

---

## 14. Architectural Anti-Patterns Observed

### 14.1 Hermes — Complexity as Anti-Pattern

- **1.3M LOC in Python** — The single largest codebase in the survey. Every feature adds to the cognitive overhead of understanding the system.
- **`run_agent.py:20,526 lines`** — The gateway runner is a 20,000-line file that does everything. This violates the single-responsibility principle at massive scale.
- **60 constructor parameters for `AIAgent`** — The class has accumulated so much state that instantiation requires understanding 60 separate parameters.
- **6 terminal backends = 6× maintenance surface** — Each backend (`local.py`, `docker.py`, `ssh.py`, `singularity.py`, `modal.py`, `daytona.py`) is a separate implementation of the same `BaseEnvironment` ABC.
- **Plugin discovery in 3 places** — `plugins/model-providers/`, `$HERMES_HOME/plugins/`, `providers/<name>.py` (legacy). The override behavior (last-writer-wins) is documented but non-obvious.
- **Exact-pinned dependencies** — While this is a security feature (prevents supply-chain attacks), it creates a maintenance burden of constant updates.

### 14.2 OpenFang — Aspirational Scope

- **198K LOC for v0.6.9** — An extraordinary amount of infrastructure for a project that appears early-stage. The README claims 7 bundled hands; code reveals 9. Claims Playwright bridge; code uses CDP.
- **Purchase approval gate is prompt-enforced only** — Despite being listed as a security feature, there's no code-level enforcement. If the LLM disobeys the "NEVER auto-complete purchases" instruction, nothing blocks it.
- **No dedicated coding hand** — OpenFang has hands for research, trading, Twitter, lead generation, content clipping, and browsing, but no autonomous coding agent. This is a significant gap for developers.
- **Prompt-driven security** — Several "security" features (purchase gate, data exfiltration prevention) are implemented as LLM instructions rather than code-enforced constraints.
- **`max_iterations = 50`** — The circuit breaker at 30× same tool call could prematurely terminate long but valid reasoning loops.

### 14.3 OpenClaw — Complexity and Churn

- **155 workspace packages** — The monorepo is vast. Understanding any subsystem requires navigating this package graph.
- **82 releases** — Per the best-of comparison (`openclaw-vs-hermes.md:35`), OpenClaw has had 82 releases vs Hermes's 6. This creates severe update churn for users.
- **Dual facade/runtime for everything** — Every channel has `channel.ts` (lightweight) + `channel.runtime.ts` (full). This doubles the implementation surface.
- **Plugin SDK boundary fragility** — The rule "plugins must only import from `openclaw/plugin-sdk/*`" is enforced by convention and cycle checks, not by the type system. A misconfigured plugin can still import from `src/**` internals.
- **SQLite-only storage** — While SQLite-first is a good default, the AGENTS.md rule ("SQLite only") means there's no graceful degradation for large-scale deployments. Horizontal scaling requires additional architecture.

### 14.4 Best-of — Catalog Limitations

- **Curation lag** — The two-flow design (weekly API refresh → human editorial judgment) means the catalog lags current reality by at least a week.
- **No deep architectural analysis** — The best-of provides taxonomy and decision guides, but doesn't do deep code analysis. A project can be well-categorized without being well-understood.
- **Graveyard of 4 projects** — Including `get-shit-done` (64.6k stars, archived), `Roo Code` (24.3k stars, archived) shows even popular projects can be abandoned.

---

## 15. Convergent Patterns

Patterns that **all four** systems agree on, or that emerge from the 106-project catalog:

### 15.1 The Tool-Call Loop Is Universal

~80% of the 106 cataloged projects use the model → tool calls → execute → model loop. Hermes, OpenFang, and OpenClaw all implement this pattern. The loop is the dominant paradigm.

### 15.2 Provider Abstraction Is Standard

All three systems abstract LLM providers: Hermes (`ProviderProfile`), OpenFang (3 native drivers + OpenAiCompatDriver), OpenClaw (30+ provider plugins). The best-of catalog identifies 8 projects tagged `provider-agnostic` as using LiteLLM/vercel/ai patterns. This is a solved problem across the ecosystem.

### 15.3 Memory Persistence Is Expected

All three systems persist memory across sessions: Hermes (SQLite FTS5 + pluggable providers), OpenFang (6-layer SQLite), OpenClaw (Core/Wiki/LanceDB). The best-of catalog identifies 18 projects tagged `memory`. The question is no longer **whether** to persist, but **who owns** the memory (application vs agent vs harness).

### 15.4 Approval Gates for Sensitive Actions

Hermes (approval queue), OpenFang (capability gates + prompt-enforced purchase gate), OpenClaw (19 audit modules + exec approval flow). All three require human approval or explicit capability grants before dangerous operations.

### 15.5 Streaming Output Is Default

All three stream LLM output to the user. Tool results are extracted from stream chunks. Non-streaming is the exception, not the rule.

### 15.6 Multi-Channel Ingress Is Growing

Hermes (17+ via gateway), OpenFang (40 via channel adapters), OpenClaw (28+ via plugin system). The best-of catalog's "personal agent runtimes" category (OpenClaw 382k stars, Hermes 210k stars) shows users want agents that live where they live — across all their messaging platforms.

### 15.7 The MCP Standard Is Emerging

Both OpenClaw and best-of (as an MCP server) use MCP as a first-class integration protocol. Hermes has MCP client support via `mcp_serve.py`. OpenFang uses A2A for agent-to-agent and MCP for tool integration. MCP is the emerging standard for tool and agent interoperability.

---

## 16. Divergent Patterns

### 16.1 Language Choice

| Language | Tradeoff | Systems |
|----------|----------|---------|
| **Python** | Developer ergonomics, rich ecosystem, rapid iteration, GIL-bound | Hermes |
| **Rust** | Memory safety, zero-cost abstractions, no runtime, compile-time guarantees, binary distribution | OpenFang |
| **TypeScript** | Type safety, npm ecosystem, shared language for core + plugins | OpenClaw |

**Why it matters:** The language choice shapes the entire culture of the project. Hermes is Pythonic (batteries included, rich tooling). OpenFang is Rustacean (memory safety, performance, binary distribution). OpenClaw is TypeScript-first (npm ecosystem, native apps).

### 16.2 Distribution Strategy

| Strategy | Implication | Systems |
|----------|-------------|---------|
| **Single binary** | Simplest ops, no runtime deps, ~32MB | OpenFang |
| **curl/pip install** | Developer-friendly, Python ecosystem integration | Hermes |
| **npm + native apps** | Broadest reach, platform-native UX | OpenClaw |
| **MCP server** | Tool for other agents, not standalone | Best-of |

### 16.3 Core Abstraction Metaphor

| Metaphor | System | Interpretation |
|----------|--------|----------------|
| **Narrow waist** | Hermes | `AIAgent` class is the single entry point for all surfaces |
| **OS kernel** | OpenFang | Scheduler, RBAC, metering, event bus — explicitly analogized to an OS kernel |
| **Gateway + runtime** | OpenClaw | Gateway (control plane) + Agent Runtime (product) — layered architecture |
| **Catalog** | Best-of | No opinion on internal architecture; describes patterns |

### 16.4 Multi-Agent Philosophy

| Approach | System | Description |
|----------|--------|-------------|
| **ThreadPoolExecutor subagents** | Hermes | Isolated child agents, RPC pattern |
| **Hands as parallel processes** | OpenFang | Named autonomous agents with shared knowledge graph |
| **Gateway multiplexing** | OpenClaw | Per-channel agents, subagent spawning |
| **Orchestration patterns** | Best-of | Handoffs, roles, group chat, state machines |

### 16.5 Security Enforcement Philosophy

| Approach | System | Description |
|----------|--------|-------------|
| **Code-enforced** | OpenFang (mostly) | WASM metering, capability gates, GCRA rate limiting — enforced at runtime |
| **User-interactive** | Hermes | Approval queues, clarify prompts — human-in-the-loop |
| **Audit-based** | OpenClaw | 19 audit modules — detects and reports, not always blocks |
| **Mixed** | All | All systems use a mix; no pure approach |

### 16.6 Self-Improvement

| Approach | System | Description |
|----------|--------|-------------|
| **Closed autonomous loop** | Hermes | Skill auto-create → usage tracking → curator review → archive |
| **Prompt-driven skill revision** | OpenFang | Hands revise skills via `file_write` but no autonomous lifecycle |
| **Skill workshops** | OpenClaw | Skill infrastructure but no autonomous improvement |
| **Memory layer patterns** | Best-of | Mem0, Letta, claude-mem — who owns memory question |

---

## 17. The "Field Report" — Where the Industry Is Heading

### 17.1 The OS Metaphor Is Converging

Both OpenFang and OpenClaw independently arrived at the **"agent as operating system"** metaphor:

- OpenFang explicitly builds a kernel (`OpenFangKernel`) with scheduler, RBAC, metering, event bus, and workflow engine
- OpenClaw builds a **gateway** (control plane) + **agent runtime** (product) — the gateway is the OS kernel for the agent

The best-of definition (`README.md:27`) articulates why: "the harness plays the role the kernel played in operating systems or the controller played in industrial robotics." This is a **convergent insight** across three independent projects.

**Implication for Bizar:** Bizar should adopt a kernel-style architecture — a minimal, stable core (scheduler, capability gates, memory management) with protocol-based extension for tools, channels, and agents.

### 17.2 The Learning Loop Is the Differentiator

Hermes is the **only** system among 106 cataloged projects with a closed, autonomous skill improvement loop. This is the most architecturally distinctive feature.

**Why it matters:** Without a learning loop, agents are static — they don't improve from experience. With one, agents can autonomously accumulate capability over time.

**The risk (from best-of `openclaw-vs-hermes.md:29`):** "The learning loop is real but double-edged — bad patterns get 'etched in stone' alongside good ones." Hermes addresses this via the Curator's archive mechanism (never deletes, only archives).

**Implication for Bizar:** Bizar should implement a learning loop. The Hermes model (skill auto-create → usage tracking → idle-triggered review → archive) is a proven pattern.

### 17.3 Provider Abstraction Is Solved

All three systems have robust provider abstraction. The frontier is no longer "which models can I use?" but "how do I route between models intelligently based on cost, capability, and context?"

**Implication for Bizar:** Use a proven abstraction (LiteLLM or OpenFang's 3-driver model) rather than building custom.

### 17.4 MCP Is the Emerging Integration Standard

OpenClaw (as an MCP server), best-of (as an MCP server), Hermes (as MCP client), OpenFang (MCP client + A2A). MCP is the USB of AI agents — the standard that lets agents and tools interoperate.

**Implication for Bizar:** Bizar should be MCP-first — expose capabilities via MCP and consume MCP tools from other systems.

### 17.5 Cross-Channel Continuity Is the Consumer Dream

OpenClaw (28+ channels), Hermes (17+ platforms), OpenFang (40 adapters). Users want agents that live where they live — Telegram, Discord, iMessage, WhatsApp, Signal, email, and eventually voice.

**The unsolved problem:** Cross-channel conversation continuity. When a user starts a conversation on Telegram and continues on WhatsApp, the agent should remember. OpenFang's "canonical sessions" (schema v5) addresses this; Hermes and OpenClaw have partial solutions.

**Implication for Bizar:** Build for multi-channel from day one. Channel adapters should be plugins, not core code.

### 17.6 Rust for Harnesses Is a Real Bet

OpenFang demonstrates that a full "Agent OS" can be built in Rust with ~198K LOC, compiling to a single 32MB binary with 180ms cold start and 40MB idle memory. This is a credible alternative to Python for performance-critical agent infrastructure.

**Implication for Bizar:** If Bizar ever needs performance-critical components (sandboxing, tool execution, agent loop), Rust is a proven choice. Python remains better for rapid development and ecosystem integration.

### 17.7 The "Headless + Durable" Quadrant Is Sparse

The best-of landscape visualization shows the **headless + durable quadrant** (top-right of the autonomy vs recovery grid) is the sparsest — only a handful of projects qualify. Most agent systems are either step-gated (human approves each step) or have no recovery story (state lost on crash).

**Implication for Bizar:** Building in the headless + durable quadrant is a green field opportunity. This means: agents that run unattended AND survive crashes mid-task.

### 17.8 Billing as Architecture

The best-of comparison introduces a dimension invisible in most architectural discussions: **post-June 2026 billing reality**. Programmatic agent usage draws from separate credit pools. This changes architecture decisions: minimizing LLM calls, routing to cheaper models for simple tasks, caching aggressively.

**Implication for Bizar:** Cost awareness should be a first-class architectural concern, not an afterthought.

---

## Appendix: Key File References

### Hermes Agent
- Agent loop: `agent/conversation_loop.py:518`
- Tool registry: `tools/registry.py:58`
- Delegate tool: `tools/delegate_tool.py:197`
- Memory manager: `agent/memory_manager.py`
- Curator: `agent/curator.py`
- Cron scheduler: `cron/scheduler.py:3007`
- FTS5 state: `hermes_state.py`

### OpenFang
- Agent loop: `crates/openfang-runtime/src/agent_loop.rs:293`
- Tool runner: `crates/openfang-runtime/src/tool_runner.rs:3500`
- Knowledge graph: `crates/openfang-memory/src/knowledge.rs:16`
- Kernel boot: `crates/openfang-kernel/src/kernel.rs` boot sequence
- Hands bundled: `crates/openfang-hands/src/bundled.rs:6`
- Browser CDP: `crates/openfang-runtime/src/browser.rs:44`
- Cron-on-exit design: `DESIGN-cron-on-exit.md:1-29` (OpenClaw repo reference)

### OpenClaw
- Embedded agent runner: `src/agents/embedded-agent-runner/run.ts`
- Gateway server: `src/gateway/server.impl.ts:1-1869`
- Agent tools: `src/agents/agent-tools.ts:1196`
- Subagent spawn: `src/agents/subagent-spawn.ts:1394`
- Tool policy: `src/agents/tool-policy.ts`
- Memory core: `extensions/memory-core/`
- Cron exit watchers: `src/gateway/cron-exit-watchers.ts:18`

### Best-of
- MCP server: `mcp/server.py:82`
- Harness ranking: `harnesses.json:349`
- Tag rules: `scripts/generate.py:38-61`
- OpenClaw vs Hermes: `comparisons/openclaw-vs-hermes.md:27-30`

---

*Cross-reference compiled by Thor, 2026-07-06. Sources: Hermes Agent round-1+2 reports, OpenFang round-1+2 reports, OpenClaw round-1+2 reports, Best-of-Agent-Harnesses round-1+2 reports, and primary source validation.*
