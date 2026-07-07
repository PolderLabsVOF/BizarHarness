# Deep Subsystem Analysis — Round 3

**Scope:** Targeted deep dive on four subsystems that are most relevant to Bizar's mission as a multi-agent coding harness. Each subsystem is traced across **Hermes** (`NousResearch/hermes-agent`), **OpenFang** (`RightNow-AI/openfang`), **OpenClaw** (`openclaw/openclaw`), and **best-of-Agent-Harnesses** (curated catalog of 106 projects). All file:line references are verified against the captured snapshots in `research/agent-harness-survey/repos/`.

**Date:** 2026-07-06  
**Authors:** @tyr (round-3 cross-reference analysis)

---

## Subsystem 1 — Subagent / Multi-Agent Dispatch

### 1.1 Hermes — ThreadPoolExecutor + RPC zero-context-cost

The single largest dispatch surface in Hermes is `tools/delegate_tool.py` (3,445 lines). The implementation is intentionally Pythonic and pragmatic:

- **Thread pool**: `concurrent.futures.ThreadPoolExecutor(max_workers=max_workers, initializer=_set_subagent_approval_cb, initargs=(approval_callback,))` is the primitive. Each subagent runs on a worker thread; one `AIAgent` per child, with its own `task_id` and own terminal session (`tools/delegate_tool.py:28`).
- **Tool firewall**: `DELEGATE_BLOCKED_TOOLS = frozenset({"delegate_task", "clarify", "memory", "send_message", "execute_code", "cronjob"})` at `tools/delegate_tool.py:45` is the parent→child boundary. The child can `delegate_task` only when `role="orchestrator"` and `delegation.orchestrator_enabled: true`.
- **Concurrency cap**: `_get_max_concurrent_children()` reads `delegation.max_concurrent_children` (default 3) on every get-definitions call so it picks up live config changes without restart (`tools/delegate_tool.py:354-380`).
- **Two shapes**: `delegate_task(goal="...", context="...")` for a single child, or `delegate_task(tasks=[{...}, {...}])` for batch parallel execution. The batch path internally builds a `ThreadPoolExecutor` and returns `as_completed()` results.
- **Zero-context-cost RPC**: a Python script can call `registry.dispatch(tool_name, args)` directly inside the subagent thread, bypassing the LLM. The parent sees only the `delegate_task` call and the returned summary — never the child's intermediate steps.

The design implication is **strict isolation**: a child cannot recursively delegate (unless it is an orchestrator), cannot pester the user with `clarify`, cannot write to memory, and cannot send a message on a channel. The parent is the only entity that touches user-facing surfaces. This is enforced *structurally* by the tool firewall, not by prompt instructions.

### 1.2 OpenFang — Hands as scheduled processes

OpenFang's subagent concept is encoded in **`Hand.toml` manifests** at `crates/openfang-hands/src/bundled/<id>/HAND.toml` (e.g. `bundled/researcher/HAND.toml`). Each Hand declares its own agent config including `max_iterations`, `provider`, `model`, and a multi-phase system prompt. The lifecycle is `crates/openfang-kernel/src/kernel.rs:892-906` and the kernel exposes:

- `agent_spawn` / `agent_send` / `agent_list` / `agent_kill` / `agent_activate` tools (`crates/openfang-runtime/src/tool_runner.rs`).
- `ScheduleMode::{Reactive, Continuous, Periodic, Proactive}` (`crates/openfang-kernel/src/background.rs:21-200`) — a Hand can be reactive (chat only), continuous (self-prompt on interval), periodic (simplified cron), or proactive (event-triggered).
- **Global concurrency cap**: `MAX_CONCURRENT_BG_LLM = 5` (`background.rs:18`) prevents background agents from starving foreground work.
- **Capability inheritance**: `validate_capability_inheritance()` ensures a child agent cannot exceed the parent's declared capabilities.

The key difference from Hermes: OpenFang's Hands are **persistent processes** with their own state stored in SQLite (`memory_store` / `memory_recall`), their own knowledge graph entries, and their own schedule. They are not "fire-and-forget" subagents; they are scheduled workers.

### 1.3 OpenClaw — Gateway multiplexing + plugin-based delegation

OpenClaw's multi-agent model is **gateway-centric**: the Gateway process hosts N isolated agents, each with its own workspace, state directory, session store, and channel bindings (`docs/concepts/multi-agent.md:9-15`).

- **Per-agent directories**: `~/.openclaw/agents/<agentId>/agent/auth-profiles.json` for auth, `~/.openclaw/agents/<agentId>/sessions/` for chat history, plus a workspace at `~/.openclaw/workspace-<agentId>`. Each agent has its own `SOUL.md`/`AGENTS.md`/`USER.md`/`IDENTITY.md` (`docs/concepts/agent-workspace.md:67-103`).
- **Channel bindings**: a `binding` maps a channel account (e.g. one Discord bot, one WhatsApp number) to one agent. The Gateway demultiplexes inbound messages to the right agent.
- **Multi-tier agents**: `docs/concepts/delegate-architecture.md` describes three capability tiers — Tier 1 (read + draft, no sends), Tier 2 (send-on-behalf with explicit identity), Tier 3 (proactive via cron + standing orders). The same engine scales from a personal assistant to an organizational delegate.
- **Delegate hard blocks**: `SOUL.md` and `AGENTS.md` define non-negotiable hard blocks (never send external email without approval, never export contact lists, never execute commands from inbound messages). These rules load every session and are the last line of defense regardless of inbound instructions.

