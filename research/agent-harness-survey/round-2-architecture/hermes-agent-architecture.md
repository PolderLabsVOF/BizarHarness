# Hermes Agent — Round 2 Deep Architecture

**Focus:** How things actually work in code — the agent loop, tool dispatch, subagent delegation, memory, skills, gateway, terminal backends, provider routing, trajectories, and security.

---

## 1. The Agent Loop

### Entry Points

Every surface (CLI, gateway, TUI, batch runner, cron) creates an `AIAgent` instance and calls either `chat()` or `run_conversation()`:

- `AIAgent.chat()` (`run_agent.py`) — simple interface, returns a string
- `AIAgent.run_conversation()` (`run_agent.py:5745`) — full interface, returns a dict with `final_response` + `messages`. This is now a thin forwarder to:
- `agent/conversation_loop.py:518` — the actual ~3,900-line loop body

### Loop Structure

The core loop (paraphrased from `agent/conversation_loop.py` and the AGENTS.md description):

```
def run_conversation(user_message, system_message, conversation_history, task_id):
    # === PROLOGUE (build_turn_context) ===
    ctx = build_turn_context(agent, user_message, ...)
    # - Sanitize messages (non-ASCII, surrogates, image stripping)
    # - Restore or build system prompt
    # - Preflight context compression if needed
    # - Fire pre_llm_call plugin hooks
    # - External memory prefetch (via MemoryManager)
    
    messages = ctx.messages  # system prompt + history + user message + tools
    
    # === MAIN LOOP ===
    while (api_call_count < max_iterations and budget.remaining > 0) \
            or budget_grace_call:
        
        if interrupt_requested:
            break
        
        # 1. Model call
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tool_schemas,
            stream=True,
            ...
        )
        
        # 2. Handle response
        if response.tool_calls:
            # Parallel tool execution when safe
            for tool_call in parallelize(response.tool_calls):
                result = handle_function_call(
                    tool_call.name, 
                    tool_call.arguments, 
                    task_id
                )
                messages.append(tool_result_message(result))
            api_call_count += 1
        else:
            # 3. Final text response — done
            return response.content
        
        # 4. Check budget
        budget.consume(response.usage)
    
    # === POST-TURN ===
    # - Fire post_llm_call / post_tool_call hooks
    # - Memory sync (turn messages to provider)
    # - Check for curator trigger (idle-based)
    # - Title generation if needed
    # - Save trajectory if enabled
```

Key behaviors:
- **Fully synchronous** — one thread, blocking model calls
- **Interrupt-aware** — `_interrupt_requested` flag checked before each API call
- **Grace call** — `_budget_grace_call` permits one extra turn after budget exhaustion
- **Streaming** — responses are streamed; tool calls and text are extracted from the stream
- **Per-conversation prompt caching** is sacred — system prompt is built once and never mutated mid-conversation

### Tool Call Parsing and Dispatch

Tool calls arrive as OpenAI-format `tool_calls` from the model response. The dispatch chain:

1. **Intercepted tools** (handled by `run_agent.py` before `handle_function_call`): `todo`, `memory` — these are agent-level tools that modify the agent's internal state
2. **`handle_function_call()`** in `model_tools.py:1` — the main dispatcher:
   - Looks up the tool in `registry._entries` by name
   - Runs `check_fn` if present (availability gate)
   - Executes the handler with parsed arguments
   - Returns a JSON string result
3. **`registry.dispatch()`** in `tools/registry.py` — lower-level dispatch used by subagents and the batch runner

### Error Recovery / Retry Logic

- `agent/turn_retry_state.py` — tracks retry state per turn
- `agent/retry_utils.py` — `adaptive_rate_limit_backoff()` and `jittered_backoff()`
- `agent/error_classifier.py` — `FailoverReason` enum + `classify_api_error()` categorizes errors into: rate limit, context overflow, auth failure, server error, etc.
- Provider fallback chain: if primary provider fails, Hermes tries fallback models/providers
- Context overflow triggers automatic compression and retry
- Max retries configurable; 90 default max iterations

