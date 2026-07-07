# Bizar Memory Redesign — Actionable Proposal

**Round:** 9 — Memory architecture
**Date:** 2026-07-06
**Scope:** Redesign BizarHarness's memory architecture to match the 2026 five-tier hierarchy observed in Hermes, OpenFang, OpenClaw, and the memory-layer catalog.
**Author:** @tyr
**Companion:** `round-9-memory/memory-patterns.md` (architectural deep dive)
**Methodology:** Every proposal cites the existing Bizar file it would modify or replace. Every borrowed pattern cites the source it comes from. Implementation phases are sized to ship in one Bizar release cycle.

---

## Section A — Bizar's Current Memory State

### A.1 What Exists Today

Per `.bizar/PROJECT.md:133-140`, Bizar's memory stack is:

> *"Backend: Bizar Memory Service (local Obsidian-compatible Markdown + Git-shared sync). Default mode: `local-only` (vault at `.obsidian/`); opt into `managed` for cross-project sharing. Shared memory repo: `~/.local/share/bizar/memory/bizar-memory/` with namespaces `projects/<id>/`, `global/bizar/`, `users/<id>/`. Canonical truth: Markdown. LightRAG is a derived index (rebuildable from Markdown). Git is the collaboration layer. Phase 2 (v4.1.0) adds a LightRAG scaffold for semantic search — disabled by default, opt-in via `.bizar/memory.json`. Hindsight MCP is disabled by default. The Bizar Memory Service replaces it."*

The current `.bizar/memory.json:1-37` configures:
- `mode: "managed"` (per `memory.json:6`)
- Vault path: `/home/drb0rk/.local/share/bizar/memory/bizar-memory` (`memory.json:7`) — note this is the legacy path; new default is `~/.bizar_memory` per `memory-store.mjs:77`.
- Git remote: `git@github.com:PolderLabsVOF/polderlabs-memory.git` (`memory.json:8`)
- Namespaces: `projects/BizarHarness`, `global/bizar`, `users/drb0rk` (`memory.json:13-15`)
- LightRAG: **disabled** (`memory.json:18`: `"enabled": false`)

### A.2 Components Currently Implemented

| Component | File | Lines | Purpose |
|---|---|---:|---|
| `bizar memory` CLI | `cli/memory.mjs` | 1747 | init, status, link, write, pull, commit, push, sync, reindex |
| Memory REST API | `bizar-dash/src/server/routes/memory.mjs` | 1482 | `/api/memory/*` endpoints |
| Memory store | `bizar-dash/src/server/memory-store.mjs` | 1093 | Vault + note operations |
| LightRAG integration | `bizar-dash/src/server/memory-lightrag.mjs` | 1477 | Semantic search |
| Obsidian facade | `bizar-dash/src/server/memory-obsidian.mjs` | 229 | Obsidian-style read API |
| Memory git ops | `bizar-dash/src/server/memory-git.mjs` | (size n/a) | git init, commit, push |
| Schema validation | `bizar-dash/src/server/memory-schema.mjs` | (size n/a) | YAML frontmatter schema |
| Secret scanning | `bizar-dash/src/server/memory-secrets.mjs` | (size n/a) | Pre-write secret detection |
| `bizar_memory_search` tool | `plugins/bizar/src/tools/memory-search.ts` | 228 | Agent-facing semantic/fts search |
| `bizar_memory_write` tool | `plugins/bizar/src/tools/memory-write.ts` | (size n/a) | Agent-facing note write |
| `bizar_memory_read` tool | `plugins/bizar/src/tools/memory-read.ts` | (size n/a) | Agent-facing note read |
| `bizar_memory_list` tool | `plugins/bizar/src/tools/memory-list.ts` | (size n/a) | Agent-facing note list |
| Session-end hook | `plugins/bizar/src/hooks/memory-write-on-end.ts` | 188 | Auto-write session summary on `session.idle`/`session.error` |
| Compaction gate | `plugins/bizar/src/compaction.mjs` | 167 | `shouldCompact()` at 50% usage |
| Graphify graph | `.bizar/graph/graph.json` | 23,112 | Project knowledge graph (cross-agent substrate) |

### A.3 What's Missing — The Gap Inventory

The deep study (`round-9-memory/memory-patterns.md`) surfaces the gaps:

1. **No working-memory compaction tied to memory writes.** `compaction.mjs:49-53` triggers at 50% usage, but the compaction itself is undefined — `maybeCompactSession()` doesn't write durable memory before discarding. (OpenClaw's `flush-plan.ts:27-34` does exactly this.)

2. **No skill memory (no auto-creation).** Hermes auto-creates skills from Curator patterns (`round-9-memory/memory-patterns.md:6.4`). Bizar has 5 bundled skills (per `.bizar/PROJECT.md:28-34`) but doesn't auto-generate.

3. **No user modeling layer.** The `users/drb0rk` namespace exists in `.bizar/memory.json:15` but is empty. Honcho + Mem0 + Letta all have first-class user profiles.

4. **No cross-agent shared knowledge at the agent level.** The graphify graph (`.bizar/graph/graph.json`) is a structural map of the project, but no agent populates entities into a memory-resident graph during runs.

5. **No memory triggers beyond session-end.** `memory-write-on-end.ts:163-187` fires on `session.idle`/`session.error` only. Mem0's `add()` runs after every turn; Hermes' `sync_all` runs after every turn; OpenClaw's flush runs pre-compaction.

6. **No session continuity within a Bizar run.** Each Bizar dispatch (`task` tool) starts fresh — no per-task scratchpad that survives within the run.

7. **No decay / consolidation.** The vault grows forever; nothing prunes or decays old notes.

