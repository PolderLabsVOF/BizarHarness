# Hermes Agent — Round 4 Deep Dive: Long-Horizon Coding Backends

**Scope.** How Hermes handles multi-hour, multi-file coding tasks. The file-editing primitives, the code-search surface, the patch format, the six terminal backends, the long-running session lifecycle, the cross-agent file-state registry, the LSP integration, the workspace model, and how it all fits together. Verified against `repos/hermes-agent/` at the captured snapshot (commit `8301654 fix(web): refresh dashboard model picker`).

**Author:** @tyr (round-4 hermes-deep). **Date:** 2026-07-06.

---

## 0. The Footprint-Ladder Lens (Hermes' Self-Imposed Constraint)

Before the code, the constraint that shapes almost every tool decision in Hermes: **per-conversation prompt caching is sacred** (`AGENTS.md` §"Prompt Caching Must Not Break"). The system prompt is built once per conversation and never mutated mid-loop. Skills inject as **user** messages, not as system-prompt additions, precisely so the cached prefix survives.

The second constraint is the **footprint ladder** (`AGENTS.md` §"The Footprint Ladder"). A new model tool ships on every API call, so the bar for a *core* tool is high. The order of preference is:

1. Extend existing code (zero new surface)
2. CLI command + skill (zero model-tool footprint)
3. Service-gated tool (`check_fn`) — only appears when a prerequisite is configured
4. Plugin (third-party / niche)
5. MCP server in the catalog
6. New core tool — last resort

For coding, that means the agent is steered away from specialised "code edit" tools and towards the universal `terminal + file` surface, with **patch + search_files + read_file + write_file** as the small, narrow code-editing core. This is exactly the SWE-agent lesson (round-3 cross-ref §4.4: "a small, carefully designed tool surface outperforms a large toolkit"), implemented as policy.

---

## 1. File Editing Primitives

### 1.1 The four core file tools

All four are registered in `tools/file_tools.py:2170-2173`:

```python
registry.register(name="read_file",  toolset="file", schema=READ_FILE_SCHEMA,  handler=_handle_read_file,  check_fn=_check_file_reqs, emoji="📖", max_result_size_chars=100_000)
registry.register(name="write_file", toolset="file", schema=WRITE_FILE_SCHEMA, handler=_handle_write_file, check_fn=_check_file_reqs, emoji="✍️", max_result_size_chars=100_000)
registry.register(name="patch",      toolset="file", schema=PATCH_SCHEMA,      handler=_handle_patch,      check_fn=_check_file_reqs, emoji="🔧", max_result_size_chars=100_000)
registry.register(name="search_files", toolset="file", schema=SEARCH_FILES_SCHEMA, handler=_handle_search_files, check_fn=_check_file_reqs, emoji="🔎", max_result_size_chars=100_000)
```

**`read_file`** (`file_tools.py:1044-1139` in `ShellFileOperations`): read with offset/limit pagination, binary detection via `BINARY_EXTENSIONS`, 1-indexed line numbers in `LINE_NUM|CONTENT` format (`file_operations.py:869-893` — *deliberately* bare prefix, not zero-padded: "the padding was pure token overhead … an A/B (Sonnet 4.6, 2 passes) showed the compact gutter matches the padded gutter on line-reference / patch / value-lookup / structure tasks (4/4 both), while dropping line numbers entirely regressed line-referencing (3/4)"). 

Cap = 100K chars (`file_tools.py:59 _DEFAULT_MAX_READ_CHARS`), configurable via `file_read_max_chars` in config. On overflow, `read_file` trims to the last complete line that fits and returns `next_offset` — a "graceful char-budget truncation" ported from `nearai/ironclaw#5029` (`file_tools.py:86-127`).

**`write_file`** (`file_operations.py:1311-1459`): pipes content through stdin to avoid OS ARG_MAX limits (`file_operations.py:1315-1317`), creates parent dirs, runs a post-write lint check, runs an LSP semantic-diagnostics check, and writes atomically. The atomic write is a temp-file + rename in the same directory (`file_operations.py:937-989`):

```bash
tmp=$(mktemp -p "$d" .hermes-tmp.XXXXXX ...)   # mktemp collision-safe
chmod --reference "$t" "$tmp" 2>/dev/null || true  # preserve mode
cat > "$tmp"
mv -f "$tmp" "$t"                              # atomic on POSIX same-FS
trap 'rm -f "$tmp"' EXIT                      # cleanup on any failure
```

Same-directory is load-bearing — `mv` across filesystems degrades to copy+unlink, which is NOT atomic; keeping the temp beside the target guarantees a real rename (`file_operations.py:1412-1415`).

**`patch`** (`file_operations.py:1465-1586`): the headline atomic edit operation. Two modes (`file_tools.py:2045-2094` schema):
- `mode="replace"` — single-file find-and-replace via `patch_replace`
- `mode="patch"` — V4A multi-file bulk patch (see §1.4)

`replace_all=False` requires uniqueness; `replace_all=True` replaces all occurrences.

**`search_files`** (`file_operations.py:1962-2300`): the universal search tool. `target="content"` → ripgrep/grep content search; `target="files"` → file-by-name glob. Cap = 50 results, configurable.

### 1.2 Patch is fuzzy-match, not AST-based

Hermes' "patch-based editing" claim is **9-strategy fuzzy string replacement**, not tree-sitter or AST. From `tools/fuzzy_match.py:50-150` `fuzzy_find_and_replace`:

```python
strategies = [
    ("exact",                  _strategy_exact),
    ("line_trimmed",           _strategy_line_trimmed),
    ("whitespace_normalized",  _strategy_whitespace_normalized),
    ("indentation_flexible",   _strategy_indentation_flexible),
    ("escape_normalized",      _strategy_escape_normalized),
    ("trimmed_boundary",       _strategy_trimmed_boundary),
    ("unicode_normalized",     _strategy_unicode_normalized),
    ("block_anchor",           _strategy_block_anchor),
    ("context_aware",          _strategy_context_aware),
]
```

The strategies are tried in order. The first one that finds a match wins. For non-exact strategies, the code runs additional guards:

- **Escape-drift detection** (`fuzzy_match.py:_detect_escape_drift`, ~`fuzzy_match.py:96-110`): if the match was found via normalization AND `new_string` contains `\'` or `\"` shell/JSON escapes that the matched region doesn't, the patch is BLOCKED with an explanatory error. This catches the "model typed an apostrophe and the transport added a stray backslash" failure mode.
- **`\t` / `\r` unescape heuristic** (`fuzzy_match.py:_maybe_unescape_new_string`, ~`fuzzy_match.py:117-135`): when the matched region of the file contains a real tab, `new_string`'s `\t` (backslash + t) is unescaped to a real tab. Without this, files with tabs would end up with literal two-character `\t` sequences.
- **Unicode preservation** (`fuzzy_match.py:_preserve_unicode_in_replacement`, ~`fuzzy_match.py:140-148`): when strategy 7 matched, the file has Unicode (em-dashes, smart quotes) but old_string/new_string from the LLM are ASCII. The replacement is aligned with the file's actual Unicode so unchanged portions keep their original characters.

On multi-occurrence (with `replace_all=False`), the patch returns a `len(matches)>1` error instructing the model to "Provide more context to make it unique, or use replace_all=True" (`fuzzy_match.py:90-94`).

### 1.3 Patch post-conditions and verification

After a successful match, the patch is applied by `write_file` (which runs the atomic-write dance and the lint check), then re-verified:

```python
# file_operations.py:1539-1564
verify_cmd = f"cat {self._escape_shell_arg(path)} 2>/dev/null"
verify_result = self._exec(verify_cmd)
# normalize line endings, compare
if _verify_stdout_normalized != _new_content_normalized:
    return PatchResult(error="Post-write verification failed: ...")
```