### Context Management Between Turns

- Conversation history is maintained as an OpenAI-format message list
- `agent/conversation_compression.py` — handles compression when context window is exceeded
- `agent/context_compressor.py` — LLM-based summarization of earlier conversation turns
- `agent/prompt_caching.py` — Anthropic-style prompt caching markers
- System prompt is built once from: platform identity + tools index + skills index + context files + memory block. It remains byte-stable for the conversation's lifetime to preserve caching

---

## 2. Tool Execution System

### Tool Definition Format

Tools are registered via `registry.register()` in `tools/registry.py:87`:

```python
class ToolEntry:
    __slots__ = (
        "name", "toolset", "schema", "handler", "check_fn",
        "requires_env", "is_async", "description", "emoji",
        "max_result_size_chars", "dynamic_schema_overrides",
    )
```

- **`schema`**: Full OpenAI function-calling schema (`{"name":..., "description":..., "parameters":...}`)
- **`handler`**: Callable that receives parsed `args` dict + `task_id` kwarg, returns JSON string
- **`check_fn`**: Optional zero-arg callable returning bool — gates tool availability at runtime
- **`requires_env`**: List of env vars the tool needs
- **`is_async`**: Whether the handler is an async coroutine
- **`max_result_size_chars`**: Truncation limit for tool output
- **`dynamic_schema_overrides`**: Optional callable returning schema patches

### Tool Discovery and Registration

Auto-discovery in `tools/registry.py:58`:

```python
def discover_builtin_tools(tools_dir: Optional[Path] = None) -> List[str]:
    tools_path = ...  # tools/ directory
    module_names = [
        f"tools.{path.stem}"
        for path in sorted(tools_path.glob("*.py"))
        if path.name not in {"__init__.py", "registry.py", "mcp_tool.py"}
        and _module_registers_tools(path)  # AST scan for registry.register()
    ]
    for mod_name in module_names:
        importlib.import_module(mod_name)
```

The AST-based filter (`_module_registers_tools()` at line 43) ensures only files that actually register tools are imported — helper modules are skipped.

### Schema Collection

`model_tools.py` builds the final tool schema list sent to the LLM:

1. Resolve enabled toolsets via `toolsets.py:resolve_toolset()`
2. For each tool name in the resolved set, look up `registry.get_schema(name)`
3. Run `check_fn` — if it returns False, the tool is omitted from the schema
4. Apply `dynamic_schema_overrides` for per-session schema customization
5. Inject memory-provider tool schemas via `inject_memory_provider_tools()`

### Sandboxing and Permission Gates

- **`check_fn`**: Per-tool availability gate — checks env vars, config keys, installed deps
- **File write deny-lists**: `tools/file_operations.py:48` — `WRITE_DENIED_PATHS` and `WRITE_DENIED_PREFIXES` block writes to sensitive system files
- **Dangerous command approval**: `tools/approval.py` + `tools/write_approval.py` — users can approve/deny sensitive operations
- **Subagent auto-deny**: `tools/delegate_tool.py:74` — `_subagent_auto_deny()` is the default; subagent threads cannot prompt the user
- **Prompt injection scanning**: `tools/threat_patterns.py` — shared with `agent/prompt_builder.py` for context file scanning
- **Website access policy**: `tools/website_policy.py` — URL allow/deny lists

### Long-Running Tool Handling

- **Asynchronous tools**: Handlers can set `is_async=True`; `_run_async()` in `model_tools.py:88` bridges sync↔async via persistent event loops
- **Per-thread event loops**: Each worker thread gets its own long-lived asyncio loop (`_get_worker_loop()`) so cached httpx clients stay valid
- **Activity callbacks**: `tools/environments/base.py:47` — `set_activity_callback()` lets long-running terminal commands report liveness to the gateway
- **30-second tool timeout**: Configurable per-tool in the registry

### Streaming Output from Tools

- Terminal output streams through `KawaiiSpinner` activity feed in CLI
- Gateway streams tool output through `stream_consumer.py` / `stream_dispatch.py`
- Tool output is appended to messages as `tool` role entries
- Large tool results are truncated based on `max_result_size_chars`