8. **No dialectic peer cards.** `AGENTS_SELF_IMPROVEMENT.md` is a flat lessons log; Honcho's dialectic pattern (affirmative + critical cards) is more signal-dense.

9. **No knowledge graph surface for agents.** `.bizar/graph/` exists but no `bizar graph query` tool is exposed to agents.

10. **LightRAG is opt-in but never bootstrapped.** `.bizar/memory.json:18` says `enabled: false`. The default-on-the-shelf is "no semantic search."

11. **Default vault path drift.** `memory-store.mjs:77` defaults to `~/.bizar_memory`; live user data lives at `~/.local/share/bizar/memory/bizar-memory` (legacy path). Migration is one-time-notice only.

---

## Section B — Gaps Identified (mapped to 2026 standards)

The 11 gaps above, mapped to the 2026 standards from `round-9-memory/memory-patterns.md`:

| Bizar Gap | 2026 Standard | Source |
|---|---|---|
| No working-memory compaction tied to memory | Pre-compaction flush | OpenClaw `flush-plan.ts:27-34` |
| No skill auto-creation | Curator + skill auto-create | Hermes `agent/curator.py` |
| No user modeling | Dialectic peer cards / append-only facts | Honcho + Mem0 |
| No cross-agent shared knowledge at runtime | Knowledge graph | OpenFang `knowledge.rs` |
| No memory triggers beyond session-end | End-of-turn sync + on-event + on-tool-call | Hermes `memory_manager.py:558-614` |
| No session continuity within a run | Per-task scratchpad | (new pattern, see Section C.2) |
| No decay / consolidation | 7-day decay + floor | OpenFang `consolidation.rs:34-44` |
| No dialectic peer cards | Affirmative + critical cards | Honcho |
| No graph query surface for agents | `query_graph` tool | OpenFang `tool_runner.rs:2105-2140` |
| LightRAG opt-in but unused | Hybrid retrieval pipeline (BM25+vector+MMR+decay) | OpenClaw `hybrid.ts:52-156` |
| Default vault path drift | Idempotent migration on first run | (new pattern) |

---

## Section C — The Redesign

The redesign models all five memory tiers explicitly. Each tier gets:
- **What goes in it** — content boundaries
- **Storage backend** — SQLite / Markdown / Vector / Graph
- **Triggers** — when updated
- **Retrieval** — how queried
- **Cross-agent access** — who can read

### C.1 Tier 1 — Working Memory (current turn)

**What goes in it:** The current turn's prompt assembly. Includes the conversation transcript (compacted at 50%), the system prompt, the tool schemas, and any injected recall.

**Storage backend:** In-process memory inside the opencode runtime. No persistent store.

**Triggers:** Updated every turn by opencode's runtime.

**Retrieval:** Direct (positional) — the model reads it from the `messages` array.

**Cross-agent access:** None. Each agent has its own working memory; subagents may receive a slice via the `task` tool's context parameter.

**Bizar's current implementation:** Implicit in opencode's runtime. The plugin's `compaction.mjs:36` declares `compactionThreshold = 0.5`.

**Gap to close:** Working memory compaction needs to write to Tier 3 (project memory) before discarding. This is the OpenClaw `flush-plan.ts:27-34` pattern.

**Implementation hint:** Wire the existing `memory-write-on-end.ts` to also fire pre-compaction. When `shouldCompact()` returns true (`compaction.mjs:49-53`), the plugin should run a memory flush turn (similar to `flush-plan.ts:97-142`) that writes durable notes via `bizar_memory_write` before the conversation is summarized.

**Files to modify:**
- `plugins/bizar/src/compaction.mjs` — add `runPreCompactionFlush()` after `shouldCompact()` returns true.
- `plugins/bizar/src/hooks/memory-write-on-end.ts` — split the existing `createMemoryWriteOnEnd` into two: `createMemoryWriteOnFlush` (pre-compaction) and `createMemoryWriteOnEnd` (post-session).

### C.2 Tier 2 — Session Memory (per-task scratchpad within a Bizar run)

**What goes in it:** Per-task notes — what was tried, what failed, what to do next, partial results. Lives across multiple turns of the same task.

**Storage backend:** SQLite at `.bizar/sessions/<task-id>.db` per task. Schema: one `scratchpad` table with `(id, task_id, turn_index, role, content, created_at)`.

**Triggers:**
- **End of turn:** insert the current turn's user message + assistant response (compact form).
- **Mid-turn:** explicit `bizar_task_note --content "..."` tool call.
- **Task end:** session memory is read by Tier 3 (project memory) extraction.

**Retrieval:** `bizar_task_note --search "query"` returns recent notes matching the query.

**Cross-agent access:** Tasks within the same Bizar run can read each other's scratchpads via the `task` tool's `context` parameter.

**Bizar's current implementation:** None. Each `task` dispatch is fresh.

**Gap to close:** This is a net-new tier for Bizar.

**Implementation hint:** Add a `bizar_task_note` tool that writes to `.bizar/sessions/<task-id>.db`. The schema mirrors Hermes' `messages` table (`hermes_state.py:748-768`) but scoped to a single task.

**Files to create:**
- `plugins/bizar/src/tools/task-note.ts` — tool definition.
- `plugins/bizar/src/task-store.mjs` — SQLite operations (open, insert, search).
- `.bizar/sessions/` directory (auto-created on first task).

### C.3 Tier 3 — Project Memory (Bizar Memory Service)

**What goes in it:** The full vault — notes under `projects/BizarHarness/`, `global/bizar/`, `users/<id>/`. Existing implementation.

**Storage backend:** Markdown + git (current). LightRAG index on top (when enabled).