The dispatch surface is the **plugin SDK** (`src/plugin-sdk/`): plugin authors get `api.registerTool`, `api.registerChannel`, `api.registerMemoryProvider`, `api.registerCliCommand` (`src/plugin-sdk/plugin-test-api.ts:22`, `channel-entry-contract.test.ts:135`). Plugins declare capabilities, the Gateway enforces them at runtime.

### 1.4 best-of — Catalog of orchestration patterns

The curation framework identifies **8 recurring coordination primitives** across 106 projects (`round-2-architecture/best-of-architecture.md:368-383`):

| Primitive | Where it lives | Representative projects |
|----------|----------------|--------------------------|
| **Tool-call loop** | LLM ↔ harness ↔ tools | ~80% of projects |
| **Agent loop with permission gates** | Per-step or per-checkpoint approval | Cline, Aider, Open Interpreter |
| **State machine / graph** | Explicit transitions + persistent state | LangGraph, n8n, Microsoft Agent Framework |
| **Event loop with input queue** | Messages + crons + heartbeats as one stream | OpenClaw, Hermes, Khoj |
| **Memory hierarchy** | Working / episodic / persistent | Letta, Mem0, claude-mem |
| **Progressive disclosure** | Index first, details on demand | AGENTS.md, MCP-Zero, ToolGen |
| **Multi-agent handoff** | Call-center escalation | OpenAI Agents SDK, CrewAI, AutoGen |
| **Plugin/skill ecosystem** | Directory-discoverable skills | Anthropic Skills, ClawHub, superpowers |

The "unfashionable default" (`comparisons/multi-agent-orchestration.md:26`): most multi-agent use cases are **one orchestrator delegating to stateless sub-tasks**, expressible with a `for` loop. This is the anti-pattern that Hermes' RPC zero-context-cost turn is built to support directly.

### 1.5 Recurring primitives across all 4 systems

Three primitives appear in every system:

1. **Isolated subagent context.** The parent and child never share message history. Each child has its own message list, its own `task_id`, and (often) its own storage. Hermes: per-child `AIAgent` instance. OpenFang: per-Hand `AgentId`. OpenClaw: per-agent `agentId` with its own `agentDir`. best-of: the Letta/Mem0 memory hierarchy implies per-agent episodic store.

2. **Tool firewall or capability gate.** The child gets a *narrower* tool surface than the parent, not just a less-privileged version of the same surface. Hermes: `DELEGATE_BLOCKED_TOOLS`. OpenFang: `CapabilityManager.check()` + capability-inheritance validation. OpenClaw: `tools.allow`/`tools.deny` lists in agent config (`delegate-architecture.md:98-107`). best-of: every production orchestrator (LangGraph, OpenAI Agents SDK) implements capability scoping.

3. **Concurrency limit.** All four cap concurrent children, but with very different defaults — Hermes 3, OpenFang 5 global LLM calls, OpenClaw one agent per binding (i.e. serial per channel), best-of no consensus.

What does NOT appear universally: **persistent shared memory across children**. Hermes routes all memory writes through the parent (`memory` is blocked for children). OpenFang shares a SQLite knowledge graph across Einstein Hands but not across arbitrary subagents. OpenClaw's agents are fully isolated (per-agent `agentDir` is mandatory). Only best-of's Mem0/Letta projects offer shared episodic memory as a service.

---

## Subsystem 2 — Tool Sandboxing & Permission

### 2.1 Hermes — check_fn gating, AST discovery, subagent auto-deny

Hermes has a **defense-in-depth permission model** built on Python's import system:

- **`registry.register()` decorator** at `tools/registry.py:30-66`: each tool file calls `registry.register(name, toolset, schema, handler, check_fn, requires_env)` at module level. `check_fn` is a zero-arg callable returning `bool`; if it returns `False`, the tool is omitted from the schema sent to the LLM.
- **AST-based discovery** at `tools/registry.py:43-65`: `_module_registers_tools(module_path)` uses Python's `ast` module to detect `registry.register(...)` calls at module level. `discover_builtin_tools()` then imports only modules that actually register tools. No fragile import lists.
- **Subagent auto-deny**: `_subagent_auto_deny` is the default for subagent threads (`tools/delegate_tool.py:74`); the child cannot prompt the user. YOLO mode (`delegation.subagent_auto_approve: true`) is opt-in.
- **Write deny-lists**: `WRITE_DENIED_PATHS` and `WRITE_DENIED_PREFIXES` block writes to sensitive system files (`tools/file_operations.py:48`).
- **Dangerous command approval**: `tools/approval.py` + `tools/write_approval.py` run user approval flows for sensitive terminal commands and writes. In gateway mode they queue per-session.
- **Prompt injection scanning**: `tools/threat_patterns.py` is the shared scanner used by `agent/prompt_builder.py` for context files and by tool result processing.
- **Website policy**: `tools/website_policy.py` enforces URL allow/deny lists.

