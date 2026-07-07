# Bizar Alignment — Round 3

**Scope:** Map findings from Hermes, OpenFang, OpenClaw, and best-of-Agent-Harnesses to specific Bizar improvements. This document is the most actionable output of the round-3 cross-reference analysis.

**Date:** 2026-07-06  
**Author:** @tyr  
**Companion document:** `round-3-crossref/deep-subsystems.md`

---

## Section A — Bizar's Current State

### What Bizar is today

BizarHarness is a **Norse-pantheon multi-agent system for opencode** (12 agents across 4 cost tiers) built on TypeScript + Node 22. The current version is v5.5.1. The agent roster at `config/opencode.json`:

| Agent | Tier | Model | Role |
|-------|------|-------|------|
| Odin | 1 (primary) | MiniMax-M3 | Pure router — decomposes requests, dispatches subagents, synthesizes |
| Frigg | 1 (primary) | MiniMax-M2.7 | Read-only Q&A with file:line citations |
| Quick | 1 (primary) | MiniMax-M2.7 Flash | Fast escape hatch, no delegation |
| Vör | 2 (subagent) | MiniMax-M2.7 | Clarification before work begins |
| Mimir | 2 (subagent) | MiniMax-M2.7 | Deep codebase research (Semble-first) |
| Heimdall | 2 (subagent) | MiniMax-M2.7 | Simple mechanical tasks |
| Hermod | 2 (subagent) | MiniMax-M2.7 | Git/GitHub operations |
| Thor | 3 (subagent) | MiniMax-M2.7 | Moderate-complexity implementation |
| Baldr | 2 (subagent) | MiniMax-M2.7 | Design system planning (no implementation) |
| Tyr | 4 (subagent) | MiniMax-M3 | Complex implementation, Forseti-gated |
| Vidarr | 5 (subagent) | MiniMax-M3 + reasoning | Last-resort fallback |
| Forseti | 3 (subagent) | MiniMax-M3 | Adversarial plan audit (read-only) |

The runtime is opencode. The plugin lives at `plugins/bizar/index.ts` with loop guard thresholds `loopThresholdWarn: 5`, `loopThresholdEscalate: 8`, `loopThresholdBlock: 12`, and a context-compaction config (`config/opencode.json:38-48`). The dashboard is a separate process at `bizar-dash/src/server/`. Memory is three-layered: `.bizar/memory.json` (working), Obsidian vault (durable), LightRAG index (semantic). Graph: Graphify at `.bizar/graph/`. Semble is the always-on local search MCP. Skills: 5 bundled (BizarHarness, self-improvement, C++ coding standards, C++ testing, Embedded ESP-IDF).

### What Bizar does well

