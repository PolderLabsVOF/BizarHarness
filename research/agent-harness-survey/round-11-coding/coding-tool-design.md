# Coding Tool Design — A Deep Study

**Round:** 11 — Coding deep study
**Date:** 2026-07-07
**Scope:** The file/code editing primitives themselves. What does a coding agent's tool surface look like in 2026? Read/write/patch/search/terminal/LSP/git/test/build/dependency management, plus workspace state, plus Bizar-specific recommendations grounded in `config/opencode.json.template`, `plugins/bizar/src/`, and `config/agents/`.
**Methodology:** Every concrete claim cites a `file:line`. Heavy reliance on `round-4-hermes-deep/coding-backends.md:1-819` and `round-7-bestof-deep/coding-harnesses.md:14-487` from prior survey rounds.
**Companion:** `round-11-coding/long-horizon-patterns.md` (the orchestration discipline around the tools).

---

## 0. The Footprint-Ladder Lens (load-bearing constraint)

Before the tool-by-tool analysis, one constraint that shapes every coding-harness tool decision in 2026: **per-conversation prompt caching is sacred, and new model tools are paid for on every API call** (per `HERMES.md` §"Prompt Caching Must Not Break" and §"The Footprint Ladder," echoed in `config/AGENTS.md:288-308`).

The footprint ladder, in order of preference:

1. Extend existing code (zero new surface)
2. CLI command + skill (zero model-tool footprint)
3. Service-gated tool (`check_fn`) — only appears when a prerequisite is configured
4. Plugin (third-party / niche)
5. MCP server in the catalog
6. New core tool — last resort

For coding, that means the agent is steered away from specialised "code edit" tools and towards the universal `terminal + file` surface with **patch + search_files + read_file + write_file** as the small, narrow code-editing core. Per `round-4-hermes-deep/coding-backends.md:13-22`: *"This is exactly the SWE-agent lesson (`round-3-crossref` §4.4: 'a small, carefully designed tool surface outperforms a large toolkit'), implemented as policy."*

This document analyses every primitive under that constraint.

---

## 1. The File Editing Primitives

### 1.1 — `read_file` — view file contents

**Implementation pattern:** line-numbered, paginated read with offset/limit. 1-indexed lines in `LINE_NUM|CONTENT` format.

Hermes implementation at `tools/file_tools.py:1044-1139` in `ShellFileOperations` per `round-4-hermes-deep/coding-backends.md:39`:

- Binary detection via `BINARY_EXTENSIONS` constant.
- 1-indexed line numbers in compact `LINE_NUM|CONTENT` format (`file_operations.py:869-893`) — *deliberately* bare prefix, not zero-padded: "the padding was pure token overhead … an A/B (Sonnet 4.6, 2 passes) showed the compact gutter matches the padded gutter on line-reference / patch / value-lookup / structure tasks (4/4 both), while dropping line numbers entirely regressed line-referencing (3/4)."
- Cap = 100K chars (`file_tools.py:59 _DEFAULT_MAX_READ_CHARS`), configurable via `file_read_max_chars`.
- On overflow, gracefully truncate to last complete line and return `next_offset` — a "graceful char-budget truncation" ported from `nearai/ironclaw#5029` (`file_tools.py:86-127`).
- Stub-dedup at `file_tools.py:1940-2000`: if the file's mtime hasn't changed since last read, the second read returns `{"status": "unchanged", "content_returned": false}` instead of repeating content.

**Pros:**
- Line numbers let the agent cite specific lines in patches and follow-up reads.
- Pagination keeps large files within token budget.
- Graceful truncation preserves last-full-line on overflow.

**Cons:**
- Line-number prefix still costs ~6 chars per line on 1000-line files = ~6K chars overhead. For codebases with very long files (some legacy PHP), this hurts.
- 1-indexed (Hermes choice) vs 0-indexed (some other agents) — leads to LLM confusion when the agent migrates.

**Error modes:**
- File not found: explicit error, agent must `search_files` to find correct path.
- Binary file: detected via `BINARY_EXTENSIONS` extension allowlist; agent gets explicit "binary file" message.
- Permission denied: surfaced as error; agent retries with different path or different user.

### 1.2 — `write_file` — overwrite file

**Implementation pattern:** atomic temp + rename in same directory.

Hermes implementation at `tools/file_operations.py:1311-1459` per `round-4-hermes-deep/coding-backends.md:43-53`:

```bash
tmp=$(mktemp -p "$d" .hermes-tmp.XXXXXX ...)   # mktemp collision-safe
chmod --reference "$t" "$tmp" 2>/dev/null || true  # preserve mode
cat > "$tmp"
mv -f "$tmp" "$t"                              # atomic on POSIX same-FS
trap 'rm -f "$tmp"' EXIT                      # cleanup on any failure
```

Critical detail: **same-directory temp**. `mv` across filesystems degrades to copy+unlink which is NOT atomic; keeping the temp beside the target guarantees a real POSIX rename (`file_operations.py:1412-1415`).

**Pipeline:**
1. Write content via stdin (`file_operations.py:1315-1317`) to avoid OS `ARG_MAX` limits.
2. Create parent dirs.
3. Post-write lint check (in-process + shell, see §9 Lint).
4. LSP semantic-diagnostics check (local backend only, see §6).
5. Atomic rename.
6. File-state `note_write(task_id, path)` (cross-agent coordination, see §11 Workspace State).
7. Hook output spill if `code_file: true` (per `tools/hook_output_spill.py`).

**Pros:**
- Atomic by construction: the target file either contains the new content or the old content, never a half-written state.
- Mode preservation via `chmod --reference`.
- Lint + LSP integrated; the model sees failures inline.

**Cons:**
- Re-writing large files is expensive (full disk write per call). For 1MB+ files, the latency is visible.
- Doesn't preserve binary content correctly (lint check assumes text).

**Error modes:**
- Disk full: rename fails, original intact via OSError handling at `file_operations.py:1417-1422`.
- Permission denied: explicit error.
- Lint failure: writes still happen but with `lint` field populated; the agent must read the lint error and decide whether to fix.

### 1.3 — `patch` — apply unified diff or find-and-replace

The headline atomic edit operation. Two modes.

**Mode 1: `patch_replace`** — single-file find-and-replace via `file_tools.py:2045-2094` schema (`replace_all` boolean for uniqueness).

The unique-match guard at `fuzzy_match.py:90-94`: *"Found N matches for old_string. Provide more context to make it unique, or use replace_all=True."*

**Mode 2: `patch` (multi-file V4A)** — see §2 below.

**The 9-strategy fuzzy match chain** at `tools/fuzzy_match.py:50-150` per `round-4-hermes-deep/coding-backends.md:65-79` and the actual source at `fuzzy_match.py:73-83`:

```python
strategies: List[Tuple[str, Callable]] = [
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

Each strategy is tried in order; the first one that finds a match wins. Two additional guards run after a non-exact match:

**Escape-drift detection** (`fuzzy_match.py:159-197`):
- Cheap pre-check: bail unless `new_string` contains `\'` or `\"`.
- Aggregate matched regions of the file. If suspect escapes are present in `old_string` and `new_string` but not in the matched region, block with an explanatory error.
- The error message tells the model to re-read the file with `read_file` and pass `old_string`/`new_string` without backslash-escaping quote characters.
- This catches the "model typed an apostrophe and the transport added a stray backslash" failure mode.

**`_reindent_replacement`** at `fuzzy_match.py:218+`:
- Computes the LLM's base indent (first non-blank line of `old_string`).
- Computes the file's actual indent (first non-blank line of the matched region).
- Re-emits each line of `new_string` with `file_base + (line_indent - llm_base)`.
- Preserves blank-line behavior and "less-indented" lines.
- This handles the LLM/four-space-indent / file/two-space-indent mismatch silently.

**Post-write verification** at `file_operations.py:1539-1564`:
- After patch application, runs `cat <path>` to verify the file on disk matches what was expected.
- Normalizes line endings before comparison.
- Returns `PatchResult(error="Post-write verification failed: ...")` if mismatch.
- Catches the "silent persistence failure" bug class: backend FS oddities, races, truncated pipes.

**Result payload** includes `diff` (unified diff via `difflib.unified_diff` at `file_operations.py:1029-1038`), `lint`, `lsp_diagnostics`, `files_modified` (absolute path), and `error` if patch did not match.

**Pros:**
- Atomicity: file either has the patch or the original.
- 9-strategy match handles whitespace, indentation, escape, Unicode drift.
- Post-write re-verify catches FS-level corruption.