---

## 3. Subagent Delegation

### How Subagents Are Spawned

`tools/delegate_tool.py` uses `concurrent.futures.ThreadPoolExecutor`:

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

Each child:
1. Gets a **fresh `AIAgent` instance** with its own `task_id` (and thus its own terminal session + file ops cache)
2. Receives a **focused system prompt** built from the delegation goal + context
3. Gets a **restricted toolset** — `DELEGATE_BLOCKED_TOOLS` at line 45 strips `delegate_task`, `clarify`, `memory`, `send_message`, `execute_code`, `cronjob`
4. For `role="orchestrator"`, `delegate_task` is re-enabled (gated by config)

### Message-Passing Protocol

Subagents communicate via the `_run_single_child()` return value — a `dict` with:
- `summary`: LLM-generated summary of the child's work
- `success`: boolean
- `error`: optional error message
- `output`: optional detailed output

The parent's context sees only the delegation call and the summary — never the child's intermediate tool calls or reasoning.

### Parallel Work

- **Single delegation**: `delegate_task(goal="...", context="...")` — one child, blocking
- **Batch delegation**: `delegate_task(tasks=[{...}, {...}, ...])` — multiple children run concurrently
- **Concurrency cap**: `delegation.max_concurrent_children` (default 3)
- **Parallel scope**: Tools that operate on independent paths can run concurrently within a single agent turn (via `_should_parallelize_tool_batch` in `agent/tool_dispatch_helpers.py`)

### Context Isolation

- Each child gets its own OpenAI-format message list (no parent history)
- `_last_resolved_tool_names` global in `model_tools.py` is saved/restored around subagent execution
- `task_id` is unique per child, separating terminal sessions and file operation caches

### RPC Pattern: Zero-Context-Cost Turns

The RPC mechanism in `delegate_tool.py` lets Python scripts call tools via `registry.dispatch()` without the agent's LLM context. A multi-step pipeline (e.g., search → read → summarize) runs entirely inside the subagent and returns only the summary. This is the "zero-context-cost turns" pattern from the README.

---

## 4. Memory Architecture

### Three-Layer Architecture

1. **Short-term: Conversation context** — the OpenAI-format message list held in `AIAgent.messages`. Managed by the turn loop, compressed periodically by `agent/conversation_compression.py`

2. **Long-term: SQLite FTS5** — `hermes_state.py` `SessionDB` class. Stores all session metadata, full message history, and model configuration. WAL mode for concurrent readers+writer across the multi-platform gateway. FTS5 virtual table for fast text search across all session messages.
   - Session source tagging (`'cli'`, `'telegram'`, etc.)
   - Compression-triggered session splitting via `parent_session_id` chains
   - Session listing: roots + branch children visible; subagent and compression runs hidden

3. **Long-term: Pluggable memory providers** — `agent/memory_manager.py` orchestrates providers that implement the `MemoryProvider` ABC (`agent/memory_provider.py`):
   - `prefetch(query)` — background recall before each turn
   - `sync_turn(user_msg, assistant_msg)` — async write after each turn
   - `get_tool_schemas()` — expose provider-specific tools
   - `system_prompt_block()` — static text for system prompt

### Memory Triggers / Nudges

- **Pre-turn**: `MemoryManager.prefetch_all(user_message)` runs before the LLM call
- **Post-turn**: `MemoryManager.sync_all(user_msg, assistant_response)` runs after
- **Background**: `queue_prefetch_all()` schedules async prefetch for the next turn
- **Curator nudges**: `agent/curator.py` monitors idle time and triggers skill review
- **Session search tool**: The agent can explicitly search past sessions via `session_search` tool
- **Memory tool**: The agent can explicitly read/write memory via `memory` tool

### Memory Recall Flow During a Session