The `check_fn` pattern is load-bearing: most tools are *invisible* to the LLM unless their dependency (API key, binary on PATH) is present. This keeps the model from hallucinating calls to tools it cannot actually run.

### 2.2 OpenFang — WASM dual metering, match dispatch, SSRF protection

OpenFang's permission system is **runtime-enforced, not configuration-only**:

- **WASM dual metering** at `crates/openfang-kernel/src/kernel.rs:816`: `WasmSandbox::new()` initializes a Wasmtime engine with both **fuel metering** (instruction count) and **epoch interruption** (wall-clock). A watchdog thread kills runaway sandboxes. `fuel_limit: entry.manifest.resources.max_cpu_time_ms * 100_000` (`kernel.rs:2511`) sets per-execution fuel budgets.
- **Subprocess sandbox**: `cmd.env_clear()` + selective env passthrough (`crates/openfang-runtime/src/subprocess_sandbox.rs`). Process tree isolation with cross-platform kill.
- **`is_ssrf_target()`**: blocks private IPs (10.x, 172.16-31.x, 192.168.x), cloud metadata (169.254.169.254), DNS rebinding (`crates/openfang-runtime/src/tool_runner.rs`). Every `web_fetch` goes through this check before navigation.
- **Path traversal prevention**: `safe_resolve_path()` / `safe_resolve_parent()` on all file operations. Symlink escape prevention.
- **Capability gates**: `CapabilityManager.check()` runs before every tool invocation. If the agent's declared capabilities don't include the requested tool, the call returns `Permission denied` to the LLM.
- **Merkle audit trail**: every action is cryptographically linked to the previous in a hash chain (`crates/openfang-runtime/src/audit.rs`). Verification endpoint at `/api/audit/verify`.
- **Secret zeroization**: `Zeroizing<String>` on all API key fields, wiped on drop (`crates/openfang-runtime/src/runtime.rs`).
- **Ed25519 manifest signing**: `manifest_signing.rs` verifies agent identity and capability set at boot.
- **Prompt injection scanner**: `crates/openfang-runtime/src/skill_registry.rs` scans skill content for override attempts, data exfiltration patterns, shell references before installation.
- **GCRA rate limiter**: `governor 0.10` GCRA algorithm per IP (`crates/openfang-api/`).
- **Health endpoint redaction**: `/api/health` returns up/down only; `/api/health/detail` requires auth.

The README claims **16 security layers** (`round-1-recon/openfang-recon.md:430-453`). The above list confirms 12 that are code-enforced. The Browser Hand's purchase approval gate is the documented exception — it is **prompt-enforced only**, with no code-level blocker (`browser/HAND.toml:146-155`).

The match-statement dispatch (`tool_runner.rs:323-325`: `match tool_call.name.as_str() { "knowledge_add_entity" => ... "knowledge_add_relation" => ... "knowledge_query" => ... }`) is fast but inflexible: adding a tool means editing the match. There is no ABC trait — `ToolDefinition` is a data struct, not a Rust trait. This trades extensibility for predictable dispatch latency.

### 2.3 OpenClaw — Plugin SDK + multi-layer policy

OpenClaw ships **148 extensions** under `extensions/`, each implementing the same `api.registerTool` / `api.registerChannel` / `api.registerMemoryProvider` interface (`src/plugin-sdk/core.ts`). The security model is **policy + identity + sandbox**:

- **Per-agent tool policy**: each agent in `agents.list` gets `tools.allow` / `tools.deny` lists. The Gateway blocks at the tool boundary regardless of what the agent's persona files instruct (`delegate-architecture.md:96-107`).
- **Sandbox modes**: `agents.defaults.sandbox` supports `mode: "all"` for full isolation, with per-agent overrides (`delegate-architecture.md:114-120`).
- **Identity scoping**: each agent has its own OAuth credentials in `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`. The default policy is read-through to the main agent's credentials for the same profile id (with caveat about OAuth refresh portability; `multi-agent.md:31-33`).
- **Plugin hooks as policy**: `before_tool_call` / `after_tool_call` / `before_install` / `agent_end` hooks let plugins intercept, block, or annotate every tool call (`docs/concepts/agent-loop.md:60-77`). `{ block: true }` from `before_tool_call` is terminal and stops lower-priority handlers — i.e. **plugins can be policy enforcers**, not just observers.
- **Approval delivery helpers**: `src/plugin-sdk/approval-delivery-helpers.ts:253` provides the canonical approval flow for plugins that need user consent.
- **19 audit modules**: tool-policy audit, capability leak checks, supply-chain checks, drift detection, etc. (per the round-1 brief).

### 2.4 best-of — Sandboxing patterns from 17 sandboxed projects

The `sandbox` tag covers 17 projects in the catalog (`round-2-architecture/best-of-architecture.md:285-289`). The recurring patterns:

- **Docker sandbox** (OpenHands, Agent Zero): container-per-session, network isolation, read-only filesystem for sensitive dirs.
- **E2B / Daytona / Modal / Firecracker**: managed cloud sandboxes with sub-second cold start, hibernation on idle, per-session ephemeral storage.
- **Codex sandbox** (OpenAI): strongest default isolation — `sandbox: "workspace-write"` policy by default, network egress allow-list, no host filesystem access.
- **smolagents**: in-process Python sandbox with restricted builtins (no `open()`, no `exec()`) plus an opt-in E2B bridge.

