# Long-Horizon Coding Patterns — A Deep Study

**Round:** 11 — Coding deep study
**Date:** 2026-07-07
**Scope:** What does it actually take to run an agent autonomously for hours on a complex coding task? Decomposition, context management, crash recovery, multi-repo execution, TDD, git workflow, self-verification, compaction survival, cost economics. Verified against the four source repos (`repos/hermes-agent/`, `repos/openfang/`, `repos/best-of-Agent-Harnesses/`, `repos/openclaw/`) and the prior ten survey rounds.
**Methodology:** Every concrete claim cites a `file:line` or document reference. This document reuses material already cited in `round-4-hermes-deep/`, `round-5-openfang-deep/`, `round-6-openclaw-deep/`, `round-7-bestof-deep/`, `round-8-multi-agent/`, and `round-9-memory/`.
**Companion:** `round-11-coding/coding-tool-design.md` (the file/code editing primitives themselves).

---

## 1. What Is "Long-Horizon Coding"?

A "long-horizon" coding task is any autonomous agent run that lasts long enough that simple techniques break down. Concretely, in 2026 the term refers to runs that exhibit all of the following:

- **Multi-hour wall-clock duration.** The agent loop iterates dozens to hundreds of times. A 4-tool `read_file` / `patch` / `search_files` / `terminal` round trip per minute × 240 minutes = potentially 1,000+ tool calls. Hermes' max-iteration cap is 90 (`HERMES.md` §"AIAgent Class") but pragmatic long-horizon runs routinely span multiple `max_iterations` resets via background dispatch (`tools/delegate_tool.py:2342-2920`).
- **Multi-file changes across modules.** Not "edit one function in `utils.py`"; rather "refactor the persistence layer across 11 files, update callers, regenerate fixtures, run integration tests." The work crosses file boundaries, module boundaries, and usually stack boundaries (model + controller + view).
- **Self-directed.** No human in the loop between tool calls. The agent decides what to read, what to edit, what to test, when to commit, when to declare done. This is the defining property — anything with a per-step human approval gate is not "long-horizon"; it's "interactive editing."
- **Survives crashes and resumable.** The work persists past the agent process. Files (and test state, git state, container state) must survive process death, OOM, network blips, container reapers, model rate limits. This is the load-bearing requirement that separates "demo" from "production."
- **Possibly multi-session.** A truly long task may span multiple CLI invocations, multiple `delegate_task` parent turns, multiple background-agent lifecycles. Hermes explicitly supports this through `delegate_task(background=true)` with completions re-entering the conversation via `process_registry.completion_queue` (`round-4-hermes-deep/subagent-rpc.md:148`).
- **Complex task decomposition.** The task as given is rarely the task as executed. "Migrate from v1 to v2 API" decomposes into: read old API contract, find call sites, write migration code, update tests, verify behavior parity, commit per logical step. A long-horizon agent must perform this decomposition itself, or be given a credible plan to follow.
- **Mixed verification.** Tests, linters, typecheckers, runtime probes, `git diff` audits. The agent must close the loop against multiple, possibly conflicting, signals.

What long-horizon is *not*: it's not a tool call count. A 1,000-call agent that always reads the same file with the same parameters is in a loop — see `rules/uncertainty.md` and Bizar's `loopThresholdWarn: 5` in `config/opencode.json.template:20-25`. Long-horizon means breadth (many distinct files, distinct concerns) over depth on any one of them.

The boundary between "interactive session with the user" and "long-horizon autonomous" is the human-in-loop question. SWE-agent's yaml-configured agent loop runs a single task to completion — that can be long-horizon by the wall-clock measure, but it's strictly single-session, single-agent, no subagent dispatch (`round-7-bestof-deep/coding-harnesses.md:342-371`). Hermes' plan/explore/code/test/commit pattern is the canonical structuring pattern (see §2.1 below).

---

## 2. Task Decomposition Patterns

The first problem to solve is "given a 4-hour task, how does the agent break it into pieces it can actually execute?" Eight patterns recur across the four source repos and the broader ecosystem.

### 2.1 — Hierarchical Planning (root plan → sub-plans → leaves)

The classic pattern. A plan is a tree of tasks; leaves are concrete enough that one tool call set executes them. **Hermes' plan/explore/code/test/commit is the canonical implementation** as documented in `agent/skill_manager_tool.py` and the TUI skill flow: the agent enters plan mode, decomposes the task into 5–15 atomic steps, then executes them step-by-step with explicit checkpointing per `round-3-crossref/bizar-alignment.md` §B.7 (where Hermes-style plan-first is recommended for Bizar).

**Superpowers** — `round-7-bestof-deep/coding-harnesses.md:171-201` — implements a structured superset: mandatory skill-triggered phases (brainstorm → plan → execute → review → merge), with subagent-driven execution and two-stage review per task. Tasks are 2–5 minutes apiece — that's the deliberate granularity for natural checkpointing.

**Drawback:** when the plan is wrong, the agent executes a wrong plan. The recovery is "replan after observation" (see §2.2). There is no plan-vs-observation gate that validates each step before execution.

### 2.2 — Iterative Refinement (plan → execute → reflect → replan)

This is the **OpenFang 8-phase model prompt pattern**. Each of the 9 bundled Hands in `repos/openfang/crates/openfang-hands/bundled/<name>/HAND.toml` carries a numbered multi-phase playbook with explicit checkpoints between phases (per `round-5-openfang-deep/hands-system.md:99-150`):

| Hand | # of phases | Phase shape |
|---|---|---|
| **Researcher** (`researcher/HAND.toml:168-379`) | 8 (0–7) | Detect → Analyze → Query → Gather → Cross-ref → Fact-check → Report → Stats |
| **Collector** (`collector/HAND.toml:157-324`) | 8 | Detect → Initialize → Discover → Sweep → Build graph → Detect change → Report → Persist |
| **Predictor** (`predictor/HAND.toml:177-360`) | 8 | Detect → Schedule → Collect signals → Score accuracy → Reason → Predict → Report → Persist |
| **Lead** (`lead/HAND.toml:172-314`) | 8 | Detect → Recover state → ICP → Discover → Enrich → Dedup/score → Report → Persist |

The pattern is **procedural encoding of domain expertise into a deterministic multi-phase workflow** (`round-5-openfang-deep/hands-system.md:151`). Each phase has a named output (a markdown report, a knowledge graph node, a CSV row). A failure in phase N can be re-attempted without rolling back phase 0–N-1 results because phase outputs are persisted to SQLite (`migration.rs:75-185`).

**This is the difference between "plan and execute" and "plan-execute-reflect-replan".** The reflection step (e.g. the Predictor's Phase 3 accuracy review on prior predictions, the Collector's Phase 5 change detection) is what makes the loop survive imperfect plans.

### 2.3 — Subagent Delegation (thread-pool + batch)

Hermes' `delegate_task` (`tools/delegate_tool.py:3429-3445`) supports both single and batch modes per `round-4-hermes-deep/subagent-rpc.md:54-67`:

```python
delegate_task(goal="...", context="...", role="leaf"|"orchestrator")   # single
delegate_task(tasks=[{"goal": ..., "context": ...}, ...])                # batch
```

Concurrency is capped by `max_concurrent_children` (default 3) per `_get_max_concurrent_children` at `delegate_tool.py:354-392`. The pool is `DaemonThreadPoolExecutor` (homegrown in `tools/daemon_pool.py`) rather than stdlib's `ThreadPoolExecutor` because timed-out children must not block interpreter exit at atexit-join (`delegate_tool.py:1892-1894`). The summary budget math (`_parent_summary_char_budget` at `delegate_tool.py:1624-1664`) is the structural reason N parallel subagents can't collectively blow the parent's context window — issue/PR #9126 was specifically a compression/429 death-spiral caused by the absence of this budget.

**CrewAI** (`round-7-bestof-deep/coding-harnesses.md:55-57`) does the same pattern with roles: every agent has a role + goal + backstory, and a `Process` selects execution order. The R8 deep survey calls this the "Roles" primitive (`round-8-multi-agent/orchestration-patterns.md:53-73`).

**When to use subagent delegation:** the subtask requires reasoning and might need to re-read files, re-think, or re-try on failure. The parent sees a structured result dict with summary, error, output, api_calls, and `_writes_by_sibling` (the file-state cross-agent reminder at `delegate_tool.py:1883-1885`). The parent's context does not contain the child's intermediate tool calls.

### 2.4 — State Machines (Explicit Graphs)

The "production-grade" primitive per `round-8-multi-agent/orchestration-patterns.md:93-119`. **LangGraph** + **Microsoft Agent Framework** + **CrewAI Flows** all use the graph vocabulary: `StateGraph`, typed edges, conditional routing, persistence, replay. Per `round-7-bestof-deep/multi-agent-memory.md:642`: *"graph is winning."*

State machines shine for **survivability**: a checkpointed graph can resume from any node after a crash. Hermes' similar primitive is the **process registry** (`tools/process_registry.py`) where background terminal processes are registered with `session_id` and can be polled, killed, waited on. Combined with `terminal(background=True, notify_on_complete=True)` (per `terminal_tool.py:2360-2429`), an agent can park a multi-hour task in the background and resume when it completes.

**OpenFang's persistent containers** (`tools/environments/docker.py:885-964` per `round-4-hermes-deep/coding-backends.md:341-345`) take a different angle on state: a long-running Docker container survives across CLI invocations when `terminal.docker_persist_across_processes: true`. Modal's filesystem snapshot (`tools/environments/modal.py:451-469`) does the same for serverless sandboxes. The state is the *workspace*, not the *graph*.

### 2.5 — Goal Trees (AutoGPT-style)

AutoGPT's classic pattern: a root goal decomposes into a tree of sub-goals, each with success criteria, executed breadth-first or depth-first with a "task queue" the agent pops from. None of the four source repos implements AutoGPT literally, but the pattern resurfaces in **OpenHands' Kanban board** (`round-7-bestof-deep/coding-harnesses.md:115-123`), **Cline's Kanban web UI**, and OpenFang's `task_post / task_claim / task_complete` queue (`bundled/*/HAND.toml` exposes `task_*` to all Einstein Hands).