1. Session starts → `MemoryManager.initialize(session_id)` for each registered provider
2. Each provider's `system_prompt_block()` text is appended to the system prompt
3. Per turn:
   a. `prefetch_all(user_message)` — providers search their stores
   b. Results injected as context block into the messages (not system prompt, to preserve caching)
   c. `sync_all(user_msg, assistant_response)` — providers persist the turn
4. Session ends → `on_session_end()` hooks fire

---

## 5. Skill System

### Skill File Format

Skills are directories containing a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: skill-name
description: ≤60 char description.
version: 1.0
author: Contributor Name
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [tag1, tag2]
    category: development
    related_skills: [other-skill]
    config:
      some_key: description
---
# Skill Content
...
```

`agent/skill_utils.py` provides `parse_frontmatter()`, `extract_skill_description()`, `get_all_skills_dirs()`

### Skill Auto-Creation

The agent autonomously creates skills via `skill_manage(action="create")` in `tools/skill_manager_tool.py`. After complex multi-step tasks, the system prompt nudges the agent to persist what it learned as a skill.

### Skill Self-Improvement

The Curator (`agent/curator.py`) runs background maintenance:
- **Review loop**: When idle, spawns a forked `AIAgent` to review agent-created skills
- **Auto-transitions**: Skills move through `active → stale → archived` based on usage
- **Pinning**: Users can pin skills to exempt them from all auto-transitions
- **Backup**: `curator_backup.py` creates pre-run tar.gz snapshots
- **Never deletes** — max destructive action is archive; archives go to `~/.hermes/skills/.archive/`

During use, the agent can `patch` its own skills (`tools/file_operations.py` patch tool). Usage tracking (`tools/skill_usage.py`) records every use and triggers curator review when usage drops.

### agentskills.io Compatibility

The `tools/skills_hub.py` module provides `GitHubSource` that fetches skills from any GitHub repo via the Contents API — compatible with the [agentskills.io](https://agentskills.io) open standard. `OptionalSkillSource` handles the repo's own `optional-skills/` directory. Hub lock files track provenance of installed skills.

---

## 6. Multi-Platform Gateway

### Adapter Pattern

`gateway/platform_registry.py` defines `PlatformEntry`:
```python
@dataclass
class PlatformEntry:
    name: str                    # e.g. "irc", "viber"
    label: str                   # Human-readable
    adapter_factory: Callable    # Returns adapter instance
    check_fn: Callable           # Dep availability check
    validate_config: Optional[Callable]
    required_env: list[str]
    install_hint: str
```

Built-in platforms are the ones in `gateway/platforms/` — they use the legacy if/elif chain in `_create_adapter()` for now. Plugin platforms register via `PluginContext.register_platform()` and are looked up first.

### Base Platform Interface

`gateway/platforms/base.py` (5,623 lines) defines the `BasePlatform` ABC with methods for:
- `send_message()`, `send_media()`, `send_voice()`
- `handle_update()` — process incoming messages
- Message queuing (`_pending_messages`) when agent is actively processing
- Two sequential guards: base adapter queues when session active; gateway runner intercepts control commands

### How Channels Differ in Capabilities

- Telegram: voice notes, sticker cache, DM topics, inline buttons
- WhatsApp: read receipts, message reactions, media with captions
- Signal: end-to-end encryption, rate limiting (separate module `signal_rate_limit.py`)
- Discord: rich embeds, thread support, `/hermes` subcommand routing
- Slack: `/hermes` slash command, workspace-level installation
- WeChat (Weixin): Chinese platform auth, contact syncing
- QQ Bot: Chinese IM platform integration
- Yuanbao: Tencent's Yuanbao platform with sticker support
- Matrix: `formatted_body` with HTML rendering
- Email/SMS: text-only adapters
- REST API: programmatic access via HTTP

### Cross-Platform Conversation Continuity

The gateway maintains per-platform session state via `gateway/session.py`. Each platform maps to a `session_key` that ties into the `AIAgent` cache. The same agent instance handles a conversation across its lifetime within one platform. Cross-platform conversation continuity is a design goal but not yet fully implemented — the agent cache is per-platform.

### Voice Memo Handling

Voice memos are transcribed by the `transcription_provider.py` system (pluggable, similar to memory providers). Supported on platforms that natively support voice (Telegram, WhatsApp, Signal).

---

## 7. Terminal Backends

### Abstraction Layer

`tools/environments/base.py` defines `BaseEnvironment` ABC with core methods:

```python
class BaseEnvironment(ABC):
    @abstractmethod
    def execute(self, command, timeout=None, workdir=None, ...):
        """Run a command, return (returncode, stdout, stderr)"""
    
    def read_file(self, path):
        """Read file content via shell commands"""
    
    def write_file(self, path, content):
        """Write file content via shell commands"""
    
    def close(self):
        """Clean up resources"""