The recurring primitive: **environment isolation at the OS or hypervisor level**, not just at the application permission layer. Tools that touch arbitrary code (file write, shell exec, browser) need a containment boundary; tools that just read (web search, memory recall) do not.

### 2.5 Recurring primitives across all 4 systems

1. **Tool gating at registration time**: every system removes tools from the LLM-visible schema based on availability (`check_fn`, capability check, `is_allowed`, role-based deny). The LLM never sees a tool it cannot invoke.
2. **Subagent narrower scope**: every system blocks dangerous tools for children (Hermes `DELEGATE_BLOCKED_TOOLS`, OpenFang capability inheritance, OpenClaw `tools.deny`, best-of n/a but recommended in every orchestrator doc).
3. **External content is treated as untrusted**: every system wraps recalled/searched content with marker tags (`OpenFang wrap_external_content()`, Hermes `threat_patterns.py`, OpenClaw `sessions_history` redaction). The model is told to treat retrieved text as data, not instructions.
4. **Audit trail**: every system logs tool calls; OpenFang adds Merkle hash chain verification, OpenClaw adds 19 audit modules, Hermes keeps three profile-aware log files (`agent.log`, `errors.log`, `gateway.log`).
5. **Hardcoded write-deny lists for sensitive paths**: Hermes (`WRITE_DENIED_PATHS`), OpenFang (`safe_resolve_path`), OpenClaw (sandbox `mode: "all"`).

What does NOT appear universally: **OS-level isolation**. Hermes and most best-of orchestrators run in the user's environment. Only OpenFang (WASM), OpenClaw (sandbox mode), and best-of sandboxes (E2B/Daytona/Codex) provide real isolation.

---

## Subsystem 3 — Context Management & Compaction

### 3.1 Hermes — Cache-preserving context + trajectory compression

Hermes treats **prompt caching as sacred** (`AGENTS.md:14-15`). The architectural consequence is that the system prompt is built once per conversation and never mutated mid-loop. Skills are injected as user messages, not as system prompt additions.

- **Three-layer memory** (`round-2-architecture/hermes-agent-architecture.md:244-267`):
  1. **Conversation context** — OpenAI-format message list in `AIAgent.messages`. Compressed by `agent/conversation_compression.py` and `agent/context_compressor.py` when context window is exceeded.
  2. **SQLite FTS5 session store** — `hermes_state.py:SessionDB` (~6,322 lines). WAL mode for concurrent access across the multi-platform gateway. FTS5 virtual table for fast text search.
  3. **Pluggable memory providers** — `agent/memory_manager.py` orchestrates Honcho, mem0, supermemory, byterover, hindsight, holographic, openviking, retaindb via the `MemoryProvider` ABC. Only one external provider at a time.
- **Memory triggers**: pre-turn `prefetch_all(user_message)`, post-turn `sync_all()`, plus background `queue_prefetch_all()` for the next turn. `agent/curator.py` monitors idle time and triggers skill review.
- **Trajectory compression** at `trajectory_compressor.py`: a class `TrajectoryCompressor` (`trajectory_compressor.py:332`) post-processes recorded trajectories with these rules (per its docstring):
  1. Keep protected head turns (system, human, first gpt+tool)
  2. Compress middle turns only via LLM summarization
  3. Keep remaining tool calls intact
  4. Replace compressed region with a single human summary message
  5. Output target token budget: `target_max_tokens = 15250` (configurable, `trajectory_compressor.py:90`)
- **Configurable protection flags** at `trajectory_compressor.py:94-98`: `protect_first_system`, `protect_first_human`, `protect_first_gpt`, `protect_first_tool` — each toggleable independently.
- **Anthropic prompt caching**: `agent/prompt_caching.py` adds Anthropic-specific cache markers.

The compression is **post-hoc, not real-time**. The agent never sees the compressed form. This matters: real-time context compression is a separate, more invasive system that risks cache invalidation.

### 3.2 OpenFang — 50-iter cap, overflow recovery, phantom detection

OpenFang's context management is **runtime, defensive, and battle-tested**:

- **Loop constants** at `crates/openfang-runtime/src/agent_loop.rs`:
  - `MAX_ITERATIONS = 50` (line 35) — hard cap on agent loop iterations
  - `MAX_RETRIES = 3` with exponential backoff starting at 1s (line 38)
  - `TOOL_TIMEOUT_SECS = 120` (line 47), overridable via `OPENFANG_TOOL_TIMEOUT_SECS`
  - `AGENT_TOOL_TIMEOUT_SECS = 600` (line 53) — 10 min for inter-agent delegation
  - `MAX_CONTINUATIONS = 5` (line 85) for MaxTokens responses
  - Default context window: 200,000 tokens (line 225)