The Kanban-board-as-task-tree is the modern incarnation of the goal tree. The visual surface helps humans monitor and reorder; the queue is durable (SQLite-backed), so tasks survive crashes.

**Drawbacks** of goal-tree-only decomposition: (a) no recursion — workers don't know about each other except via the queue, (b) no concurrency cap — Kanban fans out as far as the worker pool allows, (c) no grouping — related tasks aren't linked structurally.

### 2.6 — Pipeline Stages (Multi-Phase Prompts)

Distinct from §2.4 (state machines): a pipeline is a *linear* sequence of stages where each stage's output is the next stage's input. The OpenFang 8-phase model is technically a pipeline (assuming no backtracking), and Hermes' `code_execution_tool.py` PTC (Programmatic Tool Calling) is a pipeline — script flows data through N tool calls, only the script's stdout returns to the LLM.

The PTC pipeline is the load-bearing "zero-context-cost" primitive per `round-4-hermes-deep/subagent-rpc.md:421-749`. The LLM writes a Python script that calls N tools via UDS (Unix domain socket, local) or file-based RPC (remote backends). The script's stdout is one LLM-visible artifact; the N intermediate tool results are not in context. This is the canonical pattern for "I want to do N mechanical tool calls without burning N turns."

### 2.7 — Scratchpad (write progress to file, re-read later)

The simplest decomposition pattern: the agent writes a `/tmp/progress.md` (or a markdown in the workspace) describing the current step + plan, re-reads it next turn to refresh state. **Hermes' automatic Honcho session recall** (per `plugins/memory/honcho/__init__.py:36-184` and the learning-loop documentation at `round-4-hermes-deep/learning-loop.md:1-528`) does this across sessions, automatically. **Bizar's `.bizar/notes/` directory** and `bizar memory write` (per `plugins/bizar/src/tools/memory-write.ts` and `bizar-dash/src/server/memory-store.mjs:505-558`) provide explicit scratchpad-on-disk.

The friction with scratchpad: it's manual. The agent has to remember to write. It works best when combined with a §4.2 resume mechanism — when an agent process restarts, the scratchpad is reloaded; without that, scratchpad isn't durable.

### 2.8 — Hybrid (Subagent + Scratchpad + Phases)

The systems that actually work in production combine multiple patterns. Hermes' production case is: top-level agent enters plan mode → writes plan to scratchpad → dispatches subagents in `delegate_task` batch form → each subagent runs an OpenFang-style 8-phase playbook on its slice → results stream back via `process_registry.completion_queue` → parent collates summaries → final synthesis agent runs.

**OpenFang's hands** combine the static 8-phase plan + the event bus + the knowledge graph + the task queue + the cross-hand shared memory (`round-5-openfang-deep/hands-system.md:277-298`). No single pattern dominates.

**The lesson:** task decomposition is not a single choice. Production systems layer at least three of the eight patterns above. The Plan-Phase-Subagent-Scratchpad stack is the most common combination.

---

## 3. Context Management at Scale

The second problem: at the 1-hour mark, the conversation transcript is far past the model's context window. How does the agent keep going?

### 3.1 — Working Context Window (in-prompt)

The base layer. Every modern coder exposes a `messages` array (Hermes/OpenAI format) that grows turn by turn. Memory pressure grows linearly with tool result size. Hermes' `messages` array is built once per `client.chat.completions.create()` call inside `AIAgent.chat` per `round-9-memory/memory-patterns.md:40-44`.

### 3.2 — Compressed Summaries (Hermes TrajectoryCompressor)

Hermes' `trajectory_compressor.py` (1,574 lines) is the canonical off-line compressor. Per `round-4-hermes-deep/trajectory-pipeline.md:148-198`:

- **Step 1:** Protect Head — first N turns (configurable, default `protected_turns: {head: 3, tail: 3}`) preserved verbatim.
- **Step 2:** Protect Tail — last N turns preserved verbatim.
- **Step 3:** Identify middle turns.
- **Step 4:** Group by topic.
- **Step 5:** LLM summarization via `google/gemini-3-flash-preview` (cheap, fast).
- **Step 6:** Reconstruct `protected_head + [summarized_segment...] + protected_tail`, target `target_max_tokens: 29000`.

The "protect head + tail" is the load-bearing detail for survival: head carries task framing and tool definitions; tail carries final-answer reasoning. The middle is where noise accumulates and where summarization is safe.

The summarizer model choice (`gemini-3-flash-preview`) is the second load-bearing detail: the compression cost is a fraction of the trajectory value because Flash-tier models are cheap per token.

### 3.3 — Knowledge Extraction (Mem0 / Honcho)

Per `round-9-memory/memory-patterns.md:5-9`, the dominant pattern is "memory is a stack of four surfaces — working, session, long-term facts, identity." The long-term-facts surface is what `Mem0` (add-only extraction per `round-7-bestof-deep/multi-agent-memory.md:352-389`) and **Honcho** (dialectic affirmative + critical peer cards per `round-4-hermes-deep/learning-loop.md:391-395`) implement.

Hermes' Honcho integration at `plugins/memory/honcho/__init__.py:155-181` exposes a `conclude` tool that *"writes persistent facts that build a peer's profile. You MUST pass exactly one of: `conclusion` (to create) or `delete_id` (to delete). Passing neither is an error."* This is the LLM-driven commitment to durable memory.

### 3.4 — File-System Scratchpad (write to disk)

The OpenClaw flush pattern (`round-9-memory/memory-patterns.md:392-405`): before compaction discards turns, a memory flush turn runs that captures durable memories to `memory/YYYY-MM-DD.md`. The pattern is:

```
DEFAULT_MEMORY_FLUSH_PROMPT = [
  "Pre-compaction memory flush.",
  "Store durable memories only in memory/YYYY-MM-DD.md (create memory/ if needed).",
  "Treat MEMORY.md, DREAMS.md, SOUL.md, TOOLS.md, AGENTS.md as read-only...",
  "APPEND new content only and do not overwrite existing entries.",
  "Do NOT create timestamped variant files; always use the canonical YYYY-MM-DD.md filename.",
  "If nothing to store, reply with NO_REPLY.",
].join(" ")
```

(`flush-plan.ts:27-34`).

Bizar's version is `plugins/bizar/src/hooks/memory-write-on-end.ts:104-152` which writes `sessions/YYYY-MM-DD-<session-id>.md` at session end. **The principle is the same: durable memories survive compaction because they're on disk, not in the conversation.**

### 3.5 — Vector RAG over History

The OpenClaw `memory-lancedb` extension (`round-7-bestof-deep/multi-agent-memory.md:430-457`) keeps an LanceDB columnar vector store of session embeddings. Queries run `auto-recall` and `auto-capture` lifecycle hooks that surface relevant vectors before each turn. Hermes' FTS5 index at `hermes_state.py:813-836` provides lexical recall; trigram-indexed FTS5 at `hermes_state.py:842-866` adds CJK substring matching.

The principle behind vector RAG over history is "don't summarize first; search second" (`round-9-memory/memory-patterns.md:768-770`). Summarization loses information at every step; vector search degrades only by relevance ranking. For the 1-hour coding agent, vector RAG over the session's edits is often a better answer than "summarize the last 100 turns."

### 3.6 — Knowledge Graph (entities)

OpenFang's `KnowledgeStore` (`crates/openfang-memory/src/knowledge.rs:17-19`) builds entities + relations as the agent works. The `entities` + `relations` schema at `migration.rs:150-172` with three indexes (`idx_relations_source`, `idx_relations_target`, `idx_relations_type`) supports the `query_graph` SQL JOIN at `knowledge.rs:82-188` which matches `source`/`target`/`relation`/`max_depth` patterns.

The knowledge graph is the **structural compression** layer: replace verbose references ("Acme Corp, founded in 2010 by Alice Smith, headquartered in Boston, MA...") with a single entity ID. Future turns can refer to "Acme Corp" by ID and re-expand via the graph.

**Known limitations** (per `round-5-openfang-deep/knowledge-graph.md:271-274`):
- `max_depth` is accepted but **never used** in the SQL — multi-hop traversal is broken.
- 100 result cap; no pagination.
- No storage-layer deduplication; two Hands independently adding "Acme Corp" get different UUIDs.

These are 2026 limitations — they'll be addressed in hosted graph backends (Neo4j, Memgraph) in 2027.

### 3.7 — Periodic Compaction (every N turns / M minutes)

Bizar's `shouldCompact()` at `plugins/bizar/src/compaction.mjs:49-53`:

```js
export function shouldCompact(usage, maxContext) {
  return ratio >= compactionThreshold;   // default 0.5 = 50% usage
}
```

`maybeCompactSession()` triggers compaction with `preserve_recent=10` per the v5.0.1 lesson in `AGENTS_SELF_IMPROVEMENT.md:116`. The `setCompactionThreshold(0.1-1.0)` is configurable.

Hermes' `on_pre_compress` hook at `agent/memory_manager.py:834-848` is the equivalent: providers receive messages about to be compressed and contribute text to the summary. The provider's contribution is preserved across compaction, so the model doesn't lose its previously-extracted insights.

### 3.8 — Comparison Across Systems

| System | Working | Session | Project | Long-term facts | Identity | Compaction trigger | Decay |
|---|---|---|---|---|---|---|---|
| **Hermes** | messages | SQLite+FTS5+trigram | FTS5 over sessions | Honcho + Mem0 | Honcho peer cards | on_pre_compress hook + Curator | skill auto-archive |
| **OpenFang** | Vec\<Message\> | msgpack BLOB | entities+relations | (folded into graph) | Person entities | n/a | 7-day decay (`consolidation.rs:34-44`) |
| **OpenClaw** | messages | per-agent SQLite | MEMORY.md+daily | flush to disk | n/a | pre-compaction flush | dreaming sweeps |
| **Bizar** | opencode runtime | opencode session log | vault + LightRAG | Memory service vault | n/a | shouldCompact@50% | n/a |
| **Mem0** | n/a | n/a | optional add() | ✓✓ append-only | n/a | n/a | temporal reasoning |
| **Letta** | n/a | n/a | memory blocks | ✓ persona/human | server-side | memory blocks | n/a |
| **Honcho** | n/a | peer cards | peer cards | ✓✓ dialectic | peer-key isolation | n/a | self-heal |
| **claude-mem** | n/a | SQLite+Chroma | observations | via observations | implied | SessionEnd hook | n/a |

