# Hermes Agent — Round 1 Reconnaissance

**Repository:** `NousResearch/hermes-agent`  
**Version:** 0.18.0 (MIT License)  
**Primary Language:** Python 3.11–3.13  
**Built by:** Nous Research  
**Date:** 2026-07-06  

---

## Project Identity & Claims

Hermes Agent is a **self-improving AI agent** — the headline claim is a "built-in learning loop" that creates skills from experience, improves them during use, and persists knowledge across conversations. It runs the same agent core across five surfaces: CLI, TUI (Ink/React), messaging gateway (17+ platforms), Electron desktop app, and an ACP server for IDE integration.

Key features from the README and `pyproject.toml:9`:

- **Real terminal interface** — full TUI with multiline editing, slash-command autocomplete, conversation history
- **Multi-platform messaging** — Telegram, Discord, Slack, WhatsApp, Signal, and ~20 others from a single gateway process
- **Closed learning loop** — agent-curated memory with periodic nudges, autonomous skill creation, FTS5 session search with LLM summarization
- **Scheduled automations** — built-in cron scheduler with natural-language scheduling
- **Subagent delegation** — isolated child agents for parallel work, plus Python RPC tools via `delegate_task`
- **Six terminal backends** — local, Docker, SSH, Singularity, Modal, Daytona
- **Research-ready** — batch trajectory generation and compression for training

### Repo Stats

| Metric | Count |
|--------|-------|
| Total files | 6,156 |
| Python files (`.py`) | 2,871 |
| Python lines of code | ~1.3M (1,347,339) |
| Tests | ~17,000 across ~900 files |

### Top-Level File sizes

| File | Lines | Role |
|------|-------|------|
| `gateway/run.py` | 20,526 | Gateway runner (biggest single file) |
| `cli.py` | 16,184 | CLI orchestrator |
| `run_agent.py` | 6,013 | AIAgent class + forwarder to conversation_loop |
| `hermes_state.py` | 6,322 | SQLite state store (FTS5) |
| `agent/conversation_loop.py` | 5,294 | Core agent turn loop (extracted from run_agent) |
| `tools/delegate_tool.py` | 3,445 | Subagent delegation system |
| `hermes_logging.py` | 1,462 | Logging system |
| `model_tools.py` | 1,374 | Tool orchestration layer |
| `toolsets.py` | 971 | Toolset definitions |
| `tools/registry.py` | 766 | Central tool registry |
| `batch_runner.py` | 1,321 | Batch trajectory generation |
| `trajectory_compressor.py` | 1,574 | Training data compression |
| `agent/curator.py` | 1,976 | Background skill maintenance |
| `agent/memory_manager.py` | 1,086 | Memory provider orchestration |
| `mcp_serve.py` | 1,956 | MCP server adapter |

### Install Methods

