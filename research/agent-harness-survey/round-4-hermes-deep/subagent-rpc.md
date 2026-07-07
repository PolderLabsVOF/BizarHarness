# Hermes Agent — Round 4 Deep Dive: Subagent Delegation & the "Zero-Context-Cost" RPC Pattern

**Scope.** How Hermes spawns subagents, the thread-pool + lifecycle machinery, the tool firewall that keeps children from touching user-facing surfaces, the two shapes (single and batch) and their result-pipeline, the orchestrator role, the `execute_code` PTC (Programmatic Tool Calling) RPC, and how subagents survive a multi-hour parent turn. Verified against `repos/hermes-agent/` at the captured snapshot (commit `8301654 fix(web): refresh dashboard model picker`).

**Author:** @tyr (round-4 hermes-deep). **Date:** 2026-07-06.

---

## 0. Two Different "RPC" Meanings

Hermes uses the word "RPC" in **two distinct senses** that the R1-R3 reports conflate. This document disambiguates them up front:

| Sense | Where | What it is |
|---|---|---|
| **RPC #1 — subagent delegation** | `tools/delegate_tool.py` | One `AIAgent` calls another `AIAgent`. The "RPC" framing here is loose: it's just a Python function call that blocks the parent on the child's full result, mediated by `ThreadPoolExecutor`/`DaemonThreadPoolExecutor`. There's no network protocol. |
| **RPC #2 — Programmatic Tool Calling (PTC)** | `tools/code_execution_tool.py` | The parent generates a `hermes_tools.py` stub module with RPC stub functions, spawns a child process, and tool calls travel back to the parent over **Unix domain socket (local)** or **request/response files (remote backends)**. The parent dispatches the tool call through `handle_function_call` and returns the result. The LLM sees only the script's stdout. This is the genuine RPC, and this is what the README means by "zero-context-cost turns". |

The README's exact wording: "Spawn isolated subagents for parallel workstreams. **Write Python scripts that call tools via RPC, collapsing multi-step pipelines into zero-context-cost turns.**" (`README.md:28`) — the "RPC" here is **#2 (PTC)**, not #1 (delegation). The R2/R3 reports sometimes called #1 the "RPC" pattern; that's a misnomer. Both are documented below.

---

## 1. Subagent Lifecycle

### 1.1 The `delegate_task` tool

`delegate_task` is the only entry point for subagent delegation. Registered in `tools/delegate_tool.py:3429-3445`:

```python
registry.register(
    name="delegate_task",
    toolset="delegation",
    schema=DELEGATE_TASK_SCHEMA,
    handler=lambda args, **kw: delegate_task(
        goal=args.get("goal"),
        context=args.get("context"),
        tasks=_strip_model_hidden_task_fields(args.get("tasks")),
        max_iterations=args.get("max_iterations"),
        role=args.get("role"),
        background=_model_background_value(args, kw.get("parent_agent")),
        parent_agent=kw.get("parent_agent"),
    ),
    check_fn=check_delegate_requirements,
    emoji="🔀",
    dynamic_schema_overrides=_build_dynamic_schema_overrides,
)
```

The `dynamic_schema_overrides` is the load-bearing detail: the schema description is rebuilt on every `get_definitions()` call (`delegate_tool.py:101-124, _build_top_level_description / _build_tasks_param_description`) so the model sees the current `max_concurrent_children` / `max_spawn_depth` values in the schema text, and the cache key is config.yaml mtime + size. A stale config that says "max 3 children" doesn't leak the wrong number into a future prompt.

### 1.2 Two modes

**Single mode** (`delegate_task.py:2348-2350`):

```python
delegate_task(goal="...", context="...", role="leaf"|"orchestrator")
```

**Batch mode** (`delegate_task.py:2342-2351`):

```python
delegate_task(tasks=[
    {"goal": "Implement X", "context": "in /foo"},
    {"goal": "Write tests for X", "context": "in /foo"},
    {"goal": "Document X", "context": "in /foo"},
])
```

The `tasks` form is the parallel-fan-out form. The `goal` form is the single-delegation form. **Both routes go through the same `delegate_task` function** (`delegate_tool.py:2438-2451`):

```python
if tasks and isinstance(tasks, list):
    if len(tasks) > max_children:
        return tool_error(f"Too many tasks: {len(tasks)} provided, but max_concurrent_children is {max_children}...")
    task_list = tasks
elif goal and isinstance(goal, str) and goal.strip():
    task_list = [{"goal": goal, "context": context, "role": top_role}]
else:
    return tool_error("Provide either 'goal' (single task) or 'tasks' (batch).")
```

The hard cap of `max_concurrent_children` (default 3) applies to both modes (`delegate_tool.py:2439-2446`).

### 1.3 Depth limit (flat by default)

`max_spawn_depth` (default 1 = flat) is the only depth control (`delegate_tool.py:467-503, 2387-2402`):

```python
depth = getattr(parent_agent, "_delegate_depth", 0)
max_spawn = _get_max_spawn_depth()
if depth >= max_spawn:
    return json.dumps({"error": f"Delegation depth limit reached (depth={depth}, max_spawn_depth={max_spawn})..."})
```

Default behavior: a parent (depth 0) spawns children at depth 1. Depth-1 children cannot spawn (blocked by this guard AND, for leaf children, by the toolset strip in `_strip_blocked_tools`). Raise `max_spawn_depth` to 2+ to unlock nested orchestration.

The `role="orchestrator"` opt-in (`delegate_tool.py:506-520, 766-786`) re-enables `delegate_task` for depth-1 children so they can spawn their own workers. The orchestrator role is gated by `delegation.orchestrator_enabled` (default true), with `delegation.max_spawn_depth` as the upper bound.

### 1.4 ThreadPoolExecutor vs DaemonThreadPoolExecutor

**Synchronous batch** uses `tools/daemon_pool.DaemonThreadPoolExecutor` (`delegate_tool.py:2534-2538`):

```python
from tools.daemon_pool import DaemonThreadPoolExecutor
with DaemonThreadPoolExecutor(max_workers=max_children) as executor:
    futures = {}
    for i, t, child in children:
        future = executor.submit(
            _run_single_child,
            task_index=i, goal=t["goal"], child=child, parent_agent=parent_agent,
        )
        futures[future] = i
    pending = set(futures.keys())
    while pending:
        if getattr(parent_agent, "_interrupt_requested", False) is True:
            # Parent interrupted — collect whatever finished and abandon
            for f in pending:
                ...
            break
        from concurrent.futures import wait as _cf_wait, FIRST_COMPLETED
        done, pending = _cf_wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
        for future in done:
            entry = future.result()
            results.append(entry)
            completed_count += 1
            ...
```