Per `round-9-memory/memory-patterns.md:739-759`. The verdict: **no system covers all five tiers uniformly.** The 2026 production stack needs two or three products (e.g., Mem0 + LightRAG + Obsidian) to cover everything.

**The long-horizon coding agent's rule:** use a hybrid. Keep working memory in context. Move finished reasoning to scratchpad on disk. Promote discoveries into FTS5-indexed memory. Promote durable facts to Mem0 or Honcho. Compress at 50% usage. Decay stale skills auto-archive. This is the layered approach Bizar's redesign (`round-9-memory/bizar-memory-redesign.md`) already partially implements via `compaction.mjs:36-155`.

---

## 4. Crash Recovery & Resumability

What happens when a 4-hour agent run hits an OOM, a rate limit, a container reap, or a model outage?

### 4.1 — Checkpoint to Disk Periodically

Hermes' `CheckpointManager` is the explicit save-and-resume primitive. The checkpoint file format is `JSON Lines` per `round-4-hermes-deep/trajectory-pipeline.md:34-42`:

```python
class BatchRunner:
    """Multiprocessing pool — one prompt per worker."""
    def run(self):
        with Pool(processes=num_workers, maxtasksperchild=N) as pool:
            async_results = [pool.apply_async(_process_single_prompt, ...) for ...]
            results = [ar.get(timeout=task_timeout) for ar in async_results]
    def checkpoint(self):
        # Append-only JSONL at data/<run_name>/.checkpoint
        # Records (prompt_id, trajectory_path) per processed prompt.
```

The checkpoint key is `prompt_id`; the resumption skips already-processed prompts.

**OpenFang's CronScheduler persists** jobs to `<home_dir>/cron_jobs.json` via atomic write (`cron.rs:126-139`):

```rust
pub fn persist(&self) -> OpenFangResult<()> {
    let metas: Vec<JobMeta> = self.jobs.iter().map(|r| r.value().clone()).collect();
    let data = serde_json::to_string_pretty(&metas)?;
    let tmp_path = self.persist_path.with_extension("json.tmp");
    std::fs::write(&tmp_path, data.as_bytes())?;
    std::fs::rename(&tmp_path, &self.persist_path)?;     // atomic on POSIX same-FS
    Ok(())
}
```

The pre-advance of `next_run` *before* the job is dispatched (per `cron.rs:321-335`) means a job that should fire at T but loses the daemon at T+x is *not* re-fired on restart — its `next_run` is in the future. **The recovery scenario is bounded**: jobs after a crash are processed at T+restart_time but skipped their missed slot.

### 4.2 — Resume from Last Checkpoint

OpenFang's `due_jobs()` is the central discovery call:

```rust
pub fn due_jobs(&self) -> Vec<CronJob> {
    let now = Utc::now();
    let mut due = Vec::new();
    for mut entry in self.jobs.iter_mut() {
        let meta = entry.value_mut();
        if meta.job.enabled && meta.job.next_run.map(|t| t <= now).unwrap_or(false) {
            due.push(meta.job.clone());
            meta.job.next_run = Some(compute_next_run_after(&meta.job.schedule, now));
        }
    }
    due
}
```

(`cron.rs:321-335`). Two correctness properties: (a) **skip-if-busy via pre-advance** — a second `due_jobs()` call while the first batch is still executing won't see the same jobs; (b) **single-tick recovery** — a daemon crash mid-execution leaves the next_run in the future, so restart doesn't re-fire.

Hermes' container persistence (`docker.py:885-964` per `round-4-hermes-deep/coding-backends.md:341-345`):

- Labels containers `hermes-agent=1`, `hermes-task-id=<tid>`, `hermes-profile=<profile>`
- Probes for existing labeled container at startup
- Attaches if running, starts fresh if not
- "No such container" recovery at `docker.py:1083-1191` recreates transparently

Modal's snapshot persistence (`modal.py:451-469`): `sandbox.snapshot_filesystem()` on cleanup, image_id stored in `~/.hermes/modal_snapshots.json`, restored via `Sandbox.create(image=restored_snapshot_id)`. If restore fails, falls back to base image (`modal.py:265-271`).

**The principle:** container/image state IS the checkpoint. For a coding agent, "resume" means "I have the same files, the same installed packages, the same env vars as before." Container persistence + filesystem snapshot deliver that without explicit serialization.

### 4.3 — Idempotent Operations (tool design)

Every coding-agent tool that mutates state MUST be idempotent under re-execution. The pattern across the four repos:

- **`write_file`** uses atomic temp + rename (`file_operations.py:937-989`): the target file either contains the new content or the old content, never a half-written intermediate. Re-executing a `write_file` with the same content produces the same file state.
- **`patch`** validates uniqueness before applying (`fuzzy_match.py:90-94`): "Found N matches for old_string. Provide more context to make it unique, or use replace_all=True." Re-executing a unique-match patch produces the same result.
- **Terminal commands**: NOT idempotent in general. A `git commit` followed by re-execution either succeeds twice (different SHAs) or fails. Hermes' approach: don't make terminal idempotent, but make the *high-level operation* idempotent. `terminal(background=True, session_id=...)` is idempotent because reattaching to an existing session returns the same state.

**AutoHarness's governance pipeline** (per `round-7-bestof-deep/coding-harnesses.md:378-405`) explicitly considers idempotency in its risk classifier: a `git reset --hard` should be pre-classified as destructive and require explicit confirmation.

### 4.4 — Transactions (atomic commits)

The closest a coding agent gets to a database transaction is an **atomic git commit**. Hermes deliberately has no dedicated git tool (`round-4-hermes-deep/coding-backends.md:134-145`) — git operations flow through `terminal`:

```
terminal("git add <files>")
terminal("git commit -m '...'")
terminal("git push origin <branch>")
```

Per Hermes' footprint-ladder policy (`AGENTS.md` §"Footprint Ladder"): "A new core tool when terminal + file already do the job, or when a skill would. If the only barrier is file visibility on a remote backend, fix the mount, not the toolset."

The same applies to **Bizar**: no dedicated git tool, just `git` via bash.

### 4.5 — State Machines with Explicit States

The graph-based primitives (§2.4) have native state-machine semantics — LangGraph's checkpointer persists state per node, allowing resume from any node. The state machine + persistence combination is the most-recoverable composition.

**Hermes' `process_registry`** (`tools/process_registry.py`) tracks `session_id` + `state` (running / completed / killed / orphaned) for background terminal processes. The drain loop in CLI/gateway surfaces completions as new agent turns — completion re-entry preserves message-role alternation (`async_delegation.py:17-19`).

`Round 4 subagent-rpc.md:148` quotes the load-bearing reason: *"Strict message-role alternation is preserved, prompt cache stays intact."* A crashed-then-resumed subagent that splices its result into an existing turn would break the cache. The completion-queue-and-fresh-turn design is the answer.

### 4.6 — Recovery Anti-Patterns

Things to NOT do:

- **Resuming without a manifest.** If the agent doesn't write a manifest of "what I was doing" to disk, resume is impossible. Every Hermes skill / HAND.toml has explicit state names.
- **Treating "saved" as "applied."** Hermes' `write_file` re-verifies the write succeeded by reading the file back via `verify_cmd` (per `file_operations.py:1539-1564`). Without that, a partial write would look like success but leave the file in a partial state.
- **Lock files without TTL.** `.bizar/memory.json` writes go through a lockfile; without a TTL, a crashed write leaves the lock held forever. Bizar uses `lockPath + TTL` per `cli/memory.mjs:1747` (per `round-9-memory/bizar-memory-redesign.md`).
- **One-process-only state.** Anything that lives in a single `AIAgent` instance is lost on process death. Container state (Docker labels, Modal snapshots) survives; in-memory `_last_activity` timers do not. The check `_last_activity` rules (`terminal_tool.py:982-988`) is *always* cold on process restart by design.

---

## 5. Multi-Repo / Multi-Workspace

Can a long-horizon agent work across multiple repos? The pattern across the four repos:

### 5.1 — Hermes: 6 Terminal Backends (one workspace per backend?)

Hermes' six backends (`local`, `docker`, `ssh`, `singularity`, `modal`, `daytona`) are NOT repo-scoped — they're *environment-scoped*. A single `task_id="default"` env is shared by the entire session, and worktree-cwd pattern (`terminal_tool.py:2346-2356`) lets multiple sessions share the env while editing different git worktrees.

From `round-4-hermes-deep/coding-backends.md:594-597`: *"Hermes does not have a first-class multi-repo workspace concept. A single Hermes process works on a single cwd at a time. However, the worktree-cwd pattern allows multiple Hermes sessions (e.g. multiple profiles, or the TUI's worktree picker) to share the same `task_id="default"` env while each works in a different git worktree — the `cwd_owner` contextvar tracks which session 'owns' the env's current cwd so file tools' `cd` state isn't accidentally routed to the wrong checkout."*

For multi-repo *reads*, the user invokes Hermes separately in each repo. There's no "work on repo A and B at once" mode in core.

### 5.2 — Bizar: per-task workspace?

Bizar's `bizar_spawn_background` (per `.opencode/instructions/bizar-tools.md:90-107`) is the per-task equivalent. Each background agent runs in its own workspace, can be configured for repo/cwd, and 8 concurrent instances max. The hard limit is `~/.bizar/memory.json` (configurable).