```

### Spawn-Per-Call Model

Every command spawns a fresh `bash -c` process. Session state is captured at init:
- **Env vars**: Snapshotted from the shell at init time
- **CWD**: Persists via in-band stdout markers (remote backends) or a temp file (local)
- **Re-sourcing**: Before each command, the captured env is re-injected

### What's Common vs What Differs

| Aspect | Local | Docker | SSH | Singularity | Modal | Daytona |
|--------|-------|--------|-----|-------------|-------|---------|
| Execution | `subprocess` | `docker exec` | `ssh` | `singularity exec` | Modal SDK | Daytona SDK |
| File access | Direct | `docker cp` | `scp` | Direct | Modal volume | Git + API |
| State model | Temp file | Docker volume | Remote filesystem | Temp file | Hibernation | Hibernation |
| Init cost | Zero | Container start | SSH connect | Image pull | Wake from idle | Wake from idle |
| CWD tracking | Temp file | Temp file | Stdout marker | Stdout marker | Stdout marker | Stdout marker |

### State Persistence Across Backend Switches

- Local: ephemeral — no persistence beyond the session
- Docker: container stops when session ends (unless configured otherwise)
- SSH: remote filesystem persists naturally
- Modal: serverless persistence — environment hibernates when idle, wakes on demand
- Daytona: dev environment persists between sessions

### Factory Selection

`tools/terminal_tool.py`'s `_create_environment()` selects the backend based on `TERMINAL_ENV` config. The factory uses a simple if/elif chain:
```python
def _create_environment():
    env_type = config.get("terminal", {}).get("env", "local")
    if env_type == "docker":
        return DockerEnvironment(config)
    elif env_type == "ssh":
        return SSHEnvironment(config)
    elif env_type == "singularity":
        return SingularityEnvironment(config)
    elif env_type == "modal":
        return ModalEnvironment(config)
    elif env_type == "daytona":
        return DaytonaEnvironment(config)
    else:
        return LocalEnvironment(config)
