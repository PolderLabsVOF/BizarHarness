# Bizar Multi-Agent Redesign — From Tier Dispatch to Coordinated Crews

**Round 8 — Multi-Agent Redesign (Companion Document)**
**Scope:** Apply findings from `round-8-multi-agent/orchestration-patterns.md` to Bizar's multi-agent system. Concrete recommendations: shared knowledge graph, event bus, agent-to-agent messaging, persistent agent state, capability-based routing, the Bizar Crew pattern, and a phased implementation roadmap.
**Date:** 2026-07-06
**Author:** @tyr (round 8 of the agent-harness survey)
**Inputs:** `round-3-crossref/bizar-alignment.md`, `round-4-hermes-deep/subagent-rpc.md`, `round-5-openfang-deep/hands-system.md`, `round-6-openclaw-deep/memory-tools.md`, `round-7-bestof-deep/multi-agent-memory.md`, `round-8-multi-agent/orchestration-patterns.md` (this round's other document).

This is the most actionable document in the survey. Where the orchestration-patterns document catalogs what the 2026 cohort does, this one asks: *what should Bizar do, and in what order?*

Every recommendation cites a specific Bizar file. Where I propose a new file, the proposal names the path and the architectural shape but does not contain code (per the brief: "implementation outline, no code"). The Phase 1 / 2 / 3 roadmap at the end sequences the work by what is buildable now vs. what requires a plugin version bump.

---

## Section A — Bizar's Current Multi-Agent Architecture

Bizar's v5.5.1 architecture is a **12-agent tier-dispatch system** built on opencode's `task` tool. The structure is:

### A.1 — The Roster

`config/opencode.json:5` declares `default_agent: "odin"`. The `agent` block at `config/opencode.json:60-271` declares 12 agents (one is `default_agent`, the rest are dispatch targets):

| Agent | Mode | Model | Tier | Role |
|---|---|---|---|---|
| **Odin** | primary | `minimax/MiniMax-M3` | 1 | Pure router. Decomposes requests, dispatches subagents, synthesizes results. |
| **Frigg** | primary | `minimax/MiniMax-M2.7` | 1 | Read-only Q&A with file:line citations. |
| **Quick** | primary | `minimax/MiniMax-M2.7-Flash` | 1 | Fast single-shot escape hatch. No delegation. |
| **Vör** | subagent | `minimax/MiniMax-M2.7` | 2 | Clarifier — asks targeted project-specific questions when ambiguous. |
| **Mimir** | subagent | `minimax/MiniMax-M2.7` | 2 | Deep codebase research, Semble-first. |
| **Heimdall** | subagent | `minimax/MiniMax-M2.7` | 2 | Simple mechanical tasks. |
| **Hermod** | subagent | `minimax/MiniMax-M2.7` | 2 | Git/GitHub operations. |
| **Baldr** | subagent | `minimax/MiniMax-M2.7` | 2 | Design system planning (no implementation). |
| **Thor** | subagent | `minimax/MiniMax-M2.7` | 3 | Moderate-complexity implementation, Forseti-gated. |
| **Tyr** | subagent | `minimax/MiniMax-M3` | 4 | Complex implementation, Forseti-gated. |
| **Vidarr** | subagent | `minimax/MiniMax-M3-Reasoning` | 5 | Last-resort fallback. Reasoning enabled. |
| **Forseti** | subagent | `minimax/MiniMax-M3` | 3 | Adversarial plan audit. Read-only. |

Plus `semble-search` (Tier 2, Semble-only), making 13 agents total. The descriptions at `config/opencode.json:62, 76, 87, 103, 122, 140, 157, 173, 190, 207, 224, 241, 259` are the canonical agent rosters.

### A.2 — How They Communicate Today

Bizar has exactly **one** inter-agent channel: the `task` tool (an opencode primitive). Odin (or any agent with `task: allow` permission — currently only Odin, `config/opencode.json:67`) dispatches to a subagent via `task agent_name prompt=...`. The subagent runs to completion, returns a string. Odin synthesizes the result.

There are three optional parallel modes:

1. **Sync fan-out.** Odin calls `task` N times in a single message. The model decides what to run in parallel. The model receives N string results.

2. **Background agent.** Odin calls `bizar_spawn_background` (a plugin tool, `config/opencode.json:54`) which spawns a long-lived opencode session via `POST /api/background` (`plugins/bizar/src/tools/bg-spawn.ts:50-101`). The dispatch returns an `instanceId` immediately. Odin polls via `bizar_collect` later. The plugin tracks state in `~/.cache/bizarharness/bg/<instanceId>.json` (`.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md:296`).

3. **PR review mode.** `pr-review` is a slash command that runs `hermod` and dispatches `mimir` (research) + `forseti` (audit) in parallel, then posts a combined review (`config/opencode.json:298-302`). It is the only command-level orchestration pattern beyond plain `task`.

### A.3 — Routing

Routing is hard-coded in prose. The `AGENTS.md` "Routing Heuristic" table is the canonical reference:

> | Task Type | Route To |
> | File lookup, search, ls, info | @heimdall |
> | Quick questions, explanations | @heimdall |
> | Simple edit, rename, format | @heimdall |
> | Mechanical CRUD, boilerplate | @heimdall |
> | Read-only codebase Q&A | @frigg |
> | Ambiguous/incomplete requests | @vör |
> | Deep codebase research | @mimir |
> | Git commit, push, pull | @hermod |
> | Branching, merging, rebasing | @hermod |
> | PR management | @hermod |
> | Moderate feature implementation | @thor |
> | Design system creation | @baldr |
> | Complex new feature from scratch | @tyr (plan → @forseti → execute) |
> | Deep debugging | @tyr |
> | Tier 4 failure / stuck debugging | @vidarr |
> | Plan/approach review | @forseti |
> | Project initialization | @heimdall |
> | PR review (GitHub) | @hermod (runs /pr-review mode) |
> | Parallel test gate after implementation | @thor |

Odin reads this table and decides. There is no LLM-based classifier (à la agent-squad) and no capability-based discovery. The decision is fully manual.

### A.4 — Memory & State

Bizar's memory is a **5-layer hybrid** (Model E in §4.1 of the patterns document):

1. **Working memory** — `.bizar/memory.json` (per-project, JSON).
2. **Code graph** — `.bizar/graph/graph.json` (Graphify-populated from source code).
3. **Semantic index** — LightRAG index at `.bizar/lightrag/`.
4. **Durable archive** — Obsidian vault (typically at `~/vaults/bizar`).
5. **Self-improvement log** — `.bizar/AGENTS_SELF_IMPROVEMENT.md` (append-only Markdown).

The R7 study noted: *"Bizar already has layers 1-2 (.bizar/memory.json) and 4 (Obsidian + .bizar/AGENTS_SELF_IMPROVEMENT.md); it is missing layer 3 — a fact extractor that runs at session end."* (`round-7-bestof-deep/multi-agent-memory.md:723`). Mem0 is the recommended addition.

### A.5 — The Sibling Awareness Protocol

When multiple Bizar agents run in parallel (e.g., Odin dispatches Thor + Tyr + Forseti in one message), they share one `.git/` directory. The "Parallel Execution Awareness" section in `AGENTS.md` documents the constraints:

> 1. File scope is sacred. Odin assigns you a scope. Only modify files inside it.
> 2. No write-level git.
> 3. Detect conflicts before they happen.
> 4. .git/index.lock is a sibling's signal.
> 5. Lockfiles and root configs are shared.
> 6. Report parallel context in your final summary.

This is a **manual contract** — agents are expected to follow it. There is no enforcement. The plugin-level loop guard (`loopThresholdWarn: 5, loopThresholdEscalate: 8, loopThresholdBlock: 12` at `config/opencode.json:38-40`) detects an agent looping on the same tool but does not detect two agents editing the same file.

### A.6 — Background Agents in Detail

The v0.4.2 plugin spec at `.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md` is the most complete Bizar multi-agent document. The flow:

1. Odin calls `bizar_spawn_background(agent, prompt, model?, timeoutMs?)`.
2. Plugin checks `ctx.agent === "odin"` (only Odin can spawn — `plugin-architecture-v0.4.1-background-agents.md:638-647`).
3. Plugin validates model format (`<providerID>/<modelID>`), clamps `timeoutMs` to `[1000, 1800000]`.
4. Plugin generates `instanceId` as `bgr_<ulid>` and stores `BackgroundState` in `~/.cache/bizarharness/bg/<instanceId>.json`.
5. Plugin POSTs to `http://127.0.0.1:<port>/api/background` (the dashboard's SDK-backed spawner per `plugins/bizar/src/tools/bg-spawn.ts:4-30`).
6. Returns `{ instanceId, sessionId, status: "pending" }` immediately.
7. Plugin subscribes to `GET /event?directory=<worktree>` SSE stream (single global subscription, filtered by `sessionID` per `event-stream.ts:122`).
8. On `EventSessionIdle` → `done`; on `EventSessionError` → `failed`; on threshold-12 loop guard throw → `failed` with `[loop guard: 12 identical calls to <tool>]` marker.
9. On `bizar_collect(instanceId, timeoutMs)` → plugin reconstructs result from `GET /session/{id}/message`, concatenates `TextPart.text` values in message order, returns string.

The implementation is robust. It handles serve child crashes, plugin shutdown, and per-instance tool-call caps. The gap is what happens to the result *after* collection — currently Odin reads the string and decides what to do.

### A.7 — What Bizar is Good At

Honesty matters. Bizar is genuinely good at:

- **Cost-aware routing.** The 5-tier model selection is disciplined. Odin/M3 sees only short routing prompts; M2.7 Flash handles trivial edits.
- **Forseti plan-review gate.** Tier 3+ requires adversarial plan review before code is written. None of the multi-agent cohort (CrewAI, AutoGen, LangGraph, MAF, MetaGPT) has this. It is Bizar's unique asset.
- **The 5-layer memory hybrid.** No single framework in the cohort ships 5 memory surfaces.
- **The plugin architecture.** `.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md` is a well-designed background-agent system. The Forseti audits it (the spec carries audit references like `HIGH-1`, `MEDIUM-19`, etc.).
- **Skills CLI integration.** Skills are installable via `skills add <owner/repo> -s <name>` with `skills-lock.json` pinning versions.
- **Headroom + LightRAG + Obsidian integration.** These three work together; the dashboard exposes them in a dedicated Memory tab.

### A.8 — What Bizar is Bad At

Equally honest. Bizar currently lacks:

- **Persistent context between dispatches.** Each `task` invocation starts the child from a fresh context. The child has no memory of prior dispatch outputs unless Odin replays them.
- **An event bus.** Synchronous `task` is the only IPC. Background agents are async but Odin cannot subscribe to mid-flight events from them.
- **Background agents that talk to each other.** Two `bizar_spawn_background` calls produce two isolated instances with no shared state.
- **A shared agent-writable knowledge graph.** `.bizar/graph/` exists and Graphify populates it from code, but agents cannot call `bizar_knowledge_add_entity` to record domain facts.
- **An agent death recovery protocol.** If Thor dies mid-task, Odin sees a `failed` status but cannot resume from Thor's last good state. The trajectory is in `~/.cache/bizarharness/logs/<sessionId>.log` but is not structured for replay.
- **Typed message envelopes.** The `task` tool passes a string prompt and returns a string answer. No structured `BizarToolResult { ok, payload, transcript }`.
- **Capability-based routing.** Odin dispatches by name. If a user has installed a custom agent, Odin does not know it exists.
- **Trajectory capture.** R3 §B.6 plans it but it is not shipped. Without trajectories, Bizar cannot replay, evaluate, or learn from its own dispatches.

The rest of this document proposes fixes for each gap, in priority order.

---

## Section B — Gaps Identified

The patterns document identified five universal coordination primitives (handoffs, roles, group chat, state machines, event bus) and six layers of plumbing (discovery, identity, routing, state sharing, synchronization, failure). Mapping that against the current Bizar architecture:

### B.1 — Coverage Matrix

| Layer | Current Bizar | Gap |
|---|---|---|
| **Handoffs** | Sync `task` tool (passes string prompt) | No typed envelope; no return value structure |
| **Roles** | 12 agents with role descriptions | Rigid; no runtime registration |
| **Group chat** | None | Not needed — Bizar's strength is gates, not chat |
| **State machines** | None | No graph vocabulary for tier-3+ workflows |
| **Event bus** | None | Synchronous `task` is the only IPC |
| **Discovery** | Static `config/opencode.json` | No runtime registration |
| **Identity** | Agent name (string) | No UUID; no role-based identity |
| **Routing** | Hard-coded table in prose | No LLM-classifier or capability-match |
| **State sharing** | 5-layer memory (Model E) | No fact extractor (Mem0 missing) |
| **Synchronization** | Sync `task` + async `bizar_spawn_background` | No event-driven wake |
| **Failure handling** | Loop guard + plugin shutdown | No workflow checkpoints |
| **Observability** | Per-session log; no trajectory | R3 §B.6 plan not shipped |

### B.2 — Specific Gaps to Close

**Gap 1: No persistent context between dispatches.** Each `task` is a fresh conversation. The child does not see prior dispatch results, prior tool calls, or prior memory writes. Fix: a typed message envelope that carries `{ prior_dispatch_id, shared_state_refs, summary }`.

**Gap 2: No event bus.** Sync dispatch is the only mode; async dispatch goes through `bizar_spawn_background` which is single-shot. Fix: a publish-subscribe event bus at `.bizar/events/` (similar to OpenFang's `EventBus`).

**Gap 3: Background agents are isolated.** Two background agents cannot share state, communicate, or coordinate. Fix: add a shared `bizar_post_message` / `bizar_read_messages` tool pair, or have background agents join the event bus.

**Gap 4: No shared agent-writable knowledge graph.** R3 §B.4 plans `bizar_knowledge_add_entity` but it is not shipped. Fix: implement the three tools (`add_entity`, `add_relation`, `query`) at `plugins/bizar/knowledge-graph.mjs`, backed by `.bizar/domain-graph.sqlite`.

**Gap 5: No agent death recovery.** If Thor crashes mid-task, Odin sees `failed` but cannot resume. Fix: structured checkpoints at every tool call, persisted to `.bizar/trajectories/<run-id>/`.

**Gap 6: No typed message envelope.** The `task` tool passes strings. Fix: a `BizarMessage { sender, recipient, type, payload, refs }` envelope that the model and tool both consume.

**Gap 7: Hard-coded routing.** Odin's routing table is prose. Fix: a `bizar_agents` CLI subcommand that lists registered agents and their capabilities; Odin queries before dispatching.

**Gap 8: No fact extractor.** R7 §9 noted the gap. Fix: integrate Mem0 self-hosted at session end.

The redesign sections (C through F) below propose concrete architectures for each gap.

---

## Section C — The Redesign: Six Capability Layers

The redesign adds six capability layers to Bizar. Each is a small architectural change with clear backwards compatibility.

### C.1 — Shared Agent-Writeable Knowledge Graph

**Source.** OpenFang's `crates/openfang-memory/src/knowledge.rs:16-188` and R3 §B.4.

**What it enables.** Agents learn facts once and recall them across sessions. "The dashboard uses WebSockets not SSE" is recorded by Mimir once and retrieved by Tyr three sessions later.

**Architecture.** A new SQLite database at `.bizar/domain-graph.sqlite` with two tables (mirroring OpenFang):

```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  source_entity TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  target_entity TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);
```

Three new MCP tools (proposed by R3 §B.4):

- `bizar_knowledge_add_entity(name, entity_type, properties?)` → returns entity ID.
- `bizar_knowledge_add_relation(source, relation_type, target, confidence?)` → returns relation ID.
- `bizar_knowledge_query(source?, relation?, target?, max_depth?)` → returns matching entities.

Schema mirrors OpenFang's two-table design. The `properties` field is a JSON blob for extensibility (entity-specific metadata like `confidence`, `source_url`, `last_verified`).

**Population strategy.** Following OpenFang's pattern (R5 §5), each agent that explores domain facts is prompted to populate the graph. The Mimir prompt says: "When you learn a non-obvious fact about the codebase (architectural decision, naming convention, runtime quirk), call `bizar_knowledge_add_entity`." The Tyr prompt gets the same instruction. The graph grows from agent discoveries.

**Backwards compatibility.** None. New tools are additive. The existing `.bizar/graph/graph.json` (Graphify's code-analysis graph) is unaffected — it lives in a different file and serves a different purpose (code structure vs domain knowledge). The two graphs can be queried in parallel via `bizar graph query` (existing CLI) and `bizar knowledge query` (new CLI).

**Bizar-specific design considerations.**

- The `.bizar/domain-graph.sqlite` file is gitignored (per R3 §B.4). Domain knowledge is per-machine, not per-repo.
- `confidence` is a per-entity field (not per-relation as in OpenFang) because Bizar agents often need to mark their own confidence in domain facts.
- The graph is queryable by `bizar graph explain` extension (the existing Graphify CLI gets a `--domain` flag).
- A "dreaming" pass (à la OpenClaw's `docs/concepts/memory.md:218-244`) consolidates noisy graph entries into clean facts once per week. Phase 2 work.

### C.2 — Event Bus

**Source.** OpenFang `crates/openfang-kernel/src/event_bus.rs:14-99`. R5 §6.

**What it enables.** Agents publish events; other agents subscribe. Tyr publishes "tier-4 implementation dispatched" and Forseti auto-subscribes to audit completion. Mimir publishes "research note added" and any agent doing related research wakes up.

**Architecture.** A new directory at `.bizar/events/` with one file per event type (NDJSON append-only log):

```
.bizar/events/
  ├── dispatch.completed.ndjson
  ├── dispatch.failed.ndjson
  ├── knowledge.entity_added.ndjson
  ├── knowledge.relation_added.ndjson
  ├── agent.spawned.ndjson
  ├── agent.terminated.ndjson
  ├── file.modified.ndjson
  └── plan.commented.ndjson
```

Each line is a JSON object: `{ id, timestamp, source, type, payload, refs }`. The plugin writes to these files via a single-writer lock (per-event-type). Agents subscribe via a new tool `bizar_event_subscribe(pattern)`.

**Why NDJSON, not SQLite?** Following Hermes's precedent: `hermes_state.py:813-856` uses FTS5 + SQLite for sessions because they are queryable text. Events are append-only; NDJSON is faster to write and easier to inspect (`tail -f .bizar/events/dispatch.completed.ndjson`).

**Subscription mechanism.** `bizar_event_subscribe(pattern, callback?)` returns a subscription ID. The plugin polls (every 100ms) the relevant NDJSON files for matching events and dispatches to subscribers. The subscription lives in memory; it dies when the plugin restarts. For persistent subscriptions, the user can register a hook in `plugins/bizar/hooks/` that re-subscribes on init.

**Trigger engine (à la OpenFang).** A separate `triggers.json` file at `.bizar/events/triggers.json` registers event-driven workflows:

```json
{
  "triggers": [
    {
      "id": "forseti-audit-tier4",
      "agent": "forseti",
      "pattern": "dispatch.completed",
      "filter": { "agent": "tyr", "status": "done" },
      "prompt_template": "Audit the following Tyr dispatch: {{event.payload}}",
      "max_fires": 0
    }
  ]
}
```

When a matching event arrives, the trigger engine sends the prompt to the named agent via `bizar_spawn_background` (asynchronous to avoid blocking the publisher).

**Backwards compatibility.** None. The event bus is a new layer. Existing sync `task` and `bizar_spawn_background` continue to work; they just also emit events to the bus.

**Bizar-specific design considerations.**

- The event bus is per-machine (not gitignored or git-tracked). Events are ephemeral; their long-term value is in the trajectories.
- A `bizar event tail <type>` CLI subcommand lets the user watch events live (similar to `tail -f`).
- A `bizar event replay <run-id>` CLI subcommand re-emits the events from a prior run for debugging.
- The Forseti tier-3+ audit becomes event-driven automatically: when Tyr publishes `dispatch.completed`, Forseti picks it up.

### C.3 — Background Agents That Talk to Each Other

**Source.** OpenClaw's `subagent_spawn` + `subagent-announce-*.ts`. R6 §6, §8.

**What it enables.** Two background agents coordinate via shared state and message-passing. Mimir (research) and Tyr (implementation) run in parallel; Tyr reads Mimir's findings from a shared mailbox.

**Architecture.** Add a `bizar_post_message(recipient_instance_id, message)` and `bizar_read_messages(instance_id)` tool pair. Messages are stored at `.bizar/bg-mailbox/<instanceId>.ndjson` (one file per instance). The mailbox is per-instance, not shared — Tyr has its own mailbox, Mimir has its own.

**Coordination pattern: shared whiteboard.** For two agents to collaborate, both must read/write a shared location. The mailbox pattern is point-to-point; the whiteboard pattern is many-to-many. Bizar needs both. The whiteboard lives at `.bizar/bg-shared/<run-id>.json` — keyed on `run-id` so multiple crews can run in parallel.

**Backwards compatibility.** None. New tools are additive. Background agents that do not opt in to the message protocol work as before.

**Bizar-specific design considerations.**

- The mailbox is purged when the instance terminates (cleanup hook in `plugins/bizar/src/background.ts`).
- The whiteboard is gitignored.
- A `bizar_status(instanceId)` enhancement adds `unread_messages: int` to the response so callers can see if there's coordination work pending.

### C.4 — Persistent Agent State

**Source.** LangGraph's `Checkpointer` (R7 §8). OpenFang's `hand_instance_registry` (R5 §4). Hermes's `hermes_state.SessionDB`.

**What it enables.** An agent that crashed mid-task resumes from its last good state. The trajectory is the persistent state.

**Architecture.** Every Bizar dispatch captures a `BizarCheckpoint { run_id, agent, step_index, message_log, tool_results, timestamp }` to `.bizar/trajectories/<run-id>/<agent>.jsonl`. On agent crash, the plugin reads the last checkpoint, reconstructs the message log up to that point, and re-spawns the agent with that as context.

**Backwards compatibility.** None. Trajectory capture is new. Existing dispatch works unchanged; trajectories are captured in parallel.

**Bizar-specific design considerations.**

- The checkpoint is appended on every tool result (mirroring LangGraph's per-node persistence).
- A `bizar_replay <run-id> --with-mutation <path>` CLI subcommand replays a trajectory with a mutated state file — Phase 3 work.
- R3 §B.6 plans trajectory capture. The redesign extends it to checkpoint-based replay.

### C.5 — Capability-Based Routing

**Source.** agent-squad's classifier-routed orchestrator (R7 §6). Microsoft Agent Framework's skill catalog.

**What it enables.** Odin routes by capability match, not name. "Find every API endpoint" routes to whichever agent has the `code-search` capability, regardless of whether it's `Mimir` or `semble-search` or a custom user agent.

**Architecture.** Each agent publishes its capabilities in `config/opencode.json` (new optional field):

```json
"mimir": {
  "capabilities": ["codebase-research", "pattern-discovery", "documentation-analysis"],
  "tools": ["semble_search", "read", "grep", ...]
}
```

Odin receives a request, extracts the implicit capability needs, and queries the capability table. The match is scored (text similarity + tool overlap) and the top N agents are returned. Odin picks.

**Backwards compatibility.** Full. Agents without a `capabilities` field still work — Odin falls back to the hard-coded routing table for those.

**Bizar-specific design considerations.**

- The capability table lives at `config/agents/capabilities.json` (separate file for cleaner diffs).
- A `bizar_agents list --capabilities` CLI subcommand dumps the table for inspection.
- The match algorithm is a simple keyword overlap (à la the best-of MCP `pick_harness` server). Phase 3 work could replace it with embeddings.

### C.6 — Agent-to-Agent Messaging (Direct)

**Source.** AutoGen group chat (R7 §3). Hermes's `send_message` (R4 — blocked in subagents per `DELEGATE_BLOCKED_TOOLS`).

**What it enables.** Thor can directly message Tyr without going through Odin. Useful for tier-3+ workflows where two specialists need to coordinate.

**Architecture.** A new tool `bizar_message(target_agent, payload)` that sends a typed message to another agent's inbox. The recipient is notified via the event bus (`agent.message_received` event). The recipient's next model turn includes the message in its context.

**Backwards compatibility.** None. New tool, gated by Odin's permission model.

**Bizar-specific design considerations.**

- The tool is gated: only certain agent pairs may communicate directly (e.g., Thor ↔ Tyr for tier-3+ collaboration; never Thor → Heimdall because Heimdall cannot accept).
- A `bizar_message` audit log is emitted to the event bus for transparency.

---

## Section D — Routing 2.0

The current routing is a hard-coded prose table. The redesign proposes a four-tier hierarchy:

### D.1 — Tier 0: Hard-Coded Routing (Today)

The `AGENTS.md` table. Works. The user can read it. The downside is rigid.

### D.2 — Tier 1: Capability-Based Routing (Phase 1)

Add `capabilities` to each agent in `config/opencode.json`. Odin queries the capability table for "research", "implementation", "audit", "design". The match returns a sorted list. Odin picks the top.

This is additive — agents without a `capabilities` field are still routable via the Tier 0 table.

### D.3 — Tier 2: LLM-Classifier Routing (Phase 2)

Replace the manual pick with an LLM call. The classifier is a small model (M2.7 Flash is sufficient). Given a user request + the agent roster with capabilities, the classifier returns the best agent name.

This is agent-squad's pattern. The classifier is a separate LLM call so it does not pollute Odin's context. The classifier call costs ~200 tokens per dispatch.

### D.4 — Tier 3: Hybrid Routing (Phase 3)

The user explicitly invokes an agent via `@thor` or `/command` (current behavior). The Tier 0 table handles this — no LLM call.

If no explicit invocation, the capability match (Tier 1) filters the roster. Then the LLM classifier (Tier 2) picks from the filtered list.

The hybrid is the right shape because:

- Explicit invocations are unambiguous (no LLM cost).
- Implicit invocations benefit from capability filtering (reduces classifier load).
- Edge cases fall back to the hard-coded table.

### D.5 — Recommended Phasing

| Phase | Routing tier | What ships |
|---|---|---|
| **Phase 1** | Tier 0 + Tier 1 | Hard-coded table + capability match (parallel). |
| **Phase 2** | Tier 0 + Tier 1 + Tier 2 | Add LLM classifier. |
| **Phase 3** | Tier 0 + Tier 1 + Tier 2 + Tier 3 (hybrid) | Per-dispatch override via `task --agent=thor`. |

---

## Section E — The "Bizar Crew" Pattern

CrewAI has "crews" — teams of agents with roles and a process. Should Bizar adopt this?

### E.1 — The Case For

Bizar already has 13 agents. The combinations are not always obvious. A user doing "research the codebase, write a design doc, implement the feature, write tests, open a PR" needs to know to call `mimir` then `baldr` then `thor` then `heimdall` then `hermod`. That is five sequential dispatches. A `crew` would compress this.

### E.2 — The Case Against

CrewAI's "role" abstraction is a system prompt. It does not enforce behavior (R7: *"Roles are not behavior. Two agents with the same role will produce indistinguishable behavior."*). Bizar's agents are defined by *capability* (Mimir researches, Thor implements), not role. A crew that says "researcher" and "implementer" maps to Mimir and Thor today; tomorrow a user-installed agent might want to fill the "researcher" slot.

The better Bizar-native shape is **a crew as a *declaration of dependencies*, not a roster**. A crew file says:

> "To run a research-then-implement workflow: spawn Mimir, wait for completion, spawn Forseti for audit, on audit pass spawn Thor."

This is **a graph**, not a list. It is precisely the state-machine pattern from Section 1.4 of the patterns document. The CrewAI comparison doc itself says: *"If your 'multi-agent system' is honestly a workflow with LLM steps, this is the right honesty."* (`round-7-bestof-deep/multi-agent-memory.md:22`).

### E.3 — The Proposal: Crews as Workflow Graphs

A new file format `crews/<name>.crew.json` (or `.yaml`) at the project root. Schema:

```yaml
id: research-and-implement
description: Research a topic, design, implement, audit, ship
agents:
  - mimir       # research
  - baldr       # design
  - forseti     # audit
  - thor        # implement
  - hermod      # git ops
graph:
  - id: research
    agent: mimir
    next: design
  - id: design
    agent: baldr
    next: audit
  - id: audit
    agent: forseti
    branches:
      pass: implement
      fail: design    # loop back
  - id: implement
    agent: thor
    next: ship
  - id: ship
    agent: hermod
    terminal: true
```

The crew is invoked via `bizar crew run research-and-implement --topic "..."`. The plugin walks the graph, dispatching each step, persisting checkpoints, emitting events.

**Backwards compatibility.** Full. Crews are new files. Existing dispatch unchanged.

### E.4 — Example Crews

**Research Crew.**

```yaml
id: research
agents: [frigg, mimir, semblem-search]
graph:
  - id: shallow-qa
    agent: frigg
    next: deep-research
    when: "answer_short or no_sources"
  - id: deep-research
    agent: mimir
    next: code-search
    when: "needs_code_examples"
  - id: code-search
    agent: semblem-search
    terminal: true
```

Invoked via `bizar crew run research --topic "How does the event bus work?"`. The shallow answer comes from Frigg (M2.7 free, ~10s); if the answer is too short, Mimir (M2.7 paid, ~30s); if code examples are needed, semblem-search.

**Implementation Crew.**

```yaml
id: implement
agents: [forseti, tyr, vidarr, thor]
graph:
  - id: plan
    agent: forseti
    next: implement
  - id: implement
    agent: tyr
    next: test
    fallback:
      agent: vidarr
      when: "stalled or failed"
  - id: test
    agent: thor
    next: ship
  - id: ship
    terminal: true
```

Invoked via `bizar crew run implement --feature "..."`. Forseti plans, Tyr implements, falls back to Vidarr on stall, Thor tests.

**PR Review Crew.**

```yaml
id: pr-review
agents: [mimir, forseti, hermod]
graph:
  - id: research
    agent: mimir
    next: audit
  - id: audit
    agent: forseti
    next: post
  - id: post
    agent: hermod
    terminal: true
```

This is exactly the existing `pr-review` command (`config/opencode.json:298-302`), re-expressed as a crew. The existing command becomes a thin wrapper around `bizar crew run pr-review`.

### E.5 — When to Use Crews

Crews are for **multi-step workflows with explicit dependencies**. If a user request fits a single dispatch, use `task`. If it fits a chain of 3+ dispatches with conditional branches, use a crew.

The R7 comparison doc captures it: *"A majority of multi-agent use cases in the wild are one orchestrator delegating to stateless sub-tasks. All four frameworks can express that — and so can a `for` loop."* (`comparisons/multi-agent-orchestration.md:25`). Crews are for the cases the `for` loop cannot express.

---

## Section F — Implementation Roadmap

Three phases, sequenced by what is buildable now vs. what needs plugin/API changes.

### F.1 — Phase 1: Foundations (Next Minor Version, ~6 weeks)

Build the layers that are additive and have no breaking changes.

**1. Shared agent-writeable knowledge graph.** New file `plugins/bizar/src/knowledge-graph.ts` (or `.mjs`). SQLite-backed at `.bizar/domain-graph.sqlite`. Three new tools: `bizar_knowledge_add_entity`, `bizar_knowledge_add_relation`, `bizar_knowledge_query`. Per-agent prompt injection: "When you learn a non-obvious fact, call `bizar_knowledge_add_entity`."

Files touched:
- `plugins/bizar/src/knowledge-graph.ts` (new, ~200 LOC).
- `config/opencode.json` (add three tools to the `tools` block at `opencode.json:50-59`).
- `config/agents/*.md` (per-agent prompt update, ~30 lines added to Mimir and Tyr).
- `.gitignore` (add `.bizar/domain-graph.sqlite*`).

Verification: Semble-search for `knowledge_add_entity`; Semble-find-related on `knowledge-graph.ts`; manual test adding 3 entities + 2 relations + querying.

**2. Event bus.** New file `plugins/bizar/src/event-bus.ts`. NDJSON files at `.bizar/events/<type>.ndjson`. Two new tools: `bizar_event_publish(type, payload)`, `bizar_event_subscribe(pattern)`. Trigger engine at `.bizar/events/triggers.json`. Forseti tier-3+ audit becomes event-driven automatically.

Files touched:
- `plugins/bizar/src/event-bus.ts` (new, ~300 LOC).
- `plugins/bizar/src/tools/event-publish.ts`, `event-subscribe.ts` (new, ~80 LOC each).
- `config/opencode.json` (add two tools).
- `.gitignore` (add `.bizar/events/`).

Verification: publish an event in a test, subscribe in another agent, observe the dispatch; verify the Forseti trigger fires on `dispatch.completed`.

**3. Capability-based routing.** Add `capabilities` field to each agent in `config/opencode.json`. Odin queries the table first, falls back to hard-coded. New file `config/agents/capabilities.json` for cleaner diffs.

Files touched:
- `config/agents/capabilities.json` (new, ~50 LOC).
- `config/opencode.json` (add `capabilities` field to each of the 12 agents).
- `AGENTS.md` (update Routing Heuristic with capability note).

Verification: a `bizar_agents list --capabilities` CLI subcommand; a test dispatch where the request matches multiple capabilities, ensure Odin picks the top.

### F.2 — Phase 2: Coordinated Backgrounds (Next Major, ~12 weeks)

Build the layers that require background agent coordination.

**1. Background agent messaging.** New file `plugins/bizar/src/bg-mailbox.ts`. Two new tools: `bizar_post_message(recipient, message)`, `bizar_read_messages(instanceId)`. Mailbox at `.bizar/bg-mailbox/<instanceId>.ndjson`.

Files touched:
- `plugins/bizar/src/bg-mailbox.ts` (new, ~150 LOC).
- `plugins/bizar/src/tools/bg-post-message.ts`, `bg-read-messages.ts` (new, ~60 LOC each).
- `plugins/bizar/src/background.ts` (add mailbox cleanup on instance terminate, ~20 LOC).
- `config/opencode.json` (add two tools).

**2. Persistent agent state (checkpoints).** New file `plugins/bizar/src/trajectory.ts`. Capture trajectories to `.bizar/trajectories/<run-id>/<agent>.jsonl`. Replay via `bizar_replay <run-id>`.

Files touched:
- `plugins/bizar/src/trajectory.ts` (new, ~250 LOC).
- `plugins/bizar/src/hooks/post-tool-call.ts` (capture per-step).
- `plugins/bizar/src/tools/bg-replay.ts` (new, ~80 LOC).
- `config/opencode.json` (add `bizar_replay` tool).

**3. Crew pattern (workflow graphs).** New file format `crews/*.crew.json`. New CLI `bizar crew <run|list|validate>`. Crew runner at `plugins/bizar/src/crew-runner.ts`.

Files touched:
- `plugins/bizar/src/crew-runner.ts` (new, ~400 LOC).
- `plugins/bizar/src/tools/crew-run.ts` (new, ~100 LOC).
- `cli/commands/crew.mjs` (new, ~200 LOC).
- `cli/bin.mjs` (wire `crew` subcommand).

**4. Mem0 self-hosted integration.** Per R7 §9, ~1 week. Add Mem0 as a fact extractor that runs at session end. The Mem0 instance is local Docker; Bizar's `.bizar/memory.json` is unchanged; a parallel `.bizar/mem0/` directory stores extracted facts.

Files touched:
- `plugins/bizar/src/mem0.ts` (new, ~150 LOC).
- `plugins/bizar/src/hooks/session-end.ts` (call Mem0 extraction).
- `.bizar/PROJECT.md` (document the new layer).

### F.3 — Phase 3: Full Coordination (Future Major, ~24 weeks)

The deep changes — LLM classifier routing, agent-to-agent direct messaging, full trajectory replay.

**1. LLM classifier routing.** Replace Odin's manual pick with an LLM call. The classifier is M2.7 Flash; the call is ~200 tokens per dispatch.

Files touched:
- `plugins/bizar/src/router-classifier.ts` (new, ~200 LOC).
- `config/opencode.json` (new `router_classifier` config block).
- `AGENTS.md` (document hybrid routing).

**2. Direct agent-to-agent messaging.** `bizar_message(target_agent, payload)`. Gated by agent-pair allowlist.

Files touched:
- `plugins/bizar/src/agent-message.ts` (new, ~150 LOC).
- `plugins/bizar/src/tools/agent-message.ts` (new, ~80 LOC).
- `config/opencode.json` (allowlist config).

**3. Time-travel trajectory replay.** `bizar replay <run-id> --with-mutation <path>` replays a trajectory with a mutated state. The mutation language is a JSON Patch (RFC 6902) over the trajectory state.

Files touched:
- `plugins/bizar/src/replay.ts` (new, ~300 LOC).
- `plugins/bizar/src/tools/replay.ts` (new, ~100 LOC).

**4. Weekly dreaming pass.** Consolidate noisy graph entries into clean facts. Per OpenClaw's `docs/concepts/memory.md:218-244`.

Files touched:
- `plugins/bizar/src/dreaming.ts` (new, ~200 LOC).
- New cron job at `.bizar/events/triggers.json` (scheduled weekly).

### F.4 — The Sequence

```
Phase 1 (6 weeks)
├── Knowledge graph (1 week)
├── Event bus (2 weeks)
└── Capability routing (1 week)

Phase 2 (12 weeks)
├── Background messaging (2 weeks)
├── Trajectory capture + replay (3 weeks)
├── Crew pattern (4 weeks)
└── Mem0 integration (1 week)

Phase 3 (24 weeks)
├── LLM classifier routing (3 weeks)
├── Direct agent messaging (3 weeks)
├── Time-travel replay (8 weeks)
└── Dreaming pass (4 weeks)
```

Total: ~42 weeks. The phases overlap — Phase 2 starts before Phase 1 finishes. Realistic ship dates: Phase 1 in ~6 weeks, Phase 2 in ~12 weeks, Phase 3 stretching into 2027.

### F.5 — Risk Register

**Risk 1: Capability match too greedy.** A request like "audit the codebase" might match `forseti` (audit), `mimir` (research), and `frigg` (Q&A) all at once. Mitigation: the classifier (Phase 3) picks; until then Odin picks the first match.

**Risk 2: Event bus flood.** A noisy agent publishes 100 events per second. Mitigation: per-agent publish rate limit (default 10/sec), with a one-time warning on overflow.

**Risk 3: Trajectory file size.** A long session can produce 100MB of trajectories. Mitigation: per-run size cap (default 50MB), older trajectories compress to gzipped JSONL.

**Risk 4: Mem0 self-hosted is operationally heavy.** A team running 100 Bizar instances needs 100 Mem0 instances. Mitigation: Phase 2 ships without Mem0; teams that want it add it manually. Phase 3 considers a hosted Mem0 option.

**Risk 5: Crew graphs can deadlock.** A misconfigured `next` field creates a cycle. Mitigation: the crew runner validates the graph (no cycles, all `next` references resolve) before starting.

**Risk 6: Direct agent messaging undermines Forseti.** Two agents coordinating without audit is exactly what Forseti prevents. Mitigation: agent-to-agent messaging is gated by Forseti's tier (T3+ only).

---

## Section G — Backwards Compatibility Summary

| Change | Backwards compat? | Notes |
|---|---|---|
| Knowledge graph | Full | New tools, no existing tool changes |
| Event bus | Full | New layer; existing tools emit events but don't change behavior |
| Capability routing | Full | Hard-coded table is fallback |
| Background messaging | Full | New tools; existing background agents work as before |
| Trajectory capture | Full | Capture happens in parallel; existing dispatch unchanged |
| Mem0 integration | Full | New layer; existing memory layers unchanged |
| Crew pattern | Full | New file format, new CLI subcommand |
| LLM classifier routing | Partial | Odin's routing decision may differ; the result is still correct (different agent choice for ambiguous requests) |
| Direct agent messaging | Partial | New tool; existing dispatch unchanged |
| Time-travel replay | Full | New CLI; existing trajectory capture unchanged |
| Dreaming pass | Full | Scheduled job; runs in background |

The only two changes with partial backwards compatibility are LLM classifier routing (different agent might be chosen) and direct agent messaging (new tool that requires user opt-in). Both are non-breaking.

---

## Section H — Open Questions for the User

These are the choices the user (or the next @tyr dispatch) needs to make before Phase 1 starts.

**1. Capabilities taxonomy.** Should Bizar use a flat list of strings (e.g., `"codebase-research"`, `"pattern-discovery"`) or a hierarchical taxonomy (e.g., `research/codebase`, `research/pattern`)? OpenFang uses flat strings; LangGraph uses hierarchical node IDs. Bizar should pick flat strings for v1 — easier to match, harder to miscategorize.

**2. Event retention.** How long to keep NDJSON event files? OpenFang retains 1000 events in the history ring buffer (in-memory only). Bizar's design is on-disk; the cap could be 10000 per file (rotated to `.ndjson.1`, `.ndjson.2`, etc.).

**3. Crew file format.** JSON, YAML, or TS? TS is most Bizar-native (matches the plugin code style) but hardest to author by hand. YAML is most readable. JSON is most universally supported. Recommend YAML.

**4. Trajectory privacy.** Trajectories contain user prompts and agent outputs. Are they gitignored or git-tracked? Mem0 considers trajectories sensitive; Claude Code trajectories are per-machine. Recommend gitignore.

**5. Mem0 self-hosted vs. cloud.** Self-hosted costs operational complexity; cloud costs money and trust. The user's preference determines whether Phase 2.4 ships.

**6. Capability vs. role.** Should `capabilities` be agent descriptions of what they can do, or user-defined tags that may not match the agent's actual capabilities? The cleanest answer: capabilities are agent-self-declared in their config; user cannot override.

---

## Section I — Files Cited (Bizar-specific)

| File | Lines | Used for |
|---|---|---|
| `config/opencode.json` | 5 | `default_agent: "odin"` |
| `config/opencode.json` | 38-48 | Loop guard + compaction config |
| `config/opencode.json` | 50-59 | `tools` block (existing tools) |
| `config/opencode.json` | 60-271 | Agent roster with descriptions, models, permissions |
| `config/opencode.json` | 272-319 | Slash commands (`audit`, `explain`, `init`, `pr-review`, etc.) |
| `config/opencode.json` | 320-333 | Provider + models |
| `.bizar/PROJECT.md` | (whole) | Project state |
| `.bizar/AGENTS_SELF_IMPROVEMENT.md` | (whole) | Self-improvement log |
| `.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md` | 1-794 | Background agent spec |
| `.bizar/memory.json` | (whole) | Working memory |
| `.bizar/graph/graph.json` | (head) | Graphify code graph (existing) |
| `plugins/bizar/src/index.ts` | (whole) | Plugin entry |
| `plugins/bizar/src/background.ts` | 25-700 | Background instance manager |
| `plugins/bizar/src/background-state.ts` | (whole) | BackgroundState schema |
| `plugins/bizar/src/tools/bg-spawn.ts` | 50-120 | `bizar_spawn_background` tool |
| `plugins/bizar/src/tools/bg-send-message.ts` | (whole) | Background message tool |
| `plugins/bizar/src/tools/bg-kill.ts` | (whole) | `bizar_kill` tool |
| `plugins/bizar/src/event-stream.ts` | 122-488 | SSE event subscription |
| `plugins/bizar/src/handoff.ts` | (whole) | Loop guard handoff |
| `plugins/bizar/src/research-prompt.ts` | (whole) | Mimir prompt |
| `cli/bin.mjs` | (whole) | CLI dispatcher |
| `cli/commands/lightrag.mjs` | (whole) | LightRAG CLI |
| `cli/commands/memory.mjs` | 1284 | Memory CLI (graph mention) |

---

## Section J — Closing Note

Bizar's v5.5.1 multi-agent architecture is **solid but conservative**. The tier dispatch works. The Forseti gate works. The background agents work. The 5-layer memory hybrid works. The plugin architecture is well-designed and well-audited.

What Bizar does *not* do — and what every other production-grade multi-agent system in 2026 does — is **treat the agent fleet as a coordinated system rather than a static roster**. The redesign closes that gap in three phases:

- **Phase 1** adds the foundations: knowledge graph, event bus, capability routing. ~6 weeks.
- **Phase 2** adds coordination: background messaging, trajectories, crews, Mem0. ~12 weeks.
- **Phase 3** adds full graph-shaped dispatch with time-travel replay. ~24 weeks.

Each phase is additive. The user's existing Bizar workflow continues to work; the new capabilities unlock new use cases (research-then-implement crews, event-driven Forseti audits, trajectory replay for debugging).

The single most important takeaway from R1-R8 is **convergence on graphs**. Bizar's internal dispatch should be graph-shaped even if the user-facing API is role-shaped. The `task` tool becomes a typed message envelope; the dispatch becomes a workflow graph with checkpoints; the failures become retryable; the trajectories become training data.

The other key takeaway is **the missing layer 3 (fact extraction)**. Bizar has working memory and durable archive; it lacks the fact extractor that closes the loop. Mem0 self-hosted is the canonical answer.

Both of these moves are incremental, well-cited, and reversible. The redesign is not a rewrite — it is an evolution.

---

*End of `bizar-multi-agent-redesign.md`. Companion to `orchestration-patterns.md`. Word count target: 4000-6000. All recommendations cite specific Bizar files. Implementation roadmap is sequenced by Phase 1 (now), Phase 2 (next major), Phase 3 (future major).*