Catches the "silent persistence failure" bug class: backend FS oddities, race with another task, truncated pipe, where the write returned success-with-diff but the file is unchanged on disk.

**Result includes**:
- `diff` — unified diff via `difflib.unified_diff` (`file_operations.py:1029-1038`)
- `lint` — post-write syntax-check results
- `lsp_diagnostics` — post-write LSP semantic diagnostics (local backend only)
- `files_modified` — absolute resolved path (so worktree cwd mismatches are visible)
- `error` — if patch did not match

### 1.4 V4A multi-file patch format

`mode="patch"` accepts V4A format, the same dialect Codex and Cline use. From `tools/patch_parser.py:1-25`:

```
*** Begin Patch
*** Update File: path/to/file.py
@@ optional context hint @@
 context line (space prefix)
-removed line (minus prefix)
+added line (plus prefix)
*** Add File: path/to/new.py
+new file content
+line 2
*** Delete File: path/to/old.py
*** Move File: old/path.py -> new/path.py
*** End Patch
```

The parser (`patch_parser.py:69-200`) recognises `Update`, `Add`, `Delete`, `Move` operations and `@@ … @@` context hints. `*** Move File: src -> dst` is supported — both endpoints are checked for `..` traversal and for the sensitive-path blocklist (`file_tools.py:1766-1775`).

For multi-file V4A patches, paths are resolved, ordered, deduplicated, and **per-path locks are acquired in sorted order via `ExitStack`** (`file_tools.py:1792-1806`) to prevent deadlock on overlapping multi-file patches.

### 1.5 No dedicated test runner tool, no dedicated git tool

There is no `run_tests`, `pytest`, or `cargo test` tool. Tests are run through the `terminal` tool. The `skills/software-development/test-driven-development/SKILL.md:310-316` skill says so explicitly:

```
terminal("pytest tests/test_feature.py::test_name -v")
terminal("pytest tests/ -q")
```

There is also no dedicated `git_commit`, `git_branch`, or `gh_pr_create` tool. Git operations go through `terminal` (raw `git` commands). PR creation uses `terminal("gh pr create")`. The `skills/github/` skill provides the PR workflow as guidance, not as a tool.

**Per Hermes' footprint-ladder policy** (`AGENTS.md`): "A new core tool when terminal + file already do the job, or when a skill would. If the only barrier is file visibility on a remote backend, fix the mount, not the toolset."

---

## 2. Code Search

### 2.1 search_files is the universal search tool

`search_files(target="content", pattern=..., path=..., file_glob=..., output_mode=..., context=N)` — the entire ripgrep surface exposed through one tool. The handler is in `file_tools.py:2159-2167`, the implementation in `file_operations.py:1962-2300`.

**Backend preference** (`file_operations.py:2160-2172`):
- If `rg` is on PATH: `ripgrep` — parallel traversal, respects `.gitignore`, excludes hidden dirs by default, "faster than find on wide trees"
- Else if `grep` is on PATH: GNU grep with `--exclude-dir='.*'`
- Else: error "Install ripgrep: https://github.com/BurntSushi/ripgrep#installation"

**Output modes** (`file_operations.py:2190-2194`):
- `content` (default) — `file:line:content` with optional context
- `files_only` — `-l` flag
- `count` — `-c` flag

### 2.2 Result truncation and round-trip safety

Three deliberate safety details:

1. **Diagnostic-vs-payload splitting** (`file_operations.py:347-393` `_split_tool_diagnostics`): `_exec` merges stderr into stdout (`stderr=subprocess.STDOUT`), so rg/grep error lines are interleaved with match output. The code classifies each line by *shape* (`file:line:content` regex for matches, `rg:`/`grep:` prefix for diagnostics). The shape-based classifier is what lets the exit-2 guard distinguish a pure failure (no payload → error) from a partial failure (some matches, one unreadable file → keep matches).
2. **set -o pipefail** (`file_operations.py:2205-2210`): the rg command is run as `set -o pipefail; rg … | head -n N`. Without this, the pipeline reports head's exit code 0 and masks rg's exit code 2 (a real error).
3. **Result densification** (`file_operations.py:248-280`): when `total_count >= 5` matches, the verbose `{"path", "line", "content"}` array is collapsed to a path-grouped text block — one path header, then `  <line>: <content>` rows. Path-grouping is lossless (path, line, content all preserved) and saves tokens on dense source.

### 2.3 Search truncation signals

`search_files` returns:
- `truncated: true` when result count exceeds the page
- A literal `Hint: Results truncated. Use offset=<next> to see more, or narrow with a more specific pattern or file_glob.` footer (`file_tools.py:1992-1994`)

### 2.4 Loop guard on repeated search

`_read_tracker` (`file_tools.py:1935-1955`) tracks `(pattern, target, path, file_glob, limit, offset)` per task. On 3 consecutive identical searches, a warning is appended. On 4, the search is HARD BLOCKED with the message: "BLOCKED: You have run this exact search 4 times in a row. The results have NOT changed. STOP re-searching and proceed with your task." The block is reset when any other tool call runs (`notify_other_tool_call` at `file_tools.py:1499-1516`).

### 2.5 "Search through terminal backend" pattern (from R2)

The pattern from R2 — "the entire search surface goes through the terminal backend, so `search_files` works identically on local, docker, ssh, modal, daytona" — is concretely just `self.env.execute("rg …")` (`file_operations.py:2229`). The `_exec()` resolver picks up the live `env.cwd`, so a `cd` in a prior `terminal` call changes the next `search_files`'s root automatically.

---

## 3. Test Runner, Git, Build — the Unification

**There is no test runner, no git tool, no build tool.** All of those are `terminal` calls. Why? Three reasons traceable to the code:

1. **Footprint ladder** (above): every new core tool is paid for on every API call. SWE-agent's lesson (§1.4 of round-3) is that 7 well-designed tools beat 50 generic ones. `terminal` already exists; the "add a `pytest` tool" is a regression.
2. **Tests are language-specific**. A test runner tool would have to either know all 7 test frameworks (pytest, jest, mocha, go test, cargo test, maven, gradle) or expose them as 7 separate tools. Both options are worse than `terminal("pytest …")`.
3. **Project conventions vary.** A monorepo might use `make test`, a Python project uses `pytest -xvs tests/`, a Rust project uses `cargo test --workspace`. The model is better at reading the project README than we are at pre-building the schema.