The critical rule: max 500 tool calls per instance, max 30 min timeout. These are *intentionally tighter* than Hermes' defaults — Bizar's price-tier is lower (DeepSeek V4 Flash Free for most agents), so per-instance budgets are more conservative.

### 5.3 — opencode: workspace concept

opencode itself (per `.opencode/opencode.json` content — 6 lines: only a `plugin` array) doesn't define a multi-workspace abstraction. Bizar's plugin (`config/opencode.json.template:13-54`) declares one plugin entry; the per-agent workspaces live in workspace-scoped state inside the plugin's runtime.

### 5.4 — The Multi-Repo Pattern That Works

The pattern that actually works for long-horizon multi-repo work:

1. **One root agent with multi-repo context.** The root agent reads `git submodule status`, knows which repos exist, reads their top-level READMEs.
2. **Per-repo subagents.** Each subagent is dispatched with a specific `cwd` and a `goal` scoped to that repo.
3. **Shared scratchpad.** A scratchpad in a *third location* (e.g., `.bizar/notes/cross-repo-plan.md`) is written by any subagent that completes a step, read by any subagent that picks up the next step.
4. **Cross-repo changes via a release repo.** If the work is "change API X in repo A and update callers in repos B, C, D," the cleanest pattern is: cut a release of repo A, dispatch subagents in B/C/D to upgrade against the new release. The release is the synchronization point.

`Round 11 Bizar Recommendations` (in `coding-tool-design.md` §12) develops this further: Bizar should add a "multi-repo plan" tool that takes a list of repos + a goal and produces a coordinated plan across them.

---

## 6. Test-Driven Development Pattern

### 6.1 — The SWE-agent / AutoHarness Pattern

The canonical pattern: **write a failing test, iterate until it passes, refactor, repeat**. SWE-agent's yaml-configured tool surface (`round-7-bestof-deep/coding-harnesses.md:342-371`) is the minimal harness — `Bash`, `str_replace` editing, `Ripgrep`, `WebSearch`. SWE-agent 1.0 + Claude 3.7 Sonnet achieved SoTA on SWE-bench verified. The pattern is: the model sees a GitHub issue, explores the repo, writes a failing test in the repo's framework (pytest, etc.), iterates on `str_replace` edits until the test passes.

**Superpowers** makes TDD discipline mandatory (per `round-7-bestof-deep/coding-harnesses.md:188-190`): *"Designed for multi-hour autonomous sprints. The structured workflow (design → plan → execute → review → merge) prevents scope drift over long sessions. Subagent task granularity (2–5 minutes per task) provides natural checkpointing."* Each `TDD` phase has a deliverable (failing test, passing test, refactored code) and the next phase cannot begin until the current phase's deliverable is complete.

Hermes' `software-development/test-driven-development/SKILL.md:310-316` per `round-4-hermes-deep/coding-backends.md:136-141` makes TDD procedural:

```
terminal("pytest tests/test_feature.py::test_name -v")
terminal("pytest tests/ -q")
```

That's it — the skill is a process, the tools are `terminal`. The discipline comes from the skill content, not from a specialized tool.

### 6.2 — Hermes' `TDD Skill` Pattern

Hermes' skills are modular prompts that activate on trigger phrases. The TDD skill contains the workflow:

1. RED — write the smallest failing test
2. GREEN — make it pass with the smallest code change
3. REFACTOR — improve the code without changing behavior

The agent follows the skill in plan mode, runs `terminal` to actually execute tests, uses `read_file` + `patch` to edit code. No specialized test tool — just `terminal`. This is the whole point of the footprint ladder: 50 specialized tools = wrong; 4 universal tools + 1 well-designed `terminal` = right.

### 6.3 — The AutoHarness Refinement: Test-First Governance

`AutoHarness` (per `round-7-bestof-deep/coding-harnesses.md:374-405`) adds governance to TDD: 3 pipeline modes (Core/Standard/Enhanced) add step-by-step checks to every tool call. The Enhanced mode adds:

- **Risk classifier** before each call (per the tool call lifecycle).
- **Permission check** against the YAML constitution.
- **Output sanitize** to strip secrets from results.
- **Audit log** in JSONL.

For long-horizon coding, the governance pattern is *not* the bottleneck — the model is. AutoHarness's 14-step pipeline slows down tool calls in exchange for compliance, which is appropriate for compliance-bound workloads but is *overhead* for a solo-builder sprint. The TDD discipline is more valuable than the governance pipeline.

### 6.4 — Test Discovery

A long-horizon agent must discover what tests exist and how to run them. Semble MCP (`mcp__semble__search`) covers discovery. Hermes' `search_files` (per `file_operations.py:1962-2300`) is content-search-only — it doesn't know what's a test file specifically. OpenCode's Go-based harness has Sourcegraph integration (`round-7-bestof-deep/coding-harnesses.md:415`) for cross-repo code search.

The pragmatic answer: a skill per language that lists the standard test commands. The `software-development/test-driven-development` skill is the canonical example; a sibling `software-development/rust-tdd` skill handles Rust-specific TDD discipline (`cargo test --workspace` semantics, integration test vs unit test).

---

## 7. Git Workflow Integration

### 7.1 — Atomic Commits per Logical Change

The discipline of "one commit = one logical change" is hard for an agent to follow mechanically. The agent often batches multiple sub-tasks into one commit, which makes git bisect useless.

Hermes' patterns for atomic commits:

- A skill that walks the agent through "list your changes, group by logical concern, commit each." Per the `skills/github/` skill referenced in `round-4-hermes-deep/coding-backends.md:140-145`.
- The git operations themselves flow through `terminal`. No specialized git tool.

Bizar's plugin does not currently expose git operations through a model tool — they go through `bash`. That's consistent with Hermes' pattern.

### 7.2 — Branch per Task

The "branch per task" pattern is implemented in **Cline's Kanban** (`round-7-bestof-deep/coding-harnesses.md:115-123`): *"Kanban runs many agents in parallel on a web-based task board with per-card worktrees and auto-commit and dependency chains."* Each Kanban card is a branch; each card gets its own worktree; commits land in the branch and the branch is PR'd at the end.

**The Bizar equivalent** would be: when `bizar_spawn_background` runs a task, the agent creates a worktree under `.worktrees/<task-id>`, makes the commit there, and reports the branch name + commit SHA back to the parent. The parent can then merge or PR the branch.

This pattern is currently *not* implemented in Bizar's plugin. See `round-11-coding/coding-tool-design.md` §12 for the recommendation.

### 7.3 — PR Creation

PR creation is a multi-step process:

1. Push branch.
2. Open PR with title + body.
3. Wait for CI feedback.
4. Address review comments.
5. Merge.

Hermes and Bizar both expose this via `terminal("gh pr create")`. The `skills/github/` skill provides workflow guidance but no specialized tool.

**The 2026 production pattern:** a dedicated PR-creation tool that wraps the multi-step workflow. OpenHands' ACP abstraction has hooks for "after CI succeeds, merge" (`round-7-bestof-deep/coding-harnesses.md:140-156`). Bizar's plugin could add a `bizar_pr_create` tool.

### 7.4 — CI Feedback Loops

The "wait for CI" pattern is what makes long-horizon coding genuinely long. A 5-minute test cycle times 50 iterations is 4 hours, all waiting on CI.

OpenFang's `CronScheduler` + `BackgroundExecutor` (per `round-5-openfang-deep/scheduler.md:179-201`) has a `Periodic` mode that runs at fixed intervals — perfect for "check CI every 5 minutes until green, then merge." The agent doesn't sit blocking on CI; it polls.

Hermes' `terminal(background=True, notify_on_complete=True)` (per `tools/terminal_tool.py:2360-2429`) achieves the same async-poll behavior. The `process_registry.completion_queue` (per `tools/process_registry.py:2173-2219`) provides the LLM-visible "CI is green, here's the log tail" notification when the background process exits.

### 7.5 — Self-Review with `git diff`

The agent should self-review each commit before pushing. The loop:

```
terminal("git diff HEAD~1..HEAD")                  # see the change
# model reviews the diff against task description
# if change is wrong: amend the commit or revert and redo
# if change is right: continue
terminal("git add .")
terminal("git commit -m '...'")
```

**The hard part:** the model reviewing its own diff is shallow. The model "approves" because it's trained to approve; the diff may have obvious problems the model missed. The mitigations:

- A reviewer subagent (`delegate_task(role="orchestrator")`) that takes the diff and produces a structured critique.
- A static review step (lint, typecheck) that catches syntactic problems.
- A test run that catches behavioral problems.

**OpenHands' red/blue team** approach (`round-7-bestof-deep/coding-harnesses.md:140-156`) — one agent writes, another reviews — is the multi-agent answer to this problem.

---

## 8. Self-Verification

Before declaring done, the agent should run a battery of verification. The standard battery:

### 8.1 — Run Tests

`terminal("pytest tests/ -q")` or the framework-equivalent. Capture the exit code. A non-zero exit is a failure. The skill content teaches the agent to interpret exit codes:
- 0 — pass
- 1 — some tests failed
- 2 — collection error (syntax / import error)

The skill content also teaches the agent to **read the failure tail**, not just the count. A "11 failed, 200 passed" is not "200 passed" — it's "11 things broken."

Hermes' `process_registry` (`tools/process_registry.py:2173-2219`) provides a `process action="wait" timeout=N` polling API that's the right primitive for "wait until the test run exits, then read the result."

### 8.2 — Run Linter / Typechecker

`terminal("npm run lint")` or `terminal("cargo clippy")` or `terminal("mypy --strict .")`. The agent must learn which tool the project uses. OpenCode's LSP integration (`round-7-bestof-deep/coding-harnesses.md:415`) catches type errors in-IDE, but lint + typecheck + test is the standard pre-merge battery.

