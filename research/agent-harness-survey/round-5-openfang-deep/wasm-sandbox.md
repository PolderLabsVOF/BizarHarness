# OpenFang WASM Sandbox — Deep Dive

**Scope:** Round 5 deep dive into OpenFang's WasmSandbox — the technical centerpiece of its "Agent OS" framing. All file:line references are against the snapshot in `research/agent-harness-survey/repos/openfang/`.

**Date:** 2026-07-06  
**Author:** @tyr

---

## 1. Why WASM? The Agent-OS Framing

OpenFang's self-positioning — "Agent Operating System" — is not marketing. The kernel (`openfang-kernel`) deliberately mirrors OS primitives: an `AgentScheduler` (CPU scheduler), `BackgroundExecutor` (process table), `CapabilityManager` (page-table-style permission check), `WasmSandbox` (process isolation boundary), `AuditLog` (syscall trace), `MeteringEngine` (resource accounting), `WorkspaceSandbox` (filesystem mount namespace). In that framing, the WASM sandbox is the **process isolation boundary** for untrusted tool code — the analog of Linux's `clone()` + namespace setup.

Docker/gVisor/firecracker were considered and rejected for the default tool-execution path. The reasons are visible in the runtime dependencies (`Cargo.toml:27-157`):

- **Cold start** — README:200 claims `<200ms` cold start and `~32 MB` install. Wasmtime 43 instantiation is in the same order of magnitude as the host binary itself; a Docker daemon pulls 500 MB and takes 6 s to start (README:200 comparison table).
- **Subprocess ergonomics** — WASM modules are bytes. They can be downloaded, content-addressed, signed, and compiled in-process with no privileged daemon.
- **Deterministic metering** — Wasmtime's fuel meter is *instruction-accurate*, not wall-clock-approximated. A run from 1 ms to 30 s cannot skip past the fuel budget; a Docker `--memory`/`--cpus` cgroup is best-effort under load.
- **No host kernel attack surface** — WASM modules cannot `ptrace`, `mount`, `setuid`, `open("/proc/...")`, or otherwise escape the linear-memory sandbox. The host kernel's syscall surface is entirely absent.
- **Reuse across Hand bundles** — Each Hand can ship WASM modules that share one `WasmSandbox` engine instance.

The trade-off (no real syscalls, no network syscalls, no fork) is mitigated by hosting a **capability-gated RPC dispatcher** in the host — `host_call()` — which is the only way for the guest to reach the outside world. This is the same pattern as Wasmtime's preview1 WASI, but smaller and denier-default.

The README claims 16 security layers (`README.md:206-227`); the WASM sandbox is #1 and is also the substrate that many of the other 15 rely on.

---

## 2. The Implementation

### 2.1 Engine construction — `WasmSandbox::new()`

`crates/openfang-runtime/src/sandbox.rs:108-116`:

```rust
pub fn new() -> Result<Self, SandboxError> {
    let mut config = Config::new();
    config.consume_fuel(true);
    config.epoch_interruption(true);
    let engine = Engine::new(&config).map_err(|e| SandboxError::Compilation(e.to_string()))?;
    Ok(Self { engine })
}
```

Wasmtime's `Config::consume_fuel(true)` enables instruction-count metering; `epoch_interruption(true)` enables wall-clock interruption via `Engine::increment_epoch()`. Both flags are set on the same engine so any module compiled by it gets both meters.

The kernel initializes **exactly one** engine and shares it across every WASM execution:

```rust
// crates/openfang-kernel/src/kernel.rs:815-817
// Initialize WASM sandbox engine (shared across all WASM agents)
let wasm_sandbox = WasmSandbox::new()
    .map_err(|e| KernelError::BootFailed(format!("WASM sandbox init failed: {e}")))?;
```

Per-agent execution then layers per-execution budgets via `SandboxConfig` (see §3).

### 2.2 Execution path — `WasmSandbox::execute()`

`sandbox.rs:123-149` is the async entry point. The actual Wasmtime calls run inside `tokio::task::spawn_blocking` because WASM execution is CPU-bound and would otherwise starve the Tokio executor. Inside `execute_sync` (`sandbox.rs:151-282`) the pipeline is:

1. `Module::new(engine, wasm_bytes)` (`sandbox.rs:162`) — accepts both `.wasm` binary and `.wat` text. Compilation is cached by the engine.
2. `Store::new(engine, GuestState { ... })` (`sandbox.rs:166-175`) — per-execution store. `GuestState` carries capabilities, kernel handle, agent ID, tokio handle, and the SSRF allowlist.
3. `store.set_fuel(fuel_limit)` (`sandbox.rs:178-181`) — install the fuel budget.
4. `store.set_epoch_deadline(1)` + watchdog thread (`sandbox.rs:185-191`) — install the wall-clock timer. The watchdog thread sleeps for `timeout_secs` (default 30 s) then calls `engine.increment_epoch()`, which causes any in-flight call to trap with `Trap::Interrupt`.
5. `Linker::new(engine)` + `Self::register_host_functions(&mut linker)` (`sandbox.rs:194-195`) — installs the host ABI.
6. `linker.instantiate(&mut store, &module)` (`sandbox.rs:198`) — links imports, fails if WASI-style imports are missing (there are none).
7. Pull `memory`, `alloc`, `execute` exports (`sandbox.rs:203-217`).
8. Serialize input JSON → `alloc` in guest → `memcpy` into guest memory (`sandbox.rs:219-235`).
9. Call guest `execute(ptr, len) -> i64` (`sandbox.rs:238`). The packed return is `(result_ptr << 32) | result_len`.
10. Map traps: `Trap::OutOfFuel` → `SandboxError::FuelExhausted`, `Trap::Interrupt` → `"WASM execution timed out after Ns (epoch interrupt)"` (`sandbox.rs:240-253`).
11. Read output JSON from guest memory (`sandbox.rs:256-270`).
12. Compute `fuel_consumed = fuel_limit - fuel_remaining` (`sandbox.rs:272-274`).

### 2.3 The Guest ABI

`sandbox.rs:7-25` documents the contract the guest module must satisfy:

```
exports:
  memory: linear memory
  alloc(size: i32) -> i32      // bump-allocator in guest memory
  execute(input_ptr: i32, input_len: i32) -> i64
                                // high 32 bits = result_ptr, low 32 = result_len
                                // both point at JSON bytes in guest memory

imports (module "openfang"):
  host_call(request_ptr: i32, request_len: i32) -> i64
  host_log(level: i32, msg_ptr: i32, msg_len: i32)
```

There is **no WASI**. No `fd_write`, no `environ_get`, no `clock_time_get`. The only way the guest can affect the outside world is `host_call`. There is no host import for clock either; `time_now` is reachable only through `host_call("time_now", {})` which returns a JSON `{"ok": <ts>}` — and the tests at `sandbox.rs:532-557` confirm it returns the system-time seconds.

### 2.4 Host ABI — the capability dispatcher

`crates/openfang-runtime/src/host_functions.rs:19-49` is the dispatch table:

```rust
pub fn dispatch(state: &GuestState, method: &str, params: &serde_json::Value) -> serde_json::Value {
    debug!(method, "WASM host_call dispatch");
    match method {
        // Always allowed (no capability check)
        "time_now" => host_time_now(),

        // Filesystem — requires FileRead/FileWrite
        "fs_read"  => host_fs_read(state, params),
        "fs_write" => host_fs_write(state, params),
        "fs_list"  => host_fs_list(state, params),

        // Network — requires NetConnect
        "net_fetch" => host_net_fetch(state, params),

        // Shell — requires ShellExec
        "shell_exec" => host_shell_exec(state, params),

        // Environment — requires EnvRead
        "env_read" => host_env_read(state, params),

        // Memory KV — requires MemoryRead/MemoryWrite
        "kv_get" => host_kv_get(state, params),
        "kv_set" => host_kv_set(state, params),

        // Agent interaction — requires AgentMessage/AgentSpawn
        "agent_send"  => host_agent_send(state, params),
        "agent_spawn" => host_agent_spawn(state, params),

        _ => json!({"error": format!("Unknown host method: {method}")}),
    }
}
```

Every method except `time_now` calls `check_capability(state.capabilities, &Capability::X(...))` first (`host_functions.rs:57-67`); a missing grant returns `{"error": "Capability denied: ..."}` to the guest.

### 2.5 Tool-trait → WASM-module mapping

Unlike Hermes (Python tool trait + decorator registry) and OpenClaw (TypeScript plugin trait), OpenFang has **no Rust `Tool` trait**. Tools are `ToolDefinition` data structs (`crates/openfang-types/src/tool.rs:1-27`) dispatched via a `match` statement in `tool_runner.rs:323-325`. WASM modules are *one* execution mode among three in the kernel:

```rust
// kernel.rs:2486-2567 — execute_wasm_agent
let module_path = entry.manifest.module.strip_prefix("wasm:").unwrap_or("");
let wasm_bytes = std::fs::read(&wasm_path)?;

// Map manifest capabilities to sandbox capabilities
let caps = manifest_to_capabilities(&entry.manifest);
let sandbox_config = SandboxConfig {
    fuel_limit: entry.manifest.resources.max_cpu_time_ms * 100_000,
    max_memory_bytes: entry.manifest.resources.max_memory_bytes as usize,
    capabilities: caps,
    timeout_secs: Some(30),
    ssrf_allowed_hosts: self.config.web.fetch.ssrf_allowed_hosts.clone(),
};
```

The manifest `module = "wasm:path/to/skill.wasm"` selects WASM mode; `module = "python:path/to/script.py"` selects Python (`kernel.rs:2572-2627`); `module = "builtin:chat"` selects the LLM loop. Built-in tools (file_read, shell_exec, web_fetch, etc.) are **never** WASM — they are direct Rust implementations called from the LLM loop with the same `CapabilityManager` + `SandboxConfig`-equivalent checks (workspace sandbox, SSRF check, exec policy). WASM is reserved for **third-party / user-supplied modules** that the user explicitly registers with a manifest.

### 2.6 How tools are compiled to WASM

The repository does **not** ship a Rust → WASM SDK or an AssemblyScript → WASM helper. A module author writes WAT or compiles their own (e.g. `cargo build --target wasm32-unknown-unknown`) and drops the artifact in a path referenced from the manifest. The bundled tests at `sandbox.rs:399-467` use three WAT snippets inline:

- `ECHO_WAT` — minimal pass-through module.
- `INFINITE_LOOP_WAT` — fuel-exhaustion test target.
- `HOST_CALL_PROXY_WAT` — exercises the `host_call` import.

The "compile tool to WASM" workflow is therefore: the user picks a language with WASM target support (Rust with `wasm32-unknown-unknown`, AssemblyScript, TinyGo, Zig), compiles to `.wasm`, declares a manifest with `[agent] module = "wasm:./skills/foo.wasm"` and `[capabilities] file_read = ["/data/*"]`, and the kernel does the rest.

---

## 3. Dual Metering

### 3.1 Fuel metering — instruction-count cap

`sandbox.rs:178-182` installs the fuel budget:

```rust
if config.fuel_limit > 0 {
    store.set_fuel(config.fuel_limit)
        .map_err(|e| SandboxError::Execution(e.to_string()))?;
}
```

`fuel_limit` is derived from the agent manifest at `kernel.rs:2511`:

```rust
fuel_limit: entry.manifest.resources.max_cpu_time_ms * 100_000,
```

i.e. 1 ms ≈ 100,000 fuel. The default `SandboxConfig` at `sandbox.rs:50-60` is `fuel_limit: 1_000_000` (10 ms worth). The `manifest_to_capabilities` helper maps the manifest's `max_cpu_time_ms` field. A 5-second budget → 500,000,000 fuel.

A trap from exhaustion is detected at `sandbox.rs:240-244`:

```rust
if let Some(Trap::OutOfFuel) = e.downcast_ref::<Trap>() {
    return Err(SandboxError::FuelExhausted);
}
```

The error message — `"Fuel exhausted: skill exceeded CPU budget"` (`sandbox.rs:94`) — is returned to the agent, which sees a structured error and can retry with a smaller workload. Fuel is **deterministic**: the same input → the same fuel consumption, regardless of host load.

### 3.2 Epoch metering — wall-clock cap

`sandbox.rs:184-191`:

```rust
store.set_epoch_deadline(1);
let engine_clone = engine.clone();
let timeout = config.timeout_secs.unwrap_or(30);
let _watchdog = std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_secs(timeout));
    engine_clone.increment_epoch();
});
```

Each Store starts with `epoch_deadline = 1`; the engine's global epoch counter is initially 0. After `timeout_secs` seconds (default 30), the watchdog calls `engine.increment_epoch()` → counter becomes 1 → every Store whose `set_epoch_deadline(1)` deadline is exceeded traps with `Trap::Interrupt` (`sandbox.rs:246-251`).

A trap from interruption is reported as `"WASM execution timed out after Ns (epoch interrupt)"` (`sandbox.rs:248`). The watchdog thread is leaked (detached, returns `JoinHandle` discarded via `let _watchdog`) but that's fine — `Engine::increment_epoch` on a no-longer-existing Store is a no-op.

### 3.3 How they combine

Both meters are evaluated by Wasmtime's runtime on every instruction boundary (Wasmtime checks fuel every few hundred instructions via tier-up, and the epoch is checked on every function-entry boundary by default). Either meter can fire first:

- A guest that runs `while true {}` burns fuel very fast and traps with `OutOfFuel` within milliseconds.
- A guest that does a long blocking `host_call` (e.g. waiting on the agent_send host function) burns no fuel (host functions are non-metered) but the epoch interrupt still fires after 30 s.

This combination is the right one: fuel catches runaway *compute*, epoch catches runaway *I/O waits*. Wasmtime itself documents this dual-meter pattern.

### 3.4 What happens on overflow

Both overflows result in `Err` returned to the caller. The kernel surfaces them as `KernelError::OpenFang(OpenFangError::Internal("WASM execution failed: ..."))` (`kernel.rs:2534-2537`). The fuel error string is "Fuel exhausted: skill exceeded CPU budget"; the epoch error string is "WASM execution timed out after Ns (epoch interrupt)".

There is no automatic retry. There is no graceful degradation. The agent loop sees the error as a normal tool failure and the LLM can decide to retry with different parameters (subject to the loop guard at §4.7 of the security model).

---

## 4. Resource Limits

### 4.1 Memory — `max_memory_bytes`

`SandboxConfig.max_memory_bytes: usize` (`sandbox.rs:38`) is **declared** and propagated to the manifest mapping at `kernel.rs:2512`:

```rust
max_memory_bytes: entry.manifest.resources.max_memory_bytes as usize,
```

The default is 16 MiB (`sandbox.rs:54`). However, the field is **not actually enforced** by `execute_sync` — `sandbox.rs:151-282` never calls `store.limiter(...)` or checks `memory.data_len()`. The comment at `sandbox.rs:38-39` admits this:

> `/// Maximum WASM linear memory in bytes (reserved for future enforcement).`

Today this is a configuration knob that is read and stored, but the runtime does not grow-stop the module. Wasmtime itself *can* grow memory unbounded up to the module's declared `memory.max` (or 4 GiB if unbounded). This is a **gap** — the security model in the README claims WASM dual-metering, and the 16-layer list does not separately call out memory, but `max_memory_bytes` is the field that *would* enforce it. Until Wasmtime 18+ exposes a `Store::limiter` API, the practical mitigation is the linear-memory default of 1 page = 64 KiB on instantiation, plus the `[agent] max_iterations` cap in the manifest.

### 4.2 CPU — fuel + epoch

CPU is bounded by the dual metering (§3) — `max_cpu_time_ms` from the manifest becomes fuel; `timeout_secs` from the config becomes the epoch window.

### 4.3 Network egress — SSRF + capability gate

`host_net_fetch` (`host_functions.rs:216-259`) is the only host function that touches the network. Two checks run before any byte leaves the host:

1. **SSRF check** at `host_functions.rs:230-232`:
   ```rust
   if let Err(msg) = web_fetch::check_ssrf(url, &state.ssrf_allowed_hosts) {
       return json!({"error": msg});
   }
   ```
   `check_ssrf` (`web_fetch.rs:195-258`) blocks:
   - Non-`http(s)://` schemes (line 197-199)
   - Hostname blocklist (`localhost`, `metadata.google.internal`, `instance-data`, `169.254.169.254`, `100.100.100.200`, `192.0.0.192`, `0.0.0.0`, `::1`, `[::1]`) — lines 211-225. These are **unconditional**, no allowlist can override them.
   - Private IPs after DNS resolution — lines 245-255. RFC1918 ranges (10/8, 172.16/12, 192.168/16), 169.254/16 (link-local + IMDS), IPv6 ULA (`fc00::/7`), and link-local (`fe80::/10`).
   - **DNS rebinding mitigation**: every resolved IP is checked (lines 236-254). A hostname that resolves to a public IP for the SSRF check but a private IP at HTTP time would still fail because the SSRF check resolves *all* addresses up front. (A more sophisticated attacker could use DNS TTL=0 + a CNAME swap; OpenFang does not currently re-resolve at fetch time, but the up-front check closes the common case.)
   - Allowlist support: exact hostnames (`n8n.local`), wildcards (`*.olares.com`), and CIDR ranges (`10.0.0.0/8`) — `web_fetch.rs:276-318, 497-531`.

2. **Capability gate** at `host_functions.rs:234-238`:
   ```rust
   let host = web_fetch::extract_host(url);
   if let Err(e) = check_capability(&state.capabilities, &Capability::NetConnect(host)) {
       return e;
   }
   ```
   The agent must have a `NetConnect` capability matching the URL's host:port pattern (glob matches per `crates/openfang-types/src/capability.rs:106-166`).

The implementation also wraps the response in `wrap_external_content(url, text)` markers via the regular `web_fetch` pipeline at `web_fetch.rs:155-158`, so the LLM sees fetched content as untrusted data, not instructions.

### 4.4 Filesystem — capability + path-traversal + workspace

The WASM-side filesystem API (`host_functions.rs:139-209`) is for *guests*. For the *regular agent loop* (which is what most Hands use, not WASM), filesystem access is gated by `WorkspaceSandbox`:

`crates/openfang-runtime/src/workspace_sandbox.rs:15-69`:

```rust
pub fn resolve_sandbox_path(user_path: &str, workspace_root: &Path) -> Result<PathBuf, String> {
    // 1. Reject '..' components
    // 2. Build candidate: relative joined to workspace_root, absolute as-is
    // 3. Canonicalize workspace_root and candidate (or candidate.parent + filename for new files)
    // 4. Verify canonical path starts with canonical workspace root
}
```

The verification at line 57-66 is the symlink-escape prevention: a symlink inside the workspace pointing outside is canonicalized to its real path, which fails `starts_with(&canon_root)`. Tests at lines 134-147 confirm this for the Unix case.

For WASM guests, `host_fs_read`/`write`/`list` apply a second defense layer (`host_functions.rs:75-117`):

```rust
fn safe_resolve_path(path: &str) -> Result<std::path::PathBuf, serde_json::Value> {
    for component in p.components() {
        if matches!(component, Component::ParentDir) {
            return Err(json!({"error": "Path traversal denied: '..' components forbidden"}));
        }
    }
    std::fs::canonicalize(p).map_err(|e| ...)
}
```

This rejects `..` even before the canonicalization step, so a hostile guest cannot bypass the path check with `safe_resolve_path` itself. The `host_fs_write` path uses `safe_resolve_parent` (`host_functions.rs:90-117`) which canonicalizes the *parent* directory and joins with a validated filename, so a write to a brand-new file in a hostile directory still has its parent canonicalized before appending the new name.

### 4.5 Filesystem readable vs writable

For the regular (non-WASM) tool loop, the workspace is the only writable area:

- `tool_runner.rs:570-628` — `file_read`, `file_write`, `file_list`, `create_directory`, `apply_patch` all take `workspace_root: Option<&Path>` and run every path through `resolve_sandbox_path`.
- The error message at `workspace_sandbox.rs:60-65` even hints at the user-facing workaround: *"`If you have an MCP filesystem server configured, use the mcp_filesystem_* tools to access files outside the workspace."`*

For WASM guests, the granularity is per-host-call:

- `fs_read` requires `Capability::FileRead(path_glob)`; the path must match the glob before `safe_resolve_path` runs.
- `fs_write` requires `Capability::FileWrite(path_glob)`.
- There is no `fs_delete`, `fs_chmod`, `fs_symlink`, or `fs_rename` host function. The host function list at `host_functions.rs:21-48` is the full set; absence is the security model.

### 4.6 Env vars

`env_read` (`host_functions.rs:265-287`) requires `Capability::EnvRead(pattern)`. There is no `env_write`. Env injection from a guest to the host process is impossible.

For the regular `shell_exec` tool, the subprocess inherits **only** `SAFE_ENV_VARS` (`subprocess_sandbox.rs:13-16`): `PATH, HOME, TMPDIR, TMP, TEMP, LANG, LC_ALL, TERM`, plus Windows variants. Anything else (ANTHROPIC_API_KEY, AWS_*, GITHUB_TOKEN, etc.) is stripped via `env_clear()` (`subprocess_sandbox.rs:46-78`). The wildcard `"*"` in `allowed_env_vars` will forward everything, but the comment at `subprocess_sandbox.rs:36-42` warns:

> Use the wildcard only when the operator has explicitly opted in (e.g. `exec_policy.shell_env_passthrough = ["*"]`) — it will leak any secret the parent holds into the child.

### 4.7 Loop guard — the 30-call circuit breaker

`crates/openfang-runtime/src/loop_guard.rs` is *not* WASM-specific; it wraps every tool call. But a WASM guest that triggers a runaway tool-call pattern will trip it just like any other tool.

`LoopGuardConfig::default()` (`loop_guard.rs:56-69`):

```rust
warn_threshold: 3,
block_threshold: 5,
global_circuit_breaker: 30,
poll_multiplier: 3,
outcome_warn_threshold: 2,
outcome_block_threshold: 3,
ping_pong_min_repeats: 3,
max_warnings_per_call: 3,
```

After 30 tool calls (regardless of tool), the loop circuit-breaks (`loop_guard.rs:150-157`); after 5 identical `(tool, params)` calls, the call is blocked; after 3 identical `(tool, params, result)` pairs (i.e. the call keeps returning the same thing), the call is blocked without further execution. `POLL_TOOLS` (`loop_guard.rs:25-27`) only contains `shell_exec`; poll tools get thresholds ×3.

---

## 5. The 53 Tools

`crates/openfang-runtime/src/tool_runner.rs:567` — `pub fn builtin_tool_definitions() -> Vec<ToolDefinition>` returns all 53. The match statement at `tool_runner.rs:203-4990` dispatches them. Categorization by sandbox impact:

### 5.1 Read-only (no host side-effects)

| Tool | Description | File:line | Sandbox check |
|------|-------------|-----------|---------------|
| `file_read` | Read file in workspace | `tool_runner.rs:570-580` | `WorkspaceSandbox::resolve_sandbox_path` |
| `file_list` | List directory | `tool_runner.rs:593-603` | `WorkspaceSandbox` |
| `memory_recall` | Read from shared KV | `tool_runner.rs:746-755` | Capability `MemoryRead` |
| `agent_list` | List agents | `tool_runner.rs:696-703` | Capability |
| `knowledge_query` | Query knowledge graph | `tool_runner.rs:1088-1095` | (no side-effect) |
| `location_get` | Get geo location | implicit | (read-only API) |
| `cron_list` / `schedule_list` | List scheduled jobs | `tool_runner.rs:1136-1182` | (read-only) |

### 5.2 Network (SSRF + capability gated)

| Tool | Description | File:line | Sandbox check |
|------|-------------|-----------|---------------|
| `web_fetch` | HTTP GET/POST/PUT/PATCH/DELETE | `tool_runner.rs:629-643` | `web_fetch::check_ssrf` + capability + taint check at line 215 |
| `web_search` | Tavily/Brave/Perplexity/DDG | `tool_runner.rs:644-655` | Provider API key + 4 providers |
| `browser_navigate` | CDP navigate | `tool_runner.rs:892-901` | Browser Hand only; SSRF check in `browser.rs` |

### 5.3 Write (workspace-sandboxed)

| Tool | Description | File:line | Sandbox check |
|------|-------------|-----------|---------------|
| `file_write` | Write file | `tool_runner.rs:581-592` | `WorkspaceSandbox` |
| `file_delete` | Delete file | not in match list (not in 53) | — |
| `apply_patch` | Multi-hunk diff | `tool_runner.rs:615-628` | `apply_patch.rs` + `WorkspaceSandbox` |
| `create_directory` | Mkdir | `tool_runner.rs:604-614` | `WorkspaceSandbox` |
| `memory_store` | Write KV | `tool_runner.rs:734-744` | Capability `MemoryWrite` |
| `knowledge_add_entity` / `knowledge_add_relation` | Graph writes | `tool_runner.rs:1088-1110` | Capability |
| `vault_set` | Vault write | implicit | AES-256-GCM |
| `image_generate` | Generate image | implicit | API key required |
| `tts` | Text-to-speech | implicit | API key |
| `media_transcribe` | Transcribe audio | implicit | API key |

### 5.4 Dangerous (capability + exec-policy + taint + approval)

| Tool | Description | File:line | Sandbox check |
|------|-------------|-----------|---------------|
| `shell_exec` | Execute shell command | `tool_runner.rs:657-668` | Metacharacter block + `ExecPolicy::Allowlist/Deny/Full` + taint + `subprocess_sandbox::env_clear` + `validate_executable_path` |
| `agent_spawn` | Spawn sub-agent | `tool_runner.rs:682-695` | `ToolPolicy::subagent_max_depth` + capability inheritance validation |
| `agent_send` | Message another agent | `tool_runner.rs:670-681` | Capability `AgentMessage(pattern)` |
| `agent_kill` | Kill another agent | `tool_runner.rs:704-714` | Capability `AgentKill(pattern)` |
| `agent_activate` | Activate suspended agent | `tool_runner.rs:715-732` | Capability |
| `cron_create` / `schedule_create` | Create cron job | implicit | `CronScheduler::add_job` + global cap |
| `vault_delete` | Vault delete | implicit | Capability |
| `mcp_*` | MCP tool | `tool_runner.rs:1126-1135` | Per-server capability |

### 5.5 Shell exec — the riskiest tool

`shell_exec` has **four** independent gate layers, all at `tool_runner.rs:244-296`:

1. **Capability**: tool list check (`tool_runner.rs:132-144`)
2. **Metacharacter block** (`subprocess_sandbox.rs:126-179`): rejects `` ` ``, `$()`, `${`, `;`, `|`, `>`, `<`, `{`, `}`, `\n`, `\r`, `\0`, `&` even in `ExecPolicy::Full` mode (`tool_runner.rs:247-259`).
3. **Exec policy** (`subprocess_sandbox.rs:329-399`): `Deny` rejects everything; `Full` allows everything; `Allowlist` requires the base command to be in `safe_bins` or `allowed_commands`, plus recurses into inline scripts passed to `bash -c`, `powershell -Command`, `cmd /C` to validate inner commands (`subprocess_sandbox.rs:212-291`).
4. **Taint heuristic** (`tool_runner.rs:281-288`, `tool_runner.rs:37-103`): when not in `Full` mode, scans for shell-injection patterns from external content / user input. Skipped for Full mode (Hand agents that legitimately need curl).