- **Context overflow recovery** at `agent_loop.rs:511`: `recover_from_overflow(&mut messages, &system_prompt, available_tools, ctx_window)` is a multi-stage pipeline that drains messages, summarizes, and retries before the LLM call.
- **Phantom action detection** at `agent_loop.rs:94-111`: `phantom_action_detected(text)` scans LLM output for claims of having sent/posted/emailed without calling tools — guards against models that hallucinate actions.
- **Silent failure retry** at `agent_loop.rs:154`: one-shot retry when LLM returns empty (0 input tokens → silently failed request).
- **Text-based tool call recovery** at `agent_loop.rs:572`: `recover_text_tool_calls(&response.text(), available_tools)` parses `<function=name>{json}</function>` from text output for models without native tool-call APIs.
- **Loop guard** at `agent_loop.rs:847`: `let verdict = loop_guard.check(&tool_call.name, &tool_call.input)` runs SHA256-based `(tool_name, params)` repetition detection with warn (3×), block (5×), circuit-breaker (30×) thresholds.
- **Context guard**: oversized tool results are trimmed before being added to messages (`apply_context_guard`).
- **Auto-compact**: if context usage exceeds threshold (default 80% of window), the session auto-compacts.

### 3.3 OpenClaw — Core + Wiki + LanceDB

OpenClaw's context layer is split across **three orthogonal stores** with explicit ownership boundaries (`docs/concepts/memory.md`, `extensions/memory-wiki/README.md`, `extensions/memory-lancedb/index.ts`):

- **memory-core (built-in)**: `memory_search`, `memory_get` tools. Default recall path (`docs/concepts/active-memory.md:398`). Uses OpenAI embeddings by default, with provider override for Bedrock, DeepInfra, Gemini, etc.
- **memory-lancedb** (`extensions/memory-lancedb/`): LanceDB-backed plugin with OpenAI-compatible embeddings. Exposes `memory_recall` (not `memory_search`/`memory_get` — the tool surface changes per slot). Tests at `index.test.ts:612-720` confirm normalized limit handling, untrusted-result marking, and embedding-settle timeouts.
- **memory-wiki** (`extensions/memory-wiki/`): Persistent wiki compiler and Obsidian-friendly knowledge vault. Compiles durable knowledge into a navigable markdown vault with deterministic indexes, provenance, structured claim/evidence metadata, and optional Obsidian CLI workflows. `.openclaw-wiki/cache/` emits machine-readable digests so runtime consumers don't scrape markdown.
- **Active memory** (`docs/concepts/active-memory.md`): a plugin-owned **blocking memory sub-agent** that runs before the main reply, surfaces relevant memory, and injects it as hidden system context. Configurable with `queryMode: "message" | "recent" | "full"`, `promptStyle: "balanced" | "strict" | "contextual" | ...`, `timeoutMs`, `maxSummaryChars`, `setupGraceTimeoutMs` for cold-start grace.
- **Session write lock** at `docs/concepts/agent-loop.md:30-32`: process-aware file-based lock, 60s default acquire timeout, non-reentrant by default.
- **Compaction**: `before_compaction` / `after_compaction` plugin hooks (`docs/concepts/agent-loop.md:70`) let plugins observe or annotate compaction cycles.

The Core + Wiki + LanceDB split mirrors how Bizar already organizes memory: `.bizar/PROJECT.md` (core) + Obsidian vault (durable) + LightRAG (semantic). OpenClaw's split is more orthogonal and the seams are explicit (one plugin per backend, tool surface changes per slot).

### 3.4 best-of — Mem0 / Letta / claude-mem / agentlog

The memory layer comparison (`comparisons/memory-layers.md:262-271`) identifies three shapes:

| Framework | Shape | Ownership boundary |
|-----------|-------|---------------------|
| Mem0 | Memory API | Application owns memory |
| claude-mem | Claude Code plugin | Harness owns memory |
| Letta | Agent runtime | Agent owns memory |

The framing question: "Who owns the memory — the application, the agent, or the harness?" Each answer implies a different deployment topology.

- **Mem0**: scoped memories, multi-tenant API, works with any agent.
- **claude-mem**: perfect recall for Claude Code specifically, plugin-style integration with the harness.
- **Letta**: memory-first agent design — the agent and its memory are inseparable, you run Letta to get the agent.
- **agentlog**: append-only audit log of every tool call and LLM exchange. Not a recall layer; a recording layer.

The pattern: **memory is a deployment-shape decision, not a feature**. Picking a memory layer locks you into a topology.

### 3.5 Recurring primitives across all 4 systems

1. **Tiered memory**: every system has at least three tiers — working context (in-conversation), episodic (per-session store), and durable (cross-session). Hermes: messages → SQLite FTS5 → memory providers. OpenFang: messages → session store → SQLite memory substrate. OpenClaw: conversation → memory-core/lancedb → memory-wiki. Bizar: conversation → `.bizar/memory.json` → Obsidian vault + LightRAG.
2. **Pre-fetch before each turn**: every system runs a recall step before the LLM call. Hermes `prefetch_all`, OpenClaw active-memory blocking sub-agent, OpenFang recall loop, best-of Mem0/Letta.
3. **Cache preservation as a hard constraint**: Hermes treats it as sacred. OpenFang avoids mid-loop mutation. OpenClaw has explicit `before_compaction`/`after_compaction` hooks so plugins see but don't disrupt the cycle.
4. **Loop guard with circuit breaker**: OpenFang's SHA256 loop guard at 3/5/30 thresholds. OpenClaw's `circuitBreakerMaxTimeouts` for active-memory recall failures. Bizar's plugin has `loopThresholdWarn: 5`, `loopThresholdEscalate: 8`, `loopThresholdBlock: 12` (`config/opencode.json:38-40`).
5. **Phantom-action / silent-failure detection**: OpenFang scans LLM output for claims without tool calls; OpenClaw's `sessions_history` redaction strips tool-call XML tags; Bizar's plugin has no equivalent yet.