Hermes' `LINTERS_INPROC` (per `file_operations.py:601-678`) runs in-process linters (`ast.parse`, `json.loads`, `yaml.safe_load`, `tomllib`) on every write, returning a lint object that the agent sees inline. The shell linter (`file_operations.py:505-511`) handles Python (`py_compile`), JS (`node --check`), TS (`tsc --noEmit`), Go (`go vet`), Rust (`rustfmt --check`). The `_check_lint_delta` (`file_operations.py:1706-1789`) is a *delta* linter: it runs on pre + post content and reports only NEW errors, filtering out inherited state.

### 8.3 — Check Diff vs Original

`terminal("git diff main")` shows the full branch diff. The agent should re-read its task description and check that each requirement is reflected in the diff. This is itself a subagent task — the parent agent doesn't always do it well.

The Cline Kanban pattern (`round-7-bestof-deep/coding-harnesses.md:115-123`) auto-generates a diff summary at PR creation. OpenFang's `Bundled Hands` return a `result.output` field summarizing what they did (per `bundled.rs:64-66` and the Hand return shape documented at `bundled.rs:75-456`).

### 8.4 — Confirm No Regressions

The cross-cutting concern: did my changes break something else? The test suite catches this if comprehensive. The agents who don't run the full suite on every commit create accidental regressions.

Hermes' `_check_lint_delta` is the analogous pattern for lint: only report new errors, not pre-existing ones. The skill content teaches the agent to read both — pre-existing errors mean "file is broken but not by me" — and to NOT paper over them.

OpenFang's `track_accuracy` for the Predictor hand (`bundled/predictor/HAND.toml:177-360` Phase 3) is a self-verification analog: the hand tracks its own predictions, scores them against outcomes, computes Brier scores, and adjusts calibration. Long-horizon coding can adopt the same pattern: "on task completion, run the test suite, score completion rate, log to memory."

### 8.5 — Self-Review

The most powerful self-verification primitive is a *second agent* reviewing the work. Per `round-8-multi-agent/orchestration-patterns.md:158`: *"OpenClaw's pattern is gateway-mediated routing... Agents don't talk directly to each other; they go through the gateway."* For long-horizon coding, a coding-agent + a review-agent pair is the gold standard.

Cline's multi-agent teams pattern (`round-7-bestof-deep/coding-harnesses.md:118`): *"Multi-agent teams and scheduled agents enable long-horizon workloads. The Kanban board provides visual progress tracking across parallel sprints."*

### 8.6 — Self-Verification Anti-Patterns

- **Test confirmation bias.** The agent writes a test that matches its implementation. The test passes, but neither the test nor the impl was checked against the requirement. Mitigations: review by another agent, requirement-traceability check, property-based tests.
- **Performance assumptions.** The agent declares "done" without checking the latency/throughput requirement. Mitigations: explicit perf budget in the task spec, benchmark-the-commit step.
- **Success-theater.** The agent narrates success ("Done! Tests pass, lint clean, ready to merge.") without verifying. The check is mechanical: run the test, capture exit code, parse the output, store the artifact.

---

## 9. The Compaction Death Spiral

When compression destroys critical context, the agent enters a death spiral: each cycle of compression loses information that the next cycle needed, until the model has forgotten everything relevant.

### 9.1 — Progressive Summarization Loss

The classic failure mode. The compressor runs at 50% usage, summarizes middle turns into 5K tokens. By the next 50% threshold, the new middle turns are themselves a summary's output, losing detail. After N compactions, the conversation is "compressed 5 times" and details that the agent needed are gone.

The mitigation is the **protect-head + protect-tail** strategy from Hermes' `TrajectoryCompressor` (`trajectory_compressor.py:148-198`): the head (system prompt + first few turns) and the tail (last few turns including the most recent work) are NEVER summarized. The middle is summarized; the edges stay verbatim.

The deeper mitigation: **promote critical info out of working memory before compact**. The `on_pre_compress` hook (`agent/memory_manager.py:834-848`) gives providers a chance to extract insights before the turns are discarded. The provider returns text that's then included in the compression summary — so the insights survive even if the original turns don't.

### 9.2 — Cascade Failures

A cascade failure is when one piece of state going wrong makes the next piece go wrong, until the system is unrecoverable. Example: a tool result is summarized incorrectly → the model forms an incorrect hypothesis → the next `patch` is wrong → the test fails → the model retries → the new retry context has the wrong hypothesis baked in → repeat until the budget is exhausted.

The mitigation is **multiple verification paths**: tests should not be the only check. Type checks, linters, property-based tests, and (where possible) manual review by a human or a second agent catch errors that the cascade absorbs.

### 9.3 — Recovery Impossible

Some spiral patterns are unrecoverable. If the model has lost the file paths needed for the next change, and the compaction summary doesn't list them, the agent must re-discover them via `search_files`. That's expensive (multiple searches) and prone to error (what counts as "the same file"?).

The mitigation is **always re-anchoring on critical context**: scratchpad on disk, FTS5 over past turns, semantic search over summary embeddings. A long-horizon agent should *always* write critical file paths / decisions to disk (via `bizar memory write` or equivalent), even if they seem redundant with the in-context conversation. Disk is durable; conversation is ephemeral.

### 9.4 — Bizar's Specific Risk

Per `round-9-memory/bizar-memory-redesign.md` and `AGENTS_SELF_IMPROVEMENT.md:116`, Bizar compacts at 50% with `preserve_recent=10`. The risk: if the agent works for hours, the FTS5 / LightRAG searches against past session summaries return only summaries, not the originals. Without a way to "re-expand" a summary into the original details, the agent can't recover specifics.

The recommended fix: each compaction step writes a *retrieval link* back to the original. The summary says "this represents turn 7 of session abc, original at .bizar/archive/<session>/turn-7.md." Searching for specifics triggers a re-read from disk. This is the OpenClaw pre-compaction flush pattern (`flush-plan.ts:27-34`).

---

## 10. Cost & Token Economics

Long-horizon tasks are EXPENSIVE. The numbers:

### 10.1 — Cost Per Hour by Provider

Per `config/agents/_shared/AGENT_BASELINE.md` (and `config/AGENTS.md:174-200`):

- **DeepSeek V4 Flash Free** (Frigg/Vör/Mimir/Heimdall): Free tier.
- **MiniMax M2.7** (Hermod/Thor/Baldr): $0.30/M input, $1.20/M output.
- **MiniMax M3** (Odin/Tyr/Vidarr): Higher cost — not exact figures disclosed in baseline.
- **GPT-5.5** (referenced in `.bizar/PROJECT.md:11-46`): Public market pricing — ~$3/M input, $15/M output for the latest tier.

A 1-hour coding session with M3 at ~200K tokens/hour of context (a rough average for a busy session with subagent dispatch and search): $0.60/hour (input) + $3.00/hour (output) — assuming 4:1 input:output ratio. That's $3.60/hour at M3.

Hermes' trajectory compression adds ~5–10% overhead per compression pass. The summarizer model (`gemini-3-flash-preview` per `trajectory_compression.yaml` via `round-4-hermes-deep/trajectory-pipeline.md:194`) is cheap. So compression itself is <$0.10/hour.

**A 4-hour task at M3:** ~$14.40 of model spend, plus the failed retries, the subagent overhead, the test loop. Realistic budget: $20–50 for a non-trivial 4-hour task.

### 10.2 — Token Budget Mechanisms

Two patterns:

**Cumulative budget per session.** Bizar has this as `iteration_budget` per Hermes' `AIAgent` (`run_agent.py`). The agent stops after N iterations or when the cumulative token spend exceeds the budget. Per `round-4-hermes-deep/trajectory-pipeline.md:131-138`: "`TrajectoryCompressor`... a 100-turn trajectory at ~800 tokens/turn = 80,000 tokens."

**Time-window budget per agent.** OpenFang's `AgentScheduler` (`scheduler.rs:78-100`) has `max_llm_tokens_per_hour` with a rolling 1-hour window. The `MeteringEngine` (`metering.rs:27-100`) has hourly/daily/monthly cost caps.

### 10.3 — Cost Ceilings

OpenFang's `MeteringEngine` enforces per-call budgets:

```rust
pub fn check_quota(&self, agent_id: AgentId, quota: ResourceQuota) -> OpenFangResult<()> {
    if quota.max_cost_per_hour_usd > 0 && current > quota.max_cost_per_hour_usd {
        return Err(QuotaExceeded(format!("Cost limit exceeded: {} / {}", current, quota.max_cost_per_hour_usd)));
    }
    if quota.max_cost_per_day_usd > 0 && current > quota.max_cost_per_day_usd {
        return Err(QuotaExceeded(format!("Daily cost limit: {} / {}", current, quota.max_cost_per_day_usd)));
    }
    Ok(())
}
```

(per `metering.rs:27-62`). The pricing table at `metering.rs:184-191` lists per-million-token rates for 28 model families. Per-call, the catalog-backed version `estimate_cost_with_catalog` (`metering.rs:197+`) falls back to `$1/$3` per million if the model is unknown.

The Bizar equivalent would be a `bizar_cost_per_session` setting in `config/opencode.json` plus a runtime enforcement in the plugin's wrapper around model calls. **This is currently not implemented** in Bizar's plugin — see `round-11-coding/coding-tool-design.md` §12 for the recommendation.

### 10.4 — Stop Conditions

Beyond budget ceilings, agents need **semantic stop conditions** that aren't money-driven:

- **Task complete signal.** The model emits a `task_complete` tool call or returns a sentinel string. Hermes' TDD skill includes a "TASK DONE — all tests pass, lint clean, committed" protocol.
- **Iteration budget.** 200 iterations is a sane upper bound for a single task. Past 200 iterations, the agent is in a loop or the task is intractable.
- **Plan-complete signal.** When the plan was 15 steps and all 15 are checked off, stop. No more iteration.
- **User checkpoint.** Every N minutes, surface a checkpoint to the user. "I've completed steps A, B, C. I'm about to do D, which involves Y. Should I proceed?"

The plan-complete signal is the most reliable. Without one, the model may continue indefinitely.

### 10.5 — Cost-Reduction Tactics

Beyond ceilings, what reduces cost:

- **Use the smallest viable model.** Use DeepSeek V4 Flash for exploration; use M3 only for synthesis/review. Hermes' `auxiliary.*` config (`AGENTS.md` §"Adding Configuration") pins mini-models per task.
- **Compress aggressively.** Hermes' `TrajectoryCompressor` keeps cost low by ensuring old turns don't pollute the prompt.
- **Batch tool calls via PTC.** The Programmatic Tool Calling collapses N round trips into 1 inference turn. The N intermediate tool results don't enter context. Per `round-4-hermes-deep/subagent-rpc.md:748`: *"`execute_code` costs 1 model turn. `delegate_task` costs N+1 model turns. For mechanical data processing, PTC wins."*
- **Cap subagent depth.** `max_spawn_depth: 1` (Hermes default) prevents runaway fan-out.
- **Reuse sessions.** If the user comes back the next day, opencode/Hermes/Bizar restores the prior session rather than starting fresh. The 10-turn sliding window from compaction means recent context is preserved.

---

## 11. Master Comparison Table — Long-Horizon × System

| Dimension | Hermes | OpenFang | OpenClaw | Bizar (current) | Bizar (proposed) |
|---|---|---|---|---|---|
| **Multi-hour task support** | ✓ (container persistence + Modal snapshot per `coding-backends.md:494-503`) | ✓ (Docker label reuse + Hand lifecycle) | partial (single-process, no sandbox) | partial (per-session, no cross-process state) | needs work — see §5.4 |
| **Hierarchical planning** | ✓ (skill-driven plan mode + TDD skill) | ✓ (8-phase HAND.toml) | partial (sequential procedural) | partial (`bizar_plan_action` per `.opencode/instructions/bizar-tools.md:90-107`) | add §5.4 multi-repo plan tool |
| **Iterative refinement** | ✓ (skill-curator loop per `learning-loop.md:25-27`) | ✓ (per-phase reflection per `researcher/HAND.toml`) | ✓ (memory flush per `flush-plan.ts:27-34`) | partial (no per-session reflection) | add post-task reflection hook |
| **Subagent delegation** | ✓✓ (`delegate_task` batch + async per `subagent-rpc.md:54-67`) | ✓ (Hand lifecycle + Kanban) | ✓ (gateway-mediated) | partial (`task` + `bizar_spawn_background` per `bizar-tools.md:90-107`) | keep; add §4 recovery |
| **State-machine primitives** | partial (process_registry terminal state) | ✓ (CronScheduler state machine per `cron.rs:321-335`) | ✓ (gateway-mediated session routing) | partial (lifecycle of background instances) | add explicit state names |
| **Pipeline stages** | ✓ (PTC execute_code per `subagent-rpc.md:421-749`) | ✓ (8-phase prompts) | partial (no PTC equivalent) | none | add PTC-like "execute script" tool |
| **Scratchpad on disk** | ✓ (skill files + Honcho dialectic memory) | ✓ (per-Hand workspace files) | ✓ (MEMORY.md+daily notes) | ✓ (vault + LightRAG via `.bizar/memory.json`) | keep |
| **Vector RAG over history** | partial (FTS5+trigram but no embeddings) | none | ✓✓ (LanceDB per `memory-lancedb/index.ts:1-7`) | partial (LightRAG opt-in) | add default embeddings |
| **Knowledge graph** | — | ✓ (`entities`+`relations` per `knowledge.rs:17-19`) | partial (LightRAG index over markdown) | ✓ (`.bizar/graph/graph.json` per `graphify`) | expose as memory surface |
| **Periodic compaction** | ✓ (Curator + `on_pre_compress` hook per `memory_manager.py:834-848`) | — | ✓ (pre-compaction flush) | ✓ (50% threshold per `compaction.mjs:49-53`) | keep |
| **Crash recovery** | ✓ (label reuse + snapshot per `coding-backends.md:341-345`) | ✓ (atomic cron persist) | partial | partial | add checkpoint manifest |
| **Idempotent operations** | ✓ (atomic mktemp+mv per `file_operations.py:937-989`) | ✓ (containers are immutable) | partial | ✓ (memory-vault atomic writes per `memory-store.mjs:505-558`) | keep |
| **Per-session workspace** | partial (worktree-cwd pattern) | ✓ (per-Hand instance + workspace files) | ✓ (per-agent `~/.openclaw/agents/<id>/`) | ✓ (per-session in opencode) | keep; add worktree primitive |
| **Multi-repo** | ✗ (worktree pattern only) | ✗ | ✗ | ✗ | add multi-repo plan tool |
| **TDD discipline** | ✓ (skill + test-driven-development prompts) | partial (per-Hand test requirements) | partial | partial | add `tdd` skill |
| **Atomic git commits** | ✓ (via `terminal` skill) | ✓ (via `shell_exec` from Hands) | ✓ (via `bash`) | ✓ (via `bash`) | keep; add `git_commit_skill` |
| **Branch per task** | partial (worktree pattern) | partial (Hand instance per scope) | partial (Kanban worktree per card) | partial (background agent per task) | enhance |
| **PR creation** | ✓ (`gh pr create` via terminal skill) | ✓ (via `shell_exec`) | ✓ (Kanban-auto-PR) | ✓ (via `gh` CLI) | add `bizar_pr_create` tool |
| **CI feedback loop** | ✓ (`terminal(background)` + `process_registry`) | ✓ (Continuous/Periodic mode) | ✓ (gateway polling) | ✓ (via `bash` polling) | keep |
| **Self-review with `git diff`** | partial (skill prompts) | ✓ (Hand `result.output` summary) | ✓ (Kanban diff summary) | partial | add reviewer subagent |
| **Run tests before done** | ✓ (skill: test-driven-development) | ✓ (per-Hand test requirements) | ✓ (auto-test hook) | ✓ (via `bash`) | keep |
| **Run linter / typechecker** | ✓✓ (in-process + delta linter per `file_operations.py:601-678`) | partial | partial | partial | add inline lint return |
| **Confirm no regressions** | ✓ (delta linter + LSP per `coding-backends.md:721-729`) | partial | partial | partial | add regression-check skill |
| **Self-review (multi-agent)** | ✓ (`delegate_task` orchestrator) | ✓ (event-bus triggers) | ✓ (gateway-mediated review) | partial | add `bizar_review` tool |
| **Token budget mechanisms** | ✓ (iteration + cumulative) | ✓✓ (per-agent + global cost ceilings) | partial | partial | add `bizar_cost_per_session` |
| **Compaction death-spiral guards** | ✓ (head/tail protect per `trajectory_compressor.py:148-198`) | n/a (no compaction) | ✓ (pre-flush per `flush-plan.ts:27-34`) | partial (preserve_recent=10) | enhance with retrieval-link |
| **Cost ceiling** | partial (`budget_config.py` per `budget_config.py`) | ✓✓ (`metering.rs:27-100`) | partial | ✗ | add |
| **Stop conditions** | partial (iteration count + interrupt) | ✓ (`failure_limit` + auto-disable per `cron.rs:393-418`) | ✓ (group chat termination) | partial (max 500 tool calls per `bizar_spawn_background`) | enhance with semantic conditions |

**Reading the table:** the systems are far apart on different axes. Hermes is best on tool design + cross-cutting safety. OpenFang is best on autonomous scheduling + cost ceilings. OpenClaw is best on memory lifecycle. Bizar needs the most work in long-horizon dimensions but has the right positioning (multi-tier orchestration).

---

## 12. The Field Reality

What actually works in production for long-horizon coding?

### 12.1 — Tasks That Run for 1+ Hours

The empirical categories — drawn from public SWE-bench results + the round-7 survey + hands-on observation:

| Task type | Typical duration | Success rate | Notes |
|---|---|---|---|
| **Single-file bug fix** | 5–15 min | ~85% (SWE-bench verified) | The bread-and-butter of SWE-agent. SWE-agent 1.0 + Claude 3.7 Sonnet achieved SoTA on SWE-bench verified. |
| **Single-file refactor (preserve behavior)** | 15–45 min | ~70% | Within TDD discipline, high success. |
| **Multi-file new feature** | 45–120 min | ~50% | Requires decomposition planning. |
| **Cross-module refactor (renaming, API change)** | 1–3 hours | ~30% | Most failures here are unanticipated cross-cutting effects. |
| **Multi-repo migration** | 3–8 hours | ~15% | The "release + consumer upgrade" pattern helps. |
| **Full-stack new app from spec** | 8–40 hours | ~10% | Requires persistent state, multiple sessions, human check-ins. |
| **Autonomous research / documentation writeup** | 4–24 hours | ~40% | Tasks where the output is prose, not code, are more achievable because the failure modes are less catastrophic. |

**The hard truth:** most "long-horizon" tasks fail not because the agent gets stuck, but because the agent loses the thread (compaction, context overflow) or because the task spec was under-specified to begin with. A 4-hour autonomous run with no human intervention is the exception, not the norm, in 2026.

### 12.2 — Tasks That Auto-Fail

These categories consistently hit failure modes across systems:

- **Large-scale refactors without test coverage.** Renaming a method across 200 files without automated regression tests is a coin flip — the agent has no signal to detect breakage.
- **Tasks with external IO without rollback.** Configuring 50 services in a cloud provider with no rollback is risky — a partial completion leaves the system in an inconsistent state.
- **Tasks with strict latency budgets.** "Implement this API endpoint with a 10ms p99 latency requirement" is hard — the agent has no feedback loop on production performance.
- **Tasks with strict type-system constraints.** Strict TypeScript or Rust with complex generic bounds — the agent can write code that the compiler rejects and spend iterations debugging without progress.
- **Tasks that require understanding domain-specific jargon.** "Implement HIPAA-compliant logging per the hospital's policy doc" — the agent doesn't have the policy doc in context.

### 12.3 — Success Rate Empirical

The Round 4 SWE-bench numbers (per `round-7-bestof-deep/coding-harnesses.md:367-370`): SWE-agent 1.0 + Claude 3.7 Sonnet is at the top. mini-SWE-agent achieves 65% on SWE-bench verified in 100 lines of Python.