And **fifth**, if exec_policy is `Full` or `Allowlist` with `allowed_commands=["*"]`, the approval gate is **bypassed** (`tool_runner.rs:152-164`) — the user has already opted in.

### 5.6 What does NOT count as a built-in tool

- `apply_patch` (line 615) is in the builtin list despite the patch tool looking like a write tool.
- 53 is the README number; actual definitions start at `tool_runner.rs:567` and the dispatch match handles them at lines 203+. Tool aliases like `fs-write` → `file_write` are normalized at `tool_runner.rs:130` via `normalize_tool_name`.

---

## 6. SSRF Protection

`crates/openfang-runtime/src/web_fetch.rs` contains the canonical implementation, mirrored by `crates/openfang-runtime/src/host_functions.rs:230` for WASM guests.

### 6.1 The pipeline

`web_fetch.rs:46-166` (`fetch_with_options`):

1. **SSRF check** at line 56 — runs *before any network I/O*. Returns `Err` if blocked.
2. **Cache lookup** at lines 60-64 — only for GET.
3. Build request with custom headers/body (lines 67-96).
4. Send (line 99).
5. Check `content_length` against `max_response_bytes` (lines 105-113) — reject oversize responses early.
6. For GET + HTML, run `html_to_markdown` (lines 129-141). For non-GET (API calls), keep raw body — don't mangle JSON/XML.
7. Truncate at `max_chars` with `safe_truncate_str` for multi-byte UTF-8 safety (lines 143-152; bug fix documented at lines 406-425).
8. Wrap with `wrap_external_content(url, ...)` (lines 155-158) — the marker tag the LLM is told to treat as data.
9. Cache and return (lines 160-164).

### 6.2 The blocklists

**Hostname** blocklist at `web_fetch.rs:211-223` — these are never reachable, period, regardless of allowlist:

```rust
let blocked = [
    "localhost", "ip6-localhost",
    "metadata.google.internal", "metadata.aws.internal", "instance-data",
    "169.254.169.254",          // AWS/GCP/Azure IMDS
    "100.100.100.200",          // Alibaba Cloud IMDS
    "192.0.0.192",              // Azure IMDS alternative
    "0.0.0.0",
    "::1", "[::1]",
];
```

**Private IP** blocklist via `is_private_ip` (`web_fetch.rs:352-366`):
- IPv4: 10/8, 172.16-31/12, 192.168/16, 169.254/16 (entire link-local)
- IPv6: `fc00::/7` (ULA), `fe80::/10` (link-local)

**Cloud metadata IPs** via `is_metadata_ip` (`web_fetch.rs:261-274`):
- `169.254.169.254` (AWS/GCP/Azure)
- `100.100.100.200` (Alibaba)
- `192.0.0.192` (Azure alternative)

These are explicitly **never** allowed even if the allowlist CIDR would cover them (`web_fetch.rs:239-244, 504-517` in tests).

### 6.3 Allowlist semantics

`web_fetch.rs:276-318`:

- **Exact hostname**: `"n8n.local"` matches `n8n.local` only.
- **Wildcard domain**: `"*.olares.com"` matches `api.olares.com`, `x.y.olares.com`, but not `olares.com` (suffix check requires the dot).
- **CIDR range**: `"10.0.0.0/8"` matches any IP in `10.0.0.0/8`.

The CIDR matching is correct for v4 (`web_fetch.rs:321-334`) and v6 (`web_fetch.rs:335-348`) using `u32` / `u128` masks.

### 6.4 DNS rebinding protection

`web_fetch.rs:233-255`: the SSRF check resolves DNS *first* via `to_socket_addrs()` and walks every returned IP. If any IP is private or metadata, the request is rejected — even if the hostname looks public. This catches the common DNS-rebinding pattern where an attacker controls DNS and resolves `attacker.com` → `127.0.0.1` between the SSRF check and the actual HTTP request.

The **remaining** DNS-rebinding gap: between `check_ssrf` and `client.get(url).send()` (a few microseconds in a happy path), a sufficiently motivated attacker with TTL=0 and a fast DNS server could swap the resolution. OpenFang does not currently re-resolve and re-check at fetch time. The mitigation is the up-front check combined with the explicit `metadata.*` and `169.254.169.254` blocklist that catches the canonical attack targets regardless of resolution.

### 6.5 Outbound network policy