What does NOT appear universally: **post-hoc trajectory compression for training data**. Hermes has it (`trajectory_compressor.py`) because it ships a training pipeline (`batch_runner.py`). No other system in the survey has the same artifact.

---

## Subsystem 4 — Long-Horizon Coding Patterns

### 4.1 Hermes — Patch-based editing, ripgrep through terminal backend

Hermes treats **terminal + file as the universal coding interface**. There is no specialized "code edit" tool — everything goes through the same `BaseEnvironment` abstraction.

- **Patch tool** at `tools/file_operations.py`: `patch(path, old_string, new_string)` — exact string replacement, not AST-based. Implemented as shell operations to work across all terminal backends. `difflib` for unified diff generation.
- **`read_file`** handles binary detection via `BINARY_EXTENSIONS`. **`search_files`** wraps `grep`/`rg` through the terminal backend with regex pattern, file glob, and path restriction.
- **`write_file`** goes through the terminal backend. Write-deny-list prevents overwriting sensitive system files.
- **No dedicated git tool**: git operations go through `terminal` (raw `git` commands). The `patch` tool + `terminal` tool together form the long-horizon coding loop: search → read → edit → test → commit.
- **No dedicated PR-creation tool**: agents use `terminal` for `gh pr create` or `git push`, possibly guided by skills (e.g. `github` skill).
- **Test running**: agent invokes `terminal` for `pytest`, `npm test`, etc. For Hermes' own tests, `scripts/run_tests.sh` enforces CI parity (credential isolation, UTC timezone, subprocess isolation per test file).
- **Skills for domain knowledge**: the `software-development/`, `data-science/`, `mlops/`, `github/` skill categories provide domain-specific guidance.

The key insight: **patch + terminal is enough**. The long-horizon coding loop is a search-edit-test-commit sequence with no special infrastructure. Subagents can be spawned via `delegate_task` for parallel implementation tracks (e.g. test-writing while another agent implements).

### 4.2 OpenFang — No dedicated coding Hand; chat-based coder agents

OpenFang does **NOT have a dedicated coding Hand** in its 9 bundled Hands (`bundled.rs:6-53`). The `crates/openfang-runtime/src/agents/` directory contains 31 agent templates including `coder/`, `code-reviewer/`, `debugger/`, `test-engineer/`, `architect/` — but these are **regular chat agents**, not autonomous scheduled workers.

Available tools for coding agents: `shell_exec`, `file_read`, `file_write`, `file_list`, `file_search`, `file_delete`. No `patch` tool — edits are `file_write` only. This is a regression from Hermes' API.

The architecture implication: OpenFang's coding workflow is **chat-driven, not autonomous**. A user starts a session, asks the coder agent for a refactor, the agent uses `shell_exec` + `file_write` to do it. There is no built-in ability to say "every weekday at 9am, check GitHub Issues assigned to me, write a draft PR for each." That would require a Hand manifest.

This is a **deliberate scope choice**, not an oversight. The README positions OpenFang as an "agent operating system" for autonomous always-on work (research, monitoring, social media, trading), not as a coding harness. The absence of a coding Hand is consistent with that positioning.

### 4.3 OpenClaw — Workspace + file management + managed worktrees

OpenClaw's coding workflow centers on **workspaces + memory + tool-rich plugin SDK**:

- **Workspace layout** (`docs/concepts/agent-workspace.md`):
  - `AGENTS.md` — operating instructions, loaded every session
  - `SOUL.md` — persona and tone
  - `USER.md` — who the user is
  - `IDENTITY.md` — name, vibe, emoji
  - `TOOLS.md` — local tool conventions
  - `HEARTBEAT.md` — optional heartbeat checklist
  - `BOOT.md` — startup checklist
  - `BOOTSTRAP.md` — first-run ritual
  - `memory/YYYY-MM-DD.md` — daily memory log
  - `MEMORY.md` — curated long-term memory
  - `skills/` — workspace-specific skills (highest precedence)
  - `canvas/` — Canvas UI files
- **Bootstrap limit**: `agents.defaults.bootstrapMaxChars` (default 20000), `bootstrapTotalMaxChars` (default 60000) — large bootstrap files truncated when injected.
- **Managed worktrees** (`docs/concepts/managed-worktrees.md`): OpenClaw can manage git worktrees so multiple agents work on the same repo without colliding.
- **Plugin SDK for file ops**: `api.registerTool` lets plugins expose tools like `code_search` (regex/AST), `lsp_diagnostics`, `git_worktree_create`, `pr_create` (`src/plugin-sdk/`).
- **Diffs plugin**: `extensions/diffs/` provides file diff visualization; `extensions/diffs-language-pack/` adds language-aware syntax highlighting.
- **Codex supervisor**: `extensions/codex-supervisor/` lets one agent supervise another Codex-style agent.