- Linux/macOS/WSL2/Termux: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`
- Windows native (PowerShell): `iex (irm https://hermes-agent.nousresearch.com/install.ps1)`
- Package: `hermes-agent` on PyPI, managed by `uv` via `pyproject.toml:24`
- All dependencies are **exact-pinned** (`==X.Y.Z`) to prevent supply-chain attacks

---

## Top-Level Architecture

### Directory Breakdown

```
hermes-agent/
├── run_agent.py              # AIAgent class — core conversation loop (~6K LOC)
├── model_tools.py            # Tool orchestration, discovery, dispatch (~1.4K LOC)
├── toolsets.py               # Toolset definitions, _HERMES_CORE_TOOLS list
├── cli.py                    # HermesCLI class — interactive CLI (~16K LOC)
├── hermes_state.py           # SessionDB — SQLite session store with FTS5 (~6K LOC)
├── hermes_constants.py       # get_hermes_home() path resolution
├── hermes_logging.py         # setup_logging() — trio of log files (~1.5K LOC)
├── batch_runner.py           # Parallel batch trajectory generation (~1.3K LOC)
├── trajectory_compressor.py  # Data compression for training (~1.6K LOC)
│
├── agent/                    # Agent internals (69 files as of current snapshot)
│   ├── conversation_loop.py  #   The actual turn loop (extracted from run_agent)
│   ├── turn_context.py       #   Turn prologue setup
│   ├── memory_manager.py     #   Memory provider orchestration
│   ├── memory_provider.py    #   MemoryProvider ABC
│   ├── prompt_builder.py     #   System prompt assembly
│   ├── curator.py            #   Background skill lifecycle management
│   ├── curator_backup.py     #   Skill backup/rollback
│   ├── display.py            #   KawaiiSpinner + activity feed
│   ├── chat_completion_helpers.py  # Provider API call helpers
│   ├── coding_context.py     #   Project context files
│   ├── context_compressor.py #   Context window management
│   ├── conversation_compression.py # Message history compression
│   ├── skill_commands.py     #   Slash command parsing for skills
│   ├── skill_preprocessing.py #   SKILL.md template expansion
│   ├── skill_utils.py        #   SKILL.md frontmatter parsing
│   ├── tool_dispatch_helpers.py # Parallel tool execution rules
│   ├── tool_executor.py      #   Tool execution with timeout/retry
│   ├── tool_guardrails.py    #   Safety gate for tools
│   ├── trajectory.py         #   Trajectory capture utilities
│   ├── file_safety.py        #   Write-path deny lists
│   ├── prompt_caching.py     #   Anthropic prompt caching
│   ├── learning_graph.py     #   Desktop learning visualization graph
│   ├── learning_mutations.py #   Graph mutation helpers
│   ├── learn_prompt.py       #   Learning prompt templates
│   ├── error_classifier.py   #   API error classification
│   ├── iteration_budget.py   #   Token/budget tracking
│   ├── turn_retry_state.py   #   Retry state per turn
│   ├── title_generator.py    #   Session title generation
│   ├── insights.py           #   Session insights
│   ├── image_gen_provider.py #   Image generation ABC
│   ├── tts_provider.py       #   TTS ABC
│   ├── web_search_provider.py #  Web search ABC
│   ├── lsp/                  #   Language Server Protocol integration
│   ├── transports/           #   Communication transports
│   └── ...                   #   ~50 more internal modules
│
├── tools/                    # Tool implementations (~100 files)
│   ├── registry.py           #   Central tool registry (auto-discovery)
│   ├── terminal_tool.py      #   Terminal execution tool
│   ├── file_operations.py    #   read_file, write_file, patch, search_files
│   ├── delegate_tool.py      #   Subagent delegation (delegate_task)
│   ├── file_tools.py         #   Additional file tool wrappers
│   ├── web_tools.py          #   web_search, web_extract
│   ├── vision_tools.py       #   vision_analyze
│   ├── browser_tool.py       #   browser_navigate, etc.
│   ├── memory_tool.py        #   memory storage/recall
│   ├── todo_tool.py          #   TODO list management
│   ├── cronjob_tools.py      #   Cron job management from agent
│   ├── mcp_tool.py           #   MCP client integration
│   ├── skills_tool.py        #   Skill management from agent
│   ├── skill_manager_tool.py #   Skill CRUD from agent
│   ├── send_message_tool.py  #   Cross-platform send
│   ├── session_search_tool.py #  FTS5 session search
│   ├── clarify_tool.py       #   Clarify/sudo/secret prompts
│   ├── environments/         #   Six terminal backends
│   │   ├── base.py           #     BaseEnvironment ABC
│   │   ├── local.py          #     Local subprocess execution
│   │   ├── docker.py         #     Docker container execution
│   │   ├── ssh.py            #     SSH remote execution
│   │   ├── singularity.py    #     Singularity container execution
│   │   ├── modal.py          #     Modal serverless execution
│   │   ├── managed_modal.py  #     Nous-managed Modal backend
│   │   └── daytona.py        #     Daytona dev environment
│   └── ...                   #   ~80 more tool modules
│
├── hermes_cli/               # CLI subcommands (~130 files!)
│   ├── main.py               #   Entry point / argparse
│   ├── config.py             #   Config loading, DEFAULT_CONFIG
│   ├── commands.py           #   COMMAND_REGISTRY for slash commands
│   ├── setup.py              #   Setup wizard
│   ├── models.py             #   Model selection UI
│   ├── tools_config.py       #   Tool enable/disable curses UI
│   ├── plugins.py            #   Plugin discovery
│   ├── skin_engine.py        #   Theming system
│   ├── banner.py             #   CLI banner
│   ├── profiles.py           #   Multi-instance profile support
│   ├── curator.py            #   Curator CLI commands
│   ├── cron.py               #   Cron CLI commands
│   ├── kanban.py             #   Kanban CLI commands
│   ├── skills_hub.py         #   Skills Hub CLI
│   ├── web_server.py         #   Dashboard web server
│   ├── pty_bridge.py         #   PTY bridge for dashboard TUI embed
│   └── ...                   #   ~110 more CLI modules
│
├── gateway/                  # Messaging gateway (~40 files)
│   ├── run.py                #   GatewayRunner (20K LOC)
│   ├── session.py            #   Gateway session management
│   ├── config.py             #   Gateway config
│   ├── platform_registry.py  #   Platform adapter registry
│   ├── platforms/            #   Platform adapters
│   │   ├── base.py           #     BasePlatform ABC (5.6K LOC)
│   │   ├── api_server.py     #     REST API server
│   │   ├── signal.py         #     Signal
│   │   ├── webhook.py        #     Generic webhook
│   │   ├── whatsapp_cloud.py #     WhatsApp Cloud API
│   │   ├── bluebubbles.py    #     iMessage bridge
│   │   ├── weixin.py         #     WeChat (Weixin)
│   │   ├── qqbot/            #     QQ Bot
│   │   ├── yuanbao.py        #     Tencent Yuanbao
│   │   └── ...              #     (Other built-ins registered via if/elif)
│   ├── builtin_hooks/        # Extension hooks
│   ├── stream_consumer.py    #   Provider stream handling
│   ├── stream_dispatch.py    #   Stream dispatch
│   ├── delivery.py           #   Message delivery
│   ├── slash_commands.py     #   Gateway slash command dispatch
│   ├── status.py             #   Gateway status
│   └── relay/                #   Gateway relay subsystem
│
├── cron/                     # Scheduled job system
│   ├── scheduler.py          #   Tick loop, job execution (3.6K LOC)
│   ├── jobs.py               #   Job storage/db (2K LOC)
│   └── ...
│
├── skills/                   # Built-in skills (~20 categories)
│   ├── autonomous-ai-agents/
│   ├── computer-use/
│   ├── data-science/
│   ├── github/
│   ├── mlops/
│   ├── research/
│   ├── software-development/
│   └── ...
│
├── optional-skills/          # Heavier/niche skills (not active by default)
│
├── plugins/                  # Plugin system
│   ├── memory/               #   Memory providers (honcho, mem0, hindsight, etc.)
│   ├── model-providers/      #   Inference backends (openrouter, anthropic, etc.)
│   ├── kanban/               #   Multi-agent board
│   ├── context_engine/       #   Context engine plugins
│   ├── image_gen/            #   Image generation providers
│   ├── observability/        #   Telemetry/observability
│   └── ...
│
├── providers/                # Provider profiles (model info)
├── tests/                    # ~17K tests
├── acp_adapter/              # ACP server (IDE integration)
├── acp_registry/             # ACP tool registry
├── tui_gateway/              # Python JSON-RPC backend for TUI
├── ui-tui/                   # Ink (React) terminal UI
├── web/                      # Dashboard web app
├── apps/                     # Desktop app (Electron)
├── website/                  # Docusaurus docs site
├── docker/                   # Docker build files
└── scripts/                  # Dev/release scripts
```

### Where Is the Agent Core?

The **main agent loop** lives in two files:

1. `run_agent.py:5745` defines the `AIAgent.run_conversation()` method — but this is now a **forwarder** to:
2. `agent/conversation_loop.py:518` — the real `run_conversation()` function (~3,900 lines of loop body). This function drives one user turn through model calls, tool dispatch, retries, fallbacks, compression, and post-turn hooks.

The `AIAgent` class itself (`run_agent.py`) holds all state: ~60 constructor parameters including `base_url`, `api_key`, `provider`, `model`, `max_iterations`, `enabled_toolsets`, `platform`, `session_id`, and many more. It is the narrow waist through which all interaction flows.

### Where Are Skills Defined?

- **Built-in skills**: `skills/` — organized by category directory, each containing a `SKILL.md` with frontmatter
- **Optional skills**: `optional-skills/` — shipped but not active by default; installed via `hermes skills install official/<category>/<skill>`
- **User-created skills**: `~/.hermes/skills/` — created by the agent during use
- **Skills Hub**: `tools/skills_hub.py` provides `GitHubSource` for fetching skills from GitHub repos and `OptionalSkillSource` for repo-bundled optional skills
- The `agentskills.io` open standard is referenced in the README as a compatibility target

### Where Are Subagents Coordinated?

`tools/delegate_tool.py` (3,445 lines) handles all subagent delegation. It spawns isolated `AIAgent` instances in a `ThreadPoolExecutor`, with:
- Blocked tools: `delegate_task`, `clarify`, `memory`, `send_message`, `execute_code`, `cronjob`
- Parallel batch mode via `tasks: [...]` parameter
- `role="orchestrator"` for multi-level delegation
- Configurable `max_concurrent_children` (default 3)

### Memory System Location

- **Orchestration**: `agent/memory_manager.py` (1,086 lines) — `MemoryManager` class
- **ABC**: `agent/memory_provider.py` — `MemoryProvider` base class
- **FTS5 session store**: `hermes_state.py` (6,322 lines) — `SessionDB` with SQLite WAL mode
- **Memory plugins**: `plugins/memory/` — honcho, mem0, supermemory, byterover, hindsight, holographic, openviking, retaindb

### Tool Execution Layer

- **Registry**: `tools/registry.py` (766 lines) — auto-discovers tools via AST scanning for `registry.register()` calls
- **Orchestration**: `model_tools.py` (1,374 lines) — `get_tool_definitions()`, `handle_function_call()`
- **Toolset definitions**: `toolsets.py` (971 lines) — `_HERMES_CORE_TOOLS` list + `TOOLSETS` dict

---

## Subsystem Inventory

### CLI Layer

`cli.py:1` — The `HermesCLI` class (~16K LOC) is an interactive REPL using `prompt_toolkit` for input (with autocomplete, file history) and `Rich` for output (banners, panels, progress bars). Key subsystems:

- **`process_command()`** — dispatches slash commands via central `COMMAND_REGISTRY` in `hermes_cli/commands.py`
- **`resolve_command()`** — alias resolution chain
- **Skin engine** (`hermes_cli/skin_engine.py`) — data-driven CLI theming (colors, spinner faces, tool prefixes)
- **KawaiiSpinner** (`agent/display.py`) — animated faces during API calls, `┊` activity feed for tool results
- **Help system** — `COMMANDS_BY_CATEGORY` dict feeds `show_help()`
- **Config** — `load_cli_config()` merges hardcoded defaults + user `config.yaml`
- **Slash commands for skills** — `agent/skill_commands.py` scans `~/.hermes/skills/`, injects as user message (not system prompt) to preserve prompt caching

### TUI Layer

The TUI is a full replacement for the prompt_toolkit CLI, activated via `hermes --tui` or `HERMES_TUI=1`.

- **Process model**: `hermes --tui` spawns a Node.js Ink process that communicates with a Python `tui_gateway` backend over newline-delimited JSON-RPC on stdio
- **Ink components**: `ui-tui/src/` — Ink (React for terminal) renders the transcript, composer, prompts, and activity
- **Python backend**: `tui_gateway/server.py` — manages `AIAgent` session, tool execution, slash command logic
- **Theming**: `ui-tui/src/theme.ts` + `branding.tsx` consume skin data from the Python side
- **Dashboard embed**: `hermes_cli/pty_bridge.py` + web server WebSocket endpoint — the dashboard embeds the real `hermes --tui` via xterm.js, not a rewrite

### Gateway / Multi-Platform Messaging

`gateway/run.py` (20,526 lines) is the largest single file. The `GatewayRunner` class:

- **Discovers platforms** via `gateway/platform_registry.py` — allows both built-in and plugin adapters to self-register
- **Platform adapters**: `gateway/platforms/` — Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Mattermost, Email, SMS, DingTalk, WeCom, Weixin, Feishu, QQ Bot, BlueBubbles, Yuanbao, REST API server, webhook
- **Session management**: agent cache LRU (max 128, 1h idle TTL), per-session `AIAgent` instances
- **Stream handling**: `stream_consumer.py`, `stream_dispatch.py` — agent stream relay
- **Message delivery**: `delivery.py` — platform-aware routing
- **Slash commands**: `slash_commands.py` — `/stop`, `/new`, `/model`, etc.
- **State**: `session.py` — persistent gateway state
- **Pairing**: `pairing.py` — DM pairing for security

Platform adapters are mostly single-file and implement the `BasePlatform` ABC from `gateway/platforms/base.py`. Long-polling (Telegram) and webhook-based (Slack, Discord) modes are both supported.

### Six Terminal Backends

`tools/environments/` implements the `BaseEnvironment` ABC (`tools/environments/base.py:1`):

| Backend | File | Model |
|---------|------|-------|
| Local | `local.py` | Fresh `bash -c` subprocess per command |
| Docker | `docker.py` | `docker exec` into a container |
| SSH | `ssh.py` | SSH to a remote host |
| Singularity | `singularity.py` | Singularity container |
| Modal | `modal.py` | Modal serverless (hibernation/wake) |
| Daytona | `daytona.py` | Daytona dev environments |

All share `spawn-per-call` model: each command spawns a fresh `bash -c` process. Session state (env vars, CWD) is captured at init and re-sourced before each command. The factory in `terminal_tool.py` selects the backend based on `TERMINAL_ENV` config.

### Cron Scheduler

- `cron/jobs.py` (2K LOC) — JSON-based job store at `~/.hermes/cron/jobs.json`
- `cron/scheduler.py` (3.6K LOC) — `tick()` loop called every 60s by the gateway
- File-based lock (`~/.hermes/cron/.tick.lock`) for cross-process safety
- Schedule formats: duration strings (`"30m"`), "every" phrases (`"every 2h"`), cron expressions, ISO timestamps
- Per-job features: skills loading, model/provider overrides, pre-run data-collection scripts, `context_from` chaining
- 3-minute hard interrupt on cron sessions; `skip_memory=True` by default
- Cron deliveries land in their own session (not the main conversation) to preserve message-role alternation

### Trajectory / Batch Runner

- `batch_runner.py` (1,321 lines) — parallel batch processing with `multiprocessing.Pool`, checkpointing for fault tolerance, tool usage statistics, toolset distributions
- `trajectory_compressor.py` (1,574 lines) — post-processes trajectories: protects first/last turns, compresses middle turns via LLM summarization to fit within a token budget
- `toolset_distributions.py` — defines sampling distributions for training data generation
- Trajectories are NOT stored in the main `hermes_state.py` database — they go to separate output directories

### ACP Adapter (Agent Communication Protocol)

`acp_adapter/` — implements the ACP server for IDE integration (VS Code, Zed, JetBrains):
- `server.py` — ACP server
- `session.py` — ACP session management
- `tools.py` — tool exposure via ACP
- `entry.py` — entry point
- `auth.py` — authentication
- `permissions.py` — permission gating
- `edit_approval.py` — edit approval workflow

---

## Self-Improvement Mechanisms

### Closed Learning Loop

The "closed learning loop" is the combination of three systems:

1. **Memory persistence** (`agent/memory_manager.py` + `hermes_state.py`): Every turn, the agent's messages are stored in SQLite with FTS5 full-text search. The `MemoryManager` orchestrates plugin providers (Honcho, mem0, etc.) that each implement `prefetch()`, `sync_turn()`, `get_tool_schemas()`.

2. **Skill creation** (`tools/skill_manager_tool.py` + `agent/curator.py`): After complex tasks, the agent autonomously creates skills. Skills are SKILL.md files with YAML frontmatter stored in `~/.hermes/skills/`. The Curator (`agent/curator.py`) periodically reviews agent-created skills — pinning active ones, archiving stale ones — via a forked LLM review agent. It runs on inactivity-trigger (no cron daemon), firing when the agent is idle and the last run was > `interval_hours` (default 7 days).

3. **Skill self-improvement** (`tools/skills_tool.py` + usage tracking): Skills improve during use. The usage tracking system (`tools/skill_usage.py`) records `use_count`, `patch_count`, `last_activity_at`, and state transitions per skill. The agent can `patch` and `edit` its own skills during conversations.

### Memory Persistence Architecture

- **SQLite FTS5**: `hermes_state.py` — `SessionDB` class stores all session metadata, messages, and configuration with WAL mode for concurrent access
- **LLM summarization**: Session search results are LLM-summarized before being shown to the agent
- **Memory providers**: Pluggable via `MemoryProvider` ABC. Current built-in providers:
  - Honcho (`plugins/memory/honcho/`)
  - Mem0 (`plugins/memory/mem0/`)
  - Supermemory (`plugins/memory/supermemory/`)
  - Byterover (`plugins/memory/byterover/`)
  - Hindsight (`plugins/memory/hindsight/`)
  - Holographic (`plugins/memory/holographic/`)
  - OpenViking (`plugins/memory/openviking/`)
  - RetainDB (`plugins/memory/retaindb/`)
- **Only one external provider at a time** — enforced by `MemoryManager`
- **Lifecycle**: `initialize()` -> `system_prompt_block()` -> `prefetch()` (per-turn) -> `sync_turn()` (per-turn) -> `shutdown()`

### User Modeling with Honcho

Honcho (`plugins/memory/honcho/`) is a dialectic user modeling system that builds a representation of the user over time. It's one of the memory provider plugin options, implementing the same `MemoryProvider` ABC. The Honcho plugin provides dialectic-based user modeling that tracks user preferences, behavior patterns, and interaction history across sessions.

---

## Tool Ecosystem

### Tools Exposed to the Agent

The `_HERMES_CORE_TOOLS` list (`toolsets.py:31`) defines the default toolset available to the agent:

**Web:** `web_search`, `web_extract`  
**Terminal:** `terminal`, `process`, `read_terminal`, `close_terminal`  
**File ops:** `read_file`, `write_file`, `patch`, `search_files`  
**Vision:** `vision_analyze`, `image_generate`  
**Skills:** `skills_list`, `skill_view`, `skill_manage`  
**Browser:** `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_back`, `browser_press`, `browser_get_images`, `browser_vision`, `browser_console`, `browser_cdp`, `browser_dialog`  
**Audio:** `text_to_speech`  
**Planning:** `todo`, `memory`  
**Search:** `session_search`  
**Clarify:** `clarify`  
**Execution:** `execute_code`, `delegate_task`  
**Cron:** `cronjob`  
**Home Assistant:** `ha_list_entities`, `ha_get_state`, `ha_list_services`, `ha_call_service`  
**Kanban:** `kanban_show`, `kanban_list`, `kanban_complete`, `kanban_block`, `kanban_heartbeat`, `kanban_comment`, `kanban_create`, `kanban_link`, `kanban_unblock`  
**Computer use:** `computer_use`

Additional toolsets can be enabled per-platform via `TOOLSETS` dict (browser, code_execution, discord, feishu, homeassistant, image_gen, kanban, memory, messaging, moa, rl, safe, search, session_search, spotify, terminal, todo, tts, video, vision, web).

### RPC Mechanism

The `delegate_task` tool in `tools/delegate_tool.py` provides a Python RPC mechanism: subagents can call tools via `registry.dispatch()`, collapsing multi-step pipelines into zero-context-cost turns. The parent agent sees only the delegation call and summary result, never intermediate tool calls.

### Tool Registry Pattern

Each tool file in `tools/` calls `registry.register()` at module level (`tools/registry.py`):
```python
registry.register(
    name="example_tool",
    toolset="example",
    schema={"name": "example_tool", "description": "...", "parameters": {...}},
    handler=lambda args, **kw: example_tool(param=args.get("param"), task_id=kw.get("task_id")),
    check_fn=check_requirements,
    requires_env=["EXAMPLE_API_KEY"],
)
```

Auto-discovery (`discover_builtin_tools()` in `tools/registry.py:58`) scans `tools/*.py` for AST nodes matching `registry.register(...)` at module level. Matching modules are imported automatically — no manual import list needed.

### Plugin Tool Registration

Plugins can also register tools via `ctx.register_tool(...)` in their `register()` function. The `PluginManager` discovers plugins from `~/.hermes/plugins/`, `./.hermes/plugins/`, and pip entry points. Plugin tools can be enabled/disabled without touching `tools/` or `toolsets.py`.

---

## Key Architectural Patterns

1. **Narrow waist core** — `AIAgent` is the central abstraction; all surfaces (CLI, gateway, TUI, batch runner) create an `AIAgent` instance
2. **Per-conversation prompt caching is sacred** — context is never mutated mid-conversation (except compression)
3. **Everything is a plugin** — memory providers, model providers, image gen, tools, platform adapters all register through ABCs
4. **Spawn-per-call terminal model** — each command is a fresh process; CWD persists via markers/temp files
5. **Auto-discovery by AST scanning** — tool registration uses Python AST parsing, not explicit import lists
6. **SQLite + FTS5 for session persistence** — WAL mode for concurrent access across multi-platform gateway
7. **Data-driven CLI theming** — skins are pure YAML data, no code changes needed to add a new skin
8. **Fork-based curation** — the Curator spawns a forked `AIAgent` to review skills (avoids prompt cache pollution)