**Cons:**
- Complex machinery (~950 LOC in `fuzzy_match.py`). Maintenance burden.
- Strategy order matters; if a "loose" strategy wins prematurely, a tighter strategy never gets tried.

### 1.4 — `search_files` — find files / grep

The universal search tool. `target="content"` → ripgrep/grep content search; `target="files"` → file-by-name glob. Cap = 50 results per `round-4-hermes-deep/coding-backends.md:61`.

Hermes implementation at `file_operations.py:1962-2300`:

**Backend preference** (`file_operations.py:2160-2172`):
1. `rg` on PATH → ripgrep, parallel traversal, `.gitignore`-aware.
2. Else `grep` on PATH → GNU grep with `--exclude-dir='.*'`.
3. Else error "Install ripgrep: https://github.com/BurntSushi/ripgrep#installation".

**Output modes** (`file_operations.py:2190-2194`):
- `content` (default) — `file:line:content` with optional context.
- `files_only` — `-l` flag.
- `count` — `-c` flag.

**Three deliberate safety details** per `round-4-hermes-deep/coding-backends.md:164-180`:

1. **Diagnostic-vs-payload splitting** (`file_operations.py:347-393`): `_split_tool_diagnostics` classifies each line by shape (`file:line:content` regex for matches, `rg:`/`grep:` prefix for diagnostics). Without shape-based classification, exit-2 errors would corrupt matches.

2. **`set -o pipefail`** (`file_operations.py:2205-2210`): the rg command runs as `set -o pipefail; rg … | head -n N`. Without this, the pipeline reports head's exit code 0 and masks rg's exit code 2.

3. **Result densification** (`file_operations.py:248-280`): when `total_count >= 5` matches, the verbose `{"path", "line", "content"}` array collapses to a path-grouped text block — one path header, then `  <line>: <content>` rows. Path-grouping is lossless and saves tokens on dense source.

**Loop guard on repeated search** (`file_tools.py:1935-1955`): tracks `(pattern, target, path, file_glob, limit, offset)` per task. On 3 consecutive identical searches, append a warning. On 4, HARD BLOCK: *"BLOCKED: You have run this exact search 4 times in a row. The results have NOT changed. STOP re-searching and proceed with your task."* Reset when any non-search tool call runs (`notify_other_tool_call` at `file_tools.py:1499-1516`).

**Pros:**
- One tool covers file-name + content search, glob, filter, exclude.
- ripgrep is fast (parallel traversal, ignores hidden dirs by default).
- Loop guard catches the "agent is stuck" failure mode.

**Cons:**
- 50-result cap forces pagination for dense searches.
- `target="files"` is split from `target="content"`; two tool calls needed for "find files matching a pattern."

### 1.5 — `terminal` — run commands

The most powerful and most dangerous tool. See §5 for full design.

### 1.6 — `lsp` — use language server

See §6 for full design.

---

## 2. Patch-Based Editing Deep Dive

### 2.1 — V4A Multi-File Patch Format

Hermes' `mode="patch"` accepts V4A format — the same dialect Codex and Cline use. From `tools/patch_parser.py:1-25` per `round-4-hermes-deep/coding-backends.md:113-128`:

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

The parser (`patch_parser.py:69-200`) recognises four operations:

- **`Update File: <path>`** — patch with `+`/`-`/` ` line prefixes.
- **`Add File: <path>`** — every line prefixed `+` is the new file content.
- **`Delete File: <path>`** — deletes the named file.
- **`Move File: <src> -> <dst>`** — renames. Both endpoints checked for `..` traversal and sensitive-path blocklist (`file_tools.py:1766-1775`).

`@@ optional context hint @@` lines split a patch into hunks. The context hint is parsed (regex `r'@@\s*(.+?)\s*@@'` at `patch_parser.py:177-179`) but used only for human readability.

Lines starting with `+`/`-`/space are hunk lines (`patch_parser.py:186-191`). Lines starting with `\\` (e.g. `\ No newline at end of file`) are skipped (`patch_parser.py:192-194`). Lines without prefix are treated as implicit space (context) at `patch_parser.py:196-197`.

### 2.2 — Multi-File Atomicity

For multi-file V4A patches, paths are resolved, ordered, deduplicated, and **per-path locks acquired in sorted order via `ExitStack`** at `file_tools.py:1792-1806`. This prevents deadlock on overlapping multi-file patches and ensures deterministic lock ordering.

Cross-file V4A patches that span N paths will sequentially lock them in sorted order. Within a single file, individual hunks are applied sequentially.

**Failure recovery:**
- If one file's patch fails, the others may have already been applied. There's NO transactional rollback.
- The agent must read the result dict, identify which files were modified, and decide whether to revert the partial set or fix the failing one.

This is the load-bearing trade-off: per-file atomicity is preserved, but multi-file transactional atomicity is not. For long-horizon coding, the agent must sequence patches so that any partial completion is sensible (e.g., "delete the old API last, after the new one is wired up").

### 2.3 — Why V4A Over Unified Diff

V4A has four advantages over unified-diff (`patch -p0`):

1. **Move/add/delete as first-class operations.** Unified diff doesn't have a clean move primitive; you delete-then-add. V4A's `*** Move File:` is single-line atomic.
2. **No fuzz syntax.** Unified diff's `@@ -1,3 +1,4 @@` hunk headers are model-unfriendly; V4A's `@@ optional context hint @@` is plain English.
3. **Multi-file in one block.** Unified diff interleaves files; V4A separates them with `*** Update File:` headers.
4. **Trailing context is intuitive.** The model writes "+/-/space" instead of "1,3,2,3" hunk math.

The Hermes design choice (per `round-4-hermes-deep/coding-backends.md:766-771`): *"V4A `mode="patch"` is more readable but accepts fewer operations (no `MOVE` in Codex's format, no `*** End of File` sentinel)."* Note: this comment says Hermes accepts FEWER operations than Codex, yet the example shows `*** Move File:` which is what Codex lacks; Hermes adds move while Codex does not.

### 2.4 — The Fuzzy Match Chain in Depth

Walked through `fuzzy_match.py:50-156`, the 9 strategies in detail:

**Strategy 1: `exact`.** Byte-for-byte match. The cheap-first case.

**Strategy 2: `line_trimmed`.** Trim leading/trailing whitespace per line, then exact match. Catches the LLM adding a stray trailing space or two.

**Strategy 3: `whitespace_normalized`.** Collapse runs of whitespace to single space; tabs to 4 spaces (or vice versa). Catches the model's mixed-indent bug.

**Strategy 4: `indentation_flexible`.** Match ignoring leading whitespace. Catches the LLM miscounting tabs.

**Strategy 5: `escape_normalized`.** Strip backslash escapes from quoted strings. Catches the model adding/removing quotes inconsistently.

**Strategy 6: `trimmed_boundary`.** Trim boundary whitespace from `old_string` before matching. Catches the LLM matching a substring with whitespace at the start/end.

**Strategy 7: `unicode_normalized`.** ASCII-fold Unicode (em-dash, smart quotes) for matching, then restore original Unicode via `_preserve_unicode_in_replacement` (`fuzzy_match.py:_preserve_unicode_in_replacement`). Catches the LLM sending ASCII-but-file-has-Unicode.

**Strategy 8: `block_anchor`.** Match first/last lines as anchors; allow variable content in between. Catches the "model remembers the start/end of a block but not the middle."

**Strategy 9: `context_aware`. (last resort)** Wider context window with line skipping. Catches the deeply-wrong-but-near-match case.

After a non-exact match:
- `_detect_escape_drift` runs to block suspicious apostrophe/quote drifts.
- `_maybe_unescape_new_string` unescapes `\t`/`\r` when the matched region has real control chars.
- For strategy 7 (`unicode_normalized`), `_preserve_unicode_in_replacement` realigns the file's actual Unicode around the matched region so only the LLM's intended changes are applied.

This is the load-bearing detail that makes Hermes' patch tool robust to LLM-side noise.

### 2.5 — Anchor-Based Matching (Hermes V4A)

V4A patches are anchored by `*** Update File: <path>` headers (the path is the anchor) and `@@ context hint @@` lines (the hint is the secondary anchor). Hunks within a file are matched sequentially — first match wins, no overlap check.

This is "anchor-based" in the sense that the file path and (optional) hint together pin the patch to a specific location. If the hint is wrong, the parser falls back to positional matching within the file.

### 2.6 — Partial Application