The long-horizon coding loop in OpenClaw is **agent-mediated via plugins**: the agent invokes `code_search` (from a plugin), reads with `read`, edits with `write` or `apply_patch`, runs tests via `exec`, commits via `git` plugin, opens a PR via the `github-copilot` plugin. Every step is a plugin; the core provides the agent loop, plugins provide the tools.

### 4.4 best-of — SWE-agent, RepoMaster, OpenHands, AutoHarness, claw-code-agent

The "Build your own harness from scratch" use case in `comparisons/how-to-pick-a-harness.md` and `README.md:55-70` lists SWE-agent, RepoMaster, OpenHands, AutoHarness, claw-code-agent as top picks. Common patterns:

- **SWE-agent** (Princeton, 3.9k stars): the canonical "agent-computer interface" for code. Its insight is that **the tool surface matters more than the model**. SWE-agent exposes a deliberately small, well-designed set of tools (`open`, `scroll_down`, `scroll_up`, `find_file`, `search_dir`, `edit_file`, `submit`) and the resulting agent is more reliable than agents with rich toolkits.
- **RepoMaster** (`m-Just/RepoMaster`, 1.5k stars): multi-agent repo-level coding, with explicit per-file ownership among agents.
- **OpenHands** (79.5k stars): Docker-sandboxed coding agent with a sandboxed runtime. The model sees a real Linux shell inside a container with read-only project files, writeable workspace, and a separate test environment.
- **AutoHarness** (`zhuyxxxx/AutoHarness`): AI-generated harness tooling for SWE-style tasks.
- **claw-code-agent** (524 stars, Rust): OpenClaw-style coding agent in Rust. Pairs with OpenClaw for cross-checking.

The recurring primitive: **a small, carefully designed tool surface outperforms a large toolkit**. SWE-agent's win is not the model — it's that the LLM has fewer ways to get confused.

### 4.5 Recurring primitives across all 4 systems

1. **Patch/edit is the universal atomic operation.** Hermes has `patch`; OpenClaw has `apply_patch`; OpenFang uses `file_write` (a regression); best-of's SWE-agent uses `edit_file`. All converge on "exact string replacement" as the right granularity — not line-based, not AST-based.
2. **Tests run through the same terminal/shell tool.** No special test runner — the agent invokes `pytest`/`npm test`/`cargo test` via the terminal.
3. **Git ops also go through shell.** No specialized `git_commit` tool except in OpenClaw's `github-copilot` plugin. Most agents run `git` commands directly.
4. **Domain knowledge via skills, not via special tools.** Hermes' `software-development/` skill provides PR workflow. OpenClaw's `github-copilot` plugin provides GitHub integration. Best-of's `superpowers` skill pack (247k stars) provides coding workflow conventions.
5. **Sandbox isolation for untrusted code.** OpenHands (Docker), Codex (sandbox), Modal/Daytona/E2B (managed). Hermes and OpenClaw run in the user's environment but allow sandbox opt-in.

What does NOT appear universally: **autonomous scheduled coding tasks**. Only OpenFang's Hands pattern supports "every weekday at 9am, run coding agent X." Hermes' cron is generic, OpenClaw's cron is generic, best-of projects don't ship a cron for coding. The closest is OpenClaw's `standing-orders` pattern in `docs/automation/standing-orders.md` — rules in `AGENTS.md` that define what the agent may do autonomously, executed via cron.

### 4.6 What works for multi-hour coding tasks

Synthesizing across the four systems, the patterns that hold up for multi-hour coding work:

- **Patch + terminal** as the universal tool surface. Don't invent specialized code tools; let the LLM use `patch` for edits and `terminal` for everything else.
- **Small, well-named tool surface.** SWE-agent's lesson: 7 well-designed tools beat 50 generic ones. Every tool the agent can hallucinate is a tool it can get wrong.
- **Skills for domain knowledge, not for tools.** Coding conventions, PR workflow, test patterns — these belong in `SKILL.md` files, not in the tool schema.
- **Subagents for parallel tracks.** When you have N independent implementation tracks, spawn N subagents with the same patch+terminal tool surface. The parent coordinates; the children execute.
- **Context compression is a post-hoc concern for training data, not real-time.** Real-time compression risks cache invalidation; post-hoc compression for evaluation/trajectory data is the right separation.
- **Loop guards matter.** Even with the best prompt, agents will retry the same failing tool call 20 times without a circuit breaker.

---

## Cross-Subsystem Observations

### A. Where the 4 systems agree (high signal)

- **Narrow waist / expansive edges.** Every system has a small core (the agent loop, the message list, the tool registry) and large edges (plugins, skills, channel adapters, providers). The core changes slowly; the edges absorb new requirements.
- **Pluggability via ABC + orchestrator.** Hermes (MemoryProvider ABC + MemoryManager), OpenFang (LLMDriver trait + 3 native drivers), OpenClaw (plugin-sdk `api.register*` methods + Gateway loader). All converge on "small interface, many implementations."
- **Capability-based permissions, not role-based.** Even OpenFang's `CapabilityManager` uses capability sets, not roles. The model declares what tools it needs; the runtime checks against granted capabilities.
- **Multi-tenancy at the agent level.** All four isolate agents by directory (`~/.openclaw/agents/<id>`, `~/.openfang/data/agents/<id>`, `~/.hermes/profiles/<id>`, `.bizar/<project>/`). No system shares session state across agents without explicit sync.