- **Cost-aware routing.** Five tiers with explicit model selection per agent. Odin/M3 only sees short routing prompts; M2.7 Flash handles trivial edits. This is the same discipline best-of identifies as Q5 ("Who pays for the tokens?") in `comparisons/how-to-pick-a-harness.md`.
- **Forseti plan-review gate.** Tier 3+ implementation requires adversarial plan review before code is written. This is unusual — only OpenFang has any equivalent (the audit Merkle chain, but it's post-hoc).
- **Memory system integration.** The v4.5.1 release merged LightRAG + Obsidian + git repo config into a dedicated Memory tab with 11 endpoints (`bizar-dash/src/server/routes/memory.mjs`). This is a real integration, not a stub.
- **Headroom integration.** Token compression proxy wired into the dashboard installer with auto-install/wrap/start on startup. Settings UI lives in the dashboard.
- **Skills CLI + skills-lock.json.** Reproducible skill installation via `skills add <owner/repo> -s <name>`. Lockfile pins versions.
- **Self-improvement loop.** `.bizar/AGENTS_SELF_IMPROVEMENT.md` is appended at every task completion. The pattern is lightweight (Markdown append, no LLM review) but it exists.
- **Background agents.** `bizar_spawn_background` (fire-and-forget), `bizar_status`, `bizar_collect`, `bizar_kill` — the parallel-subagent dispatch primitives. Plus a tmux split window via `bizar bg view`.

### Known gaps (be honest)

- **No scheduler.** `bizar_spawn_background` is one-shot. There is no cron, no recurring task, no "every Monday at 9am, run this agent."
- **No multi-platform gateway.** No Telegram/Discord/Slack/WhatsApp/etc. Bizar is currently CLI + dashboard only.
- **No terminal backend abstraction.** Thor/Tyr/Vidarr run on the local machine via `bash`. No Docker, no SSH, no Modal, no Daytona. The agent cannot be sent to a sandboxed environment.
- **No agent-writable knowledge graph.** `.bizar/graph/` exists and `bizar graph query` works, but it indexes *code structure* via Graphify. The agent has no `knowledge_add_entity` tool — only humans (or Graphify's code-analysis pass) populate it.
- **No trajectory capture.** The parallel-subagent dispatch produces rich trajectories. Nothing captures them as JSONL for offline evaluation or training.
- **No purchase/billing approval gates.** The Browser Hand's "MANDATORY purchase approval" pattern from OpenFang doesn't exist in Bizar. Any tool that touches money has no code-enforced gate.
- **No phantom-action detection.** OpenFang scans for LLM output claiming actions without tool calls. Bizar has no equivalent.
- **No WASM sandbox.** Tool execution runs in the user's Node process. A misbehaving tool can read any file the user can read.
- **No MCP server for Bizar itself.** best-of's MCP server (`mcp/server.py`) exposes its catalog as tools other agents can query. Bizar has no equivalent.
- **No comparison-page pattern.** best-of publishes 5 comparison documents at `comparisons/*.md`. Bizar's ROADMAP.md is internal; there are no public-facing comparison docs.
- **Per-agent permissions are coarse.** `config/opencode.json` declares per-agent tool allow/deny lists but they're global for the agent's lifetime. No per-turn capability scope.
- **Plugin SDK is implicit.** Agents are `.md` files with YAML frontmatter; skills are loaded from `~/.opencode/skills/`. There is no published SDK contract a third party could implement against.

The gaps are not failures — they are deliberate scope decisions. Bizar is a coding harness, not a personal-assistant OS. The roadmap below adopts patterns from the survey *only where they serve the coding-harness mission*.

---

## Section B — Concrete Patterns to Adopt

For each pattern: source repo, file:line reference, recommended Bizar change, and an outline (no code) of what to build.

### B.1 — Closed Learning Loop (from Hermes)

**Source:** Hermes `agent/curator.py` (1,976 lines). The Curator is a background skill-maintenance orchestrator: when the agent is idle for > `interval_hours` (default 7 days), it spawns a forked `AIAgent` to review agent-created skills, transitions them through `active → stale → archived`, pins active ones, and never deletes. It uses an *auxiliary client* — a separate LLM call with a separate prompt — so it never pollutes the main session's prompt cache.

**Reference:** `agent/curator.py:1-21` (top-of-file docstring with strict invariants), `agent/curator.py:56-64` (default intervals), `agent/curator.py:67-72` (`.curator_state` path), `agent/curator.py:332-380` (the main `TrajectoryCompressor` class).

**Bizar recommendation:** Keep the current `AGENTS_SELF_IMPROVEMENT.md` pattern as the write path. Add a **review pass** that runs once per project session:

- **What to build:** A `bizar review` CLI subcommand that, when the user runs it after a long session, scans the recent conversation log (last N turns from `.bizar/activity.log` + the session transcript), identifies patterns that the user manually corrected (e.g. "no, use `pnpm`, not `npm`", "wrong: edit `cli/bin.mjs`, not `cli/bin.mjs.bak`"), and proposes a new entry in `AGENTS_SELF_IMPROVEMENT.md` for human approval before commit.
- **Why this matters:** The current write path is *agent-only*. Patterns that the *user* teaches the agent (corrections, preferences) are lost because the agent only logs what it learned.
- **File reference:** Append the review subcommand at `cli/review.mjs`. Wire it into the existing `cli/bin.mjs` subcommand dispatch. Store proposed entries in `.bizar/proposed-improvements.md` (human approves via `git diff` + commit).
- **Implementation outline:**
  1. New module `cli/review.mjs` exports `scanSession(transcriptPath, sinceTs)` → returns `ProposedImprovement[]`.
  2. Heuristic: diff assistant messages against the immediately-following user message. If the user message contains "no", "wrong", "actually", "use X not Y", or corrects a path/tool, it's a teaching signal.
  3. LLM call (with Forseti as the audit agent for Tier 3+, Thor for Tier 2): summarize the correction into one Markdown bullet.
  4. Append to `.bizar/proposed-improvements.md` with a diff-style separator; user reviews + commits.
- **What NOT to copy:** Hermes' Curator is 1,976 LOC and runs LLM review on idle. Bizar does not have an "idle" state — Bizar is CLI/dashboard. The review pass should be **explicit user invocation** (`bizar review`), not background.

### B.2 — Multi-Channel / Multi-Platform Gateway (from Hermes + OpenClaw)

**Source:** Hermes `gateway/run.py` (20,526 lines) supports 17+ platforms; OpenClaw ships 148 extensions including Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Mattermost, etc. OpenFang ships 40 channel adapters (`openfang-channels`).

**Reference:** Hermes `gateway/platforms/base.py` (5,623 lines, the `BasePlatform` ABC). OpenClaw `src/plugin-sdk/core.ts:579` (`api.registerChannel`).

**Bizar recommendation:** Build a **Bizar Gateway as a separate process** (not core) that listens to one or more messaging platforms and forwards messages to Bizar's existing agent dispatch.

- **What to build:** `cli/gateway.mjs` that exposes a Bizar Gateway process. It registers platform adapters via a `BasePlatform` ABC at `cli/platforms/base.mjs`. For v1, ship **Telegram + Discord** as the most-requested entry points. Webhook + long-polling modes. The gateway translates inbound messages into `bizar agent <prompt>` calls via the dashboard's existing REST endpoints.
- **Why this matters:** Bizar's biggest community miss right now is that the only way to invoke it is to open the dashboard or run the CLI. A Telegram bot would unlock "ask the agent while I'm away from the desk" use cases that OpenClaw/Hermes/OpenFang all serve.
- **File reference:** New package `cli/gateway/` with `index.mjs`, `platforms/base.mjs`, `platforms/telegram.mjs`, `platforms/discord.mjs`. Wire into `cli/bin.mjs` as a subcommand. Use the existing dashboard auth pattern (`bizar-dash/src/server/routes/artifacts.mjs`).
- **Channel adapter interface:** Pseudo-code:
  ```
  interface ChannelAdapter {
    id: string                          // 'telegram', 'discord'
    name: string                        // display label
    capabilities: ChannelCapability[]   // ['text', 'voice', 'images', 'reactions', 'inline-buttons']
    send(chatId, message): Promise<void>
    onUpdate(callback: (update) => void): void  // incoming messages
    validateConfig(config): ValidationResult
    installHint: string                 // 'set TELEGRAM_BOT_TOKEN env var'
  }
  ```
- **What NOT to copy:** OpenClaw's 148 extensions or OpenFang's 40 channels. Bizar should start with **2 channels** (Telegram + Discord) and let the community contribute the rest via the plugin SDK (see B.7).

### B.3 — Six Terminal Backends (from Hermes)

**Source:** Hermes `tools/environments/base.py:290` defines `BaseEnvironment` ABC. Six implementations: `local.py`, `docker.py`, `ssh.py`, `singularity.py`, `modal.py`, `daytona.py`. All share a **spawn-per-call model**: each command is a fresh `bash -c` process, with session env captured at init and re-sourced before each command.

**Reference:** `tools/environments/base.py:290-348` (the ABC), `tools/environments/base.py:353-379` (init_session), `tools/terminal_tool.py` (factory selection by `TERMINAL_ENV` config).

**Bizar recommendation:** Add a **`Backend` ABC** at `cli/backends/base.mjs` with three concrete backends: Local, Docker, Sandbox.

- **What to build:** A thin backend abstraction so that Thor/Tyr/Vidarr can run in (a) Local — current `bash` via opencode's default, (b) Docker — per-session container with read-only project root + writable workspace, (c) Sandbox — opt-in copy-on-write filesystem (e.g. `bwrap` on Linux, `sandbox-exec` on macOS). Selection via `BIZAR_BACKEND` env var or per-task flag.
- **Why this matters:** Bizar's tier-3+ agents sometimes make mistakes that the user notices only after the fact. A sandboxed backend gives the user confidence to let Vidarr run free.
- **File reference:** `cli/backends/base.mjs` exports the ABC. `cli/backends/local.mjs`, `cli/backends/docker.mjs`, `cli/backends/sandbox.mjs` implement it. Wire into the existing `cli/bin.mjs` execution path. The Dashboard Settings page should expose a backend selector.
- **Why three, not six:** Modal and Daytona are cloud-serverless — Bizar is a local-first harness. Singularity is HPC-only. The three that matter for a coding harness are Local (default), Docker (sandbox), and OS-level sandbox (defense in depth).
- **What NOT to copy:** Hermes' 955-line `BaseEnvironment` with all the spawn-per-call and CWD-marker logic. Bizar can use Node's `child_process.spawn` with a single env snapshot and a temp CWD file. Aim for 100 LOC, not 955.

### B.4 — Knowledge Graph as Agent-Writeable Tool (from OpenFang)

**Source:** OpenFang's `crates/openfang-memory/src/knowledge.rs` (346 lines) exposes `knowledge_add_entity`, `knowledge_add_relation`, `knowledge_query` as first-class agent tools. SQLite-backed with two tables (`entities`, `relations`). All Einstein Hands must have these three tools (`bundled.rs:427-456`).

**Reference:** `crates/openfang-runtime/src/tool_runner.rs:323-325` (match dispatch), `tool_runner.rs:859-898` (tool definitions), `crates/openfang-memory/src/knowledge.rs:16-19` (SQLite schema).

**Bizar recommendation:** Add three new MCP tools that the Bizar agents can invoke: `bizar_knowledge_add_entity`, `bizar_knowledge_add_relation`, `bizar_knowledge_query`.

- **What to build:** A new MCP server (or a new tool group in `plugins/bizar/index.ts`) that exposes a persistent domain knowledge graph stored at `.bizar/domain-graph.sqlite`. Schema mirrors OpenFang's two-table design. The `bizar graph query` CLI command is repurposed to query this new graph (or aliased alongside the existing Graphify-backed code graph).
- **Why this matters:** Bizar's agents repeatedly discover the same domain facts (e.g. "the dashboard uses WebSockets", "this repo uses Vitest not Jest", "the install script writes to `~/.config/opencode/`"). Today they rediscover via Semble every session. A persistent, agent-populated knowledge graph fixes this.
- **File reference:** New file `plugins/bizar/knowledge-graph.mjs` (the implementation), wired into `config/opencode.json` tools list. Add a `.bizar/domain-graph.sqlite` path to the gitignore at `.gitignore`.
- **Population strategy:** As in OpenFang, the agent is prompted to populate the graph during domain exploration. The prompt should say: "When you learn a non-obvious fact about the codebase (architectural decision, naming convention, runtime quirk), call `bizar_knowledge_add_entity` with the fact and `bizar_knowledge_add_relation` linking it to the relevant module/file."
- **What NOT to copy:** OpenFang's tightly-coupled Hands that *must* have these tools. Bizar's agents should opt-in via the tool schema, not be required to use them.

### B.5 — Provider Profile + Model Fallback (from Hermes + OpenFang + OpenClaw)

**Source:** Hermes' `providers/` directory is a registry of `ProviderProfile` objects, discovered via three paths (bundled plugins, user plugins, legacy single-file profiles). OpenFang's 27 providers are wired through three native LLM drivers (`AnthropicDriver`, `GeminiDriver`, `OpenAiCompatDriver`). OpenClaw's `extensions/<provider>/` ships 100+ providers.

**Reference:** Hermes `providers/__init__.py` (the lazy discovery system), OpenFang `docs/architecture.md:333-354` (LlmDriver trait).

**Bizar recommendation:** Refactor `config/opencode.json` so providers live in separate files.

- **What to build:** Move `config/opencode.json` lines 320-333 (the `provider` block with `minimax` model entries) into `config/providers/minimax.json`, `config/providers/openai.json`, `config/providers/anthropic.json` (when added). The `config/opencode.json` `provider` block becomes a list of file references: `{ "providers": ["./providers/minimax.json", "./providers/openai.json"] }`. Add a `fallback_chain` field: `{ "fallback_chain": ["minimax/MiniMax-M3", "openai/gpt-5.5", "anthropic/claude-sonnet-4.6"] }`.
- **Why this matters:** Today, adding a new provider (OpenAI, Anthropic, Google) requires editing `config/opencode.json`. After the refactor, dropping a JSON file into `config/providers/` adds it. The fallback chain lets one provider's rate limit transparently fall through to another.
- **File reference:** `config/opencode.json:320-333` → new `config/providers/*.json`. Update `cli/providers-detect.mjs` (already exists per `.bizar/PROJECT.md`) to scan the directory.
- **What NOT to copy:** OpenClaw's 100+ bundled providers. Bizar should ship 1-2 providers and let users add their own via the directory convention.

### B.6 — Trajectory Capture + Training Data Generation (from Hermes)

**Source:** Hermes `batch_runner.py` (1,321 lines) + `trajectory_compressor.py` (1,574 lines). The `TrajectoryCompressor` class at `trajectory_compressor.py:332` post-processes recorded trajectories with these rules: keep protected head turns, compress middle turns via LLM summarization, keep last N turns intact, replace compressed region with a single human summary message, target token budget configurable (default `target_max_tokens = 15250`).

**Reference:** `trajectory_compressor.py:90-98` (config struct with `protect_first_system`, `protect_first_human`, `protect_first_gpt`, `protect_first_tool`, `protect_last_n`, `target_max_tokens`). `agent/trajectory.py` for capture utilities.

**Bizar recommendation:** Capture Bizar's parallel subagent dispatch output as JSONL trajectories, with a separate `bizar trajectory compress` post-processor.

- **What to build:** When Odin dispatches N subagents in parallel, capture each subagent's full message log (after the subagent returns) to `.bizar/trajectories/<run-id>/<agent-name>.jsonl`. Add a CLI `bizar trajectory compress <run-id>` that runs the Hermes-style compression: protect first user+assistant turn, compress middle turns via LLM, keep last N turns. Output to `.bizar/trajectories/<run-id>/<agent-name>-compressed.jsonl`.
- **Why this matters:** Bizar already has the most valuable raw material for agent evaluation — multi-hour coding sessions with parallel subagents, real tool use, real code changes. Today this material is in conversation logs that get truncated. Capturing it as structured trajectories enables offline eval, regression testing, and (eventually) fine-tuning.
- **File reference:** New module `cli/trajectory.mjs` with `capture(agentName, messages)` and `compress(jsonlPath, opts)`. Wire `capture` into `plugins/bizar/index.ts` at the post-turn hook. Wire `compress` as a CLI subcommand at `cli/bin.mjs`.
- **What NOT to copy:** Hermes' 1,574-line compression pass with 5+ protection flags. Bizar's first version should support `protect_first_turn`, `protect_last_n=5`, and `target_max_tokens`. Add knobs as needed.

### B.7 — Plugin / Extension SDK (from OpenClaw)

**Source:** OpenClaw's `src/plugin-sdk/core.ts` and the 148 extensions under `extensions/`. The SDK exposes `api.registerTool`, `api.registerChannel`, `api.registerMemoryProvider`, `api.registerCliCommand`. Plugins are discovered from `~/.openclaw/plugins/`, the local repo's `extensions/`, and pip/pnpm entry points.

**Reference:** OpenClaw `src/plugin-sdk/plugin-test-api.ts:22` (`registerTool()` shape), `src/plugin-sdk/channel-entry-contract.test.ts:135` (the call site).

**Bizar recommendation:** Bizar already has agent files at `config/agents/*.md`. Promote this to a **formal Bizar SDK** with a published contract for third-party agents.

- **What to build:** A new package `packages/sdk/` (already mentioned in `.bizar/PROJECT.md`) that exports:
  - `defineAgent(config)` — typed config for an agent (name, model, permissions, color, description).
  - `AgentLoader` — discovers agents from `config/agents/`, `~/.bizar/agents/`, and npm packages named `bizar-agent-*`.
  - `registerSkill(skillDir)` — registers a SKILL.md + scripts with the opencode plugin.
  - `registerTool(toolDef)` — registers an MCP-style tool that Bizar agents can invoke.
  - `registerHook(event, callback)` — `pre_turn`, `post_turn`, `pre_tool_call`, `post_tool_call`, `subagent_dispatch`.
- **Why this matters:** Today, third parties who want to ship a Bizar agent must copy the `.md` file format and hope. With a published SDK, they can `npm install @polderlabs/bizar-sdk` and write a typed agent module that gets auto-discovered.
- **File reference:** The `packages/sdk/` directory exists per `.bizar/PROJECT.md` and has a `dash-cli` subpath export in `bizar-dash/package.json`. The SDK should follow the same package boundary pattern.
- **What NOT to copy:** OpenClaw's 148 extensions or OpenFang's 60 bundled skills. The SDK is the *contract*; the *content* comes from the community.

### B.8 — Scheduler / Cron (from Hermes + OpenFang)

**Source:** Hermes `cron/scheduler.py` (3,600 lines) ticks every 60s, supports `30m`/`2h`/`1d` durations, `every 2h` phrases, 5-field cron expressions, and ISO timestamps. OpenFang `crates/openfang-kernel/src/scheduler.rs` (191 lines) with `ScheduleMode::{Reactive, Continuous, Periodic, Proactive}`.

**Reference:** Hermes `cron/jobs.py` (job store), `cron/scheduler.py:tick()` (the loop), file-based lock at `~/.hermes/cron/.tick.lock` for cross-process safety.

**Bizar recommendation:** Add a `bizar cron <add|list|run|remove>` CLI subcommand that schedules background agents on a recurring basis.

- **What to build:** A `cron/jobs.json` file at `~/.config/bizar/cron/jobs.json` storing job specs (name, schedule, prompt, agent, model, expected_duration_seconds). A `cli/cron.mjs` subcommand with verbs `add`, `list`, `remove`, `run`, `pause`, `resume`. A `cli/cron-tick.mjs` daemon process (or a `bizar cron start` daemon-mode flag) that ticks every 60s, fires due jobs, and uses the existing `bizar_spawn_background` for execution.
- **Why this matters:** "Run Heimdall every weekday at 9am to check for stale branches and open cleanup PRs" is a workflow Bizar cannot express today. Every other system in the survey supports this. Without it, Bizar stays in "user is at the keyboard" mode.
- **File reference:** New `cli/cron.mjs` + `cli/cron-tick.mjs`. Wire `cron <verb>` into `cli/bin.mjs`. Document in `docs/cron.md`.
- **What NOT to copy:** Hermes' 3,600-line scheduler with cron-expression parsing, ISO timestamps, catchup windows, and 3-minute hard interrupts. Bizar's first version should support `every Nm` / `every Nh` / 5-field cron. Add catchup later if needed.

### B.9 — Approval Gates / Security Layer (from OpenFang + OpenClaw)

**Source:** OpenFang ships 16 security layers (`round-1-recon/openfang-recon.md:430-453`) but the Browser Hand's purchase approval is *prompt-only*. OpenClaw's `delegate-architecture.md:83-92` defines hard blocks (`never send external email without explicit human approval`, etc.) that load every session.

**Reference:** OpenFang `crates/openfang-types/src/taint.rs` (information-flow taint tracking), `crates/openfang-runtime/src/audit.rs` (Merkle hash chain). OpenClaw `before_tool_call` plugin hook (`docs/concepts/agent-loop.md:60-77`) with `{ block: true }` semantics.

**Bizar recommendation:** Add a `bizar approval` mechanism that prompts the user for sensitive tool calls.

- **What to build:** A new plugin hook in `plugins/bizar/index.ts` that intercepts specific tool invocations and prompts the user via the dashboard or CLI before allowing them. Initial gated tools:
  - `git push` (push to remote)
  - `gh pr create` (open a PR)
  - `npm publish` (publish a package)
  - Any tool invocation matching a `bizar.deny_patterns` regex (e.g. `rm -rf /`, `chmod 777`)
  - Any write to a path matching `~/.ssh/`, `~/.aws/`, `~/.config/bizar/.env`
- **Why this matters:** The Bizar final goal calls out L4 (headless) and L5 (full autonomy) as targets. Without approval gates, an autonomous Bizar cannot safely make the jump from "user at keyboard" to "user asleep." Approval gates are the difference between L3 and L4.
- **File reference:** New hook handler at `plugins/bizar/approval.mjs`. CLI prompt via `cli/bin.mjs` `--approve-yolo` flag for users who explicitly want to skip the gate.
- **What NOT to copy:** OpenFang's prompt-only Browser Hand purchase gate. Bizar's approval gates must be **code-enforced**, not prompt-instructed. If the agent ignores the prompt and calls `git push`, the hook must refuse the call.

### B.10 — WASM Sandbox for Tool Execution (from OpenFang)

**Source:** OpenFang's `WasmSandbox` at `crates/openfang-kernel/src/kernel.rs:816` and `crates/openfang-runtime/src/sandbox.rs`. Dual metering: **fuel** (instruction count, `fuel_limit: entry.manifest.resources.max_cpu_time_ms * 100_000` at `kernel.rs:2511`) and **epoch** (wall-clock via a watchdog thread). Skills and tools can run as WASM modules with per-execution budgets.

**Reference:** `crates/openfang-kernel/src/kernel.rs:816` (init), `kernel.rs:2489-2552` (per-execution fuel tracking).

**Bizar recommendation:** Defer. WASM sandboxing in Node is a significant complexity add with limited immediate payoff for a coding harness.

- **Why defer:** Bizar's tools (file read/write, terminal exec, web fetch) all need full Node API access. Wrapping them in WASM means reimplementing file I/O, networking, and process spawning in WASM-compatible code. That's a 6-12 month project with no community precedent for Node-based WASM tool execution.
- **What to do instead:** Use OS-level sandboxing (B.3 — Docker, `bwrap`, `sandbox-exec`) for the high-risk execution paths. WASM is appropriate when you have user-contributed skills of unknown provenance — but Bizar's skills come from the Skills CLI registry, which is curated. The threat model doesn't justify the complexity.
- **When to revisit:** If Bizar's plugin SDK (B.7) takes off and third parties start shipping untrusted skill packs, revisit WASM as a sandbox for *untrusted* skills only.

### B.11 — MCP Server for Bizar's Own Capabilities (from best-of)

**Source:** best-of-Agent-Harnesses ships an MCP server at `mcp/server.py` (228 lines) exposing 6 tools: `pick_harness`, `search_harnesses`, `get_harness`, `list_comparisons`, `get_comparison`, `list_categories`. Built on `mcp.server.fastmcp`. Lazy-loads `harnesses.json` from local filesystem or fetches from raw GitHub URL.

**Reference:** `mcp/server.py:29-38` (data loading), `mcp/server.py:82-145` (`pick_harness` scoring), `mcp/server.py:148-220` (the other tools).

**Bizar recommendation:** Publish a `bizar` MCP server that other agents (or Bizar itself) can query to discover Bizar's capabilities.

- **What to build:** A new package `packages/mcp-server/` (or extend `bizar-plugins/registry.json`) that exposes tools:
  - `bizar_init_project` — run `bizar init` on a project (already exists as a command at `cli/init.mjs`)
  - `bizar_run_agent` — dispatch an agent with a given task
  - `bizar_search_skills` — query the bundled + user-installed skills catalog
  - `bizar_memory_search` — proxy to the existing `.bizar/memory.json` + Obsidian search
  - `bizar_graph_query` — proxy to the existing Graphify graph (and the new domain-graph from B.4)
  - `bizar_audit` — proxy to `cli/audit.mjs` (Forseti security audit)
  - `bizar_export` — proxy to `cli/export.mjs`
- **Why this matters:** Today, a user with a different agent (Codex, Claude Code, OpenHands) cannot invoke Bizar's capabilities. With an MCP server, Bizar's tools become available to *any* MCP-aware agent. This is the discovery layer best-of identifies as the most important factor in agent ecosystem health.
- **File reference:** New package `packages/mcp-server/`. The MCP server runs as `bizar mcp serve` (a new subcommand). Use the official `@modelcontextprotocol/sdk` TypeScript SDK.
- **What NOT to copy:** best-of's two-flow automation pipeline (Flow 1 API → curation queue → Flow 2 editorial). Bizar's MCP server has no editorial layer — it's a thin pass-through to existing commands.

### B.12 — Comparison Page Pattern (from best-of)

**Source:** best-of publishes 5 comparison documents at `comparisons/`:
1. `how-to-pick-a-harness.md` — the 6-question decision guide
2. `openclaw-vs-hermes.md` — design philosophy comparison
3. `terminal-coding-agents.md` — opencode vs Codex vs Gemini CLI vs goose vs crush
4. `multi-agent-orchestration.md` — OpenAI Agents SDK vs CrewAI vs AutoGen vs LangGraph
5. `memory-layers.md` — Mem0 vs claude-mem vs Letta

**Reference:** `comparisons/how-to-pick-a-harness.md:3-28` (the 6 questions), `comparisons/terminal-coding-agents.md:5` (the "harness, not UI" insight).

**Bizar recommendation:** Publish 3 comparison docs in `docs/comparisons/` on the website.

- **What to build:**
  - `docs/comparisons/bizar-vs-opencode.md` — Bizar vs vanilla opencode (the value-add of multi-agent dispatch)
  - `docs/comparisons/bizar-vs-claude-code.md` — Bizar vs Claude Code (Bizar's multi-agent vs single-agent chat)
  - `docs/comparisons/multi-agent-orchestration.md` — Bizar's Odin/Thor/Tyr dispatch vs LangGraph / OpenAI Agents SDK
- **Why this matters:** best-of's curation framework proves that comparison docs are the highest-signal artifact for adoption. Users searching "X vs Y for multi-agent coding" find Bizar via these pages. The internal ROADMAP.md does not serve this purpose.
- **File reference:** Add `docs/comparisons/` directory; add a `Comparisons` section to the docs site (currently `docs/`).
- **What NOT to copy:** best-of's 14 curated use-case intents. Bizar's audience is narrower (multi-agent coding) and a 3-page comparison set is enough.

---

## Section C — What NOT to Copy

Just as important as what to adopt:

### C.1 — Hermes' 1.3M LOC complexity

Hermes is 1,347,339 lines of Python across 6,156 files. The Curator alone is 1,976 lines; `gateway/run.py` is 20,526 lines. This is a solo-maintained system with 17,000 tests across 900 files. Bizar's v5.5.1 codebase is roughly 10% the size of Hermes and 100% the size it should be for a coding harness.

**Don't copy:** god-files, monolithic subcommands, the 130-file `hermes_cli/` subcommand surface, the `run_agent.py` 60-parameter `AIAgent` class. Bizar's plugin-based agent dispatch in `config/opencode.json` is *already* the right shape — don't replace it with a Python monolith.

### C.2 — OpenFang's Rust-only ecosystem

OpenFang is 198,748 LOC of Rust across 13 crates. Skills are `SkillManifest` (TOML). The Rust toolchain limits plugin authors to those willing to compile a Rust crate. Hands are `include_str!()` embedded at compile time (`crates/openfang-hands/src/bundled.rs:10-12`), so adding a Hand requires a Rust rebuild.

**Don't copy:** the single-binary 32MB ambition, the compile-time `include_str!()` embedding, the Rust-only plugin contract. Bizar's agents are Markdown + YAML frontmatter; that's the right surface for a community-contributed plugin ecosystem.

### C.3 — OpenClaw's 21-package npm sprawl

OpenClaw ships 148 extensions, 21 packages (`packages/`), 130+ documentation files. The `src/plugin-sdk/` directory has 100+ files. The pnpm-workspace.yaml has 21 members. Maintaining this surface requires a full-time staff of maintainers.

**Don't copy:** the 148 extensions, the 21-package monorepo, the per-feature package boundary. Bizar's single-package monorepo (`package.json`) plus the `packages/sdk/` for SDK separation is the right scale.

### C.4 — OpenClaw's multi-agent-routing-as-default

OpenClaw defaults to multi-agent routing — one Gateway, N agents, N channel bindings. Bizar defaults to single-agent dispatch (Odin + Thor/Tyr/Vidarr siblings). These are different operating models: OpenClaw's is for organizational deployments; Bizar's is for personal coding workflows.

**Don't copy:** the Gateway-centric model, the per-agent workspace isolation, the channel-binding abstraction. Bizar's per-session agent dispatch via opencode's `task` tool is the right shape for a coding harness.

### C.5 — OpenFang's prompt-only security gates

The Browser Hand's purchase approval gate is `bundled/browser/HAND.toml:146-155` — Markdown instructions to the LLM. If the model disobeys, nothing stops it.

**Don't copy:** prompt-only security gates. Every Bizar approval gate (B.9) must be code-enforced. The agent cannot bypass the gate by reasoning past it.

### C.6 — Hermes' cache-breaking exceptions

Hermes has a hard rule: "prompt caching is sacred." The one exception is context compression. This is the right rule, but enforcing it perfectly across 1.3M LOC of Python is impossible — the rule leaks in edge cases. Bizar is small enough to enforce the rule cleanly. Don't ship the rule's exceptions.

---

## Section D — Phased Adoption Roadmap

### Phase 1 (0-3 months): Foundation

Three small, high-value additions that don't require new infrastructure:

1. **Bizar Trajectory Capture** (B.6)
   - Why first: lowest cost, highest long-term value. Every parallel dispatch already produces the raw material; we just stop throwing it away.
   - Effort: ~1 week for Thor or Tyr to implement.
   - Files: `cli/trajectory.mjs` (new), `plugins/bizar/index.ts` (post-turn hook), `cli/bin.mjs` (subcommand).
   - Verification: dispatch a Thor task, run `bizar trajectory compress`, confirm JSONL output.

2. **Knowledge Graph as Agent-Writeable Tool** (B.4)
   - Why second: addresses a real friction point (agents rediscover the same facts every session). Small implementation.
   - Effort: ~1 week for Thor or Tyr.
   - Files: `plugins/bizar/knowledge-graph.mjs` (new), `config/opencode.json` (tool list), `.gitignore` (SQLite path).
   - Verification: dispatch a Mimir research task, confirm the agent calls `bizar_knowledge_add_entity` when it learns a non-obvious fact, query the graph.

3. **Provider Profile Refactor** (B.5)
   - Why third: unblocks adding new providers (OpenAI, Anthropic, Google) without editing the opencode config.
   - Effort: ~3 days for Heimdall.
   - Files: `config/providers/minimax.json` (extract), `config/opencode.json` (provider block becomes a list).
   - Verification: add a `config/providers/openai.json` with one model; confirm the dashboard picks it up.

Total Phase 1 effort: ~3 weeks, mostly Thor/Tyr. After Phase 1, Bizar has trajectory data, a persistent domain knowledge graph, and a clean provider-extension story.

### Phase 2 (3-9 months): Capability Expansion

Three medium additions that unlock new use cases:

4. **Scheduler / Cron** (B.8)
   - Why fourth: every other system in the survey has cron. Bizar cannot express recurring work today.
   - Effort: ~3 weeks for Tyr with a Forseti review of the security implications.
   - Files: `cli/cron.mjs`, `cli/cron-tick.mjs`, `cli/bin.mjs` subcommand dispatch.
   - Verification: schedule "every Monday at 9am, run Heimdall with prompt X"; confirm it fires; confirm approval gates (B.9) work.

5. **Bizar Gateway with Telegram + Discord** (B.2)
   - Why fifth: biggest user-visible win. Unlocks "ask the agent from my phone" use case.
   - Effort: ~6 weeks for Tyr. Risk: chat-platform APIs are finicky; expect iteration.
   - Files: `cli/gateway/`, `cli/platforms/base.mjs`, `cli/platforms/telegram.mjs`, `cli/platforms/discord.mjs`.
   - Verification: configure a Telegram bot, send a message, confirm Bizar dispatches the right agent and replies.

6. **Backend Abstraction: Local + Docker + Sandbox** (B.3)
   - Why sixth: defense-in-depth for tier-3+ agents. Complements B.9 (approval gates).
   - Effort: ~3 weeks for Tyr.
   - Files: `cli/backends/base.mjs`, `cli/backends/local.mjs`, `cli/backends/docker.mjs`, `cli/backends/sandbox.mjs`.
   - Verification: dispatch a Vidarr task with `BIZAR_BACKEND=docker`; confirm it runs in a container with read-only project root.

Total Phase 2 effort: ~12 weeks. After Phase 2, Bizar can serve scheduled workflows, run from a phone, and isolate risky execution.

### Phase 3 (9-18 months): Differentiation

Two large initiatives that make Bizar uniquely valuable:

7. **Plugin / Extension SDK** (B.7)
   - Why seventh: community-contributed agents and skills are how Bizar grows without growing the core.
   - Effort: ~8 weeks for Tyr, with Forseti review of the API surface for stability.
   - Files: `packages/sdk/` (new), `bizar-plugins/registry.json` (already exists), `cli/agents-loader.mjs` (discovery).
   - Verification: a third party writes an agent module against the SDK; Bizar discovers it automatically; `bizar agents list` shows it.

8. **Approval Gates + Audit Trail** (B.9)
   - Why last: makes the L3 → L4 jump safe. Without this, Bizar cannot claim autonomous operation.
   - Effort: ~6 weeks for Tyr with Vidarr-style reasoning for edge cases.
   - Files: `plugins/bizar/approval.mjs`, `cli/audit.mjs` (already exists — extend), `.bizar/activity.log` (already exists — extend with approval outcomes).
   - Verification: configure a Vidarr task with no approval; confirm it requests approval for `git push`. Verify the gate is code-enforced (i.e. a misbehaving agent cannot bypass it via prompt).

Total Phase 3 effort: ~14 weeks. After Phase 3, Bizar is a community-extensible, scheduling-capable, approval-gated, knowledge-graph-aware, trajectory-capturing multi-agent harness with a Telegram gateway.

### What is NOT in any phase (deferred)

- **WASM sandbox for tool execution** (B.10) — deferred until community skills reach the scale where untrusted code execution is a real threat.
- **Comparison page publication** (B.12) — opportunistic; do it when there's bandwidth, don't schedule it.
- **Closed-loop skill review** (B.1) — small enough to slip into any phase. If B.6 (trajectory) is implemented first, the review pass can read trajectories as input.

---

## Section E — Vision Statement

BizarHarness should become the **smallest serious multi-agent coding harness in 2027** — the system that proves you don't need 1.3M LOC of Python, 200K LOC of Rust, or 148 npm packages to ship production-grade agent orchestration. The path forward is not "build everything Hermes and OpenClaw built" but "absorb the patterns that compound, skip the ones that don't, and stay narrow at the waist."

The patterns that compound: the **closed learning loop** (B.1) where every session makes the next one cheaper; the **knowledge graph** (B.4) where the agent's discoveries persist across sessions; the **trajectory capture** (B.6) that turns running Bizar into a self-evaluating system; the **plugin SDK** (B.7) that turns the community into the maintainer; the **approval gates** (B.9) that make L4 autonomy safe.

The patterns that don't: 148 extensions; prompt-only security; compile-time embedded Hands; 20K-line gateway files; 130 CLI subcommands. These are the gravity wells that pull systems toward complexity they cannot justify.

In 18 months, Bizar should ship: parallel subagent dispatch (already works), a Telegram/Discord gateway (Phase 2.5), a scheduler (Phase 2.4), Docker/sandbox backends (Phase 2.6), a community plugin SDK (Phase 3.7), code-enforced approval gates (Phase 3.8), a persistent domain knowledge graph (Phase 1.2), and a trajectory-compression pipeline (Phase 1.1). It should NOT ship: 1.3M LOC, 200K LOC of Rust, or 148 bundled extensions. It SHOULD ship: clean integration with opencode, the dashboard, Headroom, Obsidian, and LightRAG — the same stack it ships today, with new seams.

The final shape: **Bizar remains a coding harness, not a personal-assistant OS.** It runs in the user's terminal, dashboard, or messaging app. It dispatches Odin/Thor/Tyr/Vidarr siblings on parallel work. It captures trajectories, populates a knowledge graph, runs on schedules, asks for approval before sensitive actions, and learns from the user's corrections. The community extends it via the SDK. Forseti audits every tier-3+ plan. The closed loop closes.

That's Bizar. Not the biggest, not the smallest. The one that compounds.