**Triggers (NEW):**
- **End of turn** — for high-signal tool outputs (skill writes, gate decisions, agent council votes). Implementation: extend `plugins/bizar/src/hooks/` with a `memory-write-on-signal.ts` hook that listens to specific WebSocket events.
- **End of session** — current `memory-write-on-end.ts:104-152`.
- **Periodic** — Curator-style pattern detection. Implementation: add `bizar memory curate` CLI subcommand that scans `AGENTS_SELF_IMPROVEMENT.md` + recent notes + tool-call frequency, surfaces patterns.
- **Auto-extracted** — at session end, run an LLM extraction pass over the conversation to populate the vault. Implementation: add `bizar memory extract --session <id>` that calls a sidecar LLM (configurable via `auxiliary.curator`).

**Retrieval (NEW):** Add progressive-disclosure like claude-mem (`round-7-bestof-deep/multi-agent-memory.md:445-450`):
- `bizar memory search "query"` returns top-K with snippets (current behavior).
- `bizar memory get <relpath>` returns the full note (current).
- **NEW:** `bizar memory fetch --ids <id1,id2,...>` — agents see search results, decide which IDs to fetch.

**Cross-agent access:** All agents in the project. The dashboard REST API at `/api/memory/*` is the canonical surface.

**Bizar's current implementation:** Already in place (`memory-store.mjs`, `routes/memory.mjs`, `cli/memory.mjs`). LightRAG is opt-in.

**Gap to close:**
1. **LightRAG default-on** with FTS5 fallback when no embedding provider is configured. (Per `round-9-memory/memory-patterns.md:10.1`, hybrid retrieval is the 2026 standard.)
2. **Migration of legacy vault path** — `ensureVaultExists()` at `memory-store.mjs:116-148` only logs a notice; should auto-migrate when the new path is empty.
3. **Dialectic extraction** — separate "what worked" vs "what failed" into two sections per session-summary note.

**Files to modify:**
- `.bizar/memory.json` — flip `lightrag.enabled` to `true` by default.
- `bizar-dash/src/server/memory-store.mjs` — add auto-migration logic.
- `plugins/bizar/src/hooks/memory-write-on-end.ts:104-152` — split session summary into dialectic cards.
- `cli/memory.mjs` — add `bizar memory fetch --ids <ids>` subcommand.
- `cli/memory.mjs` — add `bizar memory curate` subcommand.
- `cli/memory.mjs` — add `bizar memory extract --session <id>` subcommand.

### C.4 Tier 4 — User Memory (per-user profile)

**What goes in it:** Facts about the user across projects — preferences, identity, working style, communication patterns.

**Storage backend:** Markdown files at `users/<id>/profile.md` in the shared vault, plus an index file at `users/<id>/index.json` (structured facts). The `users/drb0rk` namespace in `.bizar/memory.json:15` is the destination.

**Triggers:**
- **End of session** — LLM extracts user-affecting facts (preferences, decisions, corrections) into `users/<id>/profile.md`.
- **Explicit** — `bizar memory user remember "fact"` writes directly.
- **Periodic** — `bizar memory user reconcile` runs the LLM extraction pass on the user's recent notes.

**Retrieval:**
- `bizar memory user show` returns the full profile.
- `bizar memory user search "query"` searches user-specific facts.
- For agents: `bizar_user_profile --query "preference name"` returns ranked facts.

**Cross-agent access:** Read-only for all agents. Writes are restricted to `bizar memory user remember` and the end-of-session extraction hook.

**Bizar's current implementation:** None. The namespace exists but is unused.

**Gap to close:** Net-new tier.

**Implementation hint:** Adopt the Honcho peer-card pattern at `round-9-memory/memory-patterns.md:7.1`. The `conclude` tool's schema (`plugins/memory/honcho/__init__.py:155-181`) maps directly to a `bizar memory user remember "fact"` CLI subcommand.

**Files to create:**
- `cli/memory-user.mjs` — `bizar memory user <verb>` subcommands.
- `plugins/bizar/src/tools/user-profile.ts` — `bizar_user_profile` tool.
- `plugins/bizar/src/hooks/memory-write-user-on-end.ts` — end-of-session user extraction.
- `.bizar/memory.json` — update `namespaces.user` config to enable.

### C.5 Tier 5 — World Memory (the Bizar Knowledge Graph)

**What goes in it:** Cross-agent project knowledge — entities (modules, APIs, conventions, decisions) and their relations (depends-on, owned-by, etc.). The existing `.bizar/graph/graph.json` is the foundation.

**Storage backend:** SQLite at `.bizar/graph/entities.db` with two tables: `entities` (id, type, name, properties JSON, created_at, updated_at) and `relations` (id, source_entity, relation_type, target_entity, properties JSON, confidence, created_at). Mirrors OpenFang's schema at `crates/openfang-memory/src/migration.rs:150-172`.