### B. Where the 4 systems diverge (high signal)

- **Persistence model.** Hermes: SQLite + FTS5 + pluggable memory providers. OpenFang: SQLite-only, six storage layers in one file. OpenClaw: SQLite per-agent + plugin-managed stores (LanceDB, Obsidian vault). Bizar: `.bizar/memory.json` + Obsidian vault + LightRAG index. The right answer is unclear — each system optimizes for a different threat model.
- **Plugin surface language.** Hermes: Python. OpenFang: Rust with TOML manifests. OpenClaw: TypeScript with JSON manifests. Bizar: TypeScript with Markdown+frontmatter agent definitions. The language choice constrains who can write plugins.
- **Loop guard mechanism.** OpenFang: SHA256 hash. Hermes: budget tracking. OpenClaw: circuit breaker per external call. Bizar: warned/escalated/blocked thresholds in the opencode plugin. All different; all necessary.
- **Sandbox primitive.** Only OpenFang has WASM dual metering. OpenClaw has sandbox modes. Hermes has no sandbox. Best-of has Docker/E2B/Daytona. This is the area where Bizar has the most room to grow.

### C. Patterns Bizar has not yet adopted (gap analysis)

Against this baseline, Bizar has:

| Pattern | Hermes | OpenFang | OpenClaw | best-of | Bizar (current) |
|---------|--------|----------|----------|---------|-----------------|
| Pluggable memory providers | ✓ (8 plugins) | ✓ (KV/vector/graph) | ✓ (memory-lancedb, memory-wiki) | ✓ (Mem0/Letta) | Partial (LightRAG + Obsidian) |
| Knowledge graph between agents | ✗ | ✓ (entities/relations) | ✗ (via plugins) | Some | Partial (graphify at `.bizar/graph`) |
| Knowledge graph as agent-populated tool | ✗ | ✓ (knowledge_add_entity) | ✗ | Some | ✗ (graph is query-only, not write-from-agent) |
| WASM sandbox for tool execution | ✗ | ✓ (Wasmtime dual metering) | ✗ | Some | ✗ |
| Loop guard | ✓ (budget) | ✓ (SHA256) | ✓ (circuit breaker) | Some | ✓ (plugin loop thresholds) |
| Trajectory compression for training | ✓ (1.5K LOC) | ✗ | ✗ | ✗ | ✗ |
| Subagent tool firewall | ✓ (DELEGATE_BLOCKED_TOOLS) | ✓ (capability inheritance) | ✓ (tools.allow/deny) | ✓ | Partial (per-agent permission rules in opencode.json) |
| Multi-platform gateway | ✓ (17+ platforms) | ✓ (40 channels) | ✓ (148 extensions) | Some | ✗ |
| Scheduled tasks | ✓ (cron/) | ✓ (Hands continuous/periodic) | ✓ (cron + standing orders) | Some | ✗ (only `bizar_spawn_background`) |
| Phantom-action detection | ✗ | ✓ | ✗ | ✗ | ✗ |
| Six terminal backends | ✓ (Local/Docker/SSH/Singularity/Modal/Daytona) | ✗ (subprocess only) | ✗ | Some | ✗ |
| Plugin SDK for third-party skills | ✓ (MemoryProvider ABC) | ✓ (TOML hands) | ✓ (TypeScript SDK) | n/a | Partial (skill lock + skills CLI) |
| Self-improving skills (closed loop) | ✓ (Curator, 1.9K LOC) | ✗ | ✗ | ✗ | ✓ (`AGENTS_SELF_IMPROVEMENT.md`) |
| Capability-based permissions | Partial (env check) | ✓ (CapabilityManager) | ✓ (tools.allow/deny) | Some | ✓ (opencode per-agent permissions) |
| Audit trail | ✓ (3 log files) | ✓ (Merkle hash chain) | ✓ (19 audit modules) | Some | Partial (`.bizar/activity.log`) |

**Gaps where Bizar trails:**

1. **No agent-writable knowledge graph.** OpenFang has `knowledge_add_entity`, `knowledge_add_relation`, `knowledge_query` as tools the agent calls during research. Bizar's `bizar graph` is read-only at the agent level (it indexes code structure, not domain knowledge).
2. **No cron scheduler.** OpenFang, Hermes, OpenClaw all have cron. Bizar has `bizar_spawn_background` (one-shot fire-and-forget) but no recurring schedule.
3. **No multi-platform gateway.** None of Telegram/Discord/Slack/etc. Bizar is currently a CLI/dashboard harness only.
4. **No terminal backend abstraction.** Thor/Tyr/Vidarr run on the local machine via `bash`. No Docker/SSH/Modal/Daytona option.
5. **No phantom-action detection.** An agent claiming "I sent the email" without invoking the email tool would not be caught.
6. **No trajectory capture.** Parallel subagent dispatch produces valuable trajectories; nothing captures them for evaluation.

These gaps are addressed in the companion document `bizar-alignment.md`.