```

---

## 8. Provider / Model Routing

### Provider Abstraction

`providers/` provides a registry of `ProviderProfile` objects. Each profile contains:
- Name, aliases
- Base URL template
- API mode (chat_completions, codex_responses)
- Model list
- Context length defaults
- Pricing info

**Discovery** (`providers/__init__.py`):
1. Scan `plugins/model-providers/<name>/` (bundled plugins)
2. Scan `$HERMES_HOME/plugins/model-providers/<name>/` (user plugins)
3. Fall back to `providers/<name>.py` (legacy single-file profiles)

User plugins override bundled ones on name collision (last-writer-wins).

**Model-provider plugins** (`plugins/model-providers/`): Each calls `providers.register_provider(ProviderProfile(...))` at module load. Supported providers include openrouter, anthropic, gmi, deepseek, nvidia, and many others.

### What `hermes model` Does

`hermes_cli/models.py` — presents an interactive selection UI that:
1. Lists all registered providers from the provider registry
2. For each provider, shows available models
3. Sets the selected provider/model in config.yaml
4. Optionally configures API keys if missing

### Model Capability Detection

`agent/model_metadata.py` maintains context length tables per model. `estimate_messages_tokens_rough()` provides cheap token estimation. Provider-specific adapters (`agent/anthropic_adapter.py`, `agent/gemini_native_adapter.py`, etc.) handle API-format differences. The `codex_responses_adapter.py` handles OpenAI's Responses API mode.

### Fallback Chain

When a provider fails, Hermes tries fallback providers in order. The fallback chain is configured in `config.yaml` under `model.fallback`. Provider errors are classified by `agent/error_classifier.py` and the system retries with exponential backoff (`agent/retry_utils.py`).

---

## 9. Trajectory / Training Pipeline

### `batch_runner.py` — What It Does

Runs the agent in parallel across a dataset for training data generation:

1. Loads a dataset file (JSONL format with prompts)
2. For each prompt, creates an `AIAgent` and runs `run_conversation()`
3. Saves full trajectories (message sequences including tool calls/results)
4. Uses `multiprocessing.Pool` for parallelism
5. Checkpointing: saves progress every N prompts for fault-tolerant resumption
6. Tool usage statistics: aggregates tool call frequency across all batches
7. Toolset distributions: `toolset_distributions.py` allows sampling different tool combinations per prompt

Key parameters: `--dataset_file`, `--batch_size`, `--run_name`, `--resume`, `--distribution`

### How Trajectories Are Captured

`agent/trajectory.py` provides utilities for trajectory capture during `run_conversation()`. When `save_trajectories=True`, every message (user, assistant, tool) is logged to a JSONL file in the format:
```json
{"role": "user", "content": "..."}
{"role": "assistant", "content": "...", "tool_calls": [...]}
{"role": "tool", "content": "...", "tool_call_id": "..."}
```

### Compression for Training Data

`trajectory_compressor.py` post-processes trajectories:

1. **Protects** first turns (system + human + first assistant + first tool response)
2. **Protects** last N turns (final actions and conclusions)
3. **Compresses** middle turns only via LLM summarization
4. Replaces compressed region with a single human summary message
5. Keeps remaining tool calls intact

Target token budget configurable via `--target_max_tokens` (default 16K).

---

## 10. Long-Horizon Coding Capabilities

### Code Editing Tool

Uses the `patch` tool in `tools/file_operations.py` — **exact string replacement** (not AST-based):

```python
def patch(path: str, old_string: str, new_string: str, ...):
    """Find old_string in file, replace with new_string."""