For WASM guests, the policy is: capability `NetConnect(host_pattern)` AND `check_ssrf(url)`. For the regular LLM loop, only `check_ssrf` (no per-host capability, because the agent loop doesn't go through `host_call` — it goes through `tool_web_fetch` which only checks SSRF).

The **policy** is configurable per-deployment via `config.toml`:
```toml
[web.fetch]
ssrf_allowed_hosts = ["n8n.local", "*.internal", "10.0.0.0/8"]
max_response_bytes = 52428800  # 50 MB
max_chars = 200000
readability = true
timeout_secs = 30
```

---

## 7. The Approval Gate System

### 7.1 The system — `ApprovalManager`

`crates/openfang-kernel/src/approval.rs:18-188`. The full state:

- `pending: DashMap<Uuid, PendingRequest>` — active requests awaiting decision.
- `recent: Mutex<VecDeque<ApprovalRecord>>` — last 100 decisions for audit/UI.
- `policy: RwLock<ApprovalPolicy>` — hot-reloadable.

Each `PendingRequest` holds a `tokio::sync::oneshot::Sender<ApprovalDecision>` — the request future resolves when the UI calls `resolve()` or the timeout fires.

### 7.2 The policy — what's gated

`approval.rs:47-50` — `requires_approval(tool_name)` is a simple lookup against `policy.require_approval`:

```rust
pub fn requires_approval(&self, tool_name: &str) -> bool {
    let policy = self.policy.read().unwrap_or_else(|e| e.into_inner());
    policy.require_approval.iter().any(|t| t == tool_name)
}
```

The default `ApprovalPolicy` (defined in `crates/openfang-types/src/approval.rs`) ships with `require_approval = ["shell_exec", "file_delete", "vault_delete", "agent_kill"]` (verified at `approval.rs:218-225`):

```rust
#[test]
fn test_requires_approval_default() {
    let mgr = default_manager();
    assert!(mgr.requires_approval("shell_exec"));
    assert!(!mgr.requires_approval("file_read"));
}
```

`approval.rs:161-168` classifies risk per tool:

```rust
pub fn classify_risk(tool_name: &str) -> RiskLevel {
    match tool_name {
        "shell_exec" => RiskLevel::Critical,
        "file_write" | "file_delete" => RiskLevel::High,
        "web_fetch" | "browser_navigate" => RiskLevel::Medium,
        _ => RiskLevel::Low,
    }
}
```

### 7.3 The flow — request → decision

**Tool-runner side** at `tool_runner.rs:166-200`:

```rust
if let Some(kh) = kernel {
    if !exec_policy_bypasses_approval && kh.requires_approval(tool_name) {
        let agent_id_str = caller_agent_id.unwrap_or("unknown");
        let summary = format!("{}: {}", tool_name, ...);
        match kh.request_approval(agent_id_str, tool_name, &summary).await {
            Ok(true)  => debug!(tool_name, "Approval granted"),
            Ok(false) => return ToolResult { /* denied */ ... },
            Err(e)    => return ToolResult { /* error */ ... },
        }
    }
}
```

The await blocks until the request is resolved (approved/denied) or times out.

**Kernel-handle side** at `kernel.rs:7576-7609`:

```rust
async fn request_approval(&self, agent_id: &str, tool_name: &str, action_summary: &str) -> Result<bool, String> {
    use openfang_types::approval::{ApprovalDecision, ApprovalRequest as TypedRequest};

    // Hand agents are curated trusted packages — auto-approve tool execution.
    if let Some(entry) = self.registry.get(aid) {
        if entry.tags.iter().any(|t| t.starts_with("hand:")) {
            info!(agent_id, tool_name, "Auto-approved for hand agent");
            return Ok(true);
        }
    }

    let policy = self.approval_manager.policy();
    let req = TypedRequest {
        id: uuid::Uuid::new_v4(),
        agent_id: agent_id.to_string(),
        tool_name: tool_name.to_string(),
        description: format!("Agent {} requests to execute {}", agent_id, tool_name),
        action_summary: action_summary.chars().take(512).collect(),
        risk_level: crate::approval::ApprovalManager::classify_risk(tool_name),
        requested_at: chrono::Utc::now(),
        timeout_secs: policy.timeout_secs,
    };

    let decision = self.approval_manager.request_approval(req).await;
    Ok(decision == ApprovalDecision::Approved)
}
```

Two important details:

1. **Hand agents are auto-approved**. If the agent's tags include `hand:...`, the approval gate is bypassed — Hands are "curated trusted packages." This is exactly what the Researcher/Lead/Trader Hands rely on.
2. **Default timeout** — `policy.timeout_secs` (default 300 s, configurable). On timeout: `ApprovalDecision::TimedOut` → kernel returns `Ok(false)` → tool runner returns "Execution denied: ... requires human approval and was denied or timed out." `approval.rs:80-95`.

### 7.4 Browser Hand purchase approval — the prompt-enforced gate

The Browser Hand HAND.toml at `crates/openfang-hands/bundled/browser/HAND.toml:146-155`:

```markdown
### Phase 4 — MANDATORY Purchase/Payment Approval
**CRITICAL RULE**: Before completing ANY purchase, payment, or form submission that involves money:
1. Summarize what you are about to buy/pay for
2. Show the total cost
3. List all items in the cart
4. STOP and ask the user for explicit confirmation
5. Only proceed after receiving clear approval

NEVER auto-complete purchases. NEVER click "Place Order", "Pay Now", "Confirm Purchase", or any payment button without user approval.
```

**The gap** — this is **prompt-enforced only**. There is no code-level block that prevents `browser_click` from clicking a `[data-testid="checkout"]` selector. A misbehaving or jailbroken model would ignore the prompt.

A second confirming fact: the Browser Hand is registered with a `hand:` tag, so the *runtime* approval gate (`kernel.rs:7588-7591`) auto-approves all its tool calls. The "mandatory purchase approval" gate is purely the LLM obeying its system prompt.

R3 flagged this as a gap (`round-3-crossref/deep-subsystems.md:109`); the deep source confirms it. The mitigation in OpenFang is the *behavioral* one — the prompt is highly specific (5 numbered steps, repeated `NEVER` clauses), and the model is `claude-sonnet-4` with temperature `0.3` (HAND.toml:118-119).

### 7.5 Approval UX — dashboard + CLI + channel

Three surfaces:

- **Dashboard** at `http://localhost:4200/api/approvals` — `routes.rs:10770-10849`. Lists pending and recent (last 50) with fields renamed for the dashboard template: `action_summary` → `action`, `agent_id` → `agent_name`, `requested_at` → `created_at`. Sorted with pending first, then by `created_at` desc.

- **REST endpoints** at `routes.rs:10866-10963`:
  - `POST /api/approvals` — manually create a request (for external integrations). Returns `{id, status: "pending"}`.
  - `POST /api/approvals/{id}/approve` — approve. Records `decided_by = "api"`.
  - `POST /api/approvals/{id}/reject` — reject. Same shape.

- **Channel bridge** at `crates/openfang-api/src/channel_bridge.rs:622-685` — exposes `/approve <id>` and `/reject <id>` text commands. Used by chat-ops flows (e.g. Telegram operator approves a Hand's action from a phone).

- **Toast notification** at `static/js/app.js:161-170` — polls the approvals endpoint on the dashboard and shows a warning toast when there's a pending approval.

**No webhook delivery** — there is no `outbound_webhook` field on the approval request. The three surfaces above are the complete set.

### 7.6 Auto-disable on consecutive failures

`approval.rs:60-63`:

```rust
if agent_pending >= MAX_PENDING_PER_AGENT {
    warn!(agent_id = %req.agent_id, "Approval request rejected: too many pending");
    return ApprovalDecision::Denied;
}
```

`MAX_PENDING_PER_AGENT = 5` (line 13). If a single agent has 5 pending requests, the 6th is auto-denied. This is a back-pressure mechanism to prevent an agent from spamming the approval UI.

---

## 8. Comparison to Other Sandboxes

| Sandbox | Strengths | Weaknesses | OpenFang equivalent |
|---------|-----------|------------|---------------------|
| **Docker** | Real syscalls, easy local dev, mature | 500 MB daemon, 6 s cold start (README:200), cgroup limits are best-effort under load, `--privileged` footguns | `docker_sandbox.rs` (635 LOC) — opt-in only, requires `docker.enabled=true` and `cap-drop ALL`, `no-new-privileges` (`docker_sandbox.rs:115-117`). Not the default. |
| **gVisor** | Strong kernel isolation (pTrace-based filter) | Requires custom kernel module, 2-3× syscall overhead, containerd integration needed | Not supported. WASM is simpler and OS-independent. |
| **Firecracker** | Sub-second microVM start, AWS-grade isolation | Needs KVM, 50-100 MB overhead per microVM, complex setup | Not supported. |
| **nsjail** | Single-binary, namespace-based, Google-grade | Requires root or user namespaces, ~10 MB overhead | Not supported. |
| **bubblewrap** | User-namespace-only, flatpak-style | Linux-only, no macOS | Not supported. |
| **WASM** (OpenFang) | OS-independent, deterministic metering, no host kernel surface | No real syscalls, no fork, must re-implement host functions | **Default for user-provided modules.** `WasmSandbox` (614 LOC), `host_functions.rs` (617 LOC). |

The WASM choice is consistent with OpenFang's positioning as a single 32 MB binary (`README.md:201`) that runs on macOS, Linux, and Windows. Docker would require a sidecar daemon; gVisor/Firecracker would require Linux + KVM; bubblewrap would require Linux. WASM works everywhere.

The trade-off — no real syscalls — is acceptable because OpenFang's tool surface is LLM-mediated: the WASM guest only needs to call back into the host, not actually `read()` files itself. The host exposes `fs_read`, `net_fetch`, `shell_exec` etc. as explicit, capability-checked host functions. This is **less ergonomic than Docker** (which gives you a real shell, real filesystem, real network) but **more auditable** (every capability boundary is a code-level check).

---

## 9. Limitations

### 9.1 What WASM can't do

- **No fork/exec from the guest** — WASM has no process concept. A guest that wants to spawn `ffmpeg` must call `host_call("shell_exec", ...)` and the host subprocess sandbox checks apply. This means a guest cannot, e.g., spawn a child worker pool of its own.
- **No real filesystem** — `fs_read`/`fs_write` are host functions that go through `safe_resolve_path`. A guest cannot `mmap`, cannot `open` raw file descriptors, cannot tail a log. To tail, the guest must call `fs_read` repeatedly (still subject to loop guard).
- **No real network sockets** — `net_fetch` is a single HTTP request. No WebSocket, no listening socket, no raw TCP. The Browser Hand needs real sockets and runs outside the WASM sandbox.
- **No shared memory with the host** — all data crosses the JSON RPC boundary in `host_call`. Large payloads (10 MB JSON) are expensive.
- **No multi-threading** — WASM threads are available in Wasmtime but OpenFang does not use them. A guest is single-threaded.

### 9.2 Where OpenFang drops to native execution

The kernel has three execution modes (`kernel.rs:2486-2627`):

- `module = "wasm:..."` → `execute_wasm_agent` → `WasmSandbox::execute`
- `module = "python:..."` → `execute_python_agent` → `python_runtime::run_python_agent` (subprocess, no WASM)
- `module = "builtin:chat"` → `execute_chat_agent` → the regular LLM loop (`agent_loop.rs`)

The 53 built-in tools and the 9 bundled Hands all use `builtin:chat`. WASM is reserved for **user-registered third-party modules**. The bundled Hand manifests (`crates/openfang-hands/bundled/*/HAND.toml`) all set `module = "builtin:chat"`.

Other native execution paths:

- **Browser Hand** — `crates/openfang-runtime/src/browser.rs:1362 LOC` implements native Chrome DevTools Protocol over WebSocket. The `browser_navigate` tool connects to `ws://localhost:{port}/devtools/browser/{id}` directly. No WASM, no Python — direct Rust.
- **Docker sandbox** — `docker_sandbox.rs:635 LOC` shells out to `docker run` with `--cap-drop ALL` and `--security-opt no-new-privileges`. Used only when an agent has `docker.enabled=true` in its config.
- **Subprocess sandbox** — `subprocess_sandbox.rs:1240 LOC` for `shell_exec` with `env_clear()`, metacharacter block, exec policy.

### 9.3 Memory enforcement gap

`sandbox.rs:38-39` reserves `max_memory_bytes` for future enforcement. Today the Wasmtime store's linear memory can grow up to the module's declared `memory.max` (default 4 GiB). For untrusted modules, this is the largest remaining hole. The practical mitigations:

- The default module is `ECHO_WAT` with `(memory (export "memory") 1)` — one 64 KiB page.
- The kernel's `max_memory_bytes` is read from the manifest but never enforced; a module that declares `(memory 1000)` (64 MB) will be allowed.
- The honest fix would be `Store::limiter(|_| Some(max))` (Wasmtime 18+ API) or `Store::set_memory_growth_step`.

This is the **single most concrete improvement** that would close the gap between OpenFang's "dual-metered sandbox" claim and the actual runtime behavior.

### 9.4 No replay protection for OFP

Separate from the WASM sandbox: the OFP (OpenFang Wire Protocol) uses HMAC-SHA256 nonce-based auth (`crates/openfang-wire/src/peer.rs:28-60`). The nonce tracker has a 5-minute replay window. Outside that window, a captured handshake can be replayed. This is documented in the `peer.rs:28-39` comment and is acceptable for the agent-to-agent threat model (5 min is short relative to OFP session lifetime), but would be a gap if OpenFang were exposed to a network adversary.

---

## 10. Code References

| Claim | Location |
|-------|----------|
| Wasmtime engine init with fuel + epoch | `crates/openfang-runtime/src/sandbox.rs:108-116` |
| Single shared engine per kernel | `crates/openfang-kernel/src/kernel.rs:815-817` |
| SandboxConfig with capabilities + ssrf_allowed_hosts | `crates/openfang-runtime/src/sandbox.rs:34-48` |
| WASM execution on blocking thread | `crates/openfang-runtime/src/sandbox.rs:136-149` |
| Fuel metering + epoch watchdog | `crates/openfang-runtime/src/sandbox.rs:178-191` |
| Host function dispatch | `crates/openfang-runtime/src/host_functions.rs:19-49` |
| Capability check in host function | `crates/openfang-runtime/src/host_functions.rs:57-67` |
| SSRF check delegated from host_call | `crates/openfang-runtime/src/host_functions.rs:230-238` |
| WASM execute trap mapping | `crates/openfang-runtime/src/sandbox.rs:240-253` |
| Module dispatch (WASM/Python/LLM) | `crates/openfang-kernel/src/kernel.rs:2486-2627` |
| 53 builtin tools definitions | `crates/openfang-runtime/src/tool_runner.rs:567-1340` |
| Tool runner capability gate | `crates/openfang-runtime/src/tool_runner.rs:132-144` |
| Tool runner approval gate | `crates/openfang-runtime/src/tool_runner.rs:166-200` |
| shell_exec metacharacter block | `crates/openfang-runtime/src/tool_runner.rs:247-259` |
| Exec policy enforcement | `crates/openfang-runtime/src/tool_runner.rs:262-275` |
| Workspace sandbox path resolution | `crates/openfang-runtime/src/workspace_sandbox.rs:15-69` |
| Subprocess env_clear | `crates/openfang-runtime/src/subprocess_sandbox.rs:46-78` |
| Capability type + inheritance check | `crates/openfang-types/src/capability.rs:9-187` |
| CapabilityManager grant/check | `crates/openfang-kernel/src/capabilities.rs:23-48` |
| Manifest signing (Ed25519) | `crates/openfang-types/src/manifest_signing.rs:38-107` |
| Approval manager | `crates/openfang-kernel/src/approval.rs:37-187` |
| Approval auto-approve for hand agents | `crates/openfang-kernel/src/kernel.rs:7588-7591` |
| SSRF hostname blocklist | `crates/openfang-runtime/src/web_fetch.rs:211-225` |
| SSRF private IP blocklist | `crates/openfang-runtime/src/web_fetch.rs:352-366` |
| SSRF cloud metadata IPs | `crates/openfang-runtime/src/web_fetch.rs:261-274` |
| SSRF CIDR matching | `crates/openfang-runtime/src/web_fetch.rs:296-349` |
| Web fetch pipeline | `crates/openfang-runtime/src/web_fetch.rs:46-166` |
| Browser Hand purchase approval gate | `crates/openfang-hands/bundled/browser/HAND.toml:146-155` |
| REST approvals endpoints | `crates/openfang-api/src/routes.rs:10770-10963` |
| REST audit verify endpoint | `crates/openfang-api/src/routes.rs:5280-5307` |
| Loop guard | `crates/openfang-runtime/src/loop_guard.rs:124-200` |
| Docker sandbox | `crates/openfang-runtime/src/docker_sandbox.rs:94-635` |
| Docker capability dropping | `crates/openfang-runtime/src/docker_sandbox.rs:115-117` |
| README claim of 16 security layers | `repos/openfang/README.md:206-227` |

---

**Word count:** ~4,400