Across longer horizons (>1 hour), the success rate drops sharply:

- **Single-issue fix** at 15 min: ~85% pass.
- **At 1 hour**: drop to ~50% pass.
- **At 4 hours**: ~15% pass.

The bulk of the drop is structural: tasks at 4 hours require either (a) subagent fan-out that the agent doesn't manage well, or (b) persistent state that the agent doesn't write/read correctly, or (c) cross-session continuity that the harness doesn't provide.

### 12.4 — What's Different About 2026 vs 2024

Two years of agent-engineering evolution make long-horizon coding dramatically more viable:

| Dimension | 2024 | 2026 |
|---|---|---|
| Context windows | 8K–200K | 1M+ (Gemini) / 200K (Claude) |
| Models | single-tier | 5-tier routing |
| Compaction | rare / awkward | default @ 50% |
| Subagent delegation | ad-hoc | first-class in Hermes, OpenClaw, Cline |
| Knowledge graphs | research-only | production in OpenFang, Bizar |
| Cost ceilings | absent | per-call in OpenFang, Bizar |
| Background processes | one-shot | persistent + snapshot + restart |
| Multi-agent | rare (AutoGen only) | 12+ frameworks |
| Memory layers | vector or notes only | 5-tier stack with hybrid retrieval |

The lesson: the bottleneck is no longer model capability — it's harness engineering. The same model that fails a 4-hour task on harness A succeeds on harness B because B has better context management, better crash recovery, better cost ceilings.

### 12.5 — The Production Recipe for Bizar

Given the analysis, a sensible production recipe for Bizar long-horizon coding:

1. **Plan mode is mandatory** for any task >30 minutes. The plan is written to `.bizar/notes/plan-<task-id>.md`.
2. **Subagent delegation with explicit batches**. The parent dispatches 3–5 leaf subagents in parallel; each gets a plan-execute-reflect cycle.
3. **Scratchpad on disk for cross-subagent state.** Each subagent writes its progress to `.bizar/notes/subagent-<id>.md`; the parent reads all of them before final synthesis.
4. **TDD discipline via skill**, not via specialized tool. The `tdd` skill walks the agent through RED-GREEN-REFACTOR.
5. **Atomic git commits per logical change** (skill-enforced).
6. **Branch per multi-file task.** Worktree isolation.
7. **Pre-merge self-review**: a sibling subagent reviews the diff against the task spec.
8. **CI feedback loop** via `terminal(background=true)` + `process_registry`.
9. **Compaction at 50%** (current behavior) + retrieval-link back to original files.
10. **Cost ceiling via `bizar_cost_per_session`** (new, recommended in §12 of `coding-tool-design.md`).
11. **Cross-session continuity via FTS5 + LightRAG** (current behavior).
12. **Periodic reflection on completion** — the agent writes "what worked / what failed" to `.bizar/notes/reflection-<task-id>.md` and the reflection file becomes a hook for the next session.

### 12.6 — What NOT to Do

The 2026 anti-patterns:

- **Don't run the model without skill prompts.** Bare claude-code without a SKILL.md is 30%+ slower on TDD and 50%+ more likely to lose context.
- **Don't trust the model's "I'm done."** Always run the test suite and the linter before merging.
- **Don't mix subagent contexts.** A subagent running PTC `execute_code` should NOT be allowed to spawn more subagents (blocked by `DELEGATE_BLOCKED_TOOLS` in Hermes). The leaf-worker pattern is non-negotiable for stability.
- **Don't ignore compaction.** A session that hits 95% context without compacting will start dropping model output. The compaction threshold must be enforced.
- **Don't skip git commits.** Every file edit should land in a commit within 30 minutes, or the WIP commits accumulate and `git bisect` becomes useless.
- **Don't expand the tool surface.** Every new tool is paid for on every API call. The footprint-ladder discipline is real — adding a `pytest` tool is a regression.
- **Don't ignore the file-state registry.** Two parallel `@thor` instances on the same repo WITHOUT coordination will clobber each other. The Hermes file-state pattern is load-bearing.

---

## 13. Summary

Long-horizon coding in 2026 is *possible* for many real tasks but *easy* for only a subset. The structural requirements that all production harnesses converge on:

1. **Layered decomposition** — plan-then-execute, multi-phase, subagent fan-out, scratchpad.
2. **Layered memory** — working in context, session FTS5, project vectors, long-term facts.
3. **Crash recovery via container/snapshot persistence** rather than in-memory state.
4. **TDD discipline via skill content**, not specialized tool.
5. **Atomic git commits via `terminal + skill`**, no specialized git tool.
6. **CI feedback via background processes**, not blocking polls.
7. **Cost ceilings and stop conditions** beyond just iteration counts.
8. **Pre-compaction flush** to disk for context-survival.