Same for `git` (commands vary by workflow: `git rebase -i` vs `git pull --rebase` vs `git switch -c …`) and `build` (no two projects' build commands are alike).

What the **skills** provide for these is the *workflow* — the `skills/github/` skill teaches PR conventions, the `skills/software-development/test-driven-development/SKILL.md` skill teaches TDD discipline — but the agent still runs the actual commands via `terminal`.

---

## 4. The Six Terminal Backends — Deep Dive

### 4.1 The unified abstraction

`tools/environments/base.py:290-300` defines the abstract base class:

```python
class BaseEnvironment(ABC):
    _stdin_mode: str = "pipe"   # "pipe" or "heredoc"
    _snapshot_timeout: int = 30

    def __init__(self, cwd: str, timeout: int, env: dict = None):
        self.cwd = cwd
        self.timeout = timeout
        self.env = env or {}
        self._session_id = uuid.uuid4().hex[:12]
        temp_dir = self.get_temp_dir().rstrip("/") or "/"
        self._snapshot_path = f"{temp_dir}/hermes-snap-{self._session_id}.sh"
        self._cwd_file = f"{temp_dir}/hermes-cwd-{self._session_id}.txt"
        self._cwd_marker = _cwd_marker(self._session_id)
        self._snapshot_ready = False

    @abstractmethod
    def _run_bash(self, cmd_string, *, login=False, timeout=120, stdin_data=None) -> ProcessHandle: ...

    @abstractmethod
    def cleanup(self): ...
```

The key invariant — **spawn-per-call** — is in the module docstring (`base.py:1-7`):

> Unified spawn-per-call model: every command spawns a fresh `bash -c` process. A session snapshot (env vars, functions, aliases) is captured once at init and re-sourced before each command. CWD persists via in-band stdout markers (remote) or a temp file (local).

So no backend keeps a persistent shell. Every `terminal("ls")` is a brand-new `bash -c '…'`. The "session" is purely:
- An env-var snapshot file
- A CWD marker (in-band `__HERMES_CWD_<sid>__` for remote, temp file for local)

### 4.2 The `execute()` flow — shared by all six backends

`base.py:889-935` is the unified execution path. Every backend inherits it.

```python
def execute(self, command, cwd="", *, timeout=None, stdin_data=None,
            rewrite_compound_background=True):
    self._before_execute()                             # hook: SSH/Modal sync
    exec_command, sudo_stdin = self._prepare_command(command)
    if rewrite_compound_background:
        from tools.terminal_tool import _rewrite_compound_background
        exec_command = _rewrite_compound_background(exec_command)
    effective_timeout = timeout or self.timeout
    effective_cwd = cwd or self.cwd
    if effective_stdin and self._stdin_mode == "heredoc":
        exec_command = self._embed_stdin_heredoc(exec_command, effective_stdin)
        effective_stdin = None
    wrapped = self._wrap_command(exec_command, effective_cwd)  # source snap + cd + eval + CWD marker
    login = not self._snapshot_ready
    proc = self._run_bash(wrapped, login=login, timeout=effective_timeout, stdin_data=effective_stdin)
    result = self._wait_for_process(proc, timeout=effective_timeout)
    self._update_cwd(result)
    return result
```

The `_wrap_command` template (`base.py:463-527`) is:

```bash
source /tmp/hermes-snap-<sid>.sh >/dev/null 2>&1 || true
builtin cd -- /cwd || exit 126
eval '<escaped-command>'
__hermes_ec=$?
{ export -p > /tmp/hermes-snap-<sid>.tmp.$BASHPID && mv -f …tmp… /tmp/hermes-snap-<sid>.sh; } 2>/dev/null || rm -f …tmp… 2>/dev/null
pwd -P > /tmp/hermes-cwd-<sid>.txt 2>/dev/null
printf '\n__HERMES_CWD_<sid>__%s__HERMES_CWD_<sid>__\n' "$(pwd -P)"
exit $__hermes_ec
```

**Two important details**:

1. **Atomic snapshot replacement** (`base.py:475-481, 510-514`): the snapshot is rebuilt into a temp file keyed on `$BASHPID` (NOT `$$`, which is the parent PID even in `&`-launched subshells), then mv-replaced. This closes the "two concurrent writers clobber each other's temp" race in issue #38249.

2. **CWD marker**: the marker is emitted on its own line with a leading `\n` so commands that don't end with `\n` (e.g. `printf 'exact'`) still parse cleanly. `_extract_cwd_from_output` (`base.py:837-869`) finds the last `__MARKER__<path>__MARKER__` occurrence, updates `self.cwd`, and strips the marker from the response.

### 4.3 The session snapshot — what survives across calls

`init_session` (`base.py:353-446`) runs **once** after backend construction, capturing the full state of a login shell:

```bash
export -p > /tmp/hermes-snap-<sid>.tmp.$BASHPID  # all env vars
__hermes_fns=$(declare -F | awk '{print $3}' | grep -vE '^_[^_]') || true
[ -n "$__hermes_fns" ] && declare -f $__hermes_fns >> /tmp/hermes-snap-<sid>.tmp.$BASHPID 2>/dev/null
alias -p >> /tmp/hermes-snap-<sid>.tmp.$BASHPID
echo 'shopt -s expand_aliases' >> /tmp/hermes-snap-<sid>.tmp.$BASHPID
echo 'set +e' >> /tmp/hermes-snap-<sid>.tmp.$BASHPID
echo 'set +u' >> /tmp/hermes-snap-<sid>.tmp.$BASHPID
mv -f /tmp/hermes-snap-<sid>.tmp.$BASHPID /tmp/hermes-snap-<sid>.sh
builtin cd -- <quoted-cwd> 2>/dev/null || true
pwd -P > /tmp/hermes-cwd-<sid>.txt 2>/dev/null
```

Crucially, **functions are filtered by NAME, not by line** — the `grep -vE '^_[^_]'` line-based filter is wrong because it strips the function header but leaves the orphaned `{ … }` body. The correct approach (`base.py:399-413`): use `declare -F` to get the names list, filter the names, then dump *only the matching whole definitions* with `declare -f $names`. Plus the `__hermes_fns` non-empty guard — bare `declare -f` with no args dumps ALL functions, leaking the very private (`_`-prefixed) helpers we wanted to filter.

If `init_session` fails, the wrapper falls back to `bash -l -c` per call (`base.py:927`) — the user's profile still loads, but each command is slower (no source-cache).

### 4.4 ProcessHandle protocol — bridges subprocess and SDK

`base.py:189-274`:

```python
class ProcessHandle(Protocol):
    def poll(self) -> int | None: ...
    def kill(self) -> None: ...
    def wait(self, timeout: float | None = None) -> int: ...
    @property def stdout(self) -> IO[str] | None: ...
    @property def returncode(self) -> int | None: ...
```

`subprocess.Popen` satisfies this natively. SDK backends (Modal, Daytona) return `_ThreadedProcessHandle` which wraps a blocking `exec_fn() -> (output_str, exit_code)` in a background thread, exposes a stdout pipe via `os.pipe()`, and has an optional `cancel_fn` for backend-specific cancellation (`base.py:208-273`). The unified `_wait_for_process` (`base.py:543-820`) works on both.

### 4.5 The `_wait_for_process` loop

`base.py:543-820` is the cross-backend wait loop. Notable features:

- **Non-blocking drain via `select()`** (`base.py:651-666`): the old `for line in proc.stdout` pattern blocks on `readline()` until the pipe reaches EOF. When the user's command backgrounds a process (`cmd &`, `setsid cmd & disown`), the grandchild inherits the write end of the pipe and keeps it open after bash exits, so the drain hangs forever (issue #8340). The fix: `select()` with 100ms poll, stop draining ~3 cycles (~300ms) after `bash` exits.
- **UTF-8 incremental decoder** (`base.py:585, 597-611, 678-682`): raw `os.read()` returns bytes that may split a multibyte character across chunks. The `codecs.getincrementaldecoder("utf-8")(errors="replace")` buffers partial sequences, and `errors="replace"` mirrors the baseline `TextIOWrapper` (constructed with `encoding="utf-8", errors="replace"`).
- **Interrupt detection** (`base.py:717-729`): on every iteration, `is_interrupted()` is checked; if true, the process is killed and rc=130 is returned.
- **Timeout enforcement** (`base.py:730-746`): `time.monotonic()` against `deadline = start + timeout`; on timeout, the process is killed and rc=124 is returned with `\n[Command timed out after Ns]` appended to the output.
- **Process-group kill** (`local.py:1059-1131`): the local backend spawns subprocesses with `os.setsid()` so they get their own process group. `_kill_process` does SIGTERM to the group, waits 1s, then SIGKILL, then waits 2s. The wait-for-exit loop polls `killpg(pgid, 0)` — the wrapper can exit before grandchildren, and returning at that point leaves orphaned group members.
- **Activity callback** (`base.py:689-748`, `set_activity_callback` at `base.py:47-79`): every ~10s, the loop fires an `activity_callback` so the gateway knows the process is alive and the inactivity timeout doesn't kill it. The thread-local storage (`_activity_callback_local`) means a worker thread's callback doesn't leak to other threads.

### 4.6 Backend-by-backend

**Local** (`tools/environments/local.py`, 1207 lines): 
- `_run_bash` (line 989-1057) spawns `bash -c` (or `bash -l -c` for `init_session`) with `subprocess.Popen(text=True, env=run_env, cwd=_popen_cwd, start_new_session=True)`. `start_new_session=True` puts the subprocess in its own process group.
- Env-var scrubbing is heavy (`local.py:119-432`): `_build_provider_env_blocklist` derives the blocklist from `PROVIDER_REGISTRY.api_key_env_vars` plus `OPTIONAL_ENV_VARS` in `tool`/`messaging`/`setting`/`password` categories, plus a hard-coded fallback set (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.). The intent is hermes-internal secrets must NOT leak to the local terminal.
- `_resolve_safe_cwd` (line 61-91): if the cwd doesn't exist (e.g. a previous `rm -rf` deleted it), walk up the parents until one exists; fall back to `tempfile.gettempdir()`. Without this, a single `rm -rf` in a prior command wedges every subsequent terminal call.
- CWD is read from the temp file (`local.py:1138-1161`), not from a stdout marker.
- Init cost: zero (subprocess is local, snapshot writes to local `/tmp` or `%TEMP%`).

**Docker** (`tools/environments/docker.py`, 1460 lines):
- Two modes (`docker.py:580-602`):
  - `persistent_filesystem=True` (default) — `/workspace` and `/root` are **bind-mounted** from `~/.hermes/sandboxes/docker/<task_id>/workspace` and `~/.hermes/sandboxes/docker/<task_id>/home` (line 680-692). State survives container teardown.
  - `persistent_filesystem=False` — `/workspace` is a 10G tmpfs, `/home` and `/root` are 1G tmpfs (line 693-701). Ephemeral, fast, gone on cleanup.
- Cross-process container reuse (line 885-964, issue #20561): the docs promise "ONE long-lived container shared across sessions". The implementation labels containers `hermes-agent=1`, `hermes-task-id=<tid>`, `hermes-profile=<profile>`, and probes for an existing labeled container at startup; if found and running, attach to it instead of starting a fresh one. Opt out via `terminal.docker_persist_across_processes: false`.
- Network-mode guard on reuse (line 902-938): a container created before the operator set `docker_network: false` keeps its original bridge NetworkMode. Label-only reuse would hand the agent a networked container despite the config — on mismatch the stale container is removed and a fresh one started.
- Container startup uses `docker run -d … sleep infinity` (line 979). No fixed lifetime — the idle reaper handles cleanup (line 1542-1601 in `terminal_tool.py`).
- "No such container" recovery (line 1083-1191): if the container was removed out-of-band (idle reaper, docker prune, OOM, daemon restart), the next `execute()` detects the error and recreates the container transparently. Label-based reuse is tried first; if no existing container, a fresh one is started.
- Resource limits via cgroup probes (line 449-499): `--cpus`, `--memory`, `--pids-limit` are gated on `_cgroup_limits_available(image)` because unprivileged LXCs without cgroup delegation degrade badly.
- Security: `all caps dropped`, `no-new-privileges`, `read-only /etc` (line 316-365). `podman` is detected and used as the runtime if present (line 270-302).
- Orphan reaper (line 141-267): sweeps `status=exited` containers older than `2 × lifetime_seconds` that match the current profile, conservative. Idempotent — runs once per process.
- Credential/skills/cache mounts: read-only mounts of OAuth tokens, skills dirs, cache dirs from the host into the container (line 709-787). Built via `tools/credential_files.py` registry.
- Init cost: cold = image pull (up to 120s) + container start (~1-3s). Warm = ~50ms (reused labeled container).

**SSH** (`tools/environments/ssh.py`, 375 lines): 
- `_build_ssh_command` (line 83-99) constructs the ssh invocation, `_establish_connection` (line 100-115) opens the master connection (ControlMaster), `_ssh_bulk_upload` (line 188-302) and `_scp_upload` (line 159-186) for file transfer.
- `_before_execute` (line 335-341) is the **only** non-trivial hook — it triggers the `FileSyncManager` to push changed host files into the remote.
- `_run_bash` (line 343-353) runs `ssh <host> bash -c '<wrapped>'` with the `ControlMaster` socket for connection reuse.
- CWD marker is parsed from stdout, not from a temp file (line 837-869 in `base.py`).
- Init cost: SSH connect (~100-500ms first time) + snapshot (~50ms).

**Singularity** (`tools/environments/singularity.py`, 265 lines):
- Instance-based: starts a long-lived `singularity instance start` (line 197-230) and runs commands via `singularity exec instance://<name>`.
- SIF cache at `~/.hermes/cache/singularity/<image>.sif` (line 93-156) — converted from Docker images via `singularity pull`. Subsequent uses skip the pull.
- CWD marker in stdout.
- Less feature-rich than Docker; mostly used in HPC environments where Docker isn't available.

**Modal** (`tools/environments/modal.py`, 478 lines):
- **Cold start = real** — Modal's `Sandbox.create()` is asynchronous; `_AsyncWorker` (`modal.py:127-160`) runs a persistent event loop on a daemon thread, and `run_coroutine(coro, timeout=600)` is the blocking bridge.
- Filesystem persistence via Modal's snapshot API (`modal.py:451-469`): on `cleanup()`, the sandbox calls `sandbox.snapshot_filesystem()` and stores the returned image_id in `~/.hermes/modal_snapshots.json` under the namespaced key `direct:<task_id>`. On next `__init__`, the stored snapshot id is loaded and passed to `Sandbox.create(image=restored_snapshot_id)` instead of the base image. If restore fails, falls back to the base image (`modal.py:265-271`).
- File upload/download via base64 through `sandbox.exec` stdin (modal.py:295-398), with a 1MB chunk size to stay under the SDK's per-write buffer limit. Bulk transfer uses `tar | base64 | tar xzf -` in a single stdin stream.
- `_before_execute` (line 400-402) calls `self._sync_manager.sync()` — the rate-limited FileSyncManager pushes host credential/cache files into the sandbox.
- `cancel_fn` for interrupts = `sandbox.terminate.aio()` (line 415-417), wrapped in `_ThreadedProcessHandle`.
- Init cost: cold = Modal cold start (~5-15s); warm (snapshot restored) = ~2-5s. Idle sandbox times out at Modal's server side; Hermes's `cleanup()` snapshots first, so an idle sandbox can be brought back.

**Daytona** (`tools/environments/daytona.py`, 270 lines): smaller file. Uses the Daytona SDK to create a workspace, runs commands via `workspace.process.exec`. Filesystem persistence via Daytona's workspace state. **Lazy-imported** (`terminal_tool.py:1515-1516`): Daytona SDK is only required when the user actually selects this backend.

**ManagedModal** (`tools/environments/managed_modal.py`, 282 lines): an alternative to direct Modal for Nous Research account holders. Goes through Nous's tool gateway instead of requiring direct Modal credentials. `create_sandbox` (line 172-200) calls `POST /v1/sandboxes` with `idleTimeoutMs=max(300_000, timeout*1000)`, `persistentFilesystem: persistent`, `logicalKey: task_id`. Sandbox IDs are gateway-issued; snapshot on terminate is also gateway-handled (`cleanup` line 154-170 calls `POST /v1/sandboxes/<id>/terminate` with `snapshotBeforeTerminate: self._persistent`). Polling for exec results via `GET /v1/sandboxes/<id>/execs/<exec_id>` (line 121-146). The "managed" choice is decided by `_get_modal_backend_state` in `terminal_tool.py:1381-1387` (calls `resolve_modal_backend_state` which checks `has_direct_modal_credentials` and `is_managed_tool_gateway_ready`).

### 4.7 The `BaseEnvironment` design — what's common, what differs

| Aspect | Local | Docker | SSH | Singularity | Modal | Daytona |
|--------|-------|--------|-----|-------------|-------|---------|
| **Execution** | `subprocess.Popen` | `docker exec` | `ssh … bash -c` | `singularity exec instance://…` | `Sandbox.exec.aio()` (heredoc stdin) | `workspace.process.exec` |
| **File access** | direct (host FS) | `docker exec` + bind mount | `scp`/`ssh` for sync | direct (host FS via overlay) | base64 through stdin + `tar` | SDK file ops |
| **State persistence** | temp files in `/tmp` | bind mounts in `~/.hermes/sandboxes/docker/<tid>/` | remote filesystem persists naturally | overlay FS persists | `sandbox.snapshot_filesystem()` → image_id stored in `~/.hermes/modal_snapshots.json` | Daytona workspace persists |
| **Init cost (cold)** | ~5ms | ~5-30s (image pull) | ~500ms (connect) | ~30-60s (SIF build first time) | ~5-15s | ~5-10s |
| **Init cost (warm)** | ~5ms | ~50ms (reused container) | ~50ms (ControlMaster) | ~100ms | ~2-5s (snapshot) | ~2-3s |
| **CWD tracking** | temp file | stdout marker | stdout marker | stdout marker | stdout marker | stdout marker |
| **File state coordination** | `file_state.py` global + `file_state.lock_path()` | same | `FileSyncManager` + same | `FileSyncManager` + same | `FileSyncManager` + same | `FileSyncManager` + same |
| **Interrupt** | SIGTERM to process group | `docker kill` (handles group) | ssh session termination | instance stop | `sandbox.terminate.aio()` | `workspace.stop()` |
| **Async SDK** | no | no | no | no | yes (Modal SDK is async-only) | depends |
| **Stdin mode** | pipe | pipe | pipe | pipe | heredoc | heredoc |

The shared `_wait_for_process` loop, `_wrap_command` template, and `init_session` capture is the same for all six. **What's different is exclusively in `_run_bash`, `cleanup`, and `_before_execute` overrides** — plus the persistence and file-sync layers that are backend-specific.

### 4.8 When to use which

The defaults in `config.yaml` resolve at startup. CLI overrides via `TERMINAL_ENV=…` and `hermes setup`. The choice:

- **Local** — default. Fast, zero setup, but no isolation. Use for development and trusted code.
- **Docker** — the workhorse. Per-task bind mounts, full Linux env, near-zero overhead on warm. Use for untrusted code or to keep the host filesystem clean.
- **SSH** — for working on a remote dev box (Jetson, cloud VM, etc.). `FileSyncManager` keeps credential files synced.
- **Singularity** — for HPC/supercomputer environments. The only option that runs in environments without root.
- **Modal** — for ephemeral cloud sandboxes that survive across sessions via snapshot. Best for "I want to come back tomorrow to the same workspace."
- **Daytona** — alternative cloud sandbox with similar persistence semantics. Use when Modal isn't available or doesn't fit.
- **ManagedModal** — Hermes's hosted Modal (Nous gateway). For users without direct Modal accounts.

---

## 5. Long-Running Task Handling

### 5.1 Per-session container/environment lifecycle

Every backend instance is per-`task_id` (in Hermes' sense — a subagent or a user session). The terminal tool maintains a process-wide dict:

```python
# tools/terminal_tool.py:982-988
_active_environments: Dict[str, Any] = {}     # task_id -> env
_last_activity: Dict[str, float] = {}           # task_id -> monotonic timestamp
_env_lock = threading.Lock()
_creation_locks: Dict[str, threading.Lock] = {}  # task_id -> per-task creation lock
_creation_locks_lock = threading.Lock()           # protects _creation_locks
_cleanup_thread = None
_cleanup_running = False
```

The lookup path (`terminal_tool.py:2156-2161`):

```python
_existing_key = (
    effective_task_id if effective_task_id in _active_environments
    else (task_id if task_id and task_id in _active_environments else None)
)
if _existing_key is not None:
    _last_activity[_existing_key] = time.time()
    env = _active_environments[_existing_key]
```

So a second `terminal` call for the same `task_id` reuses the same env. **The default is "one bash, one /workspace, one set of installed packages"** for the entire session — including across `delegate_task` children, because `_resolve_container_task_id` (`terminal_tool.py:1123-1155`) collapses subagent IDs to `"default"`:

```python
def _resolve_container_task_id(task_id: Optional[str]) -> str:
    """Map a tool-call task_id to the container/sandbox key ...
    The top-level agent passes task_id=None and lands on "default".
    delegate_task children pass their own subagent ID so that
    file-state tracking, the active-subagents registry, and TUI events stay
    distinct per child — but we deliberately collapse that ID back to
    "default" here so subagents share the parent's long-lived container
    (one bash, one /workspace, one set of installed packages)."""
```

Exception: when an RL/benchmark env registers an override via `register_task_env_overrides` with `docker_image` / `modal_image` / `env_type` (the `_ISOLATION_KEYS` set at line 1147-1150), the task_id is *not* collapsed. That isolation is for Atropos-style rollouts where each child needs its own sandbox.

### 5.2 Idle cleanup

`_cleanup_inactive_envs` (`terminal_tool.py:1542-1601`):

```python
def _cleanup_inactive_envs(lifetime_seconds: int = 300):
    current_time = time.time()
    # Skip cleanup for sandboxes with active background processes
    try:
        from tools.process_registry import process_registry
        for task_id in list(_last_activity.keys()):
            if process_registry.has_active_processes(task_id):
                _last_activity[task_id] = current_time  # Keep sandbox alive
    except ImportError:
        pass
    with _env_lock:
        for task_id, last_time in list(_last_activity.items()):
            if current_time - last_time > lifetime_seconds:
                env = _active_environments.pop(task_id, None)
                _last_activity.pop(task_id, None)
                if env is not None:
                    envs_to_stop.append((task_id, env))
    # Phase 2: stop OUTSIDE the lock so other tool calls aren't blocked
    for task_id, env in envs_to_stop:
        try:
            from tools.file_tools import clear_file_ops_cache
            clear_file_ops_cache(task_id)
        except ImportError:
            pass
        try:
            if hasattr(env, 'cleanup'):
                env.cleanup()
            elif hasattr(env, 'stop'):
                env.stop()
            elif hasattr(env, 'terminate'):
                env.terminate()
```

The `process_registry.has_active_processes(task_id)` check is the load-bearing detail: a sandbox with a `terminal(background=true, notify_on_complete=true)` running test suite stays alive even past `lifetime_seconds`, because killing the container would kill the running tests. The cleanup reaper runs every 60s on a daemon thread (`_cleanup_thread_worker` at `terminal_tool.py:1604-1616`).

### 5.3 Crash recovery and per-process container reuse

For Docker specifically, the design supports process restart without losing state (issue #20561):

- `DockerEnvironment.__init__` probes for a labeled container with `docker ps --filter label=hermes-task-id=<tid> --filter label=hermes-profile=<profile>`. If one exists and is running, attach to it.
- If the container was removed out-of-band, `execute()` detects "No such container" / "is not running" and calls `_recreate_container` (`docker.py:1094-1174`). Label-based reuse is tried first; if no existing container, a fresh one is started.
- The orphan reaper at startup (`docker.py:141-267`) sweeps `status=exited` containers older than `2 × lifetime_seconds` that match the current profile — only the current profile, to avoid tearing down another Hermes process's containers.

For Modal, the snapshot is the persistence: `cleanup()` calls `sandbox.snapshot_filesystem()` and stores the image_id in `~/.hermes/modal_snapshots.json`. On next start, the snapshot id is loaded and the new sandbox is created from it (`modal.py:194-203`). If the snapshot is invalid, it falls back to the base image (`modal.py:264-275`).

### 5.4 Session continuity

Hermes doesn't have process-level restart: each Hermes CLI invocation is a fresh process. What survives across runs:

1. **Workspace files** (Docker): bind-mounted to `~/.hermes/sandboxes/docker/<task_id>/`. Files written by the agent are on the host.
2. **Modal sandbox state**: `~/.hermes/modal_snapshots.json` persists snapshot IDs.
3. **Conversation history**: `hermes_state.py` SQLite FTS5 store at `~/.hermes/sessions.db`. WAL mode, periodic checkpoint.
4. **Memory**: pluggable memory providers persist across sessions.
5. **Skills**: created skills live in `~/.hermes/skills/`, indexed for the next session.

What does NOT survive: the in-memory `AIAgent` instance, the in-memory tool result cache, any open file handles, the in-progress `_last_activity` timer. The first `terminal` call after a fresh process is always a cold container start (or snapshot restore for Modal).

### 5.5 Long-running task support: `terminal(background=True, …)`

The `terminal` tool's `background=True` mode (`terminal_tool.py:2360-2429`) is the canonical way to run a multi-hour task. It routes through the `process_registry` (`tools/process_registry.py`) which manages long-lived background processes:

```python
# terminal_tool.py:2364-2388
from tools.process_registry import process_registry

if env_type == "local":
    proc_session = process_registry.spawn_local(
        command=command, cwd=effective_cwd, task_id=effective_task_id,
        session_key=session_key, env_vars=env.env if hasattr(env, 'env') else None,
        use_pty=effective_pty,
    )
else:
    proc_session = process_registry.spawn_via_env(
        env=env, command=command, cwd=effective_cwd, task_id=effective_task_id,
        session_key=session_key,
    )
```

`process_registry` exposes the `process` tool (`process_registry.py:2173-2219`):

```python
def _handle_process(args, **kw):
    action = args.get("action", "")
    if action == "list": ...
    elif action in {"poll", "log", "wait", "kill", "write", "submit", "close"}:
        if action == "poll": return json.dumps(process_registry.poll(session_id))
        elif action == "log": return json.dumps(process_registry.read_log(session_id, offset, limit))
        elif action == "wait": return json.dumps(process_registry.wait(session_id, timeout))
        elif action == "kill": return json.dumps(process_registry.kill_process(session_id))
        elif action == "write": return json.dumps(process_registry.write_stdin(session_id, data))
        ...
```

So the agent's pattern for a long task is:
1. `terminal(command="pytest tests/ -v", background=True, notify_on_complete=True)` — returns a session_id
2. Continue working on other things
3. When the process exits, a completion event is pushed onto the shared `process_registry.completion_queue`
4. The CLI/gateway drain (`_run_process_watcher`) reads the event and forges a new agent turn
5. The agent sees the result and continues

**The hard rate-limit** (`terminal_tool.py:2035`): background process notification is 1 per 15s per process. After 3 strike windows, `watch_patterns` is auto-disabled and the session is promoted to `notify_on_complete`. This is the load-bearing mechanism that prevents a long-running process from spamming the agent.

**The 3-minute cron interrupt** (Hermes AGENTS.md "Cron" section): cron-scheduled sessions get a 3-minute hard interrupt. Agent loops in cron jobs cannot monopolize the scheduler. This is **not** for ad-hoc terminal commands — only for cron jobs.

### 5.6 The `pty` mode for interactive CLIs

For sub-agents that need to drive interactive CLI tools (Codex, Claude Code, Python REPL), `pty=true` switches `_run_bash` to use a pseudo-terminal. Only local and SSH backends support it (`terminal_tool.py:2986-2989` schema). Other backends silently disable PTY and emit a `pty_disabled_reason` note (line 2336-2343).

PTY is auto-disabled for commands that expect piped stdin/EOF (`terminal_tool.py:1861-1881` `_command_requires_pipe_stdin`) — the conflict would deadlock the read.

---

## 6. Workspace Management

### 6.1 Per-session workspace

There is no per-session workspace in the model. The workspace is the directory pointed to by:
- `os.getcwd()` for CLI mode (`terminal_tool.py:1196-1207 _safe_getcwd`)
- `TERMINAL_CWD` env var for messaging (bridged from `config.yaml terminal.cwd`)
- The session_id defaults to "default" for the top-level agent

`TERMINAL_CWD` defaults differ by backend (`terminal_tool.py:1290-1298`):
```python
if env_type == "local":    default_cwd = _safe_getcwd()
elif env_type == "ssh":   default_cwd = "~"
else:                     default_cwd = "/root"
```

For container backends, host paths are rejected (issue #20561 class of bug, see `terminal_tool.py:1235-1253` `_is_unusable_container_cwd`):
```python
_HOST_CWD_PREFIXES = ("/Users/", "/home/", "C:\\", "C:/")
_CONTAINER_BACKENDS = frozenset({"docker", "singularity", "modal", "daytona"})
```
A raw host path (`/home/user`, `C:\Users\me`) is meaningless to `docker run -w` and crashes with exit 125. The check is **re-applied to override paths** (line 2100-2115 in `terminal_tool.py`) so a stale override can't bypass it.

### 6.2 Multi-repo

Hermes does not have a first-class multi-repo workspace concept. A single Hermes process works on a single cwd at a time. **However**, the worktree-cwd pattern allows multiple Hermes sessions (e.g. multiple profiles, or the TUI's worktree picker) to share the same `task_id="default"` env while each works in a different git worktree — the `cwd_owner` contextvar (`terminal_tool.py:2352-2358`) tracks which session "owns" the env's current cwd so file tools' `cd` state isn't accidentally routed to the wrong checkout.

For multi-repo reads, the user invokes Hermes separately in each repo.

### 6.3 File watching

**No file watcher.** File state is tracked at the tool-call level, not via inotify/FSEvents:
- `tools/file_state.py:FileStateRegistry` tracks read/write stamps per task_id + path. `record_read` is called by `read_file`, `note_write` by `write_file`/`patch`, `check_stale` by `write_file`/`patch` before the mutation.
- Per-path `threading.Lock` (`file_state.py:70-90`) serializes read→modify→write on the same path within a process — different paths proceed in parallel.
- This is for **cross-agent coordination** (sibling subagent writes), not external file watching. If a file is modified by something outside Hermes, the next `write_file` will detect the mtime change in `check_stale` and warn ("file was modified since you last read it").

### 6.4 Per-subagent workspace isolation

Subagents (from `delegate_task`) get their own `task_id` but, by default, share the parent's container. For subagents that need true workspace isolation, the calling agent can use `register_task_env_overrides(task_id, {"docker_image": "...", "cwd": "/workspace/sub"})` to register a per-task image and cwd. The override is consulted in `_resolve_container_task_id` (`terminal_tool.py:1123-1155`) and determines whether the subagent's task_id is preserved or collapsed to `"default"`.

---

## 7. Cross-Agent File State Coordination

The unique feature in Hermes' coding surface. The `file_state.py` module (`tools/file_state.py:1-260`) provides a process-wide `FileStateRegistry` that prevents mangled edits when concurrent subagents (same process, same filesystem) touch the same file.

### 7.1 What it tracks

```python
# tools/file_state.py:59-67
class FileStateRegistry:
    def __init__(self) -> None:
        self._reads: Dict[str, Dict[str, ReadStamp]] = defaultdict(dict)
        # task_id -> {path: (mtime, read_ts, partial)}
        self._last_writer: Dict[str, Tuple[str, float]] = {}
        # path -> (task_id, write_ts)
        self._path_locks: Dict[str, threading.Lock] = {}
        self._meta_lock = threading.Lock()
        self._state_lock = threading.Lock()
```

Three checks: `record_read` after a read, `note_write` after a write, `check_stale` before a write.

### 7.2 Staleness classes

`check_stale` (`file_state.py:142-215`) detects three classes of staleness, in order of severity:

1. **Sibling-subagent write** (most severe): "X was modified by sibling subagent Y at T — after this agent's last read at T. Re-read the file before writing."
2. **External/unknown change**: mtime differs from our last read stamp.
3. **Write-without-read** (least severe): "X was not read by this agent. Read the file first so you can write an informed edit."

None of these BLOCK the write — they just warn. The model decides whether to re-read.

### 7.3 Per-path locking

```python
# tools/file_state.py:78-90
@contextmanager
def lock_path(self, resolved: str):
    lock = self._lock_for(resolved)
    lock.acquire()
    try:
        yield
    finally:
        lock.release()
```

Used in `file_tools.py:1792-1806` for V4A multi-file patches — the paths are sorted, deduplicated, and locked in order via `ExitStack` to prevent deadlock. Different paths run in parallel.

### 7.4 Reminder helper for delegate_task

`writes_since` (`file_state.py:218-242`) returns the set of paths a sibling subagent has modified after a given timestamp. Used by `_run_single_child` in `delegate_tool.py:1883-1885` to capture the parent's known reads at delegation start, and the result dict includes a "subagent modified files the parent previously read" reminder. (See `subagent-rpc.md` §4 for the full delegation result pipeline.)

### 7.5 Read dedup and search loop guard

A separate per-task `_read_tracker` (in `file_tools.py:1940-2000`, NOT in `file_state.py`) handles:
- Consecutive-read loop guard: a 3rd consecutive read of the same `(path, offset, limit)` triggers a warning; a 4th HARD BLOCKS with "STOP re-reading and proceed with your task."
- Stub-dedup: if the file's mtime hasn't changed since the last read, the second read returns `{"status": "unchanged", "content_returned": false}` instead of repeating the content. The model is expected to use the prior result.
- Reset on any non-read tool call: `notify_other_tool_call(task_id)` clears the counter.

The two are explicitly separate concerns (`file_state.py:31-32`): "This module is intentionally separate from `_read_tracker` in `file_tools.py` — that tracker is per-task and handles consecutive-read loop detection, which is a different concern."

---

## 8. LSP Integration (Local Backend Only)

`file_operations.py:1791-1956` wires a local LSP service into the write/patch path. The local backend only — `docker.py`, `ssh.py`, `modal.py`, etc. don't have LSP, because the host-side LSP server can't see files inside the sandbox.

```python
# file_operations.py:1791-1810
def _lsp_local_only(self) -> bool:
    env = getattr(self, "env", None)
    if env is None:
        return False
    try:
        from tools.environments.local import LocalEnvironment
    except Exception:
        return False
    return isinstance(env, LocalEnvironment)
```

When LSP is enabled and a `.ts`, `.go`, or `.rs` file is edited, the post-write path:

1. **`_snapshot_lsp_baseline`** (`file_operations.py:1869-1890`): captures pre-edit diagnostics.
2. **Shell-linter skip** (`file_operations.py:1666-1670`): `.ts`/`go vet`/etc. are structurally weak in single-file mode; LSP is the canonical replacement. The shell linter is skipped when LSP claims the file.
3. **`_maybe_lsp_diagnostics`** (`file_operations.py:1892-1956`): after a successful write, fetches the post-write diagnostics from the LSP service. If both pre and post content are available, builds a line-shift map (`build_line_shift` from `agent.lsp.range_shift`) so baseline diagnostics are remapped into post-edit coordinates before the set-difference.

Result is returned in `WriteResult.lsp_diagnostics` and `PatchResult.lsp_diagnostics` — separate from the `lint` field, so the agent can read syntax errors and semantic errors as independent signals.

---

## 9. Lint Integration

### 9.1 The two-tier strategy

**Tier 1 — In-process linters** (`file_operations.py:601-678`, `LINTERS_INPROC` dict):
- `.py` — `ast.parse()` (microseconds, no subprocess)
- `.json` — `json.loads()`
- `.yaml` / `.yml` — `yaml.safe_load()` (skipped if PyYAML not installed)
- `.toml` — `tomllib.loads()` (Python 3.11+ stdlib, else `tomli`)

**Tier 2 — Shell linters** (`file_operations.py:505-511`, `LINTERS` dict):
- `.py` — `python -m py_compile`
- `.js` — `node --check`
- `.ts` — `npx tsc --noEmit` (skipped when LSP is active for the file)
- `.go` — `go vet`
- `.rs` — `rustfmt --check` (skipped when LSP is active)

### 9.2 Delta refinement

`_check_lint_delta` (`file_operations.py:1706-1789`) is the post-write lint with **pre-write baseline comparison**. The strategy:

1. Run post-write lint. If clean or skipped, return.
2. If post-write has errors AND we have pre_content, run lint on pre_content.
3. Compute set-difference: `post_lines - pre_lines`. Return only NEW errors.
4. If every post error was pre-existing, return: "Pre-existing lint errors — this edit didn't introduce new ones but the file is still broken."

This filters out inherited state — the agent isn't distracted by errors that were there before its edit.

The LINTER_UNUSABLE_PATTERNS dictionary (`file_operations.py:562-582`) classifies the cases where the linter command exists on PATH but couldn't actually run (e.g. `npx tsc` when tsc isn't in node_modules, or `rustfmt --check` without a Cargo project). These are returned as `skipped` not `error`, so the write isn't flagged for a tooling problem the agent can't fix.

---

## 10. Comparison to Other Coding Agents

| Capability | Hermes | opencode | Codex | Claude Code |
|---|---|---|---|---|
| **Patch semantics** | fuzzy 9-strategy (file-based, line-anchor) | `apply_patch` (custom format) | unified diff | `Edit`/`MultiEdit` with exact match |
| **Read with pagination** | `read_file(offset, limit)` 1-indexed line numbers | `read` with `offset`/`limit` | file read with line numbers | file read with line numbers |
| **Search** | `search_files` wrapping ripgrep | `grep`/`glob` tools | `grep`/`glob` tools | `Grep`/`Glob` tools |
| **LSP** | local-only post-write diagnostics | yes (TS/Python) | yes | yes (via IDE) |
| **Terminal backend** | local + Docker + SSH + Singularity + Modal + Daytona | local | cloud (Codex sandbox) | local |
| **Per-edit lint** | in-process + shell + delta refinement | yes | yes | yes |
| **Atomic writes** | mktemp + mv + chmod reference | yes | yes | yes |
| **Multi-hour survival** | long-lived container per task_id, snapshot for Modal | per-run | per-run | per-run |
| **Cross-process state** | bind-mount for Docker, snapshot for Modal | none | per-session | none |
| **Concurrent subagent file coordination** | per-path locks + read/write stamps + `check_stale` warnings | none | none | none |
| **Atomic snapshot replacement** | `$BASHPID`-keyed temp + `mv -f` for env-var snapshot | n/a | n/a | n/a |

### 10.1 The unique angle

Hermes' uniqueness for long-horizon coding:

1. **Container + snapshot persistence across processes** (issue #20561). A Docker container started by one Hermes process is detected and reused by a later one. A Modal sandbox is snapshotted on teardown and restored on next start. No other coding agent has this — they all run on the host machine for the lifetime of the CLI invocation.

2. **Subagent-aware file safety**. The `FileStateRegistry` + per-path locks + `check_stale` warnings are unique. When 3 subagents work in parallel on the same repo, Hermes catches the "subagent B wrote a file that subagent A already read, A's next write would overwrite B's changes" race.

3. **Terminal as universal interface, with backend abstraction**. opencode / Codex / Claude Code all run on the host. Hermes' six backends + the per-session container reuse mean the coding workflow can be sandboxed (Docker), remote (SSH), serverless-persistent (Modal snapshot), or HPC (Singularity) without the model learning a different tool surface.

4. **Defensive deletion handling**. The `_safe_cwd` recovery in `local.py:61-91` walks up parents if the cwd is missing — a single `rm -rf` in a prior command can't wedge every subsequent terminal call. The OSError handling on temp-file creation in `write_file` (line 1417-1422) means a failed write leaves the original file intact, never a half-written `.hermes-tmp` next to the user's data.

5. **PTC (Programmatic Tool Calling) via `execute_code`**. The `hermes_tools.py` stub module (auto-generated from enabled tools) lets the LLM write a Python script that calls tools via UDS RPC (local) or file-based RPC (remote backends). Multiple tool calls collapse into a single inference turn. The result is `stdout`, not the chain of intermediate tool results, so context cost is bounded. (Full deep-dive in `subagent-rpc.md`.)

6. **The patch fuzzy-match chain + lint-delta + LSP tier**. The 9-strategy fuzzy match means the model doesn't have to be byte-perfect on whitespace. The lint-delta filters out pre-existing errors so the model only sees what it introduced. The LSP tier replaces structurally-weak single-file shell linters for TS/Go/Rust. All three together mean the model gets *useful* feedback after every edit.

### 10.2 What's deliberately absent

- **No `apply_patch` (Codex-style) format** in the schema. Hermes uses V4A (`mode="patch"`) which is more readable but accepts fewer operations (no `MOVE` in Codex's format, no `*** End of File` sentinel).
- **No AST-aware editing** (no `tree-sitter` rewrite). The fuzzy match handles whitespace, the LSP handles semantics, but there's no "rename all references to this symbol" tool.
- **No "edit at multiple locations at once" tool** like Claude Code's `MultiEdit`. Hermes' V4A `mode="patch"` is the closest, but you build the patch text manually.
- **No TS/JS bundler integration** — `tsc` is the only JS type-checker and it requires `tsconfig.json` to be present (otherwise `npx tsc FILE.ts` defaults to ES5/no-lib, false-positive storm). The pragmatic answer: rely on LSP, which respects tsconfig.
- **No SQLite read tool** for code analysis (the `session_search` tool searches past session text via FTS5, but it's memory, not code DB).

---

## 11. Long-Horizon Coding — What's Verified, What's Assumed

Verified by code reading:
- Container persistence via `persist_across_processes=True` + label reuse (`docker.py:885-964`)
- Modal snapshot on `cleanup()`, restore on next `__init__` (`modal.py:194-203`, `451-469`)
- Cross-process state across `bash -c` calls via atomic snapshot replacement with `$BASHPID`-keyed temp (`base.py:475-481`)
- Per-path `threading.Lock` for cross-agent write coordination (`file_state.py:70-90`)
- Fuzzy match with 9 strategies, escape-drift guard, Unicode preservation (`fuzzy_match.py:50-150`)
- Atomic write via mktemp + mv + chmod --reference (`file_operations.py:937-989`)
- Post-write re-verification of patch application (`file_operations.py:1539-1564`)
- Delta-refined lint reporting only NEW errors (`file_operations.py:1706-1789`)
- LSP layer with line-shift remap, local-only (`file_operations.py:1791-1956`)
- Long-running `terminal(background=True, notify_on_complete=True)` with 15s rate limit (`terminal_tool.py:2035`, `AGENTS.md` §"Background Process Notifications")
- Idle reaper skipping sandboxes with active background processes (`terminal_tool.py:1549-1554`)
- CWD marker stripping, atomic snapshot publish, file group kill on interrupt

Assumed from `AGENTS.md` / docs (not traced through code in this round):
- Prompt caching as sacred (per-conversation byte-stable)
- 3-minute hard interrupt on cron sessions
- The Cursor/Codex-style "agent-computer interface" lesson (small tool surface wins)

What we could not verify in this round:
- The exact `delegate_task` parent-summary budget math (`delegate_tool.py:1624-1664` `_parent_summary_char_budget` and `_apply_summary_budget` — present but not deeply read; covered in `subagent-rpc.md`)
- The full `kanban` dispatcher integration with delegation
- The `acp_adapter/` IDE integration's session/load flow

---

## 12. Summary — What Makes Hermes' Coding Surface Distinctive

Hermes' coding tools are deliberately small (4 file tools + 1 terminal + 1 process) but the plumbing around them is rich. The headline features:

- **Spawn-per-call terminal with session snapshot** — every backend, no persistent shell, but env vars, functions, aliases all survive. Atomic snapshot replacement closes the `$BASHPID` race.
- **Six backends, identical tool surface** — the model never learns a different set of tools whether it's running on a local subprocess, a Docker container, an SSH host, a Singularity instance, a Modal serverless sandbox, or a Daytona dev environment.
- **Container + snapshot persistence across processes** — labels + bind-mounts for Docker; filesystem snapshot for Modal. The docs' "ONE long-lived container" is real, not aspirational.
- **Cross-agent file safety** — per-path locks, read/write stamps, three-tier staleness warnings. Concurrent subagents don't trample each other's edits.
- **Patch with fuzzy match + lint-delta + LSP** — the 9-strategy fuzzy match handles whitespace drift, the lint-delta filters out pre-existing errors, the LSP tier replaces structurally-weak single-file shell linters. Together: useful feedback after every edit.
- **Atomic writes everywhere** — mktemp + mv + chmod --reference, with `trap 'rm -f $tmp' EXIT` cleanup. A failed write leaves the original file intact, never a half-written `.hermes-tmp` next to the user's data.
- **Background process registry** — `terminal(background=True, notify_on_complete=True)` runs a multi-hour task, returns a session_id, and the gateway surfaces the completion as a new agent turn when the process exits. 15s rate limit on watch patterns prevents notification spam.
- **The footprint ladder** — every coding capability that can be `terminal + skill` IS `terminal + skill`. The agent runs `pytest`, `git`, `npm`, `cargo test`, `make`, `gh pr create` through the same `terminal` interface that the file tools share. No specialised test-runner tool, no specialised git tool, no specialised build tool.

What this gives the model: a small, well-designed tool surface (4 file tools + 1 terminal + 1 process) that scales from a 30-second code review to a multi-hour cross-repo refactor with no schema changes, no special handling, and a 3-strategy staleness check that catches the "I forgot to re-read after the sibling agent wrote" failure mode.

What this means for Bizar: the lesson is not "copy the 4-tool surface" — it's **patch + terminal + terminal-managed-background-processes is the right primitive, and the cross-agent file state registry is the load-bearing safety feature that no other agent has built**. The six terminal backends are a separate axis (sandboxed execution) that Bizar doesn't currently have and is the most obvious gap in the R3 cross-reference.