A V4A patch that fails midway may partially apply. Hermes has no explicit "rollback" step. The agent must read the result payload, see which files succeeded, and either revert or fix.

The fix for partial application in agent-level: divide the patch into smaller V4A blocks (one per file) and sequence them. If one fails, stop, read the failure, retry that file's block.

---

## 3. AST-Based Editing

Some production systems use AST instead of text patches. Per the prompt: "AST-based editing is precise, no formatting issues, but language-specific and complex."

**Implementations I've seen surveyed:**

- **Aider** uses tree-sitter for code-aware editing on select languages (Python, JS/TS, Rust, Go) per the project's tree-sitter integration.
- **Zed Edit Predictions** uses LSP-based AST for inline edits.
- **Cursor's early "rewrite file"** model used tree-sitter edits.

None of the four source repos (Hermes, OpenFang, OpenClaw, Bizar) uses AST-based editing. The reason given in Hermes per `round-4-hermes-deep/coding-backends.md:769-770`: *"No AST-aware editing (no tree-sitter rewrite). The fuzzy match handles whitespace, the LSP handles semantics, but there's no 'rename all references to this symbol' tool."*

**Pros of AST:**
- Precise — no whitespace ambiguity, no fuzzy-match failures.
- Refactor-aware — `Rename Foo to Bar` updates all references.
- Format-preserving — tree-sitter doesn't reformat the rest of the file.

**Cons of AST:**
- Language-specific. Adding Go support means shipping a Go tree-sitter grammar.
- Comments and whitespace preservation is harder than you'd think.
- Symbol-aware operations require a full semantic model, not just AST.
- The model's training data has produced patterns of "patch text" not "manipulate tree"; AST APIs are less natural for LLMs.

**The Hermes recipe:** fuzzy match for text-level edits + LSP for semantic understanding. This avoids the AST-per-language trap while still giving the model some AST awareness via the LSP layer.

**Recommendation for Bizar:** don't add tree-sitter. Use fuzzy text patches + LSP. If a "rename symbol across files" tool is needed, it should be an LSP-driven `workspace/executeCommand` (LSP standard) that the language server implements, not a tree-sitter+regex system.

---

## 4. Search Tool Design

Three approaches:

### 4.1 — ripgrep-Style (Hermes)

`search_files` is ripgrep-wrapped. The model's interface is:

```
search_files(target="content", pattern="...", path="...", file_glob="...", output_mode="content", context=N)
```

Same tool, four dimensions. Per `round-4-hermes-deep/coding-backends.md:152-194`:

- `target`: content | files
- `path`: root directory
- `file_glob`: extension filter
- `output_mode`: content | files_only | count
- `context`: line context for the match

### 4.2 — LSP-Based (Codex, Claude Code)

LSP `workspace/symbol` for symbol search (`Go to Symbol`), `textDocument/definition` for `Go to Definition`, `textDocument/references` for `Find References`. These return real AST nodes, not text patterns.

The advantage: semantic. `textDocument/references` finds all uses of a function, including aliases via `use` statements or imports. The disadvantage: requires the LSP server for each language to be running and configured.

### 4.3 — Hybrid

Hermes combines: `search_files` for content/glob + LSP for semantic. The agent uses whichever fits the query.

The 2026 consensus is hybrid. OpenCode's integration (`round-7-bestof-deep/coding-harnesses.md:415`) is `gopls` for Go + `typescript-language-server` for TS — both LSP-driven.

**Recommendation for Bizar:** use Semble MCP (already configured per `config/AGENTS.md:288-306`) as the project-wide semantic index, plus a `search_files` shim that ripgreps the workspace. Semble's index handles "find where X is defined" faster than grep; grep handles "find the string 'TODO'" without index. Hybrid wins.

---

## 5. Terminal/Shell Tool Design

The terminal is the most dangerous and most powerful tool in the harness. Five design axes:

### 5.1 — Hermetic vs Stateful

Hermes is **spawn-per-call** with a session snapshot — every `terminal("ls")` is a brand-new `bash -c '...'`. State that survives across calls:

- Env vars (`export FOO=bar` in call N persists to N+1)
- Functions (`my_fn() { ... }` persists)
- Aliases (`alias ll='ls -la'` persists)
- CWD (`cd /tmp` persists; tracked via stdout marker)