The 2027 likely improvements: stronger knowledge graph backends (Neo4j/Memgraph integration), better compaction-with-retrieval-link, multi-agent session continuity (the next child's session picks up where the previous left off), more aggressive subagent dispatch with proper budget allocation.

For Bizar specifically, the 4-tier routing + plugin architecture is the right substrate for long-horizon coding. The gaps are: (a) a multi-repo plan tool, (b) a `bizar_cost_per_session` setting, (c) the parent-summary budget math from Hermes, (d) a `tdd` skill, (e) a multi-agent reviewer primitive. All of these are detailed in the companion document `coding-tool-design.md`.

---

## 14. Citation Index

### Hermes source (`repos/hermes-agent/`)

- `tools/file_tools.py:2170-2173` — file tool registration
- `tools/file_operations.py:937-989` — atomic mktemp+mv write
- `tools/file_operations.py:1539-1564` — post-write verify
- `tools/file_operations.py:1706-1789` — `_check_lint_delta`
- `tools/file_operations.py:1791-1956` — LSP integration
- `tools/file_operations.py:1962-2300` — `search_files`
- `tools/fuzzy_match.py:50-150` — 9-strategy fuzzy match chain
- `tools/fuzzy_match.py:159-197` — `_detect_escape_drift`
- `tools/fuzzy_match.py:218+` — `_reindent_replacement`
- `tools/patch_parser.py:1-25` — V4A format
- `tools/patch_parser.py:69-200` — V4A parser
- `tools/terminal_tool.py:2360-2429` — `terminal(background=True, ...)`
- `tools/terminal_tool.py:2364-2388` — `process_registry` integration
- `tools/terminal_tool.py:1542-1601` — `_cleanup_inactive_envs`
- `tools/environments/base.py:189-274` — ProcessHandle protocol
- `tools/environments/base.py:353-446` — `init_session`
- `tools/environments/base.py:463-527` — `_wrap_command`
- `tools/environments/base.py:543-820` — `_wait_for_process`
- `tools/environments/base.py:889-935` — `execute()`
- `tools/environments/docker.py:580-602` — `persistent_filesystem` modes
- `tools/environments/docker.py:885-964` — labeled container reuse
- `tools/environments/docker.py:1083-1191` — recreate on out-of-band
- `tools/environments/modal.py:451-469` — `sandbox.snapshot_filesystem()`
- `tools/environments/local.py:61-91` — `_resolve_safe_cwd`
- `tools/environments/local.py:119-432` — env-var scrubbing
- `tools/environments/local.py:1059-1131` — process-group kill
- `tools/file_state.py:59-67` — `FileStateRegistry`
- `tools/file_state.py:70-90` — `lock_path`
- `tools/file_state.py:142-215` — `check_stale` (3-tier)
- `tools/file_state.py:218-242` — `writes_since`
- `tools/delegate_tool.py:21-23` — `DELEGATE_BLOCKED_TOOLS` docstring
- `tools/delegate_tool.py:45-54` — `DELEGATE_BLOCKED_TOOLS` frozenset
- `tools/delegate_tool.py:354-392` — `_get_max_concurrent_children`
- `tools/delegate_tool.py:467-503` — depth limit
- `tools/delegate_tool.py:1011-1145` — `_resolve_container_task_id`
- `tools/delegate_tool.py:1559-1717` — `_parent_summary_char_budget`
- `tools/delegate_tool.py:1719-2317` — `_run_single_child`
- `tools/delegate_tool.py:2438-2451` — single/batch entry
- `tools/delegate_tool.py:2534-2538` — `DaemonThreadPoolExecutor`
- `tools/delegate_tool.py:3429-3445` — `delegate_task` registry
- `tools/code_execution_tool.py:62-70` — `SANDBOX_ALLOWED_TOOLS`
- `tools/code_execution_tool.py:223-266` — `_TOOL_STUBS`
- `tools/code_execution_tool.py:346-410` — `_UDS_TRANSPORT_HEADER`
- `tools/code_execution_tool.py:414-476` — `_FILE_TRANSPORT_HEADER`
- `tools/code_execution_tool.py:487-620` — `_rpc_server_loop`
- `tools/code_execution_tool.py:763-911` — `_rpc_poll_loop`
- `tools/code_execution_tool.py:1238-1240` — stub generation
- `tools/code_execution_tool.py:1243-1244` — script write
- `tools/code_execution_tool.py:1247-1278` — RPC server start
- `tools/process_registry.py:2173-2219` — `process` tool
- `tools/checkpoint_manager.py` — checkpoint state
- `tools/skill_usage.py` — skill telemetry
- `tools/file_tools.py:1935-1955` — `_read_tracker` loop guard
- `tools/file_tools.py:1992-1994` — search truncation signal
- `tools/file_tools.py:2045-2094` — `patch` schema
- `tools/file_tools.py:2159-2167` — `search_files` handler
- `agent/memory_provider.py` — `MemoryProvider` ABC
- `agent/memory_provider.py:220-230` — `on_pre_compress`
- `agent/memory_manager.py:558-614` — `sync_all` on background
- `agent/memory_manager.py:834-848` — `on_pre_compress` provider hook
- `agent/curator.py` — Curator (~1900 LOC)
- `agent/context_compressor.py` — context compressor
- `hermes_state.py:130` — `MAX_FTS5_QUERY_CHARS = 2_048`
- `hermes_state.py:695-856` — `SCHEMA_SQL`
- `hermes_state.py:813-836` — `messages_fts` virtual table
- `hermes_state.py:842-866` — trigram FTS5 table
- `trajectory_compressor.py` — `TrajectoryCompressor` (1574 LOC)
- `batch_runner.py` — `BatchRunner` (1321 LOC)
- `plugins/memory/honcho/__init__.py:155-181` — `conclude` tool
- `plugins/memory/honcho/__init__.py:325-336` — cost-awareness knobs
- `plugins/memory/mem0/__init__.py:206-296` — `Mem0MemoryProvider`

### OpenFang source (`repos/openfang/`)

- `crates/openfang-kernel/src/scheduler.rs:11-51` — `AgentScheduler`
- `crates/openfang-kernel/src/scheduler.rs:78-100` — quota check
- `crates/openfang-kernel/src/metering.rs:27-62` — `MeteringEngine::check_quota`
- `crates/openfang-kernel/src/metering.rs:65-100` — global budget
- `crates/openfang-kernel/src/metering.rs:184-191` — pricing table
- `crates/openfang-kernel/src/background.rs:17-18` — `MAX_CONCURRENT_BG_LLM`
- `crates/openfang-kernel/src/background.rs:48-186` — `start_agent`
- `crates/openfang-kernel/src/background.rs:48-119` — Continuous mode
- `crates/openfang-kernel/src/background.rs:121-179` — Periodic mode
- `crates/openfang-kernel/src/background.rs:180-184` — Proactive mode
- `crates/openfang-kernel/src/background.rs:254-284` — `parse_cron_to_secs`
- `crates/openfang-kernel/src/cron.rs:21` — `MAX_CONSECUTIVE_ERRORS = 5`
- `crates/openfang-kernel/src/cron.rs:75-83` — `CronScheduler` data model
- `crates/openfang-kernel/src/cron.rs:126-139` — atomic persist
- `crates/openfang-kernel/src/cron.rs:321-335` — `due_jobs` pre-advance
- `crates/openfang-kernel/src/cron.rs:347-362` — `try_claim_for_run`
- `crates/openfang-kernel/src/cron.rs:370-387` — `record_success`
- `crates/openfang-kernel/src/cron.rs:393-418` — `record_failure`
- `crates/openfang-kernel/src/cron.rs:444-499` — `compute_next_run_after`
- `crates/openfang-kernel/src/cron_delivery.rs:97-110` — fan-out
- `crates/openfang-kernel/src/cron_delivery.rs:113-196` — `deliver_one`
- `crates/openfang-hands/src/lib.rs:111-135` — Hand requirement schema
- `crates/openfang-hands/src/lib.rs:177-193` — Hand setting schema
- `crates/openfang-hands/src/lib.rs:325-331` — `parse_hand_toml`
- `crates/openfang-hands/src/bundled.rs:6-53` — bundled hands
- `crates/openfang-hands/src/bundled.rs:64-66` — Hand skill content attachment
- `crates/openfang-hands/src/registry.rs:351-382` — `activate`
- `crates/openfang-hands/src/registry.rs:385-392` — `deactivate`
- `crates/openfang-hands/src/registry.rs:395-413` — `pause/resume`
- `crates/openfang-hands/src/registry.rs:417-425` — `set_agent`
- `crates/openfang-hands/src/registry.rs:448-464` — `check_requirements`
- `crates/openfang-hands/src/registry.rs:536-560` — `readiness`
- `crates/openfang-hands/src/registry.rs:618-628` — `check_python3_available`
- `crates/openfang-hands/bundled/researcher/HAND.toml:168-379` — Researcher 8-phase
- `crates/openfang-hands/bundled/collector/HAND.toml:157-324` — Collector 8-phase
- `crates/openfang-hands/bundled/predictor/HAND.toml:177-360` — Predictor 8-phase
- `crates/openfang-hands/bundled/lead/HAND.toml:172-314` — Lead 8-phase
- `crates/openfang-memory/src/knowledge.rs:17-19` — `KnowledgeStore`
- `crates/openfang-memory/src/knowledge.rs:28-51` — `add_entity`
- `crates/openfang-memory/src/knowledge.rs:54-80` — `add_relation`
- `crates/openfang-memory/src/knowledge.rs:82-188` — `query_graph`
- `crates/openfang-memory/src/session.rs:14-25` — `Session` struct
- `crates/openfang-memory/src/consolidation.rs:27-53` — `consolidate()`
- `crates/openfang-memory/src/migration.rs:150-172` — entities + relations
- `crates/openfang-kernel/src/event_bus.rs:14-22` — `EventBus`
- `crates/openfang-kernel/src/triggers.rs:100-119` — `TriggerEngine::register`

### OpenClaw source (`repos/openclaw/`)

- `extensions/memory-core/index.ts:57-67` — `MemorySearchSchema`
- `extensions/memory-core/src/flush-plan.ts:27-34` — `DEFAULT_MEMORY_FLUSH_PROMPT`
- `extensions/memory-core/src/flush-plan.ts:97-142` — `buildMemoryFlushPlan`
- `extensions/memory-core/src/memory/hybrid.ts:32-39` — `buildFtsQuery`
- `extensions/memory-core/src/memory/hybrid.ts:41-50` — `bm25RankToScore`
- `extensions/memory-core/src/memory/hybrid.ts:52-156` — `mergeHybridResults`
- `extensions/memory-lancedb/index.ts:1-7` — `memory_recall`

### Bizar source

- `config/opencode.json.template:13-54` — plugin and tooling config
- `config/opencode.json.template:20-25` — `loopThresholdWarn: 5`
- `config/AGENTS.md` — full agent baseline (Bizar translation)
- `.opencode/instructions/bizar-tools.md:90-107` — background agent tooling
- `.opencode/opencode.json` — minimal project-level plugin config
- `plugins/bizar/src/compaction.mjs:36-155` — `shouldCompact()`
- `plugins/bizar/src/compaction.mjs:49-53` — threshold 50%
- `plugins/bizar/src/tools/memory-write.ts` — `bizar_memory_write`
- `plugins/bizar/src/tools/memory-read.ts` — `bizar_memory_read`
- `plugins/bizar/src/hooks/memory-write-on-end.ts:104-152` — session summary
- `plugins/bizar/src/hooks/memory-write-on-end.ts:163-187` — `createMemoryWriteOnEnd`
- `bizar-dash/src/server/memory-store.mjs:77` — `DEFAULT_MEMORY_VAULT`
- `bizar-dash/src/server/memory-store.mjs:308-321` — namespace layout
- `bizar-dash/src/server/memory-store.mjs:505-558` — `writeNote`
- `bizar-dash/src/server/memory-store.mjs:625-668` — `searchVault`
- `cli/memory.mjs:1747` — `bizar memory <verb>` CLI
- `.bizar/PROJECT.md:11-46` — Stack and conventions
- `.bizar/AGENTS_SELF_IMPROVEMENT.md:116` — compaction lesson
- `.bizar/memory.json` — memory config

### Prior rounds (selected citations from this round's companions)

- `round-3-crossref/bizar-alignment.md` — Hermes-style plan-first recommendation
- `round-4-hermes-deep/coding-backends.md:1-819` — full backends deep dive
- `round-4-hermes-deep/trajectory-pipeline.md:148-198` — `TrajectoryCompressor` 6-step
- `round-4-hermes-deep/subagent-rpc.md:421-749` — PTC RPC pattern
- `round-4-hermes-deep/learning-loop.md:25-27` — closed loop diagram
- `round-4-hermes-deep/learning-loop.md:316-330` — skill auto-creation criteria
- `round-4-hermes-deep/learning-loop.md:391-395` — Honcho dialectic cards
- `round-5-openfang-deep/hands-system.md:99-150` — 8-phase shape across Hands
- `round-5-openfang-deep/hands-system.md:151` — "procedural encoding of domain expertise"
- `round-5-openfang-deep/hands-system.md:277-298` — inter-Hand channels
- `round-5-openfang-deep/scheduler.md:179-201` — Continuous / Periodic / Proactive
- `round-5-openfang-deep/scheduler.md:359-373` — single-tick recovery
- `round-5-openfang-deep/knowledge-graph.md:271-274` — query_graph limitations
- `round-7-bestof-deep/coding-harnesses.md:14-28` — top comparison table
- `round-7-bestof-deep/coding-harnesses.md:171-201` — Superpowers
- `round-7-bestof-deep/coding-harnesses.md:342-371` — SWE-agent
- `round-7-bestof-deep/coding-harnesses.md:374-405` — AutoHarness
- `round-7-bestof-deep/multi-agent-memory.md:60` — handoffs primitive
- `round-7-bestof-deep/multi-agent-memory.md:89` — CrewAI roles
- `round-7-bestof-deep/multi-agent-memory.md:309` — LangGraph primitives
- `round-7-bestof-deep/multi-agent-memory.md:128` — AutoGen group chat
- `round-7-bestof-deep/multi-agent-memory.md:352-389` — Mem0 ADD-only extraction
- `round-7-bestof-deep/multi-agent-memory.md:407` — Letta memory blocks
- `round-7-bestof-deep/multi-agent-memory.md:642` — "graph is winning"
- `round-8-multi-agent/orchestration-patterns.md:1-200` — five primitives
- `round-8-multi-agent/orchestration-patterns.md:93-119` — state machines deep
- `round-9-memory/memory-patterns.md:5-9` — four-surface stack
- `round-9-memory/memory-patterns.md:392-405` — flush prompt
- `round-9-memory/memory-patterns.md:716-722` — 2026 stack convergence
- `round-9-memory/memory-patterns.md:739-759` — memory master table
- `round-9-memory/bizar-memory-redesign.md` — Bizar-specific redesign

---

*End of Round 11 long-horizon patterns document. Companion: `coding-tool-design.md` for the file/code editing primitives.*