`DaemonThreadPoolExecutor` (the project's homegrown variant in `tools/daemon_pool.py`) is preferred over stdlib `concurrent.futures.ThreadPoolExecutor` for one reason: **timed-out or abandoned children must not block interpreter exit at atexit-join time** (`delegate_tool.py:1892-1894`): "a stdlib non-daemon worker would then block interpreter exit at atexit-join time if the child never unwinds." Daemon threads are abandoned on exit; the stdlib pool's workers would block shutdown.

**Asynchronous dispatch** (background=true) uses a module-level persistent daemon executor (`tools/async_delegation.py:63-93`):

```python
_executor: Optional[ThreadPoolExecutor] = None
_executor_max_workers: int = 0

def _get_executor(max_workers: int) -> ThreadPoolExecutor:
    global _executor, _executor_max_workers
    with _executor_lock:
        if _executor is None or max_workers > _executor_max_workers:
            _executor = _DaemonThreadPoolExecutor(
                max_workers=max_workers,
                thread_name_prefix="async-delegate",
            )
            _executor_max_workers = max_workers
        return _executor
```

The pool is never shrunk (`ThreadPoolExecutor` can't resize) but is grown when the configured cap changes. Background results re-enter the conversation through the `process_registry.completion_queue` — a separate drain (CLI `process_loop`, gateway `_run_process_watcher`) polls the queue while the agent is idle and forges a new user/internal turn per event. **Critically**: completions surface as a fresh turn, never spliced between a tool result and an assistant message — strict message-role alternation is preserved, prompt cache stays intact (`async_delegation.py:17-19`).

### 1.5 Why ThreadPoolExecutor and not asyncio or multiprocessing

- **asyncio**: AIAgent's loop is synchronous. The model call blocks. Making the model-call async would force every tool to be async-aware. Not worth the API surface.
- **multiprocessing**: AIAgent's state (~60 constructor parameters, conversation history, tool registry, memory providers) is not picklable. Spinning a child means a fresh interpreter, which loses the in-process `file_state` registry, the process registry, the LLM provider pool, etc. Process boundary would break the file-state coordination.
- **ThreadPoolExecutor (or DaemonThreadPoolExecutor)**: one process, many threads. Children get their own `AIAgent` instance, their own message list, their own `task_id`, but share the process's `file_state` registry, `process_registry`, the loaded memory providers, and the loaded tool registry. That's the right granularity.

### 1.6 The `_run_single_child` body

`delegate_tool.py:1719-2317`. Per child, before any agent.run_conversation:

1. **Save the parent's resolved tool names** (`delegate_tool.py:1739-1741`): the child construction mutates the global `_last_resolved_tool_names`; the parent needs to restore it after.
2. **Credential leasing** (`delegate_tool.py:1743-1753`): if the child has its own credential pool, lease one. The same `CredentialPool` is used to share rate limits across the parent's children and grandchildren.
3. **Heartbeat thread** (`delegate_tool.py:1755-1835`): every `_HEARTBEAT_INTERVAL=30s` (line 605), the thread calls `parent._touch_activity("delegate_task: subagent …")` so the gateway's inactivity timeout doesn't fire while the parent is blocked on `delegate_task`. Includes stale-detection: a child that hasn't advanced iteration or changed `current_tool` for `_HEARTBEAT_STALE_CYCLES_IDLE=15` cycles (idle) or `_HEARTBEAT_STALE_CYCLES_IN_TOOL=40` cycles (in-tool) stops heartbeating so the gateway can fire its timeout on a truly wedged child.
4. **TUI registration** (`delegate_tool.py:1838-1864`): the child is registered in `_active_subagents` with `subagent_id`, `parent_id`, `depth`, `goal`, `model`, `started_at`, `status`, `tool_count`, `agent` so the TUI can show / target it.
5. **Run on a per-call DaemonThreadPoolExecutor with a 1-slot pool** (`delegate_tool.py:1894-1903`): the child runs in its own daemon worker thread. The approval callback (`_get_subagent_approval_callback()`) is installed into the worker thread's `threading.local` to prevent the dead-lock described at `delegate_tool.py:62-67`: "The CLI's interactive approval callback is stored in tools/terminal_tool.py's threading.local(), so worker threads do NOT inherit it. Without a callback, prompt_dangerous_approval() falls back to input() from the worker thread, which deadlocks against the parent's prompt_toolkit TUI that owns stdin."
6. **Result extraction** (`delegate_tool.py:1919-2317`): after the child's `run_conversation()` returns, the code:
   - Pulls the conversation tail for the TUI's output panel (`_extract_output_tail`)
   - Invokes the child's LLM to produce a summary (or, if a `summary` field is already on the result, uses it directly)
   - Computes per-result budget via `_parent_summary_char_budget` and applies it via `_apply_summary_budget` (line 1624-1717) so N children can't collectively blow the parent's context window
   - Computes the file-state reminder: "subagent X modified files the parent previously read" (using `file_state.writes_since` — see `coding-backends.md` §7)
   - Builds the structured result dict: `{status, summary, error, output, api_calls, duration_seconds, _child_role, _writes_by_sibling}`

### 1.7 The interrupt path

`delegate_tool.py:152-202`: `set_spawn_paused` is a TUI-driven global kill switch. `interrupt_subagent(subagent_id)` calls `agent.interrupt(reason)`, which sets `AIAgent._interrupt_requested` and propagates into the child's tool calls. The heartbeat thread detects and stops heartbeating so the gateway timeout can fire on a truly wedged child.

`_interrupt_requested` is also checked in the batch dispatch's polling loop (`delegate_tool.py:2561-2596`): on parent interrupt, in-flight futures are collected as `status="interrupted"` and the rest are abandoned with `"Parent agent interrupted — child did not finish in time"`. The children themselves receive the interrupt signal via `agent.interrupt()`; we just can't wait forever.

---

## 2. DELEGATE_BLOCKED_TOOLS — The Tool Firewall

`tools/delegate_tool.py:44-54`:

```python
DELEGATE_BLOCKED_TOOLS = frozenset([
    "delegate_task",   # no recursive delegation (orchestrator opt-in re-enables)
    "clarify",         # no user interaction
    "memory",          # no writes to shared MEMORY.md
    "send_message",    # no cross-platform side effects
    "execute_code",    # children should reason step-by-step, not write scripts
    "cronjob",         # no scheduling more work in the parent's name
])
```

**Six tools, six reasons, structurally enforced** (`delegate_tool.py:21-23` docstring): "The parent's context only sees the delegation call and the summary result, never the child's intermediate tool calls or reasoning."

The toolset strip happens in `_strip_blocked_tools` (`delegate_tool.py:766-786`):

```python
def _strip_blocked_tools(toolsets: List[str]) -> List[str]:
    """Strip DELEGATE_BLOCKED_TOOLS from the child toolset."""
    ...
```

For `role="orchestrator"`, `delegate_task` is re-added so depth-1 orchestrators can spawn their own workers (`delegate_tool.py:114-116`):

> NOTE: nested delegation is granted by role='orchestrator' (which re-adds the "delegation" toolset in _build_child_agent), NOT by the model naming toolsets — the model has no toolsets argument. Subagents inherit the parent's toolsets.

The model cannot choose or narrow its own toolset — the `toolsets` parameter is intentionally absent from the model-visible schema (the `_MODEL_HIDDEN_TASK_FIELDS` filter at `delegate_tool.py:3407-3426` strips `acp_command` / `acp_args` from any `tasks` array). Subagents inherit the parent's toolsets, period.

### 2.1 The runtime approval override

`delegate_tool.py:60-99`:
- Default (`delegation.subagent_auto_approve: false`): `_subagent_auto_deny` returns `"deny"` for any dangerous command in a subagent thread. The subagent sees a refusal it can recover from.
- Opt-in YOLO (`delegation.subagent_auto_approve: true`): `_subagent_auto_approve` returns `"once"` so the subagent proceeds without blocking the parent.

Both callbacks are installed into the worker thread via `ThreadPoolExecutor(initializer=…)` to prevent the input() deadlock.

### 2.2 Why these specific tools

- **`delegate_task`** (without orchestrator opt-in): prevents runaway fan-out. The model can't accidentally call `delegate_task` from within a delegation.
- **`clarify`**: prevents the subagent from asking the user a question. The user is talking to the parent; mid-delegation user prompts would be a context-window hazard.
- **`memory`**: prevents the subagent from polluting the parent's MEMORY.md. Memory writes go through the parent only.
- **`send_message`**: prevents the subagent from sending a Telegram/Discord/Slack message. The gateway surfaces are parent-controlled.
- **`execute_code`**: this is the load-bearing one. Subagents are reasoned to be "leaf workers" — they should call `read_file` / `patch` / `search_files` / `terminal` directly, not write a Python script that calls those tools via RPC. Why? Because `execute_code` collapses multi-step pipelines into "zero-context-cost turns" — but the child's context is ALREADY isolated from the parent's. Adding `execute_code` to the child would let the child ALSO collapse its own multi-step pipelines, hiding intermediate work from the LLM trace. The leaf-worker assumption is that a child should be a visible, auditable work-doer, not a black-box script runner.
- **`cronjob`**: prevents the subagent from scheduling future work in the parent's name.

### 2.3 Per-task and per-delegation credentials

`delegate_tool.py:2891-3098` `_resolve_delegation_credentials` / `_resolve_child_credential_pool`: when `delegation.provider` is configured in config.yaml, the child uses a different provider/model than the parent. The credential resolution goes through the same `RuntimeProvider` system used by CLI startup. When unconfigured, the child inherits the parent's credentials (and the parent's CredentialPool for rate-limit sharing).

The default is **inherit**, not override. Most users run parent and child on the same provider.

---

## 3. Batch and Parallel Modes

### 3.1 What's different between single and batch

Functionally, both are the same — single is N=1 batch. The only difference is overhead:

- **Single** (`delegate_tool.py:2524-2528`): run directly, no thread pool:

```python
if n_tasks == 1:
    _i, _t, child = children[0]
    result = _run_single_child(_i, _t["goal"], child, parent_agent)
    results.append(result)
```

- **Batch** (`delegate_tool.py:2529-2639`): use `DaemonThreadPoolExecutor(max_workers=max_children)`, submit all children, join via `wait(FIRST_COMPLETED, timeout=0.5)` in a poll loop. The 0.5s timeout lets the loop check `_interrupt_requested` and the heartbeat thread.

### 3.2 Concurrency cap

`_get_max_concurrent_children` (`delegate_tool.py:354-392`): default 3, floor 1, no upper ceiling. The value > 10 emits a one-time warning about API token cost (`_HIGH_CONCURRENCY_WARNED` guard at line 124, 369-376).

The same cap governs both synchronous batch and async background dispatch (`_get_max_async_children` at `delegate_tool.py:398-422` returns `_get_max_concurrent_children()` — a `max_async_children` config key, if present, is deprecated and the unified `max_concurrent_children` is used instead).

For async dispatch, the cap is enforced at dispatch time (`async_delegation.py:182-198`):

```python
with _records_lock:
    running = sum(1 for r in _records.values() if r.get("status") == "running")
    if running >= max_async_children:
        return {
            "status": "rejected",
            "error": f"Async delegation capacity reached ({max_async_children} running). ..."
        }
```

The capacity check and record insert are under one lock hold so two concurrent dispatches can't both pass the check and exceed the cap. **A rejected async dispatch returns the error to the model, which is expected to fall back to `background=false` (synchronous).**

### 3.3 Result pipeline

Per child, the result is:

```python
{
    "task_index": int,
    "status": "completed" | "interrupted" | "error",
    "summary": str,                    # LLM-generated summary (default) or the child's final text
    "error": str | None,
    "output": str | None,              # detailed output, if any
    "api_calls": int,
    "duration_seconds": float,
    "_child_role": "leaf" | "orchestrator",
    # Cross-agent file state reminder (added by _run_single_child):
    "_writes_by_sibling": Dict[str, List[str]],   # writer_task_id -> [paths]
}
```

The summary budget math (`_parent_summary_char_budget` at `delegate_tool.py:1624-1717`):
- Each child gets a budget of `parent_remaining_headroom * 0.5 / n_summaries` (the `_SUMMARY_HEADROOM_FRACTION` constant at line 595)
- Floor: `_MIN_SUMMARY_CHARS = 2000` (line 598) so a single summary always has a usable slice
- Hard ceiling: `DEFAULT_MAX_SUMMARY_CHARS = 24000` (line 590), layered on top of the dynamic headroom
- Over the budget: `_trim_summary_with_footer` (line 1569-1622) trims with a "this summary was truncated" footer

This budget is the structural reason N children can't collectively blow the parent's context window. The compression/429 death-spiral in issue/PR #9126 was specifically this.

### 3.4 What the parent sees in context

Only:
1. The `delegate_task` tool call itself (`goal`, `context`, `tasks`)
2. The aggregated result JSON: array of `{status, summary, error, output, ...}` per task

The child agent's intermediate tool calls, reasoning, and the LLM stream are NOT in the parent's context. The parent sees the summary text, not the chain of read/patch/terminal calls that produced it.

### 3.5 When the agent uses which

**Single mode**: when there's a single sub-task, or when the sub-task must finish before the parent can continue (synchronous block).

**Batch mode**: when the agent has identified multiple independent work streams and wants to parallelize them. Classic use cases: "implement the feature, write tests, update the docs" — three independent tracks that don't need each other's intermediate output.

**Async (background=true)**: when the work is so long that the user shouldn't wait. The pattern: spawn with `background=true, notify_on_complete=true`, continue with other work, the completion re-enters the conversation as a fresh turn when the work finishes. Useful for "start a long test suite and let me know when it passes" or "research topic X, I'll work on Y in the meantime."

---

## 4. Subagent Context Isolation

### 4.1 Each child has its own AIAgent instance

`_build_child_agent` (`delegate_tool.py:1044-1400`) constructs a fresh `AIAgent` for each child. The constructor takes ~60 parameters; the child gets:
- Its own `messages` list (the OpenAI-format message log)
- Its own `task_id` (a stable `subagent-<index>-<uuid>`) so file-state tracking, the active-subagents registry, and TUI events all share one key
- Its own terminal session (because `_resolve_container_task_id` collapses to "default" by default — but the `task_id` field is still used for `_active_environments` and `file_state` lookups)
- Its own `model`, `provider`, `api_key`, `base_url`, `api_mode` (inherited from the parent, or overridden via `delegation.provider`)
- Its own `iteration_budget` (fresh, not shared with the parent)
- Its own `max_iterations` (50 default, from `delegation.max_iterations`)

### 4.2 Toolset inheritance vs. narrowing

**Children inherit the parent's toolsets by default** (`delegate_tool.py:2493-2494`):

> Subagents always inherit the parent's toolsets; the model cannot choose or narrow them (no model-facing toolsets arg).

The model has no way to request "I want only `terminal` for this child." Children are full-fidelity mirrors of the parent minus the `DELEGATE_BLOCKED_TOOLS` strip (and the orchestrator opt-in re-add of `delegate_task`).

`_expand_parent_toolsets` (`delegate_tool.py:544-572`) handles the case where the parent uses a composite toolset like `hermes-cli` (which bundles all core tools) and a child needs to verify individual toolset names like `web` or `terminal`. The helper collects the tool names from each parent toolset, then adds the names of any individual toolsets whose tools are a subset.

### 4.3 Memory shared or isolated

**Memory is shared** (in the sense that the parent's memory providers see both parent and child turns) but **writes are gated**:

- The `memory` tool is in `DELEGATE_BLOCKED_TOOLS`, so the child cannot directly call `memory`.
- The child's turns are still passed to `MemoryManager.sync_turn()` in the agent loop (`hermes_state.py:Sync` is per-session, but a child gets its own session_id).
- The parent sees the child's turns when the summary is returned; if the summary includes content the parent decides is memory-worthy, the parent writes to memory.

So memory writes are parent-decided, not child-driven. The subagent's intermediate discoveries are visible in the summary; the parent can choose what to persist.

### 4.4 Per-subagent session in the SQLite store

`hermes_state.py:SessionDB` stores every session with a `session_id`. The child gets a derived session_id (e.g. `subagent-<idx>-<uuid>`). The SQLite store is shared across the process — child sessions are visible to `session_search` and the parent can see them on `/resume`. The `parent_session_id` linkage allows the parent's view to "look through" into child sessions if needed (`hermes_state.py:1959, 2012, 2025, 3936-3971 resolve_resume_session_id`).

### 4.5 The cross-agent file-state registry

**This is where subagent isolation gets interesting.** `tools/file_state.py` is a process-wide singleton that tracks:

- Per-task read stamps: `{task_id: {path: (mtime, read_ts, partial)}}`
- Per-path last writer globally: `{path: (task_id, write_ts)}`
- Per-path `threading.Lock` for read→modify→write critical sections

When a child writes a file, `note_write(task_id, path)` records it. When the parent (or another child) tries to write the same path, `check_stale(parent_task_id, path)` returns a warning: "X was modified by sibling subagent Y at T — after this agent's last read at T. Re-read the file before writing."

The reminder surfaces in the result dict: `_writes_by_sibling` (computed by `file_state.writes_since` at `delegate_tool.py:1883-1885`). The parent agent can choose to re-read the modified file before continuing.

**The use case this solves**: imagine parent A reads `/foo.py`, then delegates two subagents to also work on `/foo.py`. Subagent B writes a fix; subagent C doesn't see the fix and writes a different one. Without `file_state`, the parent's next write would silently clobber one of the two. With `file_state`, both children are warned when they read, and the parent is reminded when it next writes.

(See `coding-backends.md` §7 for the full file-state design.)

---

## 5. Subagent Failure Recovery

### 5.1 Child crash

The `DaemonThreadPoolExecutor` worker thread is a daemon, so a Python exception that escapes `_run_single_child` is caught and the future's `.result()` raises the exception. The batch dispatch loop (`delegate_tool.py:2603-2620`) catches it:

```python
try:
    entry = future.result()
except Exception as exc:
    idx = futures[future]
    entry = {
        "task_index": idx,
        "status": "error",
        "summary": None,
        "error": str(exc),
        "api_calls": 0,
        "duration_seconds": 0,
        "_child_role": getattr(_child_by_index.get(idx), "_delegate_role", None),
    }
results.append(entry)
```

The parent sees the child's error in the result dict and can recover: re-dispatch with `replace_all=True`-style retry logic, or escalate to the user.

### 5.2 Stuck child (no API progress)

The heartbeat staleness monitor (`delegate_tool.py:1787-1815`): every 30s, the heartbeat thread checks the child's `(current_tool, api_call_count)`. If neither advances for `_HEARTBEAT_STALE_CYCLES_IDLE=15` (idle between turns) or `_HEARTBEAT_STALE_CYCLES_IN_TOOL=40` (running a long tool), the heartbeat stops touching the parent's activity. The gateway's inactivity timeout then fires on the parent, which interrupts the parent (and recursively the child via `AIAgent.interrupt()`).

This is a **fail-open** strategy: a wedged child doesn't get a special hard-kill; it makes the gateway think the whole agent is wedged, which interrupts cleanly.

The child_timeout (off by default, opt-in via `delegation.child_timeout_seconds`) is the explicit hard cap (`delegate_tool.py:425-464`). Floor 30s; 0 or negative disables. The default is "no timeout" because the comment at line 435-440 says it explicitly:

> Subagents doing legitimate heavy work (deep code review, large research fan-outs, slow reasoning models) were routinely killed mid-task by the old blanket cap even though they were making steady progress. Failures should come from what the child is actually doing — API errors, tool errors, iteration budget — not from a generic delegation-level stopwatch.

### 5.3 Partial output handling

A child that exits with `status="interrupted"` (parent interrupted) or `status="error"` (exception) still gets an entry in the results array. The result includes whatever summary the child managed to produce (truncated by the summary budget if needed), the error, and the cross-agent file-state reminder.

A child that times out via `child_timeout_seconds` (when set) is also marked. The `_run_single_child` doesn't explicitly catch `TimeoutError` from the future — the future's `result(timeout=...)` raises it, and the dispatch loop catches it (`delegate_tool.py:2606-2620`).

### 5.4 Retry logic

Hermes does **not** have automatic retry of failed subagents. The parent agent sees the error in the result dict and decides whether to re-dispatch. The design intent: retries with the same goal are likely to fail the same way; the parent should adjust the goal/context based on what it learned.

The skill content can encode retry patterns — e.g. "if subagent fails with X, dispatch with a different framing" — but the system itself is stateless across child invocations.

---

## 6. The "Zero-Context-Cost" RPC — Programmatic Tool Calling

The genuine RPC. `tools/code_execution_tool.py` (1,910 lines) is the implementation.

### 6.1 What it is

From `tools/code_execution_tool.py:1-29` docstring:

> Lets the LLM write a Python script that calls Hermes tools via RPC, collapsing multi-step tool chains into a single inference turn.
>
> Architecture (two transports):
>
>   **Local backend (UDS):**
>   1. Parent generates a `hermes_tools.py` stub module with UDS RPC functions
>   2. Parent opens a Unix domain socket and starts an RPC listener thread
>   3. Parent spawns a child process that runs the LLM's script
>   4. Tool calls travel over the UDS back to the parent for dispatch
>
>   **Remote backends (file-based RPC):**
>   1. Parent generates `hermes_tools.py` with file-based RPC stubs
>   2. Parent ships both files to the remote environment
>   3. Script runs inside the terminal backend (Docker/SSH/Modal/Daytona/etc.)
>   4. Tool calls are written as request files; a polling thread on the parent
>      reads them via env.execute(), dispatches, and writes response files
>   5. The script polls for response files and continues
>
> In both cases, only the script's stdout is returned to the LLM; intermediate
> tool results never enter the context window.

This is the **README's "zero-context-cost turns"** claim. The LLM writes one tool call (`execute_code` with a script), the script makes N tool calls via RPC, and the LLM sees only the script's stdout. The N intermediate tool results are NOT in the LLM's context.

### 6.2 The seven allowed tools in the sandbox

`code_execution_tool.py:62-70`:

```python
SANDBOX_ALLOWED_TOOLS = frozenset([
    "web_search",
    "web_extract",
    "read_file",
    "write_file",
    "search_files",
    "patch",
    "terminal",
])
```

The intersection of these and the session's enabled tools determines which stubs are generated. `delegate_task`, `memory`, `send_message`, `clarify`, `cronjob`, and `compute_kb_search` are **deliberately excluded** — the sandbox can do mechanical data processing, not user interaction or side effects.

### 6.3 The local UDS RPC server

`code_execution_tool.py:487-620` `_rpc_server_loop` runs on a thread in the parent process:

```python
def _rpc_server_loop(server_sock, task_id, tool_call_log, tool_call_counter,
                     max_tool_calls, allowed_tools, stop_event, rpc_token):
    from model_tools import handle_function_call

    conn = None
    try:
        server_sock.settimeout(0.05)
        while not stop_event.is_set():
            try:
                conn, _ = server_sock.accept()
                break
            except socket.timeout:
                continue
        if conn is None:
            return
        conn.settimeout(300)

        buf = b""
        while True:
            try:
                chunk = conn.recv(65536)
            except socket.timeout:
                break
            if not chunk:
                break
            buf += chunk

            # Process all complete newline-delimited messages in the buffer
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    request = json.loads(line.decode())
                except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                    resp = tool_error(f"Invalid RPC request: {exc}")
                    conn.sendall((resp + "\n").encode())
                    continue

                if not rpc_token or not secrets.compare_digest(
                    str(request.get("token") or ""), rpc_token
                ):
                    resp = json.dumps({"error": "Unauthorized RPC request"})
                    conn.sendall((resp + "\n").encode())
                    continue

                tool_name = request.get("tool", "")
                tool_args = request.get("args", {})

                # Enforce the allow-list
                if tool_name not in allowed_tools:
                    ...

                # Enforce tool call limit
                if tool_call_counter[0] >= max_tool_calls:
                    ...

                # Strip forbidden terminal parameters
                if tool_name == "terminal" and isinstance(tool_args, dict):
                    for param in _TERMINAL_BLOCKED_PARAMS:
                        tool_args.pop(param, None)
                    # _TERMINAL_BLOCKED_PARAMS = {"background", "pty", "notify_on_complete", "watch_patterns"}

                # Dispatch through the standard tool handler.
                try:
                    _real_stdout, _real_stderr = sys.stdout, sys.stderr
                    devnull = open(os.devnull, "w", encoding="utf-8")
                    try:
                        sys.stdout = devnull
                        sys.stderr = devnull
                        result = handle_function_call(
                            tool_name, tool_args, task_id=task_id
                        )
                    finally:
                        sys.stdout, sys.stderr = _real_stdout, _real_stderr
                        devnull.close()
                except Exception as exc:
                    result = tool_error(str(exc))

                tool_call_counter[0] += 1
                call_duration = time.monotonic() - call_start
                tool_call_log.append({
                    "tool": tool_name,
                    "args_preview": str(tool_args)[:80],
                    "duration": round(call_duration, 2),
                })

                conn.sendall((result + "\n").encode())
    ...
```

The server:

1. Accepts one client connection.
2. Reads newline-delimited JSON requests.
3. Validates the `rpc_token` (a 32-byte `secrets.token_urlsafe(32)` per `execute_code` invocation) using `secrets.compare_digest` (constant-time, to prevent timing side-channels).
4. Enforces the `allowed_tools` allow-list.
5. Enforces the per-invocation `max_tool_calls` cap (default 50).
6. Strips `background`, `pty`, `notify_on_complete`, `watch_patterns` from `terminal` calls so the sandbox can't escape the foreground-only model.
7. Dispatches via `handle_function_call` (the same dispatcher the model uses, line 580-600 in `tools/registry.py`).
8. Suppresses stdout/stderr from the handler (via `sys.stdout = devnull`) so internal tool prints don't leak into the CLI spinner.
9. Logs every call (`tool_call_log`) for observability.

The `task_id` passed to `handle_function_call` is the same task_id as the parent. **The child's tool calls go through the parent's tool execution layer**, so they share the parent's file_state tracking, terminal session, etc. — exactly as if the model were calling them directly.

### 6.4 The UDS client stub (`_UDS_TRANSPORT_HEADER` at line 346-410)

The `hermes_tools.py` module generated for local backends:

```python
"""Auto-generated Hermes tools RPC stubs."""
import json, os, socket, shlex, threading, time

_sock = None
# The RPC server handles a single client connection serially and has no
# request-id in the protocol, so concurrent _call() invocations from multiple
# threads (e.g. ThreadPoolExecutor) would race on the shared socket and get
# each other's responses. Serialize the entire send+recv round-trip.
_call_lock = threading.Lock()

def _connect():
    global _sock
    if _sock is None:
        endpoint = os.environ["HERMES_RPC_SOCKET"]
        if endpoint.startswith("tcp://"):
            _host_port = endpoint[len("tcp://"):]
            _host, _, _port = _host_port.rpartition(":")
            _sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            _sock.connect((_host or "127.0.0.1", int(_port)))
        else:
            _sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            _sock.connect(endpoint)
        _sock.settimeout(300)
    return _sock

def _call(tool_name, args):
    request = json.dumps({
        "tool": tool_name,
        "args": args,
        "token": os.environ.get("HERMES_RPC_TOKEN", ""),
    }) + "\n"
    with _call_lock:
        conn = _connect()
        conn.sendall(request.encode())
        buf = b""
        while True:
            chunk = conn.recv(65536)
            if not chunk:
                raise RuntimeError("Agent process disconnected")
            buf += chunk
            if buf.endswith(b"\n"):
                break
    raw = buf.decode().strip()
    result = json.loads(raw)
    if isinstance(result, str):
        try:
            return json.loads(result)
        except (json.JSONDecodeError, TypeError):
            return result
    return result
```

Per-tool stubs are generated from the `_TOOL_STUBS` template dict (line 223-266). For example:

```python
def read_file(path: str, offset: int = 1, limit: int = 500):
    """Read a file (1-indexed lines). Returns dict with "content" and "total_lines"."""
    return _call("read_file", {"path": path, "offset": offset, "limit": limit})
```

The transport is **AF_UNIX** on Linux/macOS (path-based) or **AF_INET loopback** on Windows (since `AF_UNIX` is unreliable across Windows Python builds — the socket file can't live on the same drive as the script, line 1205-1211). The endpoint is set in `HERMES_RPC_SOCKET` env var. macOS gets a special temp dir at `/tmp` because the long `/var/folders/...` path pushes Unix domain socket paths past the 104-byte macOS AF_UNIX limit (line 1200-1203).

The serialized `_call_lock` is the load-bearing detail: the RPC server has no request-id in the protocol, so concurrent `_call()` invocations from multiple threads would race on the shared socket and get each other's responses. The lock ensures one send+recv round-trip at a time.

### 6.5 The file-based RPC for remote backends

`code_execution_tool.py:763-911` `_rpc_poll_loop` is the remote-backend equivalent. The transport:

1. Script writes `req_NNNNNN` request file in the sandbox's `HERMES_RPC_DIR`.
2. Parent's polling thread (`env.execute("ls -1 …/req_* 2>/dev/null")` every 100ms, line 786) sees the request.
3. Parent reads the file, validates the token, dispatches via `handle_function_call`, writes the response to `res_NNNNNN` (atomic via base64 + tmp + rename).
4. Script polls for the response file (`os.path.exists(res_file)` in an adaptive 50ms → 250ms poll loop, line 451-457).

```python
# Stub (line 426-474)
def _call(tool_name, args):
    global _seq
    with _seq_lock:
        _seq += 1
        seq = _seq
    seq_str = f"{seq:06d}"
    req_file = os.path.join(_RPC_DIR, f"req_{seq_str}")
    res_file = os.path.join(_RPC_DIR, f"res_{seq_str}")

    # Write request atomically (write to .tmp, then rename).
    tmp = req_file + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({
            "tool": tool_name,
            "args": args,
            "seq": seq,
            "token": os.environ.get("HERMES_RPC_TOKEN", ""),
        }, f)
    os.rename(tmp, req_file)

    # Wait for response with adaptive polling
    deadline = time.monotonic() + 300  # 5-minute timeout per tool call
    poll_interval = 0.05
    while not os.path.exists(res_file):
        if time.monotonic() > deadline:
            raise RuntimeError(f"RPC timeout: no response for {tool_name} after 300s")
        time.sleep(poll_interval)
        poll_interval = min(poll_interval * 1.2, 0.25)  # Back off to 250ms

    with open(res_file, encoding="utf-8") as f:
        raw = f.read()
    try:
        os.unlink(res_file)
    except OSError:
        pass

    result = json.loads(raw)
    ...
```

The seq-locking is a separate concern from the UDS lock — file-based RPC needs atomic sequence number allocation, which is what `_seq_lock` does.

The "remote" path bypasses Modal's stdin buffer limits by using `echo '<base64>' | base64 -d > …` (line 892-900) — Modal doesn't reliably deliver stdin to chained commands. Base64 output is shell-safe (`[A-Za-z0-9+/=]`) so single quotes are fine.

### 6.6 Lifecycle of an `execute_code` call

Local backend (UDS):

1. **Generate the stub module** (`code_execution_tool.py:1238-1240`): `tools_src = generate_hermes_tools_module(list(sandbox_tools))` writes `hermes_tools.py` to a temp dir.
2. **Write the user's script** (line 1243-1244): `script.py` to the same temp dir.
3. **Start the RPC server** (line 1247-1278): bind a UDS (or loopback TCP on Windows), start a thread running `_rpc_server_loop` with the per-call `rpc_token`.
4. **Spawn the child process** (line 1345-1354): `subprocess.Popen([_child_python, _script_path], cwd=_child_cwd, env=child_env, stdout=PIPE, stderr=PIPE, stdin=DEVNULL, start_new_session=True)`. `start_new_session=True` puts the child in its own process group so the parent's `Ctrl+C` doesn't propagate.
5. **Poll the child** (line 1356+): background reader threads for stdout (head+tail strategy) and stderr (head only). Watch the child for exit, timeout, and interrupt.
6. **Cleanup** (line 1537+): stop the RPC server, unlink the socket, kill the child if still running, re-deliver any deferred SIGINT.

The RPC token and socket path are passed via `HERMES_RPC_SOCKET` and `HERMES_RPC_TOKEN` env vars. The child env is **scrubbed** of all API keys, tokens, secrets (line 88-207) before the child process inherits it. Only `HERMES_HOME`, `HERMES_PROFILE`, `HERMES_CONFIG`, `HERMES_ENV`, plus safe prefixes (`PATH`, `HOME`, `USER`, `LANG`, `LC_`, `TERM`, `TMPDIR`, `TMP`, `TEMP`, `SHELL`, `LOGNAME`, `XDG_`, `PYTHONPATH`, `VIRTUAL_ENV`, `CONDA`), plus skill-declared passthroughs, plus Windows-OS essentials, are passed. The child can't exfiltrate `OPENAI_API_KEY` because the child never sees it.

### 6.7 How the result reaches the LLM

The child process's **stdout only** is returned to the LLM (line 1382+). The intermediate tool results are NOT in the LLM's context. The script's stdout is the single LLM-visible artifact.

Standard post-processing:
1. Truncate to `MAX_STDOUT_BYTES = 50_000` (40% head + 60% tail, line 75).
2. Strip ANSI escape sequences (`ansi_strip.strip_ansi`).
3. Redact secrets (`redact_sensitive_text(..., code_file=True)` — different from terminal redaction).
4. Return `{status, output, tool_calls_made, duration_seconds, [error]}` to the model.

The `tool_calls_made` and `duration_seconds` fields give the LLM a feedback signal that "the script did N tool calls over X seconds" without showing the N intermediate results.

### 6.8 When the agent uses PTC vs delegate_task

The rule of thumb (`website/docs/user-guide/features/delegation.md:262`):

> Use `delegate_task` when the subtask requires reasoning, judgment, or multi-step problem solving. Use `execute_code` when you need mechanical data processing or scripted workflows.

`delegate_task`:
- LLM-driven subtask
- Iterative, may need to re-read files, re-think, re-try
- Produces a prose summary at the end
- Costs N+1 inference turns (N child turns + 1 parent turn with the summary)

`execute_code`:
- Mechanical, deterministic, scripted
- The script's flow is fully under the agent's control
- Produces one stdout blob at the end
- Costs 1 inference turn (the parent turn)

The "zero-context-cost" framing is exactly this: PTC collapses a multi-step pipeline that would have been N model turns + N tool results into 1 model turn + 1 stdout blob. The intermediate tool results are visible to the script (via the RPC), but not to the LLM that wrote the script.

---

## 7. RPC Pattern — What "RPC" Actually Means Here

### 7.1 The two RPCs compared

| Aspect | Subagent "RPC" (`delegate_task`) | PTC RPC (`execute_code`) |
|---|---|---|
| **Transport** | In-process Python function call | UDS (local) or filesystem (remote) |
| **Caller** | Parent LLM agent | User-written Python script in a child process |
| **Callee** | Fresh `AIAgent` instance | `handle_function_call` dispatcher |
| **Language boundary** | Same Python interpreter | Separate Python process (or remote shell script) |
| **What's returned to caller** | Structured result dict with summary | Just the child's stdout |
| **What's returned to LLM** | One structured result JSON | One stdout blob |
| **Tools available to callee** | All parent tools minus DELEGATE_BLOCKED_TOOLS | 7-tool allow-list (web_search, web_extract, read_file, write_file, search_files, patch, terminal) |
| **Recursive delegation possible?** | Yes (with orchestrator opt-in) | No (`delegate_task` not in sandbox) |
| **Process boundary?** | No (thread within same process) | Yes (separate process) |
| **Crash isolation?** | Daemon thread (abandoned on parent exit) | Child process (killable independently) |
| **Token cost** | N+1 model turns | 1 model turn |
| **Best for** | Reasoning, judgment, multi-step problem solving | Mechanical data processing, scripted workflows |

### 7.2 The "zero-context-cost" claim, in one sentence

> A `execute_code` call returns the script's stdout, not the N intermediate tool results — so the LLM's context window sees one blob, not N tool messages.

That's the entire claim. There's no magic; it's a careful partitioning of "what the script sees" vs "what the LLM sees."

### 7.3 When to use which RPC

**Use `delegate_task`**:
- The subtask requires the child to read multiple files, think, re-try on failure
- The result is a prose summary, not a structured data transformation
- The child might need to ask "should I do X or Y?" (well — no, `clarify` is blocked; it should just pick and explain)
- Multi-step problem solving (debug this stack trace, design this schema)

**Use `execute_code`**:
- The subtask is a known, scripted pipeline (read N files → filter → transform → write 1 output file)
- The data processing is mechanical and deterministic
- You want N tool calls to NOT enter the LLM's context
- The "summary" would just be the script's final output anyway

**Use `terminal(background=True, notify_on_complete=True)`**:
- The subtask is a long-running process (test suite, build, deploy)
- The agent has other work to do while it runs
- The result is a single completion notification

---

## 8. Subagent Context Isolation Recap

Each subagent has:

| Resource | Shared with parent? | Per-subagent? |
|---|---|---|
| Process | Yes | — |
| Python interpreter | Yes | — |
| OpenAI message list (conversations) | No | Yes (fresh per child) |
| Tool registry | Yes | — (same registry, but DELEGATE_BLOCKED_TOOLS are filtered out) |
| `task_id` | No | Yes (per-subagent stable id) |
| Terminal session | **Yes by default** (collapsed to "default") | Optional via `register_task_env_overrides` |
| File-state read/write stamps | No | Yes (each child is a separate task) |
| Per-path write locks | Yes (process-wide) | — |
| Memory providers | Yes (shared) | — (writes go through the parent's memory tool, which the child can't call) |
| `process_registry` | Yes (shared) | — (the child can spawn its own background processes) |
| Session DB (hermes_state) | Yes (shared) | Writes are tagged with the child's session_id |
| `model`, `provider`, `api_key` | Optional | Inherited or overridden per child |
| Iteration budget | No | Yes (fresh per child) |
| `max_iterations` | No | Yes (inherited or set per child) |
| Credential pool | Optional | Inherited or leased (with rate-limit sharing) |
| Skill index | Yes (shared) | — (no per-child skills) |

The point of the isolation is **strict message-role alternation is preserved, prompt cache stays intact, the parent never sees the child's intermediate tool calls**. The cost is the parent must decide what to do with the summary.

---

## 9. Failure Recovery for Subagents

| Failure mode | Detection | Recovery |
|---|---|---|
| Child Python exception | `future.result()` raises | `delegate_task` result entry with `status="error"` and `error=str(exc)` |
| Child API rate limit | Child's own retry logic | Child reports error; parent sees in result |
| Child tool error | `handle_function_call` returns JSON error | Visible in child's intermediate state; propagates to summary |
| Child wedged (no API progress) | Heartbeat staleness monitor (15 idle / 40 in-tool cycles) | Heartbeat stops; gateway inactivity timeout fires; parent interrupts → child interrupts via `agent.interrupt()` |
| Child timeout (opt-in) | `child_timeout_seconds` config (off by default) | Future times out; entry with `status="error"`, `error="Child did not finish in time"` |
| Parent interrupted | `parent_agent._interrupt_requested` checked in poll loop | All still-pending children get `status="interrupted"` entries; running children are abandoned with `interrupt_subagent(sid)` |
| Subagent clobbers sibling's file | `file_state.check_stale` | Warning in result; parent agent re-reads before next write |
| Subagent asks user | Blocked by DELEGATE_BLOCKED_TOOLS | `clarify` not in child's toolset; returns "Tool 'clarify' is not available" |
| Subagent sends Telegram | Blocked by DELEGATE_BLOCKED_TOOLS | `send_message` not in child's toolset |
| Subagent writes to MEMORY.md | Blocked by DELEGATE_BLOCKED_TOOLS | `memory` not in child's toolset |
| Subagent calls `delegate_task` (non-orchestrator) | Blocked by DELEGATE_BLOCKED_TOOLS | Returns tool error; child is informed |
| Subagent runs `execute_code` | Blocked by DELEGATE_BLOCKED_TOOLS | Returns tool error |
| Subagent schedules cron job | Blocked by DELEGATE_BLOCKED_TOOLS | Returns tool error |
| Subagent uses dangerous shell command | `_subagent_auto_deny` callback (default) | Returns "deny"; child gets a refusal; can adjust command |

The defensive layering is intentional: even if a child manages to bypass one guard (e.g. by accident in prompt), the next guard catches it.

---

## 10. Code References Summary

| Topic | File | Lines |
|---|---|---|
| `DELEGATE_BLOCKED_TOOLS` frozenset | `tools/delegate_tool.py` | 45-54 |
| `_subagent_auto_deny` / `_subagent_auto_approve` | `tools/delegate_tool.py` | 74-99 |
| `set_spawn_paused` / `is_spawn_paused` | `tools/delegate_tool.py` | 152-166 |
| `_active_subagents` registry | `tools/delegate_tool.py` | 149 |
| `_get_max_concurrent_children` | `tools/delegate_tool.py` | 354-392 |
| `_get_child_timeout` (opt-in) | `tools/delegate_tool.py` | 425-464 |
| `_get_max_spawn_depth` (default 1) | `tools/delegate_tool.py` | 467-503 |
| `_get_orchestrator_enabled` (kill switch) | `tools/delegate_tool.py` | 506-520 |
| `_expand_parent_toolsets` | `tools/delegate_tool.py` | 544-572 |
| `_strip_blocked_tools` | `tools/delegate_tool.py` | 766-786 |
| `_build_child_agent` | `tools/delegate_tool.py` | 1044-1400 |
| `_trim_summary_with_footer` | `tools/delegate_tool.py` | 1569-1622 |
| `_parent_summary_char_budget` | `tools/delegate_tool.py` | 1624-1664 |
| `_apply_summary_budget` | `tools/delegate_tool.py` | 1664-1717 |
| `_run_single_child` (body) | `tools/delegate_tool.py` | 1719-2317 |
| `delegate_task` (entry) | `tools/delegate_tool.py` | 2342-2920 |
| `delegate_task` registry | `tools/delegate_tool.py` | 3429-3445 |
| `DaemonThreadPoolExecutor` (homegrown) | `tools/daemon_pool.py` | (imported) |
| `_executor` (module-level daemon pool) | `tools/async_delegation.py` | 63-93 |
| `dispatch_async_delegation` (capacity check + record) | `tools/async_delegation.py` | 124-238 |
| `dispatch_async_delegation_batch` | `tools/async_delegation.py` | 311-424 |
| `_push_completion_event` (forges a new agent turn) | `tools/async_delegation.py` | 256-310 |
| `SANDBOX_ALLOWED_TOOLS` (PTC 7-tool allow-list) | `tools/code_execution_tool.py` | 62-70 |
| `_TOOL_STUBS` (PTC stub templates) | `tools/code_execution_tool.py` | 223-266 |
| `generate_hermes_tools_module` | `tools/code_execution_tool.py` | 269-301 |
| `_UDS_TRANSPORT_HEADER` (UDS stub module) | `tools/code_execution_tool.py` | 346-410 |
| `_FILE_TRANSPORT_HEADER` (file-based stub module) | `tools/code_execution_tool.py` | 414-476 |
| `_rpc_server_loop` (UDS/TCP server in parent thread) | `tools/code_execution_tool.py` | 487-620 |
| `_rpc_poll_loop` (file-based server in parent thread) | `tools/code_execution_tool.py` | 763-911 |
| `_execute_remote` (file-based RPC for remote backends) | `tools/code_execution_tool.py` | 913-1102 |
| `execute_code` (entry, dispatches local vs remote) | `tools/code_execution_tool.py` | 1115- |
| `_scrub_child_env` (no API keys in child process) | `tools/code_execution_tool.py` | 146-207 |
| `FileStateRegistry` | `tools/file_state.py` | 59-260 |
| `check_stale` (three-tier staleness) | `tools/file_state.py` | 142-215 |
| `lock_path` (per-path serialization) | `tools/file_state.py` | 78-90 |
| `writes_since` (subagent file reminder) | `tools/file_state.py` | 218-242 |
| `FileSyncManager.sync` (rate-limited, transactional rollback) | `tools/environments/file_sync.py` | 162-236 |

---

## 11. What Makes Hermes' Subagent Model Distinctive

1. **The DELEGATE_BLOCKED_TOOLS firewall is structural, not prompt-based.** The child literally cannot call `clarify`, `memory`, `send_message`, `execute_code`, `cronjob`, or `delegate_task` (orchestrator opt-in aside). The LLM cannot bypass this through a clever prompt; the tools are simply not in the schema.

2. **The "RPC" claim is the PTC (`execute_code`), not the subagent delegation.** Subagent delegation is a Python function call. The genuine RPC is the UDS / file-based transport for `execute_code` — the only path that gives "zero-context-cost turns".

3. **The heartbeat staleness monitor (15 idle / 40 in-tool cycles) replaces the opt-in child timeout.** Default behavior is "no hard cap on child duration" — failures come from what the child is doing, not from a stopwatch. A truly wedged child is detected by liveness, not elapsed time.

4. **`max_concurrent_children` is one cap for both sync and async.** When a `background=true` dispatch is at capacity, it's REJECTED, not queued — the model falls back to synchronous. No unbounded background work.

5. **The summary budget math (50% of parent's remaining headroom, divided by N children)** is the structural reason N parallel subagents can't collectively blow the context window. The compression/429 death-spiral in issue/PR #9126 was specifically this.

6. **Async dispatch completions re-enter the conversation as fresh turns, never spliced.** Strict message-role alternation is preserved, prompt cache stays intact. This is the load-bearing detail for "background work doesn't pollute the active conversation's prompt cache."

7. **The cross-agent file-state registry is unique to Hermes.** Other agents in the survey (OpenFang, OpenClaw, best-of) don't have a process-wide read/write coordination layer. The 3-tier staleness check (sibling subagent write, external change, write-without-read) plus per-path `threading.Lock` is a load-bearing safety feature for parallel subagents on the same repo.

8. **The terminal-default `task_id="default"` collapse** means subagents share the parent's long-lived container (one bash, one /workspace, one set of installed packages) by default. This is the opposite of OpenFang's "each Hand is its own persistent process" model — and it's correct for coding work, where the child should see exactly the env the parent has set up.

### What Bizar could learn

- The **DELEGATE_BLOCKED_TOOLS firewall** is a clean pattern: tools that are present in the parent but absent in the child is the right way to enforce "no user interaction / no memory writes / no side-effect sends" without prompting.
- The **PTC RPC** (UDS for local, file-based for remote) is the right pattern for "I want tool calls in the LLM's output to be N+1 turns, not 2N+1." opencode and Codex have nothing equivalent.
- The **cross-agent file-state registry** is the missing safety layer for Bizar's parallel subagent dispatch. Without it, two parallel `@thor` instances on the same repo can silently clobber each other.
- The **summary budget math** (per-child allocation of parent's remaining headroom) is the right primitive. Bizar's plugin doesn't currently budget subagent summaries against the parent's window.
- The **heartbeat staleness monitor** (liveness-based, not time-based) is more robust than a hard `child_timeout_seconds` cap. Bizar's `loopThresholdWarn: 5` is a similar pattern but at the iteration level, not the wall-clock level.

### What Bizar should NOT copy

- The **six terminal backends** are overkill for Bizar. Three (local + Docker + remote SSH) would cover the same space without the maintenance burden of Modal/Daytona/Singularity.
- The **per-task credential pool** is a niche feature for users who hit rate limits across many subagents. Bizar's `bizar` plugin can wait until this becomes a real problem.
- The **PTC UDS / file-based transport** is complex (token auth, atomic file replacement, sequence locking, transport fallback for Windows). If Bizar needs PTC, the simpler model is a subprocess that emits JSON lines on stdout, parsed in the parent.
- The **prompt-caching-as-sacred constraint** is a Hermes-specific optimization. Bizar's plugin runs in opencode's session model where the caching rules are different.

---

## 12. Summary

Hermes' subagent model is a careful layering of isolation primitives:

- **The thread pool + daemon-thread trick** (`DaemonThreadPoolExecutor`) gives cheap concurrency without process-boundary serialization cost.
- **The tool firewall** (`DELEGATE_BLOCKED_TOOLS`) enforces a structural policy that the LLM cannot bypass through prompts.
- **The cross-agent file-state registry** (`tools/file_state.py`) prevents the most common concurrent-subagent failure mode (sibling write clobber).
- **The summary budget math** (`_parent_summary_char_budget`) keeps N parallel subagents from collectively blowing the parent's context window.
- **The heartbeat staleness monitor** (liveness-based) replaces a hard time cap for stuck-child detection.
- **The async completion rail** (the `process_registry.completion_queue` + drain in CLI/gateway) lets background work re-enter the conversation without mutating the active prompt prefix.

The PTC RPC (`execute_code`) is the genuine "zero-context-cost" claim — a UDS (local) or file-based (remote) transport that lets a user-written Python script call tools through the parent's dispatcher. The script's stdout is the LLM-visible artifact; the N intermediate tool results are not.

What this gives Hermes: small, structural enforcement of "subagents do reasoning, the parent decides what to persist." The DELEGATE_BLOCKED_TOOLS firewall is the load-bearing detail — without it, the LLM would routinely need prompt-based instructions like "don't ask the user, don't send Telegram, don't write to memory" which fail under prompt pressure. The structural tool-absence is the right primitive.