State that does NOT survive:
- Variables that aren't `export`-ed (subshell scope).
- Backgrounded processes (the grandchild's pipe keeps stdout open).
- File descriptors opened via redirection.

The stateful surface is established via `init_session` (`tools/environments/base.py:353-446`) which runs **once** at backend construction:

```bash
export -p > /tmp/hermes-snap-<sid>.tmp.$BASHPID
__hermes_fns=$(declare -F | awk '{print $3}' | grep -vE '^_[^_]')
[ -n "$__hermes_fns" ] && declare -f $__hermes_fns >> /tmp/hermes-snap-<sid>.tmp.$BASHPID 2>/dev/null
alias -p >> /tmp/hermes-snap-<sid>.tmp.$BASHPID
echo 'shopt -s expand_aliases' >> /tmp/hermes-snap-<sid>.tmp.$BASHPID
echo 'set +e' >> /tmp/hermes-snap-<sid>.tmp.$BASHPID
echo 'set +u' >> /tmp/hermes-snap-<sid>.tmp.$BASHPID
mv -f /tmp/hermes-snap-<sid>.tmp.$BASHPID /tmp/hermes-snap-<sid>.sh
builtin cd -- <quoted-cwd> 2>/dev/null || true
```

The `$_wrap_command` template (`base.py:463-527`):

```bash
source /tmp/hermes-snap-<sid>.sh >/dev/null 2>&1 || true
builtin cd -- /cwd || exit 126
eval '<escaped-command>'
__hermes_ec=$?
{ export -p > /tmp/hermes-snap-<sid>.tmp.$BASHPID && mv -f …tmp… /tmp/hermes-snap-<sid>.sh; } 2>/dev/null
pwd -P > /tmp/hermes-cwd-<sid>.txt 2>/dev/null
printf '\n__HERMES_CWD_<sid>__%s__HERMES_CWD_<sid>__\n' "$(pwd -P)"
exit $__hermes_ec
```

**Why `$BASHPID` and not `$$`?** `$$` is the parent PID even in `&`-launched subshells (`base.py:475-481`); `$BASHPID` is the actual PID. Two concurrent writers (rare but possible in async dispatch) would clobber each other's temp if they shared `$$` but isolated with `$BASHPID`.

If `init_session` fails, the wrapper falls back to `bash -l -c` per call (`base.py:927`). Slower but works.

### 5.2 — Background Processes

`terminal(background=True, notify_on_complete=True)` is the canonical way to run a multi-hour task per `round-4-hermes-deep/coding-backends.md:516-560`. Routes through `process_registry` (`tools/process_registry.py`):

```python
# terminal_tool.py:2364-2388
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

The `process` tool (`process_registry.py:2173-2219`) exposes:

- `process action="list"` — show all sessions.
- `process action="poll"` — non-blocking poll.
- `process action="log"` — paginated log fetch.
- `process action="wait"` — block until exit (with timeout).
- `process action="kill"` — SIGTERM/SIGKILL cascade.
- `process action="write"` — stdin write.
- `process action="submit"` — send EOF.
- `process action="close"` — cleanup.

**The hard rate-limit** (`terminal_tool.py:2035`): background process notification is 1 per 15s per process. After 3 strike windows, `watch_patterns` is auto-disabled and the session is promoted to `notify_on_complete`. This is the load-bearing mechanism that prevents a long-running process from spamming the agent.

### 5.3 — Output Truncation

Hermes truncates at `MAX_RESULT_SIZE_CHARS = 100_000` per `tools/tool_output_limits.py`. The 40%-head / 60%-tail split preserves the most useful content (start and end of output). Middle is dropped with a marker.

### 5.4 — Streaming

Hermes' `_wait_for_process` loop (`base.py:543-820`) drains the subprocess's stdout via `select()` (non-blocking). On user interrupt, the loop checks `is_interrupted()` and kills the process with `rc=130`. On timeout, kills with `rc=124` and appends `\n[Command timed out after Ns]`.

UTF-8 incremental decoder (`base.py:585, 597-611, 678-682`) handles multibyte characters correctly across chunk boundaries. The `codecs.getincrementaldecoder("utf-8")(errors="replace")` mirrors the baseline `TextIOWrapper`.

### 5.5 — Cross-Platform (cmd vs bash vs zsh)

Hermes targets POSIX (bash) primarily. The local backend runs `bash -c` (`local.py:989-1057`); SSH backend similarly. Windows is supported but PTY is auto-disabled (`terminal_tool.py:2986-2989`).

The auto-disable for pipe-stdin-conflict commands (`terminal_tool.py:1861-1881`) prevents deadlocks: if the command expects piped stdin (`cat`, `read`), PTY would deadlock the read.

**Recommendation for Bizar:** keep `bash` via the opencode shell tool. If cross-platform is needed, detect via `process.platform` and switch to `cmd.exe` syntax. Don't expose shell selection to the agent.

---

## 6. LSP Integration

### 6.1 — Local LSP (Hermes)

`file_operations.py:1791-1956` wires a local LSP service into the write/patch path per `round-4-hermes-deep/coding-backends.md:677-696`:

```python
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

When LSP is enabled and a `.ts`, `.go`, or `.rs` file is edited:

1. **`_snapshot_lsp_baseline`** (`file_operations.py:1869-1890`): captures pre-edit diagnostics.
2. **Shell-linter skip** (`file_operations.py:1666-1670`): `.ts`/`go vet`/etc. are structurally weak in single-file mode; LSP is the canonical replacement. The shell linter is skipped when LSP claims the file.
3. **`_maybe_lsp_diagnostics`** (`file_operations.py:1892-1956`): after a successful write, fetches the post-write diagnostics from the LSP service. If both pre and post content are available, builds a line-shift map (`build_line_shift` from `agent.lsp.range_shift`) so baseline diagnostics are remapped into post-edit coordinates before the set-difference.

### 6.2 — Server-Based LSP

OpenCode's TUI uses LSP servers (`gopls`, `typescript-language-server`) integrated via a language-server-protocol client per `round-7-bestof-deep/coding-harnesses.md:415`. The servers are spawned per-session, configurable via `opencode.json`.

### 6.3 — Capabilities

LSP provides:

- **Definition** (`textDocument/definition`) — go to symbol's declaration.
- **References** (`textDocument/references`) — find all uses.
- **Completion** (`textDocument/completion`) — autocomplete.
- **Hover** (`textDocument/hover`) — show type/docs.
- **Diagnostics** (`textDocument/publishDiagnostics`) — semantic errors.
- **Format** (`textDocument/formatting`) — reformat.
- **Rename** (`textDocument/rename`) — rename across files.

The most useful for an agent: **definition + references + diagnostics**. These give semantic understanding without the agent having to grep.

### 6.4 — Use for Semantic Understanding

The agent should use LSP for:

- "Where is this function called?" → references
- "What does this method return?" → hover
- "Did my edit introduce errors?" → diagnostics

Not for:

- "Find all TODO comments" → ripgrep
- "Find the file that imports this" → ripgrep on `import` patterns + references
- "Get the comment text" → read_file

### 6.5 — Hermes Pattern Is Local-Only

Hermes deliberately limits LSP to local backends (`file_operations.py:1791-1810`). The LSP server runs on the host; in a Docker/SSH/Modal backend, the host's LSP can't see inside the sandbox.

**For Bizar:** the opencode runtime should expose LSP per-workspace (each worktree/per-session) via the standard LSP client. This is implemented in OpenCode's Go harness already; Bizar's plugin doesn't need to re-implement it.

---

## 7. Test Runner Tool

Hermes has **no dedicated test runner tool**. Tests run via `terminal("pytest tests/ -q")`. The reasoning (per `round-4-hermes-deep/coding-backends.md:189-200`):

1. **Footprint ladder.** Every new core tool is paid for on every API call. SWE-agent's lesson is that 7 well-designed tools beat 50 generic ones. `terminal` already exists; adding a `pytest` tool is a regression.

2. **Tests are language-specific.** A test runner tool would have to know all 7 test frameworks (pytest, jest, mocha, go test, cargo test, maven, gradle) or expose them as 7 separate tools. Both options are worse than `terminal("pytest …")`.

3. **Project conventions vary.** A monorepo might use `make test`, a Python project uses `pytest -xvs tests/`, a Rust project uses `cargo test --workspace`. The model is better at reading the project README than we are at pre-building the schema.

The skill content (`skills/software-development/test-driven-development/SKILL.md:310-316`) teaches TDD discipline via prompts. The agent runs `terminal("pytest tests/test_feature.py::test_name -v")` to actually execute.

### 7.1 — Framework Detection

A 2026 best practice: a "test discovery" skill that walks the agent through detecting the framework:

1. Look at `package.json` for npm projects.
2. Look at `pyproject.toml` / `pytest.ini` for Python.
3. Look at `Cargo.toml` for Rust.
4. Look at `go.mod` for Go.
5. Look at `Makefile` for polyglot / monorepo.

The agent runs the appropriate command. No special tool needed.

### 7.2 — Run Subset

For test subsets, the agent uses framework-native selectors:

- pytest: `pytest tests/test_foo.py::TestBar::test_baz -v`
- jest: `jest tests/foo.test.ts -t "specific test"`
- cargo: `cargo test test_name`
- go: `go test -run TestFoo ./...`

These are all expressible in `terminal`. No special tool.

### 7.3 — Failures Parsing

This is where a special tool *could* help. Some systems have a "test result parser" that turns pytest/jest output into a structured result. Hermes doesn't; the agent reads the terminal output directly.

For the 2026 production target, a `parse_test_results` skill (not tool) teaches the agent how to read failures. The skill content includes "this is what pytest failures look like; find the `FAILED tests/...` line, then read the assertion details."

---

## 8. Build Tool Integration

### 8.1 — Frameworks

- **Make**: `make` or `make build`
- **npm**: `npm run build`
- **cargo**: `cargo build`
- **go**: `go build ./...`
- **maven**: `mvn package`
- **gradle**: `./gradlew build`

All via `terminal`. No special tool.

### 8.2 — Cache Detection

Builds with caches: `cargo build --release` (target/ dir), `npm run build` (node_modules/ + dist/), `mvn package` (target/). Each has its own cache invalidation rules.

The agent should learn: "if I haven't changed a file, don't expect a rebuild." Skills like `software-development/build-caching` can teach this.

### 8.3 — Output Streaming

For long builds, output streaming matters. Hermes' `_wait_for_process` drains stdout via `select()` (`base.py:651-666`) — non-blocking. Output is returned in chunks. The 100K char cap is applied per the truncation rules.

---

## 9. Git Tool

Hermes deliberately has **no dedicated git tool** (`round-4-hermes-deep/coding-backends.md:139-145`). Git operations flow through `terminal`:

```
terminal("git add <files>")
terminal("git commit -m '...'")
terminal("git push origin <branch>")
terminal("gh pr create --title '...' --body '...'")
```

The skill content (`skills/github/`) teaches the PR workflow:
1. Cut a branch from main.
2. Make atomic commits per logical change.
3. Push and open PR.
4. Wait for CI.
5. Address review.
6. Merge.

The footprint ladder principle: *"A new core tool when terminal + file already do the job, or when a skill would. If the only barrier is file visibility on a remote backend, fix the mount, not the toolset."*

### 9.1 — What a Git Tool Would Offer

If you DO want a dedicated git tool, the surface would be:

- `git status`
- `git diff [commit1] [commit2]`
- `git log [path] [-n N]`
- `git add [files]`
- `git commit -m "..."`
- `git branch [new] [-d old]`
- `git checkout <branch>`
- `git push <remote> <branch>`
- `gh pr create --title "..." --body "..."`

The trade-off:
- **Pro:** typed parameters, validated inputs, structured results.
- **Con:** surface is paid per API call; harder to express complex git workflows (interactive rebase, bisect).

Per Hermes' choice: keep `terminal` for git. The skill teaches the workflow.

### 9.2 — What Bizar Currently Exposes

Per `config/opencode.json.template`, Bizar's `tools` section enables only `bizar_*` tools (plan, comments, wait-for-feedback, spawn_background, status, collect, kill). Git operations go through the standard opencode `bash` tool.

This is consistent with Hermes' footprint-ladder policy.

---

## 10. Dependency Management

### 10.1 — Tools

- **pip**: `pip install -r requirements.txt`
- **npm**: `npm install`
- **cargo**: `cargo add <crate>` (modifies Cargo.toml)
- **go**: `go mod tidy` (after `go get`)
- **maven/gradle**: edit pom.xml / build.gradle, then `./mvnw install`

All via `terminal`. Hermes' Python skill (`skills/python/`) handles these and detects which the project uses.

### 10.2 — Hermes' `hermes-install` Detection

The Hermes CLI has an `install` command (per the `hermes install` reference in the broader docs) that detects missing tools and prompts to install them. The pattern is: scan for `pip`/`npm`/`cargo`/`go`/`brew`; identify which are missing; offer to install.

### 10.3 — What a Dedicated Tool Would Offer

- **Pro:** Project-aware (knows to update lockfile, run migrations).
- **Con:** Project conventions vary wildly; the model can read `package.json` and figure it out.

Same pattern as git: skill content, not a new tool.

---

## 11. Workspace State

### 11.1 — Per-Session Workspace

Hermes' workspace model: no formal per-session workspace; the cwd is the workspace. The terminal tool uses `TERMINAL_CWD` env var (per backend defaults at `terminal_tool.py:1290-1298`):

```python
if env_type == "local":    default_cwd = _safe_getcwd()
elif env_type == "ssh":   default_cwd = "~"
else:                     default_cwd = "/root"
```

For container backends, host paths are rejected (`_HOST_CWD_PREFIXES = ("/Users/", "/home/", "C:\\", "C:/")` and `_CONTAINER_BACKENDS = frozenset({"docker", "singularity", "modal", "daytona"})` at `terminal_tool.py:1235-1253`). Re-applied to override paths at `terminal_tool.py:2100-2115`.

### 11.2 — Multi-Repo

Hermes has no formal multi-repo workspace concept (`round-4-hermes-deep/coding-backends.md:594-597`). The worktree-cwd pattern allows multiple `task_id="default"` envs to share a Docker container while each works in a different git worktree. The `cwd_owner` contextvar (`terminal_tool.py:2346-2358`) tracks which session owns the env's current cwd.

### 11.3 — File Watching

**No file watcher.** File state is tracked at the tool-call level via `FileStateRegistry` (`tools/file_state.py:1-260`). The registry tracks read/write stamps per `task_id + path`; `record_read` on `read_file`, `note_write` on `write_file`/`patch`, `check_stale` on `write_file`/`patch` before the mutation.

`check_stale` (`file_state.py:142-215`) detects three classes:
1. **Sibling-subagent write** (most severe).
2. **External/unknown change** (mtime differs from last read stamp).
3. **Write-without-read** (least severe).

All three just warn — the model decides whether to re-read.

### 11.4 — Diff Tracking

Per-path `threading.Lock` (`file_state.py:78-90`) serializes read→modify→write on the same path within a process. Different paths proceed in parallel.

### 11.5 — Per-Subagent Workspace Isolation

Subagents (from `delegate_task`) get their own `task_id`. By default, they share the parent's container (collapsed to `"default"` in `_resolve_container_task_id` at `tools/terminal_tool.py:1123-1155`):

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

For subagents that need isolation, `register_task_env_overrides(task_id, {"docker_image": "...", "cwd": "/workspace/sub"})` registers a per-task image and cwd. The override is consulted in `_resolve_container_task_id` and determines whether the subagent's task_id is preserved or collapsed.

---

## 12. Bizar-Specific Tool Recommendations

This is where the survey translates to actionable Bizar changes. Grounded in `config/opencode.json.template`, `plugins/bizar/src/`, and `config/AGENTS.md`.

### 12.1 — Current Bizar Tool Inventory

Per `.opencode/instructions/bizar-tools.md:90-107` and `config/opencode.json.template:39-46`:

**Tools currently exposed (model-visible):**

| Tool | Purpose | Citation |
|---|---|---|
| `bizar_plan_action` | Multi-agent plan state machine | `plugins/bizar/src/tools/plan-action.ts` |
| `bizar_get_plan_comments` | Read plan comments | `plugins/bizar/src/tools/bg-get-comments.ts` |
| `bizar_wait_for_feedback` | Block until user feedback | `plugins/bizar/src/tools/wait-for-feedback.ts` |
| `bizar_spawn_background` | Async agent dispatch | `plugins/bizar/src/tools/bg-spawn.ts` |
| `bizar_status` | Query background agent state | `plugins/bizar/src/tools/bg-status.ts` |
| `bizar_collect` | Block + collect background result | `plugins/bizar/src/tools/bg-collect.ts` |
| `bizar_kill` | Terminate background agent | `plugins/bizar/src/tools/bg-kill.ts` |
| `bizar_pause` / `bizar_resume` | Pause/resume agents | `plugins/bizar/src/tools/bg-pause.ts`, `bg-resume.ts` |
| `bizar_send_message` | Inter-agent message | `plugins/bizar/src/tools/bg-send-message.ts` |
| `bizar_report_progress` | Progress reporting | `plugins/bizar/src/tools/bg-report-progress.ts` |
| `bizar_memory_search` / `read` / `list` / `write` | Memory vault operations | `plugins/bizar/src/tools/memory-*.ts` |
| `open_kb` | Open knowledge base entry | `plugins/bizar/src/tools/open-kb.ts` |
| `read_glyph_feedback` | Read glyph feedback | `plugins/bizar/src/tools/read-glyph-feedback.ts` |

Plus the standard opencode tools: `read`, `write`, `edit`, `bash`, `grep`, `glob`, `webfetch`, `websearch`, `task`, `todowrite`.

### 12.2 — What to KEEP

The current set is right for Bizar's scope. Specifically:

1. **All `bizar_memory_*` tools.** Per `config/AGENTS.md:212-235`, Bizar's memory layer is core. The current 4-tool surface (search, read, list, write) covers the 5-tier memory model in `round-9-memory/memory-patterns.md`.

2. **`bizar_plan_action` + `bizar_wait_for_feedback`.** The plan-first + wait-for-feedback pattern is the OpenHands/Bizar equivalent of Hermes' plan mode. Per `round-7-bestof-deep/coding-harnesses.md:140-156` (OpenHands), the plan/act pattern lets users see the plan before execution. Keeping it.

3. **`bizar_spawn_background` + `bizar_status` + `bizar_collect` + `bizar_kill`.** Per `config/opencode.json.template:50-52`, `loopThresholdWarn: 5` catches agent loops; max 8 concurrent instances. The `bizar_spawn_background` + `bizar_collect` pattern lets the main agent not block (per `.opencode/instructions/bizar-tools.md:96-101`: *"After spawning, return control to the user immediately. Do NOT call `bizar_collect` unless the user explicitly asked for the result."*).

4. **The standard opencode `read`, `write`, `edit`, `bash`, `grep`, `glob` tools.** These are the universal primitives. Adding specialized tools would be a regression per the footprint ladder.

5. **`task` (subagent dispatch) + `todowrite` (planning).** Standard opencode tool, used by Odin to dispatch to Thor/Tyr/etc.

6. **`semble` MCP.** Local codebase search per `config/AGENTS.md:288-306`. Faster than grep; the right tool for "where is X used?"

### 12.3 — What to ADD

Five additions are warranted, ranked by impact:

#### Addition #1: **`tdd` skill** (highest impact)

A skill at `~/.opencode/skills/tdd/SKILL.md` that walks the agent through TDD discipline:

- RED phase: write smallest failing test
- GREEN phase: minimum code to pass
- REFACTOR phase: improve without breaking
- Discipline rules: test first, run after each step, don't skip phases

**Rationale:** per `round-7-bestof-deep/coding-harnesses.md:188-190` (Superpowers), TDD discipline is the highest-leverage methodology. A skill is the right surface — no new tool, just guided workflow.

#### Addition #2: **`bizar_cost_per_session` setting + runtime cap**

Add to `config/opencode.json`:

```json
{
  "plugin": [
    [...,
      {"bizar_cost_per_session": {"max_usd": 5.00, "max_iterations": 200}}
    ]
  ]
}
```

Plus a `tools/tool-dispatch.ts` wrapper in the plugin that tracks cumulative tokens + estimated cost per session and enforces the cap.

**Rationale:** per `round-5-openfang-deep/scheduler.md:46-100` and `round-7-bestof-deep/coding-harnesses.md:393` (AutoHarness), cost ceilings are standard in 2026. Bizar currently has none. The cap should be per-session (not per-call) and configurable.

#### Addition #3: **`bizar_pr_create` tool** (medium impact)

A specialized tool that wraps the multi-step PR workflow:

```
bizar_pr_create({
  branch: "feat/issue-123-migration",
  title: "Migrate from v1 to v2 API",
  body: "Closes #123. Migration steps:\n...",
  reviewers: ["@user"],
  labels: ["backend", "breaking-change"],
  draft: false
})
```

The tool:
1. Verifies branch is up-to-date with main.
2. Pushes branch.
3. Opens PR via `gh pr create`.
4. Returns PR URL.

**Rationale:** per `config/AGENTS.md:235-250` and `round-7-bestof-deep/coding-harnesses.md:140-156` (OpenHands), this is a workflow that recurs. A specialized tool reduces the model-side "which `gh` flags do I pass" burden and ensures consistent PR hygiene.

#### Addition #4: **`bizar_multi_repo_plan` tool** (medium impact)

A specialized tool for multi-repo work:

```
bizar_multi_repo_plan({
  repos: ["/path/to/repo-a", "/path/to/repo-b"],
  goal: "Migrate consumers of API X to v2",
  constraints: ["preserve public API", "max 3 PRs per repo"]
})
```

Returns: a plan with per-repo sub-plans, dependency ordering, estimated timeline.

**Rationale:** per `round-11-coding/long-horizon-patterns.md` §5.4, the multi-repo pattern is critical for long-horizon coding. Bizar currently has no first-class support. The tool doesn't execute anything; it returns a plan that the agent then dispatches.

#### Addition #5: **`bizar_git_review` skill** (low impact, high long-term value)

A skill that walks the agent through self-review of changes:

1. `git diff main` — see all changes
2. For each changed file, re-read with the original task spec in mind
3. Check: does the change implement what was specified? Are there unintended side effects?
4. Run tests, lint, typecheck
5. Report findings

**Rationale:** per `round-11-coding/long-horizon-patterns.md` §7.5 and `round-8-multi-agent/orchestration-patterns.md:158`, self-review is hard for the model. A skill teaches the discipline.

### 12.4 — What to REFACTOR

Two existing pieces of Bizar deserve refactoring:

#### Refactor #1: **`bizar_spawn_background` task_id hygiene**

Per `config/opencode.json.template:50-52`, `loopThresholdWarn: 5` fires after 5 consecutive identical tool calls. The current implementation may not clear the loop counter when a background agent returns a result. Verify that `notify_other_tool_call(task_id)` is called when a `bizar_collect` result enters the parent's context.

**Specific check:** inspect `plugins/bizar/src/tools/bg-collect.ts` and confirm the loop counter resets on result entry.

#### Refactor #2: **Memory vault atomicity**

Per `bizar-dash/src/server/memory-store.mjs:505-558` `writeNote`, memory writes should use atomic temp + rename (matching Hermes' `write_file` pattern). Verify:
- A `write` failure leaves the existing note intact
- Concurrent writes don't corrupt the note (per-path lock or file lock)
- A read during a write doesn't return partial content

If any of these aren't true, the `writeNote` needs the same atomic-dance treatment as `file_operations.py:937-989`.

### 12.5 — What to REMOVE (if any)

Reviewing the current tool surface, I don't see anything that should be removed. The footprint is small (7 specialized tools + standard opencode primitives). Adding more would risk regressing; removing risks losing capability.

### 12.6 — Skill-Additions (no new tools)

Several things should be **skills, not tools**, per the footprint ladder:

1. **`build-and-test` skill**: walk through detecting the framework, running the build, running tests, parsing failures.
2. **`git-commit-discipline` skill**: walk through atomic commits, branch per task, PR hygiene.
3. **`long-task-resilience` skill**: walk through checkpoint + recover patterns for multi-hour tasks.
4. **`dependency-management` skill**: walk through detecting package manager, installing, resolving conflicts.
5. **`plan-review` skill**: walk through a subagent critiquing its own plan before execution.

### 12.7 — Workspace Recommendations

Per `config/AGENTS.md:230-260` and `round-11-coding/long-horizon-patterns.md` §11:

1. **Add a `worktree_per_task` mode to `bizar_spawn_background`.** When enabled, the background agent creates `.worktrees/<task-id>/`, works there, and commits to a branch with the same name.
2. **Add `cwd_owner` contextvar.** Track which session "owns" the env's current cwd so file tools' `cd` state isn't routed to the wrong checkout (Hermes' pattern at `terminal_tool.py:2346-2358`).
3. **Add cross-agent file safety.** Mirror Hermes' `FileStateRegistry` (`tools/file_state.py:1-260`): track read/write stamps per `task_id + path`. When two parallel agents edit the same file, warn + lock.

### 12.8 — Memory Recommendations

Per `round-9-memory/bizar-memory-redesign.md` and `round-11-coding/long-horizon-patterns.md` §3-4:

1. **Strengthen `compaction.mjs`'s retrieval-link pattern.** When compacting, write a retrieval link back to the original (e.g., the note `compaction-2026-07-07-1234.md` links to the original session turns). The agent can `read_file` the link to recover details.
2. **Add periodic reflection hook.** Per `round-11-coding/long-horizon-patterns.md` §12.5 step 12, on session-end, write "what worked / what failed" to `.bizar/notes/reflection-<session-id>.md`. This becomes a hook for the next session.
3. **Surface `.bizar/graph/graph.json` as a memory query.** Per `round-9-memory/memory-patterns.md:103`, the graph is built but not queryable from agents. Add a `bizar_graph_query_concept` tool that returns entities + relations for a given concept.

### 12.9 — Cost & Token Recommendations

1. **Add `iteration_budget` + `cost_per_session` enforcement** to `plugins/bizar/src/loop.ts` (assuming this is where budget is tracked). The `loopThresholdWarn: 5` is good for loop detection but doesn't track token spend.
2. **Add a `kill_when_over_budget` mode.** If a background agent hits its iteration or cost cap, gracefully terminate and surface the partial result.
3. **Default cost cap = $5 per session** for the default (free DeepSeek V4 Flash) tier; `$20 per session` for M2.7; `$50 per session` for M3. Document these in `config/AGENTS.md` §"Cost & Token Economics."

### 12.10 — The Final Tool Inventory (proposed)

| Tool | Source | Keep / Add / Modify |
|---|---|---|
| `read` (opencode) | opencode | Keep |
| `write` (opencode) | opencode | Keep |
| `edit` (opencode) | opencode | Keep |
| `bash` (opencode) | opencode | Keep |
| `grep` (opencode) | opencode | Keep |
| `glob` (opencode) | opencode | Keep |
| `webfetch` (opencode) | opencode | Keep |
| `websearch` (opencode) | opencode | Keep |
| `task` (subagent) | opencode | Keep |
| `todowrite` | opencode | Keep |
| `semble` MCP | config | Keep |
| `bizar_plan_action` | plugin | Keep |
| `bizar_get_plan_comments` | plugin | Keep |
| `bizar_wait_for_feedback` | plugin | Keep |
| `bizar_spawn_background` | plugin | Keep + add worktree mode |
| `bizar_status` / `bizar_collect` / `bizar_kill` | plugin | Keep |
| `bizar_pause` / `bizar_resume` / `bizar_send_message` / `bizar_report_progress` | plugin | Keep |
| `bizar_memory_*` (4 tools) | plugin | Keep + add retrieval-link |
| `bizar_pr_create` | plugin | **ADD** |
| `bizar_multi_repo_plan` | plugin | **ADD** |
| `bizar_graph_query_concept` | plugin | **ADD** |
| Skills: `tdd`, `build-and-test`, `git-commit-discipline`, `long-task-resilience`, `dependency-management`, `plan-review`, `bizar_git_review` | new | **ADD SKILLS** |

The total: ~12 specialized tools + ~10 standard opencode tools. That's right for a 5-tier agent system. Adding more would dilute; removing any would regress capability.

---

## 13. The Bigger Picture

### 13.1 — The Footprint-Ladder Doctrine

Every code change in Bizar should be evaluated against the footprint ladder:

1. Extend existing code (zero new surface) — PREFERRED
2. CLI command + skill (zero model-tool footprint) — DEFAULT for new workflows
3. Service-gated tool (`check_fn`) — only when prerequisite is configured
4. Plugin (third-party / niche)
5. MCP server in the catalog
6. New core tool (only when fundamental)

For coding work, this means:

- New commit/push workflow? Add a `git-commit-discipline` skill, not a tool.
- New TDD workflow? Add a `tdd` skill, not a tool.
- New PR creation? Add a `bizar_pr_create` tool, because the surface is non-trivial AND the workflow repeats AND most other systems have it.
- New code-review workflow? Add a `bizar_review` tool OR a skill, depending on whether it returns structured data or prose.
- New test-runner? Add a `tdd` skill that teaches the agent to use `terminal` for testing. Do NOT add a `pytest` tool.
- New LSP integration? The opencode harness already provides this; no Bizar-side work needed.

### 13.2 — The Cost-vs-Capability Trade-off

Every model call costs. Every model-tool entry is paid per call. The cost-vs-capability frontier:

```
Surface size ↓ → Cost ↓ → Capability ↓
Surface size ↑ → Cost ↑ → Capability ↑
```

The optimum is at "minimum surface that produces the required capability." For Bizar, the current 12 specialized tools + 10 standard opencode tools are at that frontier. The 5 additions in §12.3 are at the frontier too — they add unique capability (PR creation, multi-repo plan, graph query) that isn't achievable with skills + standard tools.

### 13.3 — The 2026 vs 2028 Trajectory

**Now (2026):** Bizar's tool surface is well-tuned for solo-builder + multi-agent dispatch. The surface area is intentionally small.

**2028 trajectory:**
- **MCP-as-default-extensibility.** Gemini CLI, Cline, OpenHands, OpenCode, Claude Agent SDK all treat MCP as the standard extensibility. Bizar should formally adopt MCP for third-party tool integration.
- **Skills become agent-callable.** ECosystem shift: skills as runtime API rather than static content. The model asks for a skill; the skill runs; the result returns.
- **PTC-as-default.** Programmatic Tool Calling collapses N round trips into 1 turn. Bizar should add a `bizar_ptc` tool that lets the agent write a script, run it in a sandbox, and capture stdout.
- **Background agents become first-class.** The current `bizar_spawn_background` is good; the next iteration should add cost-enforcement, idempotency, and reusable sessions.

---

## 14. Code References

### Hermes source citations

- `tools/file_tools.py:59 _DEFAULT_MAX_READ_CHARS`
- `tools/file_tools.py:86-127` — graceful char-budget truncation
- `tools/file_tools.py:1044-1139` — `_handle_read_file`
- `tools/file_tools.py:1499-1516` — `notify_other_tool_call`
- `tools/file_tools.py:1766-1775` — sensitive-path blocklist
- `tools/file_tools.py:1792-1806` — ExitStack per-path locks
- `tools/file_tools.py:1935-1955` — `_read_tracker`
- `tools/file_tools.py:1940-2000` — read dedup
- `tools/file_tools.py:1992-1994` — `truncated: true` signal
- `tools/file_tools.py:2045-2094` — `patch` schema
- `tools/file_tools.py:2159-2167` — `search_files` handler
- `tools/file_tools.py:2170-2173` — tool registration
- `tools/file_operations.py:248-280` — result densification
- `tools/file_operations.py:347-393` — `_split_tool_diagnostics`
- `tools/file_operations.py:505-511` — `LINTERS` dict (shell)
- `tools/file_operations.py:562-582` — `LINTER_UNUSABLE_PATTERNS`
- `tools/file_operations.py:585, 597-611, 678-682` — UTF-8 decoder
- `tools/file_operations.py:601-678` — `LINTERS_INPROC` dict
- `tools/file_operations.py:869-893` — 1-indexed line format
- `tools/file_operations.py:937-989` — atomic write
- `tools/file_operations.py:1029-1038` — unified diff generation
- `tools/file_operations.py:119-432` — env-var scrubbing in local backend
- `tools/file_operations.py:1311-1459` — `write_file` handler
- `tools/file_operations.py:1315-1317` — stdin to avoid ARG_MAX
- `tools/file_operations.py:1412-1415` — same-dir temp invariant
- `tools/file_operations.py:1417-1422` — OSError handling
- `tools/file_operations.py:1465-1586` — `patch` handler
- `tools/file_operations.py:1539-1564` — post-write verify
- `tools/file_operations.py:1666-1670` — shell-linter skip
- `tools/file_operations.py:1706-1789` — `_check_lint_delta`
- `tools/file_operations.py:1791-1810` — `_lsp_local_only`
- `tools/file_operations.py:1791-1956` — LSP integration
- `tools/file_operations.py:1869-1890` — `_snapshot_lsp_baseline`
- `tools/file_operations.py:1892-1956` — `_maybe_lsp_diagnostics`
- `tools/file_operations.py:1962-2300` — `search_files` implementation
- `tools/file_operations.py:2160-2172` — backend preference (rg / grep / error)
- `tools/file_operations.py:2190-2194` — output modes
- `tools/file_operations.py:2205-2210` — `set -o pipefail`
- `tools/file_operations.py:2229` — `self.env.execute("rg …")`
- `tools/environments/base.py:47-79` — `set_activity_callback`
- `tools/environments/base.py:189-274` — ProcessHandle protocol
- `tools/environments/base.py:290-300` — `BaseEnvironment` ABC
- `tools/environments/base.py:353-446` — `init_session`
- `tools/environments/base.py:399-413` — fn name filter
- `tools/environments/base.py:463-527` — `_wrap_command`
- `tools/environments/base.py:475-481, 510-514` — `$BASHPID` keyed temp
- `tools/environments/base.py:543-820` — `_wait_for_process`
- `tools/environments/base.py:585, 597-611` — UTF-8 incremental decoder
- `tools/environments/base.py:651-666` — `select()` non-blocking drain
- `tools/environments/base.py:689-748` — activity callback
- `tools/environments/base.py:717-729` — interrupt detection
- `tools/environments/base.py:730-746` — timeout enforcement
- `tools/environments/base.py:837-869` — `_extract_cwd_from_output`
- `tools/environments/base.py:889-935` — `execute()`
- `tools/environments/base.py:927` — fallback to `bash -l -c`
- `tools/environments/local.py:61-91` — `_resolve_safe_cwd`
- `tools/environments/local.py:989-1057` — `_run_bash`
- `tools/environments/local.py:1059-1131` — process-group kill
- `tools/environments/local.py:1138-1161` — CWD temp file read
- `tools/environments/local.py:119-432` — env-var scrubbing
- `tools/environments/docker.py:580-602` — persistent_filesystem
- `tools/environments/docker.py:885-964` — label reuse
- `tools/environments/docker.py:1083-1191` — recreate on out-of-band
- `tools/environments/modal.py:194-203` — snapshot restore
- `tools/environments/modal.py:265-271` — base image fallback
- `tools/environments/modal.py:451-469` — `sandbox.snapshot_filesystem()`
- `tools/file_state.py:1-260` — `FileStateRegistry`
- `tools/file_state.py:31-32` — separation from `_read_tracker`
- `tools/file_state.py:59-67` — registry data model
- `tools/file_state.py:70-90` — `lock_path`
- `tools/file_state.py:142-215` — `check_stale` (3-tier)
- `tools/file_state.py:218-242` — `writes_since`
- `tools/fuzzy_match.py:50-156` — `fuzzy_find_and_replace`
- `tools/fuzzy_match.py:73-83` — 9 strategies
- `tools/fuzzy_match.py:90-94` — uniqueness guard
- `tools/fuzzy_match.py:96-110` — `_detect_escape_drift` (ref)
- `tools/fuzzy_match.py:117-135` — `_maybe_unescape_new_string` (ref)
- `tools/fuzzy_match.py:140-148` — `_preserve_unicode_in_replacement` (ref)
- `tools/fuzzy_match.py:159-197` — escape-drift detection impl
- `tools/fuzzy_match.py:218+` — `_reindent_replacement`
- `tools/patch_parser.py:1-25` — V4A format docstring
- `tools/patch_parser.py:69-200` — V4A parser
- `tools/patch_parser.py:111-114` — operation regexes
- `tools/patch_parser.py:177-179` — context hint
- `tools/patch_parser.py:186-191` — hunk line prefixes
- `tools/patch_parser.py:192-194` — `\\` skip
- `tools/patch_parser.py:196-197` — implicit space prefix
- `tools/terminal_tool.py:982-988` — `_active_environments` registry
- `tools/terminal_tool.py:1123-1155` — `_resolve_container_task_id`
- `tools/terminal_tool.py:1136` — "_ISOLATION_KEYS" comment
- `tools/terminal_tool.py:1147-1150` — isolation override
- `tools/terminal_tool.py:1196-1207` — `_safe_getcwd`
- `tools/terminal_tool.py:1235-1253` — host-path rejection
- `tools/terminal_tool.py:1290-1298` — default cwd by backend
- `tools/terminal_tool.py:1381-1387` — `_get_modal_backend_state`
- `tools/terminal_tool.py:1515-1516` — Daytona lazy-import
- `tools/terminal_tool.py:1542-1601` — `_cleanup_inactive_envs`
- `tools/terminal_tool.py:1549-1554` — process-registry check
- `tools/terminal_tool.py:1604-1616` — `_cleanup_thread_worker`
- `tools/terminal_tool.py:1861-1881` — `_command_requires_pipe_stdin`
- `tools/terminal_tool.py:2035` — 15s rate limit hard ref
- `tools/terminal_tool.py:2156-2161` — task_id lookup path
- `tools/terminal_tool.py:2336-2343` — `pty_disabled_reason`
- `tools/terminal_tool.py:2346-2358` — `cwd_owner` contextvar
- `tools/terminal_tool.py:2360-2429` — `terminal(background=True, ...)` impl
- `tools/terminal_tool.py:2364-2388` — `process_registry` integration
- `tools/terminal_tool.py:2986-2989` — PTY availability check
- `tools/process_registry.py:2173-2219` — `process` tool impl
- `tools/tool_output_limits.py` — output cap config
- `skills/software-development/test-driven-development/SKILL.md:310-316` — TDD skill content
- `skills/github/` — PR workflow skill
- `skills/python/` — Python tooling skill
- `agent/lsp.range_shift` — `build_line_shift`

### Bizar source citations

- `config/opencode.json.template:13-54` — plugin and tooling config
- `config/opencode.json.template:20-25` — `loopThresholdWarn: 5`
- `config/opencode.json.template:39-46` — `tools` section enable list
- `config/AGENTS.md` — full Bizar agent baseline
- `config/AGENTS.md:174-200` — agent model assignment
- `config/AGENTS.md:212-235` — Bizar memory layer
- `config/AGENTS.md:230-260` — graph queries
- `config/AGENTS.md:288-308` — Semble + Skills + general baseline
- `.opencode/instructions/bizar-tools.md` — full Bizar tools doc
- `.opencode/instructions/bizar-tools.md:90-107` — background agent tooling
- `.opencode/instructions/bizar-tools.md:96-101` — "do not collect" warning
- `.opencode/opencode.json` — minimal project-level plugin config
- `plugins/bizar/index.ts` — plugin entry
- `plugins/bizar/src/tools/plan-action.ts` — `bizar_plan_action`
- `plugins/bizar/src/tools/bg-get-comments.ts` — `bizar_get_plan_comments`
- `plugins/bizar/src/tools/bg-collect.ts` — `bizar_collect`
- `plugins/bizar/src/tools/bg-kill.ts` — `bizar_kill`
- `plugins/bizar/src/tools/bg-spawn.ts` — `bizar_spawn_background`
- `plugins/bizar/src/tools/bg-status.ts` — `bizar_status`
- `plugins/bizar/src/tools/bg-pause.ts` — `bizar_pause`
- `plugins/bizar/src/tools/bg-resume.ts` — `bizar_resume`
- `plugins/bizar/src/tools/bg-send-message.ts` — `bizar_send_message`
- `plugins/bizar/src/tools/bg-report-progress.ts` — `bizar_report_progress`
- `plugins/bizar/src/tools/memory-search.ts` — `bizar_memory_search`
- `plugins/bizar/src/tools/memory-write.ts` — `bizar_memory_write`
- `plugins/bizar/src/tools/memory-read.ts` — `bizar_memory_read`
- `plugins/bizar/src/tools/memory-list.ts` — `bizar_memory_list`
- `plugins/bizar/src/tools/open-kb.ts` — `open_kb`
- `plugins/bizar/src/tools/read-glyph-feedback.ts` — `read_glyph_feedback`
- `plugins/bizar/src/tools/wait-for-feedback.ts` — `bizar_wait_for_feedback`
- `plugins/bizar/src/hooks/memory-write-on-end.ts:104-152` — session summary
- `plugins/bizar/src/hooks/memory-write-on-end.ts:163-187` — `createMemoryWriteOnEnd`
- `plugins/bizar/src/compaction.mjs:36-155` — `shouldCompact()` impl
- `plugins/bizar/src/compaction.mjs:49-53` — 50% threshold
- `plugins/bizar/src/loop.ts` — loop guard / budget logic
- `bizar-dash/src/server/memory-store.mjs:77` — `DEFAULT_MEMORY_VAULT`
- `bizar-dash/src/server/memory-store.mjs:308-321` — namespace layout
- `bizar-dash/src/server/memory-store.mjs:505-558` — `writeNote`
- `bizar-dash/src/server/memory-store.mjs:625-668` — `searchVault`
- `cli/memory.mjs:1747` — `bizar memory <verb>` CLI
- `.bizar/PROJECT.md` — Stack + conventions
- `.bizar/AGENTS_SELF_IMPROVEMENT.md:116` — compaction lesson
- `.bizar/memory.json` — memory config

### Prior rounds

- `round-4-hermes-deep/coding-backends.md:1-819` — backends deep dive
- `round-4-hermes-deep/coding-backends.md:39-148` — file tools
- `round-4-hermes-deep/coding-backends.md:152-194` — search
- `round-4-hermes-deep/coding-backends.md:189-200` — no test/git/build tool rationale
- `round-4-hermes-deep/coding-backends.md:204-275` — six backends
- `round-4-hermes-deep/coding-backends.md:336-560` — long-running task handling
- `round-4-hermes-deep/coding-backends.md:594-610` — workspace model
- `round-4-hermes-deep/coding-backends.md:613-672` — file-state coordination
- `round-4-hermes-deep/coding-backends.md:677-696` — LSP
- `round-4-hermes-deep/coding-backends.md:721-732` — delta linter
- `round-4-hermes-deep/coding-backends.md:766-771` — what's deliberately absent
- `round-7-bestof-deep/coding-harnesses.md:14-28` — top comparison table
- `round-7-bestof-deep/coding-harnesses.md:34-487` — 12 project profiles
- `round-8-multi-agent/orchestration-patterns.md:158` — gateway-mediated routing
- `round-9-memory/memory-patterns.md:5-9` — four-surface stack
- `round-9-memory/memory-patterns.md:289-313` — hybrid retrieval pipeline
- `round-9-memory/memory-patterns.md:739-759` — memory master table
- `round-9-memory/bizar-memory-redesign.md` — Bizar-specific redesign
- `round-10-security/tool-execution-patterns.md` — approval patterns
- `round-11-coding/long-horizon-patterns.md` — companion document

---

## 15. Summary

The 2026 coding-agent tool surface is small by design and large in capability. Hermes' footprint-ladder discipline — 4 file tools + 1 terminal + 1 process — is the right baseline. The depth of *what those tools do* is the productive surface:

- `read_file` with paginated line numbers + deduplication.
- `write_file` with atomic temp + rename + lint + LSP integrated.
- `patch` with 9-strategy fuzzy match + escape-drift guard + Unicode preservation + post-write verification.
- `search_files` with ripgrep preference + result densification + loop guard.
- `terminal` with spawn-per-call + session snapshot + atomic temp + 6 backends.
- `process` (background) with `terminal(background=True, notify_on_complete=True)`.
- LSP with line-shift remap (local-only).

Hermes' file-state registry, terminal per-session container persistence, and V4A multi-file patches are the load-bearing features.

For Bizar, the analysis is clear: **keep the current surface, add 5 specific items (3 tools + 2 skills clusters), refactor 2 items for resilience**. The current 12 specialized tools + ~10 standard opencode tools are well-tuned; adding more would dilute, removing any would regress capability. The proposed additions target uniquely-Bizar needs (multi-repo plan, PR creation, graph query, TDD discipline, cost ceiling, self-review).

The five specific recommendations:

1. **`tdd` skill** — TDD discipline, the highest-leverage methodology.
2. **`bizar_cost_per_session` setting + runtime cap** — cost ceilings, standard in 2026.
3. **`bizar_pr_create` tool** — wraps multi-step PR workflow.
4. **`bizar_multi_repo_plan` tool** — supports multi-repo coordination.
5. **`bizar_graph_query_concept` tool** — surfaces Bizar's existing graph as a memory query.

Plus 6 skills (`build-and-test`, `git-commit-discipline`, `long-task-resilience`, `dependency-management`, `plan-review`, `bizar_git_review`) and 2 refactors (loop counter reset on background result, memory vault atomic writes).

The agent harness survey's verdict: **Bizar is well-positioned for long-horizon coding in 2026.** The 4-tier routing + plugin architecture + memory vault + .bizar/graph/ knowledge substrate + per-task background agents are the right primitives. The gaps are manageable and the proposed changes fit cleanly into the existing pattern.

---

*End of Round 11 coding tool design document. Companion: `long-horizon-patterns.md`.*