```

Implemented as shell operations to work across all terminal backends. Uses `difflib` for unified diff generation.

### File Operations

- `read_file(path)` — reads files via terminal backend
- `write_file(path, content)` — writes files via terminal backend
- `search_files(pattern, path, file_glob)` — grep-like search with regex support
- `read_file` handles binary files with `BINARY_EXTENSIONS` detection
- Write deny-list prevents overwriting sensitive system files

### Code Search/Grep Integration

`search_files` in `tools/file_operations.py` wraps `grep`/`rg` through the terminal backend:
- Regex pattern matching
- File glob filtering
- Path restriction
- Works across all terminal backends (local, Docker, SSH, etc.)

### Test Running

The agent can run tests via the `terminal` tool. For the repo's own tests, `scripts/run_tests.sh` enforces CI-parity (credential isolation, UTC timezone, subprocess isolation per test file).

### Git Workflow

Git operations go through the `terminal` tool (raw shell commands). There is no dedicated git tool — the model runs `git` commands through the terminal backend. The `patch` tool + `terminal` tool together form the long-horizon coding loop: search → read → edit → test → commit.

### PR Creation

No dedicated PR-creation tool. The agent uses:
1. `terminal` for `gh pr create` or `git push`
2. Can be guided by skills (e.g., `github` skill provides PR workflow)

---

## 11. Observability & Debugging

### Logging

`hermes_logging.py` — `setup_logging()` creates three profile-aware log files:

| File | Level | Purpose |
|------|-------|---------|
| `agent.log` | INFO+ | Agent conversation and tool calls |
| `errors.log` | WARNING+ | Errors and warnings |
| `gateway.log` | INFO+ | Gateway lifecycle and message routing |

Logs are stored in `~/.hermes/logs/` (profile-aware via `get_hermes_home()`). The `hermes logs` command browses logs with `--follow`, `--level`, `--session` options.

### Trace / Replay

- Trajectories saved by `batch_runner.py` serve as replay logs
- `hermes_state.py` session store preserves full message history with timestamps
- No dedicated replay UI exists in the codebase

### Token Usage Tracking

- `agent/usage_pricing.py` — `estimate_usage_cost()` and `normalize_usage()`
- `agent/credits_tracker.py` — tracks token credits
- `agent/billing_view.py` — billing display helpers
- `agent/account_usage.py` — `fetch_account_usage()` for provider API usage
- Gateway: `gateway/run.py` wires `/usage` slash command to `fetch_account_usage()`
- Portal: `hermes_cli/nous_billing.py` — Nous Portal billing integration

---

## 12. Security Model

### Tool Approval Gates

`tools/approval.py` — two approval flows:

- **Prompt approval** (`prompt_dangerous_approval()`) — shown for dangerous terminal commands (detected via pattern matching in `tools/terminal_tool.py`). In CLI mode, prompts the user; in gateway mode, queues for approve/deny via `tools/approval.py`'s per-session queue
- **Write approval** (`tools/write_approval.py`) — shown for dangerous file writes

### Sensitive Action Confirmation

- **Subagent default**: `_subagent_auto_deny` — auto-denies dangerous commands in subagent threads
- **Opt-in YOLO**: `delegation.subagent_auto_approve: true` — auto-approves
- **Clarify tool**: `tools/clarify_tool.py` — the agent can ask clarifying questions when uncertain
- **Secret prompt**: `tools/clarify_tool.py` supports sudo-style secret entry

### Provider Auth Handling

- API keys go in `~/.hermes/.env` (secrets only — not `config.yaml`)
- `hermes_cli/env_loader.py` — loads .env from HERMES_HOME
- `hermes_cli/config.py` — `OPTIONAL_ENV_VARS` dict with metadata for each key (description, prompt text, URL)
- `hermes setup` wizard collects and saves API keys
- `tools/credential_files.py` — credential file management
- `tools/credential_pool.py` — credential pooling for multi-provider routing
- `tools/path_security.py` — path traversal protection
- `gateway/pairing.py` — DM pairing for gateway security

### Additional Security Layers

- **Prompt injection scanning**: `tools/threat_patterns.py` — shared scanner used by `prompt_builder.py` for context files and by tool result processing
- **Website policy**: `tools/website_policy.py` — URL access policy enforcement
- **URL safety**: `tools/url_safety.py` — URL validation and safety checks
- **File safety**: `agent/file_safety.py` — write-path deny lists based on profile-aware HOME paths
- **TIRITH security**: `tools/tirith_security.py` — policy-as-code security framework for Hermes
- **Hadolint**: `.hadolint.yaml` — Dockerfile linting configuration
- **Secret scope**: `agent/secret_scope.py` — secret scoping for provider credentials
- **Gateway auth**: `gateway/authz_mixin.py` — authorization mixin for gateway operations
- **SSH security**: `gateway/cwd_placeholder.py` — CWD interpolation safety

---

## Summary of Unique Architectural Choices

1. **Prompt caching as hard constraint** — everything is designed to keep the system prompt byte-stable; skills are injected as user messages, not system prompt mutations
2. **Narrow waist core with expansive edges** — the `AIAgent` class is intentionally minimal; all capability lives in tools, plugins, and skills
3. **Spawn-per-call terminal model** — simpler and more portable than persistent shell sessions; CWD tracking via stdout markers is clever
4. **AST-based tool discovery** — avoids fragile import lists; `_module_registers_tools()` using Python AST is a unique approach
5. **Fork-based curation** — the Curator spawns a full `AIAgent` fork rather than using the main session's context
6. **Self-improving skills** — the combination of skill creation → usage tracking → curator review → archive is a complete lifecycle management system
7. **Six backend abstraction for terminal** — unique in agent systems; most agents only support local execution
8. **Plugin system with 3 discovery paths** — filesystem, pip entry points, and git-based hub install