**Triggers (NEW):**
- **On tool call** — when an agent edits a file that introduces a new concept (module, function, class), emit a graph-entity-add event.
- **End of session** — when `memory-write-on-end.ts` writes a session summary, parse the summary for entities and add them.
- **Periodic** — `bizar graph rebuild` re-extracts entities from source code (graphify's incremental mode).

**Retrieval:**
- **CLI:** `bizar graph query "<concept>"` (already in AGENTS.md).
- **CLI:** `bizar graph path "<A>" "<B>"` (already in AGENTS.md).
- **CLI:** `bizar graph explain "<X>"` (already in AGENTS.md).
- **Tool:** `bizar_graph_query --source "Acme Corp" --relation "WorksAt"` (NEW).
- **Tool:** `bizar_graph_path --from "Acme Corp" --to "Series B"` (NEW).

**Cross-agent access:** Read for all agents. Writes via `bizar_graph_query` tool (LLM-driven), `bizar graph add` CLI, or the graphify incremental rebuilder.

**Bizar's current implementation:** `AGENTS.md` mentions graphify (`config/agents/_shared/AGENT_BASELINE.md`). The `.bizar/graph/` directory exists. But the graph is read-only as far as agents are concerned.

**Gap to close:** Expose the graph to agents as a queryable tool surface. Mirror OpenFang's `tool_knowledge_query` at `crates/openfang-runtime/src/tool_runner.rs:2105-2140`.

**Files to create:**
- `cli/graph.mjs` — `bizar graph <verb>` CLI (currently scattered; consolidate).
- `plugins/bizar/src/tools/graph-query.ts` — `bizar_graph_query` tool.
- `plugins/bizar/src/tools/graph-path.ts` — `bizar_graph_path` tool.
- `bizar-dash/src/server/graph-store.mjs` — SQLite operations for entities/relations.
- `bizar-dash/src/server/routes/graph.mjs` — REST surface.

### C.6 Cross-Tier Integration

The tiers talk to each other:

- **Tier 1 → Tier 3:** Pre-compaction flush writes durable notes before working memory is compacted.
- **Tier 2 → Tier 3:** End-of-task extraction promotes per-task notes into project memory.
- **Tier 3 → Tier 4:** End-of-session extraction pulls user-affecting facts into the user profile.
- **Tier 3 → Tier 5:** End-of-session extraction adds entities/relations to the graph.
- **Tier 4 → Tier 5:** User profile becomes a Person entity with relation to projects.

This is the **closed learning loop** in Bizar's terms. Per `AGENTS_SELF_IMPROVEMENT.md:48` (v5.5.0 lesson): *"Auto-reindex on every note write keeps the LightRAG index current."* The principle extends: every tier update should trigger downstream index updates.

---

## Section D — The Skill Memory Pattern

### D.1 Should Bizar Adopt Hermes' Skill Auto-Creation?

**Yes, but smaller.** Hermes' full Curator is a 1976-line subsystem (`agent/curator.py`); Bizar doesn't need that surface. The minimum viable pattern is:

1. **Detect pattern frequency.** When an agent successfully resolves a recurring issue (e.g., "tests fail with `pnpm install` first"), count occurrences in `AGENTS_SELF_IMPROVEMENT.md`.
2. **Propose skill.** If a pattern appears in 3+ entries, propose a skill via `bizar memory skill propose --name <slug>`.
3. **Human review.** The proposed skill goes into `.bizar/skills/proposed/<slug>/SKILL.md` with `status: proposed`. The user (or Mimir in autonomous mode) reviews and either approves (move to `bizar-dash/skills/<slug>/`) or rejects.
4. **Auto-improve.** When an existing skill is used, log `bizar memory skill use --name <slug> --outcome success|failure`. The Curator-style review pass (`bizar memory skill review`) increments the skill's version when 5+ failure log entries accumulate.

### D.2 Storage Layout

```
.bizar/skills/
├── proposed/
│   └── <slug>/
│       └── SKILL.md            # status: proposed
├── approved/                   # mirrors bizar-dash/skills/<slug>/
└── rejected/
    └── <slug>/
        └── SKILL.md            # status: rejected, reason: <why>
```

Each skill's `SKILL.md` includes a frontmatter block:
```yaml
---
name: pnpm-install-then-test
description: Run pnpm install before tests in this project
triggers:
  - "tests fail"
  - "pnpm install"
version: 0.1.0
status: proposed | approved | rejected
created_by: curator
use_count: 0
failure_count: 0
last_used: 2026-07-06
---
```

### D.3 Index

A `bizar memory skill list` command walks `.bizar/skills/` and `bizar-dash/skills/`, parses frontmatter, returns a table. The index is `AGENTS_SELF_IMPROVEMENT.md`-style — appended on each transition.

### D.4 Curator Implementation Outline

**Files to create:**
- `plugins/bizar/src/hooks/skill-curator.ts` — listens for high-signal events (skill failure, repeated error), increments counters.
- `cli/curator.mjs` — `bizar curator <verb>` subcommands: `status`, `propose`, `review`, `approve`, `reject`, `archive`.
- `bizar-dash/src/web/views/SkillsCurator.tsx` — dashboard view for proposed/rejected skills.

**Trigger logic:**
```js
// skill-curator.ts (sketch)
import { onSignal } from "../event-stream.js";

onSignal("skill_failure", async ({ skillName, error }) => {
  await bumpCounter(skillName, "failure");
  if (await getFailureCount(skillName) >= 5) {
    await proposeSkillRevision(skillName);
  }
});

onSignal("skill_use", async ({ skillName, outcome }) => {
  await bumpCounter(skillName, outcome === "success" ? "use" : "failure");
});
```

**Pattern detection:**
```js
// curator.mjs (sketch) — `bizar curator propose`
async function proposeFromLessons() {
  const lessons = await readLessonsLog(); // .bizar/AGENTS_SELF_IMPROVEMENT.md
  const patterns = extractPatterns(lessons, { minOccurrences: 3 });
  for (const pattern of patterns) {
    await writeProposedSkill({
      name: slugify(pattern.name),
      description: pattern.description,
      triggers: pattern.triggers,
      evidence: pattern.evidence, // lesson IDs that contributed
    });
  }
}
```

---

## Section E — The Cross-Agent Knowledge Graph

### E.1 Should Bizar Adopt OpenFang's Graph?

**Yes.** OpenFang's graph is the production reference (`round-9-memory/memory-patterns.md:2.5`). The pattern is:

- **Storage:** SQLite + two tables (`entities`, `relations`).
- **Population:** LLM-driven via `knowledge_add_entity` tool, plus periodic rebuild from source.
- **Query:** SQL JOIN with `source`/`relation`/`target` filters.
- **Cross-Hand shared state:** All Hands read the same tables.

### E.2 Bizar's Graph: Where It Lives

Bizar's `.bizar/graph/graph.json` is graphify's output — a JSON-serialized AST + semantic graph. The proposal splits this into two layers:

1. **graphify's graph** (existing) — structural: which files reference which modules, which APIs are called.
2. **Runtime graph** (NEW) — semantic: which concepts the agents have learned about, which decisions have been made, which entities the user cares about.

The runtime graph is what agents query. graphify's graph feeds into the runtime graph via periodic rebuild.

### E.3 Schema

Mirrors OpenFang (`crates/openfang-memory/src/migration.rs:150-172`):

```sql
CREATE TABLE IF NOT EXISTS entities (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,        -- Person, Organization, Project, Concept, Event, Location, Document, Tool, Custom
    name        TEXT NOT NULL,
    properties  TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relations (
    id              TEXT PRIMARY KEY,
    source_entity   TEXT NOT NULL,
    relation_type   TEXT NOT NULL,    -- WorksAt, KnowsAbout, RelatedTo, DependsOn, OwnedBy, CreatedBy, LocatedIn, PartOf, Uses, Produces, Custom
    target_entity   TEXT NOT NULL,
    properties      TEXT NOT NULL DEFAULT '{}',
    confidence      REAL NOT NULL DEFAULT 1.0,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_entity);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_entity);
CREATE INDEX IF NOT EXISTS idx_relations_type   ON relations(relation_type);
```

### E.4 Population

Three pathways:

1. **LLM-driven:** `bizar_graph_add_entity --type Concept --name "LightRAG" --properties '{"description": "..."}'`. Agents call this when they learn something.
2. **Session-end extraction:** When `memory-write-on-end.ts` writes a session summary, parse the summary for entities. Implementation: a small LLM call that returns `(entities, relations)` tuples.
3. **Periodic rebuild:** `bizar graph rebuild` walks the project source via graphify, extracts entities from module names + comments + docstrings.

### E.5 Query API

Mirrors OpenFang's `tool_knowledge_query` (`crates/openfang-runtime/src/tool_runner.rs:2105-2140`):

```js
// plugins/bizar/src/tools/graph-query.ts
tool({
  name: "bizar_graph_query",
  description: "Query the cross-agent knowledge graph. Use to find entities and relations by source, relation type, or target.",
  args: {
    source: z.string().optional().describe("Source entity name or ID."),
    relation: z.string().optional().describe("Relation type (e.g., 'DependsOn', 'OwnedBy')."),
    target: z.string().optional().describe("Target entity name or ID."),
    limit: z.number().int().positive().default(20),
  },
  execute: async (args) => {
    const matches = await graphStore.query(args);
    return { output: JSON.stringify(matches) };
  },
});
```

### E.6 Cross-Agent Access

Every agent gets `bizar_graph_query` and `bizar_graph_add_entity` tools. Reads are unrestricted; writes go through a Curator-style review (Mimir in autonomous mode, user in supervised mode).

### E.7 Files to Create

- `bizar-dash/src/server/graph-store.mjs` — SQLite operations.
- `bizar-dash/src/server/routes/graph.mjs` — REST surface.
- `plugins/bizar/src/tools/graph-query.ts` — agent tool.
- `plugins/bizar/src/tools/graph-add-entity.ts` — agent tool.
- `plugins/bizar/src/tools/graph-add-relation.ts` — agent tool.
- `cli/graph.mjs` — `bizar graph <verb>` CLI (consolidate the existing graphify CLI).
- `plugins/bizar/src/hooks/graph-extract-on-end.ts` — session-end entity extraction.

---

## Section F — The User Modeling Layer

### F.1 Should Bizar Adopt Honcho's Dialectic?

**Yes, simplified.** The Honcho peer-card pattern (affirmative + critical cards) is unique in 2026 (`round-9-memory/memory-patterns.md:7.1`). Bizar's `AGENTS_SELF_IMPROVEMENT.md` could become dialectic by separating "what worked" from "what failed" lessons.

### F.2 Bizar's User Profile Layout

```
users/<id>/
├── profile.md              # human-readable: who is this user, what do they care about
├── index.json              # structured facts for fast retrieval
├── preferences/            # directory of preference notes
│   ├── coding-style.md
│   ├── communication.md
│   └── tools.md
└── history/                # session-level facts
    └── <date>-<session-id>.md
```

### F.3 Triggers

- **End of session** — extract user-affecting facts via a sidecar LLM call.
- **Explicit** — `bizar memory user remember "fact"`.
- **Periodic** — `bizar memory user reconcile` (monthly) merges near-duplicates and decays low-confidence facts.

### F.4 Retrieval

For agents, expose `bizar_user_profile --query "<topic>"` that:
1. Searches `users/<id>/index.json` for matching facts.
2. Returns ranked facts with confidence scores.
3. For high-stakes queries, fetches the full note body.

### F.5 Files to Create

- `cli/memory-user.mjs` — `bizar memory user <verb>` subcommands.
- `plugins/bizar/src/tools/user-profile.ts` — `bizar_user_profile` tool.
- `plugins/bizar/src/hooks/memory-write-user-on-end.ts` — end-of-session user extraction.
- `bizar-dash/src/server/user-profile-store.mjs` — operations on `users/<id>/`.
- `bizar-dash/src/server/routes/user-profile.mjs` — REST surface.

---

## Section G — Compaction Strategy

### G.1 The Problem

Bizar's `compaction.mjs:36` declares `compactionThreshold = 0.5`. When `shouldCompact()` returns true, opencode summarizes the conversation. The summary is lost from Bizar's perspective.

### G.2 The Solution: Pre-Compaction Flush

Borrow OpenClaw's `flush-plan.ts:27-34` pattern:

```
Pre-compaction memory flush.

Store durable memories only in memory/YYYY-MM-DD.md (create memory/ if needed).

Treat MEMORY.md, DREAMS.md, SOUL.md, TOOLS.md, AGENTS.md as read-only.

APPEND new content only and do not overwrite existing entries.

Do NOT create timestamped variant files; always use the canonical YYYY-MM-DD.md filename.

If nothing to store, reply with NO_REPLY.
```

### G.3 Implementation

`plugins/bizar/src/compaction.mjs` — add a `runPreCompactionFlush()` function that runs after `shouldCompact()` returns true but before the conversation is summarized. The flush is a special turn:

```js
// plugins/bizar/src/compaction.mjs (sketch)
export async function runPreCompactionFlush(turn, sessionID) {
  const flushPrompt = [
    "Pre-compaction memory flush.",
    "Store durable memories only in memory/YYYY-MM-DD.md (create memory/ if needed).",
    "Treat MEMORY.md, DREAMS.md, SOUL.md, TOOLS.md, AGENTS.md as read-only.",
    "APPEND new content only and do not overwrite existing entries.",
    "Do NOT create timestamped variant files; always use the canonical YYYY-MM-DD.md filename.",
    "If nothing to store, reply with NO_REPLY.",
  ].join(" ");
  
  await callLLM({
    systemPrompt: "Pre-compaction memory flush turn. The session is near auto-compaction; capture durable memories to disk.",
    userPrompt: flushPrompt,
    tools: [memoryWriteTool],
  });
}
```

### G.4 Memory Extracted During Flush

The flush turn writes to:
- `memory/YYYY-MM-DD.md` — daily notes (current).
- `users/<id>/profile.md` — user-affecting facts.
- `.bizar/graph/entities.db` — entities and relations.

After the flush turn returns `NO_REPLY` or after a successful write, `shouldCompact()` proceeds to compact.

### G.5 Dialectic Variant

For richer extraction, the flush turn can be dialectic (Honcho-style):

```
Pre-compaction memory flush (dialectic mode).

For this session, write TWO cards:

AFFIRMATIVE CARD (what worked):
- Successful tool sequences
- Effective prompts
- Correct tool parameterizations

CRITICAL CARD (what failed):
- Failures and errors
- Workarounds that succeeded
- Missing skills or capabilities

Store both cards in sessions/<date>-<session-id>.md with clear section headers.
If nothing to store, reply with NO_REPLY.
```

The dialectic mode is opt-in via `memory.flush.dialectic: true` in `.bizar/memory.json`.

### G.6 Files to Modify

- `plugins/bizar/src/compaction.mjs` — add `runPreCompactionFlush()`.
- `plugins/bizar/src/hooks/memory-write-on-end.ts` — split into flush + end.
- `.bizar/memory.json` — add `flush.dialectic` and `flush.softThresholdTokens` config.

---

## Section H — Implementation Roadmap

Three phases, sized to ship within Bizar's existing release cadence.

### Phase 1: Foundation (v5.6.0)

**Goal:** Add Tier 2 (session scratchpad), Tier 5 (knowledge graph), and pre-compaction flush. Default LightRAG on.

**Tasks:**

1. **`bizar_task_note` tool** — `plugins/bizar/src/tools/task-note.ts` (NEW).
   - SQLite at `.bizar/sessions/<task-id>.db`.
   - `bizar_task_note --content "..."` writes.
   - `bizar_task_note --search "query"` reads.
   - **Effort:** 1-2 days.
   - **Tests:** round-trip write/read; cross-task isolation; CJK FTS5.

2. **Knowledge graph SQLite migration** — `bizar-dash/src/server/graph-store.mjs` (NEW).
   - Schema at `.bizar/graph/entities.db` (entities + relations tables).
   - Migration from `.bizar/graph/graph.json` (graphify output) on first run.
   - **Effort:** 2-3 days.
   - **Tests:** schema migration; index creation; query correctness.

3. **`bizar_graph_query` tool** — `plugins/bizar/src/tools/graph-query.ts` (NEW).
   - Mirrors OpenFang's `tool_knowledge_query` at `crates/openfang-runtime/src/tool_runner.rs:2105-2140`.
   - **Effort:** 1 day.

4. **Pre-compaction flush** — `plugins/bizar/src/compaction.mjs` (MODIFY).
   - Add `runPreCompactionFlush()` after `shouldCompact()` returns true.
   - **Effort:** 1 day.

5. **LightRAG default-on** — `.bizar/memory.json` (MODIFY).
   - Flip `lightrag.enabled` to `true`.
   - **Effort:** 0.5 day (testing only).

6. **Auto-migrate legacy vault path** — `bizar-dash/src/server/memory-store.mjs` (MODIFY).
   - Extend `ensureVaultExists()` at line 116 to auto-migrate when new path is empty.
   - **Effort:** 1 day.

7. **`bizar memory fetch --ids` subcommand** — `cli/memory.mjs` (MODIFY).
   - Progressive-disclosure pattern from claude-mem.
   - **Effort:** 0.5 day.

**Phase 1 total:** ~7-9 days. Ships in v5.6.0.

### Phase 2: User Modeling + Skill Curator (v5.7.0)

**Goal:** Add Tier 4 (user memory) and the skill auto-creation pattern.

**Tasks:**

1. **`bizar memory user` CLI** — `cli/memory-user.mjs` (NEW).
   - Subcommands: `show`, `remember`, `search`, `reconcile`.
   - **Effort:** 2 days.

2. **`bizar_user_profile` tool** — `plugins/bizar/src/tools/user-profile.ts` (NEW).
   - Read-only profile query.
   - **Effort:** 1 day.

3. **End-of-session user extraction** — `plugins/bizar/src/hooks/memory-write-user-on-end.ts` (NEW).
   - LLM call extracts user-affecting facts.
   - **Effort:** 2 days.

4. **Skill Curator** — `plugins/bizar/src/hooks/skill-curator.ts` (NEW).
   - Pattern detection on `AGENTS_SELF_IMPROVEMENT.md`.
   - **Effort:** 2 days.

5. **`bizar curator <verb>` CLI** — `cli/curator.mjs` (NEW).
   - Subcommands: `status`, `propose`, `review`, `approve`, `reject`, `archive`.
   - **Effort:** 2 days.

6. **`SkillsCurator.tsx` dashboard view** — `bizar-dash/src/web/views/SkillsCurator.tsx` (NEW).
   - List proposed/rejected skills with approve/reject buttons.
   - **Effort:** 1-2 days.

7. **Dialectic session summary** — `plugins/bizar/src/hooks/memory-write-on-end.ts` (MODIFY).
   - Split session summary into affirmative + critical cards.
   - **Effort:** 1 day.

**Phase 2 total:** ~11-13 days. Ships in v5.7.0.

### Phase 3: World Memory Graph + Consolidation (v6.0.0)

**Goal:** Add Tier 5 (full knowledge graph surface for agents) and the consolidation engine.

**Tasks:**

1. **`bizar_graph_add_entity` / `bizar_graph_add_relation` tools** — `plugins/bizar/src/tools/` (NEW).
   - LLM-driven graph population.
   - **Effort:** 2 days.

2. **Session-end graph extraction** — `plugins/bizar/src/hooks/graph-extract-on-end.ts` (NEW).
   - LLM call extracts entities/relations from session summary.
   - **Effort:** 2 days.

3. **Periodic graph rebuild** — `cli/graph.mjs` (NEW).
   - `bizar graph rebuild` walks source code via graphify.
   - **Effort:** 2 days.

4. **Consolidation engine** — `bizar-dash/src/server/consolidation.mjs` (NEW).
   - 7-day decay + floor at 0.1 (mirrors OpenFang `consolidation.rs:34-44`).
   - **Effort:** 3 days.

5. **Memory curator `bizar memory curate`** — `cli/memory.mjs` (MODIFY).
   - Pattern detection across `AGENTS_SELF_IMPROVEMENT.md` + recent notes + tool-call frequency.
   - **Effort:** 3 days.

6. **Cross-tier integration** — `plugins/bizar/src/event-stream.ts` (MODIFY).
   - Wire Tier 1 → Tier 3 (pre-compaction flush).
   - Wire Tier 2 → Tier 3 (end-of-task extraction).
   - Wire Tier 3 → Tier 4 (end-of-session user extraction).
   - Wire Tier 3 → Tier 5 (end-of-session graph extraction).
   - **Effort:** 2 days.

**Phase 3 total:** ~14 days. Ships in v6.0.0.

### Roadmap Summary

| Phase | Version | Days | Major Additions |
|---|---|---:|---|
| 1 | v5.6.0 | 7-9 | Tier 2 scratchpad, Tier 5 graph foundation, pre-compaction flush, LightRAG default-on |
| 2 | v5.7.0 | 11-13 | Tier 4 user memory, skill curator, dialectic session summaries |
| 3 | v6.0.0 | 14 | Tier 5 full graph, consolidation engine, cross-tier integration |
| **Total** | **v5.6.0 → v6.0.0** | **~32-36** | **All 5 tiers, Curator, Consolidation, Graph** |

At ~10 days/month of agent work, this is a 3-4 month roadmap. Aligned with the L4/L5 autonomy target in `.bizar/PROJECT.md:9`.

---

## Section I — Risk & Trade-Offs

### I.1 What This Redesign Does NOT Solve

1. **Cross-project memory sharing.** Bizar's `users/drb0rk/` namespace is local; cross-project sharing requires the multi-user Honcho/Mem0 SaaS model. Out of scope for v5.6-v6.0.
2. **Real-time memory updates from tool outputs.** OpenClaw's `auto-capture` runs on every tool output. Bizar would need a hook on every tool call — possible but high-cost (token usage).
3. **Knowledge graph multi-hop queries.** OpenFang's `max_depth` is ignored (`round-9-memory/memory-patterns.md:2.5`). Bizar inherits the same limitation unless the graph store upgrades to Neo4j.
4. **Conflict resolution between memory sources.** Mem0's append-only design avoids this; Bizar's markdown+git design can't enforce append-only without a write-side validator.

### I.2 Risks

1. **LightRAG default-on could double storage.** LightRAG's KV store at `.bizar/lightrag/kv_store_full_docs.json` duplicates content already in the vault. Mitigation: garbage collection pass that removes stale entries.
2. **Pre-compaction flush adds latency.** Each flush is an LLM call. At 50% usage, the flush could add 2-5 seconds to the user-visible response. Mitigation: cheap model for the flush (configurable in `.bizar/memory.json` flush.model).
3. **Curator auto-creates bad skills.** Hermes' pattern requires 3+ session occurrences; Bizar's could match that. Mitigation: skills go to `proposed/` not `approved/`. Human review required.
4. **Knowledge graph drift.** Agents add entities with conflicting names ("Acme" vs "Acme Corp"). Mitigation: entity linking pass at end-of-session that merges near-duplicates.

### I.3 What We're NOT Borrowing

| Borrowed | NOT Borrowed | Why |
|---|---|---|
| Honcho peer cards | Honcho hosted service | Bizar is local-first; doesn't want SaaS dependency |
| Mem0's append-only facts | Mem0's LLM extraction | Mem0's LLM call is mandatory; Bizar can defer |
| Letta memory blocks | Letta's per-agent persona | Persona is more Letta-shaped than Bizar's needs |
| Claude-mem Bun runtime | Bun runtime dep | Bizar is Node-only; would need port to Bun for that surface |
| graphify's JSON graph | graphify's full rebuild | Bizar's runtime graph covers the use case incrementally |

---

## Section J — Cross-References

- **Companion document** — `round-9-memory/memory-patterns.md` for the architectural deep dive.
- **Prior round reports**:
  - `round-3-crossref/bizar-alignment.md` — Bizar's current state + gaps.
  - `round-4-hermes-deep/learning-loop.md` — Hermes closed learning loop source.
  - `round-5-openfang-deep/knowledge-graph.md` — OpenFang graph source.
  - `round-6-openclaw-deep/memory-tools.md` — OpenClaw memory + tool policy.
  - `round-7-bestof-deep/multi-agent-memory.md` — Mem0/Letta/claude-mem source.
  - `round-8-multi-agent/bizar-multi-agent-redesign.md` — Bizar multi-agent redesign.
- **Bizar files to modify:**
  - `cli/memory.mjs` (1747 lines)
  - `bizar-dash/src/server/memory-store.mjs` (1093 lines)
  - `bizar-dash/src/server/memory-lightrag.mjs` (1477 lines)
  - `bizar-dash/src/server/routes/memory.mjs` (1482 lines)
  - `plugins/bizar/src/compaction.mjs` (167 lines)
  - `plugins/bizar/src/hooks/memory-write-on-end.ts` (188 lines)
  - `plugins/bizar/src/tools/memory-search.ts` (228 lines)
  - `.bizar/memory.json` (37 lines)
- **Bizar files to create:**
  - `cli/memory-user.mjs`
  - `cli/curator.mjs`
  - `cli/graph.mjs`
  - `plugins/bizar/src/tools/task-note.ts`
  - `plugins/bizar/src/tools/graph-query.ts`
  - `plugins/bizar/src/tools/graph-add-entity.ts`
  - `plugins/bizar/src/tools/graph-add-relation.ts`
  - `plugins/bizar/src/tools/user-profile.ts`
  - `plugins/bizar/src/hooks/skill-curator.ts`
  - `plugins/bizar/src/hooks/memory-write-user-on-end.ts`
  - `plugins/bizar/src/hooks/graph-extract-on-end.ts`
  - `bizar-dash/src/server/graph-store.mjs`
  - `bizar-dash/src/server/user-profile-store.mjs`
  - `bizar-dash/src/server/consolidation.mjs`
  - `bizar-dash/src/server/routes/graph.mjs`
  - `bizar-dash/src/server/routes/user-profile.mjs`
  - `bizar-dash/src/web/views/SkillsCurator.tsx`

---

## Section K — Quick-Reference Decision Matrix

When the team asks "should we adopt pattern X?" — consult this matrix.

| Pattern | Source | Adopt in Bizar? | Phase |
|---|---|---|---|
| SQLite + FTS5 + trigram | Hermes `hermes_state.py:695-866` | Already adopted (`.bizar/memory.json`) | — |
| Hybrid retrieval (BM25+vector+MMR+decay) | OpenClaw `hybrid.ts:52-156` | Adopt via LightRAG (default-on) | 1 |
| Pre-compaction flush | OpenClaw `flush-plan.ts:27-34` | Adopt | 1 |
| Memory blocks (persona/human/facts/conversation) | Letta | Skip (out of scope) | — |
| Append-only facts | Mem0 | Adopt via session-end dialectic | 2 |
| Dialectic peer cards | Honcho | Adopt (dialectic session summaries) | 2 |
| Knowledge graph (entities + relations) | OpenFang `knowledge.rs:17-19` | Adopt | 1+3 |
| Skill auto-creation | Hermes Curator | Adopt (small) | 2 |
| 7-day decay + 0.1 floor | OpenFang `consolidation.rs:34-44` | Adopt | 3 |
| Progressive-disclosure search | claude-mem | Adopt (`bizar memory fetch --ids`) | 1 |
| End-of-turn sync | Hermes `memory_manager.py:558-614` | Skip (cost) | — |
| On-event / on-tool-call capture | OpenClaw auto-capture | Skip (cost) | — |
| Per-task scratchpad | (new pattern) | Adopt | 1 |
| User profile (Honcho/Mem0) | Honcho + Mem0 | Adopt (Honcho shape) | 2 |

---

## Section L — Closing Note

The Bizar memory redesign is a 3-phase roadmap that brings Bizar from "good enough for a single user with LightRAG opt-in" to "matches the 2026 five-tier hierarchy with active Curator + Consolidation + Graph." The total effort is ~32-36 days of agent work, spread across three releases (v5.6.0, v5.7.0, v6.0.0).

The biggest wins are:
- **Pre-compaction flush** prevents information loss during working-memory compaction.
- **Knowledge graph surface for agents** lets Bizar's 12 agents coordinate via shared entities/relations.
- **Skill auto-creation** makes Bizar's 5-bundled-skill baseline grow over time.
- **Honcho-style user modeling** gives Bizar a per-user profile that survives across projects.

The biggest risks are:
- **LightRAG default-on doubles storage** without a garbage collection pass.
- **Pre-compaction flush adds latency** at compaction time (2-5 seconds).
- **Curator auto-creates bad skills** if the pattern detector is too eager.
- **Knowledge graph drift** without an entity-linking pass.

All four risks are tractable in this proposal's design. None are deal-breakers.

The closed learning loop, which Hermes pioneered (`round-4-hermes-deep/learning-loop.md:25-27`), is the north star: every conversation generates telemetry → indexed → retrieved → synthesized into skills/entities/facts → consumed by future sessions. Bizar's v6.0.0 closes this loop.

---

*End of Bizar memory redesign proposal. Total sections: 12. Files to modify: 7. Files to create: 18. Roadmap: 3 phases over 3-4 months.*