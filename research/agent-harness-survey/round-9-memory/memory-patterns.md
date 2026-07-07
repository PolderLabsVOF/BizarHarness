# Memory Architecture Deep Study — Across All Four Source Repos and the Best-of Catalog

**Round:** 9 — Memory architectures
**Date:** 2026-07-06
**Scope:** Hermes, OpenFang, OpenClaw, and the memory layer projects (Mem0, Letta, claude-mem, Honcho, graphify, Obsidian-style) catalogued in best-of-Agent-Harnesses.
**Author:** @tyr
**Companion:** `round-9-memory/bizar-memory-redesign.md` (Bizar-specific redesign proposal)
**Methodology:** Every concrete claim cites a `file:line` or document reference. Star/license/architecture claims are sourced from `round-7-bestof-deep/multi-agent-memory.md` (which itself cites the catalogs); internal architecture claims cite the actual source.

---

## Section 0 — Why Memory is the Most Important Layer in 2026

The 2026 agent landscape has converged on three observations about memory:

1. **The memory layer is the differentiator, not the model.** Mem0 (60.1k stars), Letta (23.7k stars), and claude-mem (85.9k stars) are the three most-popular memory projects, and the gap between "a model call" and "an agent" is measured in what it remembers. The best-of catalog tags this with the answer-shape: *"Top picks: Mem0, claude-mem, agentlog"* for the question "what is the best agent harness if I want a drop-in memory layer for agents?" (`round-7-bestof-deep/multi-agent-memory.md:21`).

2. **Memory is a four-surface stack, not a single product.** Per the catalog's synthesis: *"Every modern memory layer stacks four surfaces: (1) Working memory — in-run conversation / scratchpad. Cheap, ephemeral, owned by the framework. (2) Session memory — within-conversation summary, possibly indexed for retrieval. Per-session. (3) Long-term facts — cross-session extracted facts. Owned by Mem0 / Letta / LightRAG. (4) Identity/persona — the agent's evolving self. Owned by Letta (or by the user via Obsidian)."* (`round-7-bestof-deep/multi-agent-memory.md:716-720`).

3. **The 2026 production stack covers all four with two products (or one product + Obsidian).** *"a memory-primitive library (Mem0 OR Letta) and a human-readable archive (Obsidian + git)."* (`round-7-bestof-deep/multi-agent-memory.md:721-722`).

This document is the architecture-deep version of those observations. The next sections enumerate the patterns in detail.

---

## Section 1 — The Memory Hierarchy

Across all four source repos and the memory-layer projects, every system implements some subset of the following five-tier hierarchy. The tiers differ in **lifetime**, **retrieval interface**, **read/write audience**, and **storage backend**.

### Tier 1: Working Memory (in-run scratchpad)

**What goes in it:** The current turn's user message, tool calls, tool results, the model's intermediate reasoning, and the most recent few turns of context that the model needs to keep producing coherent output.

**How long it lives:** A single turn or a small sliding window of recent turns. Discarded when the model emits a final response (or earlier, if the context window overflows).

**How it's indexed/searched:** None. Working memory is positional — the model sees it inline as the `messages` array passed to the next LLM call. No FTS, no vector search.

**Who reads/writes:** The model reads it; the runtime framework writes to it. Per OpenClaw's memory definition (`extensions/memory-core/index.ts:57-67`), the working memory surface is the message list itself — `memory_search` and `memory_get` only operate on memory that has been **promoted out of working memory** into durable storage. Per Hermes (`agent/memory_provider.py:116-132`), the provider's `sync_turn` hook fires *after* a turn completes and persists the turn's content into the provider's own backend — at that point the content is no longer working memory.

**Examples from each system:**
- **Hermes:** The `messages` array passed into `client.chat.completions.create(model=model, messages=messages, tools=tool_schemas)` call inside `run_conversation()` (per the system prompt's documented `AIAgent.chat` shape). Token accounting on the way in; no per-turn indexing.
- **OpenFang:** The `Session.messages: Vec<Message>` field of the `Session` struct (`crates/openfang-memory/src/session.rs:14-25`). The session is loaded into memory at the start of a Hand's run, mutated in-place, and serialized back via `SessionStore::save_session()` (`crates/openfang-memory/src/session.rs:78-101`) when the run ends. Inside the run, messages are positional — `Message` structs in a `Vec` with no index.
- **OpenClaw:** The agent's message transcript, surfaced through the loop. OpenClaw's memory-core plugin explicitly does NOT touch working memory — `memory_search` and `memory_get` only see promoted memory.
- **Bizar:** The compiled prompt the opencode runtime assembles per turn from the conversation transcript. Bizar's `plugins/bizar/src/compaction.mjs:49-53` documents the boundary: `shouldCompact(usage, maxContext)` returns true at 50% usage, and beyond that point a compaction step reduces working memory. Bizar has no per-turn persistence to a memory backend at this tier — working memory lives entirely in opencode's runtime.

### Tier 2: Session Memory (within-conversation indexable)

**What goes in it:** Everything in Tier 1, but indexed for retrieval within the same session. Often implemented as the same data (the message transcript) plus an index over it. The agent can search its own past turns within the session.

**How long it lives:** For the duration of the session. Some systems preserve it across session boundaries (Hermes does; OpenFang does; OpenClaw does; Bizar does via the opencode session log). Some purge it after compaction.

**How it's indexed/searched:**
- **Hermes:** SQLite + FTS5 over the `messages` table via a virtual `messages_fts` table (`hermes_state.py:813-836`), with INSERT/UPDATE/DELETE triggers keeping the FTS index in sync. A second trigram-indexed FTS5 table at `hermes_state.py:842-866` handles CJK substring queries (the `unicode61` tokenizer breaks CJK into individual tokens, so `trigram` is added for phrase matching). Per `hermes_state.py:130`, user FTS queries are capped at `MAX_FTS5_QUERY_CHARS = 2_048`.
- **OpenFang:** The `SessionStore` persists the full message blob (`crates/openfang-memory/src/session.rs:62-63` deserializes from `rmp_serde`) keyed by `(id, agent_id)`. There is no built-in FTS over session messages — retrieval happens at the `KnowledgeStore` and `SemanticStore` levels (Tier 3 and Tier 5 below), not at the session level.
- **OpenClaw:** Per-agent SQLite session store (`docs/concepts/multi-agent.md:9-25`). Memory state lives in `~/.openclaw/agents/<agentId>/agent/`. The `memory-core` plugin's `memory_search` tool can include `corpus: "sessions"` (`extensions/memory-core/index.ts:62-67`) — that's session memory indexed for search.
- **Bizar:** LightRAG indexes (when enabled) cover session content via the markdown notes written by `memory-write-on-end.ts:104-152` (which writes `sessions/YYYY-MM-DD-<session-id>.md` summaries at session termination). LightRAG itself is opt-in (`.bizar/memory.json:17`).

**Who reads/writes:**
- Reads: the model (via tool calls); the curator/review subsystem (Hermes' `run_curator_review()`).
- Writes: the framework's sync hooks after each turn; the curator on consolidation.

### Tier 3: Project Memory (across sessions of one user/project)

**What goes in it:** Durable facts about the project — architecture decisions, naming conventions, prior bugs, agent preferences for that specific codebase. Lives longer than any session but is scoped to one project (or one user, depending on the boundary).

**How long it lives:** Until explicitly deleted. Per Hermes's curator (`agent/curator.py`), sessions and the durable memories extracted from them are kept indefinitely by default; `archive_after_days` is a configurable but conservative threshold.

**How it's indexed/searched:**
- **Hermes:** The FTS5 index covers session messages and Honcho-extracted peer cards. Honcho's own service handles entity extraction and dialectic Q&A. There is no first-class per-project fact store inside Hermes — project memory lives in the conversation archive, retrieved via FTS5/Honcho.
- **OpenFang:** The `KnowledgeStore` (`crates/openfang-memory/src/knowledge.rs:17-19`) holds entities and relations in a `entities` + `relations` schema (`crates/openfang-memory/src/migration.rs:150-172`). Three indexes: `idx_relations_source`, `idx_relations_target`, `idx_relations_type` (`migration.rs:170-172`). The `GraphPattern` query at `memory.rs:201-212` matches `source`/`target`/`relation`/`max_depth`; the SQL implementation at `knowledge.rs:82-188` performs a JOIN.
- **OpenClaw:** The `MEMORY.md` + `memory/YYYY-MM-DD.md` files (`docs/concepts/memory.md:11-25`). `MEMORY.md` is loaded into the agent's system prompt at session start; `memory/YYYY-MM-DD.md` are daily notes loaded for today and yesterday automatically. LightRAG indexes the markdown content; the `memory-wiki` plugin emits a `wiki_search`/`wiki_get`/etc. vocabulary over a compiled vault (`extensions/memory-wiki/index.ts:43-62`).
- **Bizar:** `.bizar/PROJECT.md` (the canonical project description), `.bizar/AGENTS_SELF_IMPROVEMENT.md` (the lessons log, 1231 lines and growing), and the Bizar Memory vault under `~/.bizar_memory/` (currently default-vault in code per `bizar-dash/src/server/memory-store.mjs:77` — but the live user data lives in the legacy path per `memory.json:7`, awaiting migration). The vault namespace layout (`memory-store.mjs:308-321`) carves project memory into `projects/<id>/`, plus global and user namespaces.

**Who reads/writes:**
- Reads: every agent in the project; the curator; the dashboard; `bizar memory search` and `bizar memory read` CLI.
- Writes: agent tools (`bizar_memory_write` at `plugins/bizar/src/tools/memory-write.ts`); the session-end hook (`plugins/bizar/src/hooks/memory-write-on-end.ts`); the user directly via the Obsidian vault's editor.

### Tier 4: User Memory (about the user across projects)

**What goes in it:** Cross-project facts about the user — preferences, identity, working style, communication patterns. The Honcho provider's primary use case is exactly this: *"cross-session user modeling with dialectic Q&A"* (`plugins/memory/honcho/__init__.py:191-192`).

**How long it lives:** Indefinitely. Honcho's `conclude` tool (`plugins/memory/honcho/__init__.py:155-181`) writes *persistent* facts that build a peer's profile. The default behavior per the schema: *"Conclusions are persistent facts that build a peer's profile. You MUST pass exactly one of: `conclusion` (to create) or `delete_id` (to delete). Passing neither is an error. Deletion is only for PII removal — Honcho self-heals incorrect conclusions over time."*

**How it's indexed/searched:**
- **Hermes Honcho:** Five tools (`honcho_profile`, `honcho_search`, `honcho_reasoning`, `honcho_context`, `honcho_conclude`) at `plugins/memory/honcho/__init__.py:36-184`. The provider exposes peer cards — *"Retrieve or update a peer card from Honcho — a curated list of key facts about that peer (name, role, preferences, communication style, patterns)."* The schema (`__init__.py:36-61`) defines a `peer` parameter with aliases `user` and `ai`.
- **OpenFang:** User-level memory is folded into the same `KnowledgeStore` (`Person` entity type per `memory.rs:132-154`). OpenFang does not differentiate user-vs-project at the storage layer; the differentiation is at the agent-runner level.
- **OpenClaw:** No first-class user model. User identity is captured at the platform layer (Telegram user ID, Discord user ID) but no per-user fact store ships in `memory-core`. `memory-wiki` and `memory-lancedb` don't have user-scoping either.
- **Bizar:** No first-class user memory. `.bizar/memory.json` has a `users/drb0rk` namespace (`memory.json:15`) but the namespace is currently unused.

**Who reads/writes:**
- Reads: any agent on behalf of the user; the dashboard's user-preferences view.
- Writes: explicit via the `conclude` tool; automatic via Honcho's dialectic processing on session end.

### Tier 5: World Memory (shared across users)

**What goes in it:** Knowledge that's true independent of any user or project — language semantics, library documentation, common patterns. In practice, every system implements this as either an external knowledge base (LightRAG over a curated corpus) or as a per-agent knowledge graph (OpenFang's entities + relations).

**How long it lives:** Until the knowledge decays. OpenFang's `ConsolidationEngine` (`crates/openfang-memory/src/consolidation.rs:14-18`) decays confidence on memories not accessed in 7 days: *"Decay confidence of memories not accessed in the last 7 days"* (`consolidation.rs:34-44`). Decayed memories drop to a floor of `MAX(0.1, confidence * decay_factor)`.

**How it's indexed/searched:**
- **OpenFang:** The `entities` + `relations` schema is the world graph. Query pattern at `memory.rs:201-212` supports `source`/`relation`/`target`/`max_depth`. Notable limitation: `max_depth` is accepted but **never used in the SQL** (per R5 deep dive at `round-5-openfang-deep/knowledge-graph.md:271-272`). All queries are single-hop JOINs.
- **OpenClaw:** LightRAG index over the vault (when enabled). The memory-lancedb extension (`extensions/memory-lancedb/index.ts:1-7`) exposes `memory_recall` and runs `auto-recall` + `auto-capture` lifecycle hooks. Multi-corpus search via `corpus: "memory" | "wiki" | "all" | "sessions"` per `memory-core/index.ts:62-67`.
- **Bizar:** `.bizar/graph/graph.json` (23,112 lines) — the graphify-built knowledge graph of the project itself. Per `round-3-crossref/bizar-alignment.md`, Bizar's graph is the cross-agent knowledge substrate.
- **Honcho:** Honcho itself is a hosted service; the world's worth of user-modeling facts lives there but is scoped per workspace, not truly global.

**Who reads/writes:**
- Reads: every agent in the project; the dashboard's knowledge graph viewer.
- Writes: agents as a side effect of work (OpenFang's `knowledge_add_entity` tool); humans via the dashboard; scheduled dreaming passes (OpenClaw's `memory-core/src/dreaming.ts`).

---

## Section 2 — Storage Backends Catalogued

The full set of storage backends seen across the four source repos and the catalog.

### 2.1 SQLite (with FTS5)

The default substrate. Used by:
- **Hermes** — `~/.hermes/state.db` (managed by `hermes_state.py:695-856`, the canonical `SCHEMA_SQL` plus the FTS5 virtual table at `hermes_state.py:813-836`).
- **OpenFang** — `~/.openfang/data/openfang.db` (single file, multiple stores, all sharing one connection; `migration.rs:75-185` is the schema). WAL mode at `substrate.rs:52-53`: `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000`.
- **OpenClaw** — per-agent SQLite at `~/.openclaw/agents/<agentId>/agent/` (`docs/concepts/multi-agent.md:9-25`).
- **Bizar** — none directly (Bizar's vault is markdown + git; the dashboard's session state is in JSONL). Bizar's memory-lightrag backend stores LightRAG state in `.bizar/lightrag/` (KV store JSON files at `.bizar/lightrag/kv_store_*.json`).

**Schema patterns:**
- **Hermes:** 5 base tables (`sessions`, `messages`, `state_meta`, `gateway_routing`, `compression_locks`) plus 2 FTS5 virtual tables (one standard, one trigram). Schema versioned via `schema_version` table.
- **OpenFang:** 11 base tables across 8 migration versions — `agents`, `sessions`, `events`, `kv_store`, `task_queue`, `memories`, `entities`, `relations`, `migrations`, `usage_events`, `canonical_sessions`, `paired_devices`, `audit_entries` (`migration.rs:75-340`).
- **OpenClaw:** Per-agent DB shape depends on plugin; `memory-core` adds `memory_index_state` rows (`extensions/memory-core/src/memory/manager-db.ts:21`).

**Query patterns:** All three implement `INSERT/UPDATE/DELETE` triggers on the base table to keep FTS in sync. Hermes's trigram tokenizer addition (`hermes_state.py:842-866`) is the cleanest example — the FTS5 virtual table gets `tokenize='trigram'`, which produces overlapping 3-byte sequences that substring-match any script (CJK, Thai, etc.).

**Performance:** SQLite handles ~100K entities comfortably (per `round-5-openfang-deep/knowledge-graph.md:460`). For multi-process agents, WAL mode is required (`substrate.rs:52-53`); Hermes's `apply_wal_with_fallback` path at `hermes_state.py:506-574` documents repair-from-corruption patterns.

### 2.2 LanceDB (vector store)

The dedicated vector backend. Used by:
- **OpenClaw** — `extensions/memory-lancedb/index.ts` (2023 lines). Single tool surface (`memory_recall`) plus `auto-recall` + `auto-capture` lifecycle hooks.

**Schema:** LanceDB's columnar format — embeddings as `FixedSizeListArray<float32>` plus metadata columns. Single-file or directory-backed depending on `embedding_dim`.

**Query patterns:** Cosine similarity over embeddings. The plugin runs `auto-recall` (which surfaces relevant vectors into the agent's prompt before each turn) and `auto-capture` (which adds new vectors from tool outputs automatically).

**Performance:** LanceDB is columnar and on-disk; sub-100ms queries on million-vector datasets are typical. Cold-start is the bottleneck.

### 2.3 PostgreSQL + pgvector

The hosted alternative. Mentioned in:
- **OpenFang** — `crates/openfang-memory/src/http_client.rs` is the optional HTTP backend that routes to a memory-api gateway backed by PostgreSQL + pgvector + Jina embeddings. Per `semantic.rs:184-185`: *"When HTTP backend is configured, searches via memory-api (hybrid vector+BM25)."* The SQLite connection is still required as fallback (`semantic.rs:49-53`).
- **CrewAI** — backend support for *"PostgreSQL, MySQL, SQLite, MongoDB, Redis, and 20+ more"* (per `round-7-bestof-deep/multi-agent-memory.md:97`).
- **PraisonAI** — same set of 20+ DBs (`round-7-bestof-deep/multi-agent-memory.md:210`).

**Schema:** Standard `pgvector` extension: `embedding vector(1536)` column plus metadata JSONB. Index with `ivfflat` or `hnsw`.

**Query patterns:** SQL + `<=>` operator for cosine distance. Hybrid (vector + BM25) via `ts_rank` joined with vector distance in a CTE.

**Performance:** pgvector with `hnsw` index hits sub-10ms on million-row datasets. Cold start is connection-pool latency, not the DB itself.

### 2.4 Redis

Used as a cache / session store, not as the durable memory. Mem0's library mode uses Redis for ephemeral state in some deployments. PraisonAI lists Redis as one of 20+ backends. Not the primary choice for any memory project in the catalog.

### 2.5 Custom Knowledge Graphs (entities + relations)

The OpenFang pattern: **`crates/openfang-memory/src/knowledge.rs`** with two tables (`entities`, `relations`) and three indexes. Schema at `migration.rs:150-172`. The relationship to a full graph DB (Neo4j, Memgraph) is documented in `round-5-openfang-deep/knowledge-graph.md:450-470`: OpenFang chose **simplicity and zero-dependency** over graph expressiveness.

Notable limitations:
- **`max_depth` is accepted but ignored** in the SQL (`round-5-openfang-deep/knowledge-graph.md:271-272`). A `max_depth=2` query returns the same results as `max_depth=1`.
- **100 result cap** (`knowledge.rs:123`).
- **No transactions** across multi-step population (`round-5-openfang-deep/knowledge-graph.md:418`).
- **No deduplication at the storage layer** (`round-5-openfang-deep/knowledge-graph.md:209-216`). Two Hands independently adding "Acme Corp" get different UUIDs.
- **No negation** filters in `GraphPattern` (`round-5-openfang-deep/knowledge-graph.md:274`).

The trade is deliberate: *"OpenFang chose simplicity and zero-dependency over graph expressiveness. For the Einstein Hands' use cases (tracking entities, simple relationship queries), SQLite is sufficient."* (`round-5-openfang-deep/knowledge-graph.md:464-466`).

### 2.6 Honcho (dialectic Q&A service)

A hosted service, not a storage backend per se. The Hermes Honcho provider talks to a remote Honcho API for cross-session user modeling with dialectic Q&A. The provider's `conclude` and `context` tools drive LLM summarization; the storage of peer cards lives on Honcho's side.

Schema is opaque (Honcho is a hosted SaaS); the integration pattern is documented at `plugins/memory/honcho/__init__.py:191-200`. Cost-awareness knobs at `__init__.py:325-336` (`injection_frequency`, `context_cadence`, `dialectic_cadence`, `dialectic_depth`, `reasoning_heuristic`, `reasoning_level_cap`).

### 2.7 Mem0 (extractive facts)

A memory API. Operations: `add(messages)`, `search(query, filters, top_k)`, `update(memory_id, data)`, `delete(memory_id)`, `get_all(user_id)` (per `round-7-bestof-deep/multi-agent-memory.md:352-355`).

The April 2026 algorithm is **single-pass ADD-only extraction** — *"one LLM call, no UPDATE/DELETE. Memories accumulate; nothing is overwritten"* (`round-7-bestof-deep/multi-agent-memory.md:355-356`). This is a major inversion: facts are append-only; conflicting memories are resolved at *retrieval time*, not at *write time*.

Sub-systems inside the new algorithm:
- **Entity linking** — entities are extracted, embedded, and linked across memories (`round-7-bestof-deep/multi-agent-memory.md:358`).
- **Multi-signal retrieval** — semantic + BM25 keyword + entity matching, scored in parallel and fused (`round-7-bestof-deep/multi-agent-memory.md:359`).
- **Temporal reasoning** — *"time-aware retrieval that ranks the right dated instance for queries about current state, past events, and upcoming plans"* (`round-7-bestof-deep/multi-agent-memory.md:360`).

Benchmarked retrieval quality (`round-7-bestof-deep/multi-agent-memory.md:364-369`):
| Benchmark | Old | New | Tokens | Latency p50 |
|---|---:|---:|---:|---:|
| LoCoMo | 71.4 | 91.6 | 7.0K | 0.88s |
| LongMemEval | 67.8 | 94.8 | 6.8K | 1.09s |
| BEAM (1M tokens) | — | 64.1 | 6.7K | 1.00s |
| BEAM (10M tokens) | — | 48.6 | 6.9K | 1.05s |

### 2.8 Letta (stateful agents)

The Letta SDK (`@letta-ai/letta-agent-sdk`) creates long-lived agents with persistent identity. Per `round-7-bestof-deep/multi-agent-memory.md:407`: *"Letta's hallmark is the memory blocks abstraction — typed, named, persistent units the agent can read and write to itself. The classic shapes: `persona`, `human`, `facts`, `conversation`. Each block has a label, a value, and a limit (character or token count)."*

Three runtimes (`round-7-bestof-deep/multi-agent-memory.md:401-403`):
1. **Letta Code** (`@letta-ai/letta-code`) — Node.js CLI; bundles pre-built skills/subagents.
2. **Letta Agent SDK** (`@letta-ai/letta-agent-sdk`) — TypeScript SDK; cloud/local/self-hosted backends.
3. **Letta V1 SDK** — legacy Python+TS SDKs targeting the API directly.

Storage: server-side (stateful across sessions). The `resumeSession` call rehydrates the full memory state.

### 2.9 claude-mem (file-based observation logs)

The dominant Claude Code plugin for memory (85.9k stars). Six pieces glue together (per `round-7-bestof-deep/multi-agent-memory.md:435-442`):
1. **5 Lifecycle Hooks** — `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, `SessionEnd`.
2. **Worker Service** — local HTTP API run under Bun; exposes `/search`, `/timeline`, `/get_observations`, and the web viewer UI.
3. **SQLite Database** — sessions, observations, summaries, FTS5-indexed.
4. **Chroma Vector Database** — hybrid semantic + keyword search.
5. **mem-search Skill** — natural-language query interface.
6. **Web Viewer UI** — real-time memory stream dashboard.

The 3-layer progressive-disclosure pattern (per `round-7-bestof-deep/multi-agent-memory.md:445-450`):
```
Layer 1: search         → compact index with IDs          (~50-100 tokens/result)
Layer 2: timeline       → chronological context           (cheap)
Layer 3: get_observations → full details for filtered IDs (~500-1,000 tokens/result)
```
*"~10x token savings by filtering before fetching details."* Three MCP tools ship: `search`, `timeline`, `get_observations`.

### 2.10 graphify (knowledge graph)

A local knowledge graph builder. Per `config/agents/_shared/AGENT_BASELINE.md`, Bizar uses graphify as part of the `.bizar/graph/` infrastructure. Status: `bizar graph status`, `bizar graph query "<concept>"`, `bizar graph path "<A>" "<B>"`, `bizar graph explain "<X>"`.

Schema: god nodes + community detection, plus a query/path/explain interface. The graph is rebuilt incrementally by the graphify binary when source files change.

### 2.11 Obsidian (markdown + wikilinks)

The human-readable durable archive. Per `round-7-bestof-deep/multi-agent-memory.md:721-722`: *"a human-readable archive (Obsidian + git)."* 

In Bizar's case, the Obsidian vault lives at `~/.bizar_memory/` (default per `memory-store.mjs:77`, though the live user data is at the legacy path `.local/share/bizar/memory`). OpenClaw's `memory-wiki` plugin is Obsidian-flavored: it compiles durable knowledge into a markdown vault with deterministic page structure, structured claim/evidence metadata, contradiction tracking, freshness tracking, generated dashboards, and compiled digests (`docs/concepts/memory.md:170-178`).

### 2.12 File system (raw markdown)

The simplest backend. Bizar's vault IS raw markdown + git. No schema beyond YAML frontmatter on each note. Tools write/read files directly. The file system is git-backed for collaboration; markdown is git-diff-friendly.

Trade-offs:
- **Pro:** Human-readable. Git-trackable. No vendor lock-in.
- **Con:** No vector search without LightRAG; no transaction guarantees; cross-project queries require manual aggregation.

---

## Section 3 — Indexing & Search Strategies

### 3.1 Full-Text Search (FTS5)

The workhorse. Used by:
- **Hermes** — `messages_fts` virtual table at `hermes_state.py:813-836`. Token count precomputed and stored. Trigram extension at `hermes_state.py:842-866` for CJK. WAL maintenance at `hermes_state.py:1226`.
- **OpenClaw** — `memory-core`'s hybrid engine (`extensions/memory-core/src/memory/hybrid.ts:32-39`):
  ```ts
  export function buildFtsQuery(raw: string): string | null {
    const tokens = normalizeStringEntries(raw.match(/[\p{L}\p{N}_]+/gu) ?? []);
    if (tokens.length === 0) return null;
    const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
    return quoted.join(" AND ");
  }
  ```
  CJK-friendly via Unicode property escapes `\p{L}` and `\p{N}` plus the optional `trigram` tokenizer at `memory-core/src/tokenize.ts` (per `docs/concepts/memory-builtin.md:18`: *"CJK support via trigram tokenization for Chinese, Japanese, and Korean."*).
- **claude-mem** — FTS5 over sessions + observations (`round-7-bestof-deep/multi-agent-memory.md:440`).

**Scoring:** SQLite FTS5's `rank` is negative (more relevant = more negative). OpenClaw's normalization at `hybrid.ts:41-50`:
```ts
export function bm25RankToScore(rank: number): number {
  if (!Number.isFinite(rank)) return 1 / (1 + 999);
  if (rank < 0) {
    const relevance = -rank;
    return relevance / (1 + relevance);
  }
  return 1 / (1 + rank);
}
```

### 3.2 Vector Similarity (embeddings)

The semantic complement. OpenClaw's hybrid engine combines vector hits with BM25 hits. The 10+ embedding providers documented at `docs/concepts/memory-builtin.md:67-79`:
- Bedrock, DeepInfra (default `BAAI/bge-m3`), Gemini (multimodal — image+audio), GitHub Copilot, LM Studio, Local, Mistral, Ollama, OpenAI (default `text-embedding-3-small`), OpenAI-compatible, Voyage.

Embedding generation is incremental — `reindexSingleNote` runs after each `bizar_memory_write` per `AGENTS_SELF_IMPROVEMENT.md:48` (lesson from v5.5.0): *"Auto-reindex on every note write keeps the LightRAG index current."*

### 3.3 Hybrid (BM25 + Vector + MMR + Temporal Decay)

The 2026 standard. OpenClaw's `mergeHybridResults` at `extensions/memory-core/src/memory/hybrid.ts:52-156`:

```ts
const merged = Array.from(byId.values()).map((entry) => {
  const score = params.vectorWeight * entry.vectorScore + params.textWeight * entry.textScore;
  return { ... entry, score };
});

// Apply temporal decay
const decayed = await applyTemporalDecayToHybridResults({
  results: merged,
  temporalDecay: temporalDecayConfig,
  workspaceDir: params.workspaceDir,
  nowMs: params.nowMs,
});
const sorted = decayed.toSorted((a, b) => b.score - a.score);

// Apply MMR re-ranking
if (mmrConfig.enabled) {
  return applyMMRToHybridResults(sorted, mmrConfig);
}
```

**MMR (Maximal Marginal Relevance):** Re-ranks to favor diversity. Configurable via `mmr.lambda` and `mmr.enabled`. Default config in `DEFAULT_MMR_CONFIG`.

**Temporal decay:** Recent memories rank higher. Configurable via `temporalDecay` (decay rate, half-life, etc.). Default config in `DEFAULT_TEMPORAL_DECAY_CONFIG`.

This four-stage pipeline (BM25 + vector → temporal decay → sort → MMR) is the single most influential idea in 2026 retrieval. Every modern memory backend implements some variant.

### 3.4 Knowledge Graph Traversal

OpenFang's `query_graph` at `knowledge.rs:82-188`:
```rust
pub fn query_graph(&self, pattern: GraphPattern) -> OpenFangResult<Vec<GraphMatch>> {
  // Builds SQL:
  // SELECT s.*, r.*, t.*
  // FROM relations r
  // JOIN entities s ON r.source_entity = s.id
  // JOIN entities t ON r.target_entity = t.id
  // WHERE 1=1
  //   AND (s.id = ? OR s.name = ?)   [if source set]
  //   AND r.relation_type = ?         [if relation set]
  //   AND (t.id = ? OR t.name = ?)    [if target set]
  // LIMIT 100
}
```

Notable behavior:
- **Source/Target matching**: matches both `id` AND `name`. Permissive but causes false positives (`round-5-openfang-deep/knowledge-graph.md:271`).
- **Relation filtering**: type is JSON-serialized before comparison (`round-5-openfang-deep/knowledge-graph.md:273`).
- **100 result cap**: hard limit; no pagination (`round-5-openfang-deep/knowledge-graph.md:274`).

### 3.5 Trigram (CJK Support)

For CJK substring search. Hermes's trigram FTS5 table at `hermes_state.py:842-866`:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_trigram USING fts5(
    content,
    tokenize='trigram'
);
```
Plus the same INSERT/UPDATE/DELETE trigger pattern as the standard FTS5 table. When the trigram tokenizer is missing (older SQLite builds), `hermes_state.py:1000-1013` falls back to standard FTS5 with a one-time log.

### 3.6 Temporal Decay

OpenFang's `ConsolidationEngine.consolidate()` at `consolidation.rs:27-53`:
```rust
let cutoff = (Utc::now() - chrono::Duration::days(7)).to_rfc3339();
let decay_factor = 1.0 - self.decay_rate as f64;
let decayed = conn.execute(
    "UPDATE memories SET confidence = MAX(0.1, confidence * ?1)
     WHERE deleted = 0 AND accessed_at < ?2 AND confidence > 0.1",
    rusqlite::params![decay_factor, cutoff],
);
```

Memories not accessed in 7 days get their confidence multiplied by `decay_factor` (default 0.9, configurable). Floor at 0.1 — memories never fully decay.

OpenClaw's temporal decay is different: it's a retrieval-time rank adjustment, not a write-time mutation. The same idea (recency boosts) implemented differently.

### 3.7 Re-Ranking

Mem0's "new memory algorithm" includes explicit rerank (`round-7-bestof-deep/multi-agent-memory.md:381`): *"Rerank is available on search."* The Hermes Mem0 plugin surfaces `rerank=true` as a tool parameter at `plugins/memory/mem0/__init__.py:144`:
```python
"rerank": {"type": "boolean", "description": "Enable reranking for recall", "default": "true"},
```

The Claude-mem progressive-disclosure pattern (`search` → `timeline` → `get_observations`) is a different kind of rerank — agents re-rank by deciding which IDs to fetch.

---

## Section 4 — Memory Triggers

When does the agent update its memory? The 2026 catalog exposes eight trigger types.

### 4.1 End of Turn (every turn)

**Hermes:** `MemoryManager.sync_all(user_content, assistant_content, session_id, messages)` at `agent/memory_manager.py:558-614`. Called after every turn completes. **Critically, runs on a background worker thread, NOT inline on the turn-completion path** (`memory_manager.py:566-577`). A slow or wedged provider can never stall the turn.

Per the comment at `memory_manager.py:566-577`: *"A provider's sync_turn may make a blocking network/daemon call (a misconfigured Hindsight daemon was observed blocking ~298s before failing); doing that inline held run_conversation open long after the user saw their response."*

**Mem0:** Per the plugin's `sync_turn` at `plugins/memory/mem0/__init__.py:411-435`. Uses a background `_sync_thread`.

### 4.2 End of Session (conversation close)

**OpenClaw memory-core:** Pre-compaction flush (`extensions/memory-core/src/flush-plan.ts:97-142`). When the session nears auto-compaction, a memory flush turn runs that captures durable memories to disk. Per `flush-plan.ts:27-34`:
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

**Hermes Honcho:** `on_session_end(messages)` at `plugins/memory/honcho/__init__.py:166-174`. Default no-op; providers override to do end-of-session fact extraction.

**Bizar:** `memory-write-on-end.ts:163-187` — fires on `session.idle` or `session.error` events. Writes an automated session summary note to `sessions/<date>-<session-id>.md`.

### 4.3 Periodic (every N turns or M minutes)

**Hermes Curator:** `agent/curator.py` runs after the agent has been idle for `curator_idle_threshold_seconds` (default 300) per `round-4-hermes-deep/learning-loop.md:53`. Inactivity gate, auto-transition gate.

The closed learning loop documented at `round-4-hermes-deep/learning-loop.md:25-27`:
```
Conversation → Curator → FTS5 Index → Honcho Recall → LLM Summarization → Skill Auto-Creation → Future Sessions
```

### 4.4 Idle (Hermes Curator)

Same as above. The Hermes Curator is the canonical "idle" trigger — it doesn't interrupt active work; it fires only when the agent transitions to idle.

### 4.5 On Event (memory nudge)

**OpenFang's `event_publish`:** The TriggerEngine pattern matching allows Hands to coordinate reactively. A Hand can publish an event ("company X announced funding") and another Hand with a matching trigger activates. Per `round-5-openfang-deep/knowledge-graph.md:426-427`: *"event_publish + TriggerEngine pattern matching allows Hands to coordinate reactively. But this is event-driven, not graph-driven."*

**OpenClaw's `auto-recall` / `auto-capture`:** The memory-lancedb plugin's lifecycle hooks run on relevant events — captures tool outputs, surfaces relevant vectors.

### 4.6 On Tool Call (capture tool outputs)

**claude-mem:** `PostToolUse` hook (one of the 5 lifecycle hooks per `round-7-bestof-deep/multi-agent-memory.md:437`). Captures tool observations and runs AI summarization. The observation becomes a row in SQLite.

### 4.7 Explicit (user asks "remember this")

**Honcho `conclude`:** *"You MUST pass exactly one of: `conclusion` (to create) or `delete_id` (to delete)"* (`plugins/memory/honcho/__init__.py:158-161`). Explicit user-driven fact persistence.

**Mem0 `add`:** *"Store a durable fact about the user, verbatim (no LLM extraction). Call this the moment the user states a lasting preference, correction, decision, or personal detail worth recalling on future turns — don't wait to be asked to remember."* (`plugins/memory/mem0/__init__.py:150-166`).

### 4.8 Auto-Extracted (Mem0 pattern)

**Mem0:** The `add(messages)` operation extracts facts automatically via an LLM call. The schema docs: *"Server-side LLM fact extraction, semantic search, and automatic deduplication"* (`plugins/memory/mem0/__init__.py:3`).

**Honcho dialectic:** Auto-generated peer cards from conversation summaries. Two cards per session: *"Affirmative card ('what worked'): summarizes successful tool sequences... Critical card ('what failed'): summarizes failures, workarounds that succeeded, missing skills"* (`round-4-hermes-deep/learning-loop.md:391-395`).

### Comparison Table — Trigger Strategies

| Trigger | Hermes | OpenFang | OpenClaw | Mem0 | Honcho | claude-mem |
|---|---|---|---|---|---|---|
| **End of turn** | ✓ sync_all | partial | — | ✓ | — | — |
| **End of session** | ✓ on_session_end | ✓ save_session | ✓ flush-plan | — | ✓ conclude | ✓ SessionEnd hook |
| **Periodic** | ✓ Curator | — | ✓ cron dreaming | — | — | — |
| **Idle** | ✓ Curator | — | — | — | — | — |
| **On event** | — | ✓ event_publish | ✓ auto-recall/capture | — | — | ✓ PostToolUse |
| **On tool call** | — | — | partial | — | — | ✓ PostToolUse |
| **Explicit** | ✓ honcho_conclude | — | — | ✓ mem0_add | ✓ honcho_conclude | — |
| **Auto-extracted** | ✓ Honcho dialectic | — | — | ✓ mem0_add | ✓ Honcho | — |

The Mem0 + Honcho + claude-mem trio is the only one that combines explicit, auto-extracted, and event-driven triggers. Hermes gets all but on-event and on-tool-call. OpenClaw gets the pre-compaction flush but no continuous capture. OpenFang gets event-driven but no end-of-session extraction.

---

## Section 5 — Compaction & Compression

How do systems prevent context overflow?

### 5.1 Sliding Window (keep last N turns)

**Bizar:** `plugins/bizar/src/compaction.mjs:49-53`:
```js
export function shouldCompact(usage, maxContext) {
  // ...
  return ratio >= compactionThreshold;
}
```
Threshold is 0.5 by default (`compaction.mjs:36`: `let compactionThreshold = 0.5`). `maybeCompactSession()` runs compaction with `preserve_recent=10` (per `AGENTS_SELF_IMPROVEMENT.md:116` v5.0.1 lesson: *"Compaction at 50% context. New plugins/bizar/src/compaction.mjs built from scratch. shouldCompact() returns true at 50% usage. setCompactionThreshold() configurable 0.1-1.0. maybeCompactSession() triggers compaction with preserve_recent=10."*).

### 5.2 Summarization (LLM summarizes older turns)

**Hermes:** Context compression with `on_pre_compress` hook (`agent/memory_manager.py:834-848`). Providers receive the messages about to be compressed and contribute text to the compression summary prompt. The compressor itself is in `agent/context_compressor.py` (referenced from `memory_provider.py:220-230`).

The provider interface at `memory_provider.py:220-230`:
```python
def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
    """Called before context compression discards old messages.
    Use to extract insights from messages about to be compressed.
    messages is the list that will be summarized/discarded.
    Return text to include in the compression summary prompt so the
    compressor preserves provider-extracted insights. Return empty
    string for no contribution (backwards-compatible default).
    """
    return ""
```

**OpenClaw:** Pre-compaction memory flush (`flush-plan.ts:97-142`). Before compaction, a memory flush turn runs to capture durable memories to disk. The flush model can be overridden (e.g., a cheaper local model). Per `docs/concepts/memory.md:212-216`: *"If your agent has important facts in the conversation that are not yet written to a file, they are saved automatically before the summary happens."*

### 5.3 Knowledge Extraction (Mem0 pulls facts out)

**Mem0:** Single-pass ADD-only extraction on `add()`. The extracted facts are returned as a list of `Memory` objects with their `id`. Per the README's "New Memory Algorithm" table (`round-7-bestof-deep/multi-agent-memory.md:364-369`), the fact extractor runs once per add call — no agentic loops, no multi-step reasoning.

### 5.4 Knowledge Graph (replace verbose with entity refs)

**OpenFang:** The `KnowledgeStore` is the substitute for verbose references. Once an entity is added (e.g., `Acme Corp` as an `Organization`), future conversations can refer to it by ID rather than re-stating its full description. The graph serves as the compression artifact.

### 5.5 Forgetting (drop low-importance)

**OpenFang's `ConsolidationEngine`:** Decays confidence on memories not accessed in 7 days (`consolidation.rs:34-44`). Floor at 0.1 — memories never fully decay, but their score drops.

**Hermes' Curator auto-archive:** Auto-archives skills with `archived` state when stale. Per the AGENTS.md: *"background skill-maintenance system that tracks usage on agent-created skills and auto-archives stale ones. Users never lose skills; archives go to `~/.hermes/skills/.archive/` and are restorable."*

### 5.6 Pruning (RAG over full history)

**OpenClaw:** The hybrid engine ranks the entire vault by relevance, returns top-K. The agent reads only what was returned. This is the inverse of compaction — instead of summarizing, you search.

**Bizar's RAG approach:** LightRAG indexes the entire vault; semantic search returns top-K on demand. No proactive compaction of the vault itself.

### Compaction Comparison

| Approach | Hermes | OpenFang | OpenClaw | Bizar | Mem0 | Honcho |
|---|---|---|---|---|---|---|
| **Sliding window** | ✓ partial | ✓ partial | ✓ partial | ✓ preserve_recent=10 | — | — |
| **Summarization** | ✓ compressor | — | — | — | — | ✓ dialectic |
| **Knowledge extraction** | ✓ Honcho conclude | — | ✓ flush | — | ✓ add | ✓ conclude |
| **Knowledge graph** | — | ✓ entity refs | — | — | ✓ entity linking | — |
| **Forgetting** | ✓ archive | ✓ consolidation | — | — | — | — |
| **Pruning (RAG)** | — | — | ✓ hybrid search | ✓ LightRAG | ✓ search | ✓ search |

The most-overlooked technique is **dialectic summarization** (Honcho): instead of summarizing the transcript, the system summarizes "what worked vs what didn't" — a peer card that is fundamentally different from a transcript summary.

---

## Section 6 — Cross-Session Continuity

How does the agent remember across sessions?

### 6.1 File-Based Session Logs

**OpenClaw:** Sessions stored as JSON Lines at `~/.openclaw/agents/<agentId>/sessions/`. Per `docs/concepts/multi-agent.md:9-25`, each agent has its own session store.

**Hermes:** SQLite-based sessions with full `messages` table (`hermes_state.py:748-768`). Every message has `session_id`, `role`, `content`, `tool_calls`, `reasoning`, etc.

**Bizar:** opencode's session log (managed by opencode itself, not by Bizar's plugin). Bizar writes a session summary to `sessions/YYYY-MM-DD-<session-id>.md` at session end via `memory-write-on-end.ts:104-152`.

### 6.2 Vector Search Over Session Embeddings

**claude-mem:** Sessions captured → AI-compressed observations → indexed in Chroma vector DB. Per `round-7-bestof-deep/multi-agent-memory.md:441`: *"Chroma Vector Database — hybrid semantic + keyword search for retrieval."*

**OpenClaw memory-lancedb:** `auto-recall` surfaces relevant session vectors into the agent's prompt.

### 6.3 Knowledge Graph Accumulation

**OpenFang:** The `entities` + `relations` graph is cumulative — every Hand's Phase 4 contribution adds to it. Per `round-5-openfang-deep/knowledge-graph.md:402-405`: *"The knowledge graph is the only cross-Hand persistent state mechanism that doesn't require explicit file-based coordination. All six Einstein Hands access the same entities and relations tables."*

Cross-Hand patterns enabled (`round-5-openfang-deep/knowledge-graph.md:412-416`):
- Collector → Lead: Collector builds company/person entities. Lead queries them when scoring leads.
- Collector → Predictor: Collector tracks market/technology events. Predictor queries them as signals.
- Researcher → any Hand: Researcher stores source entities. Other Hands can query for domain knowledge.
- Lead → Collector: Lead's ICP stored in KG. Collector can use it as a focus filter.

### 6.4 Skill Accumulation (Hermes)

The Hermes closed learning loop. Per `round-4-hermes-deep/learning-loop.md:316-330`:
1. Skill authored → written to `.agents/skills/<slug>/SKILL.md`
2. Next session starts → `skills/` directory scanned at startup
3. Skill loaded → `skill_usage.py` registers it as `active`
4. Skill used → telemetry flows through `maybe_run_curator()`
5. Curator reviews → sees the skill was used, updates its `active` state and hit count
6. Skill refined → if the skill's recommendations are followed but still produce failures, the Curator notes the pattern and can trigger a revision (incrementing the version in frontmatter)

The trigger for skill auto-creation is at `agent/curator.py`: *"The Curator triggers auto-creation via `skill_auto_create()` when all of the following are true: (1) A capability gap is detected, (2) The gap has appeared in at least `curator_min_pattern_frequency` distinct sessions (default: 3), (3) The most recent session involving the gap ended without a workaround, (4) `curator_auto_create_skills: true` in config."*

### 6.5 User Profile Accumulation (Honcho Dialectic)

Honcho's `conclude` tool writes persistent peer cards. Per the schema at `plugins/memory/honcho/__init__.py:155-181`: *"Conclusions are persistent facts that build a peer's profile."* Honcho's retrieval (`honcho_search`, `honcho_reasoning`) returns facts ranked by relevance.

The dialectic method (per `round-4-hermes-deep/learning-loop.md:391-395`):
- **Affirmative card** ("what worked"): successful tool sequences, effective prompts, correct tool parameterizations.
- **Critical card** ("what failed"): failures, workarounds that succeeded, missing skills.

The two cards together form a **peer card** for that session. Peer cards are the unit of long-term memory storage.

### Cross-Session Continuity Comparison

| Approach | Hermes | OpenFang | OpenClaw | Bizar | Mem0 | Honcho | claude-mem |
|---|---|---|---|---|---|---|---|
| **File logs** | ✓ SQLite | ✓ msgpack | ✓ JSONL | partial | — | — | ✓ SQLite |
| **Vector search** | ✓ FTS5+trigram | — | ✓ LanceDB | ✓ LightRAG | ✓ semantic | ✓ semantic | ✓ Chroma |
| **Knowledge graph** | — | ✓ entities+relations | — | ✓ graphify | ✓ entity linking | — | — |
| **Skill accumulation** | ✓ Curator | — | — | — | — | — | — |
| **User profile** | ✓ Honcho | partial | — | — | ✓ peer cards | ✓ peer cards | ✓ observations |

The skill accumulation pattern is unique to Hermes. The user profile pattern is shared by Honcho + Mem0. The knowledge graph pattern is unique to OpenFang (and partially to Mem0 via entity linking).

---

## Section 7 — User Modeling

How systems model the user across sessions.

### 7.1 Honcho Dialectic (Hermes)

The Honcho provider's four core tools (`plugins/memory/honcho/__init__.py:36-184`):

```python
PROFILE_SCHEMA = {
    "name": "honcho_profile",
    "description": "Retrieve or update a peer card from Honcho — a curated list of key facts about that peer (name, role, preferences, communication style, patterns).",
    "parameters": {
        "type": "object",
        "properties": {
            "peer": {"type": "string", "description": "Peer to query. Built-in aliases: 'user' (default), 'ai'."},
            "card": {"type": "array", "items": {"type": "string"}, "description": "New peer card as a list of fact strings. Omit to read the current card."},
        },
    },
}
```

**Cost-awareness knobs** at `__init__.py:325-336`:
- `injection_frequency` — every-turn or first-turn
- `context_cadence` — minimum turns between context API calls
- `dialectic_cadence` — backwards-compat fallback; wizard writes 2 on new configs
- `dialectic_depth` — how many `.chat()` calls per dialectic cycle (1-3)
- `reasoning_heuristic` — scale base level by query length
- `reasoning_level_cap` — ceiling for auto-selected level ("high" by default)

### 7.2 Letta Persona Layer

Per `round-7-bestof-deep/multi-agent-memory.md:407`: *"Letta's hallmark is the memory blocks abstraction — typed, named, persistent units the agent can read and write to itself. The classic shapes: `persona`, `human`, `facts`, `conversation`."*

The `human` block grows with what the agent learns about the user; the `persona` block evolves the agent's identity. Each block has a character or token limit, forcing the agent to decide what to write and what to forget.

### 7.3 claude-mem User Observations

Claude-mem captures user statements via the `PostToolUse` hook. Per `round-7-bestof-deep/multi-agent-memory.md:455-456`: *"three layers: session-level (transient, per Claude Code session), observation-level (per tool-use event with AI-generated summary), summary-level (cross-session compressed semantic memory)."*

The user model is implicit — the AI-generated summaries capture user behavior, but there's no first-class persona layer.

### 7.4 Mem0 User Preferences

Mem0's `add(messages)` extracts facts automatically. Per `round-7-bestof-deep/multi-agent-memory.md:381`: *"ALWAYS call mem0_search before answering anything that could depend on what you know about the user (preferences, facts, history, people, projects, past decisions)."*

The append-only design means user preferences accumulate over time without ever being overwritten. Conflicting preferences are resolved at retrieval time (the most recent dated fact wins).

### 7.5 Profile Accumulation Patterns

**Honcho:** Dialectic Q&A at session end. Affirmative + Critical cards → peer card.

**Mem0:** Single-pass ADD-only. Facts accumulate, never overwritten.

**Letta:** Self-editing memory blocks. The agent decides what to write/keep/forget.

**claude-mem:** Observation capture. AI-generated summaries.

**Bizar:** None. Bizar has no first-class user model.

---

## Section 8 — The Memory Anti-Patterns

What goes wrong?

### 8.1 Context Overflow (token limit hit)

**Cause:** Working memory grows beyond the model's context window.
**Symptoms:** Trauncated responses, lost context, tool calls that don't make sense.
**Mitigation:**
- Hermes: `on_pre_compress` hook (`memory_provider.py:220-230`) lets providers contribute to the compression summary.
- OpenClaw: Pre-compaction flush (`flush-plan.ts:97-142`).
- Bizar: `shouldCompact()` at 50% usage (`compaction.mjs:49-53`).

### 8.2 Conflicting Memories

**Cause:** Two sources disagree on a fact (e.g., "Alice's role is X" vs. "Alice's role is Y").
**Symptoms:** Agent retrieves wrong info, contradicts itself.
**Mitigation:**
- Mem0: Append-only design (`round-7-bestof-deep/multi-agent-memory.md:355-356`). Resolution at retrieval time.
- Honcho: *"Honcho self-heals incorrect conclusions over time"* (`plugins/memory/honcho/__init__.py:161`).
- OpenFang: Confidence field on relations (`memory.rs:156-171`); higher-confidence relations win.

### 8.3 Stale Memories

**Cause:** User preferences change but old facts remain.
**Symptoms:** Agent applies outdated preferences.
**Mitigation:**
- Mem0: Temporal reasoning — *"time-aware retrieval that ranks the right dated instance for queries about current state"* (`round-7-bestof-deep/multi-agent-memory.md:360`).
- OpenFang: ConsolidationEngine decays confidence (`consolidation.rs:34-44`).
- Honcho: `delete_id` for explicit deletion of stale facts (`plugins/memory/honcho/__init__.py:155-181`).
- OpenClaw: Dreaming sweeps — *"background consolidation pass... phased summary and diary entries are written to DREAMS.md for human review"* (`docs/concepts/memory.md:218-233`).

### 8.4 Privacy Violations (memory leaks across users)

**Cause:** User A's memory leaks to User B's session.
**Symptoms:** One user sees another's personal facts.
**Mitigation:**
- Hermes: Profile-scoped storage via `get_hermes_home()` (`AGENTS.md` rule 1: *"Use get_hermes_home() for all HERMES_HOME paths"*). Each profile has isolated `HERMES_HOME`. Honcho's peer-key isolation.
- OpenClaw: Per-agent database isolation (`docs/concepts/multi-agent.md:9-25`).
- Bizar: No first-class user model yet — risk is latent.

### 8.5 Compaction Loss (key info dropped during compression)

**Cause:** Compression summarizer drops critical details.
**Symptoms:** Agent forgets things it shouldn't.
**Mitigation:**
- Hermes: Pre-compress hooks let providers extract before discard (`memory_provider.py:220-230`).
- OpenClaw: Flush before compaction captures durable memories to disk (`flush-plan.ts:97-142`).
- Bizar: `preserve_recent=10` keeps the last 10 turns intact (`AGENTS_SELF_IMPROVEMENT.md:116`).

### 8.6 Memory Poisoning (injection via retrieved memory)

**Cause:** Attacker stores malicious content in memory, which the agent later retrieves and follows.
**Symptoms:** Agent executes malicious instructions.
**Mitigation:**
- claude-mem: `<private>` tags exclude sensitive content (`round-7-bestof-deep/multi-agent-memory.md:455`).
- Hermes: Bizar's BUILT-IN memory validation in `memory-secrets.mjs`.
- OpenFang: Confidence scoring makes poisoned memories decay.

### 8.7 Infinite Memory Growth (no decay)

**Cause:** Memory grows forever; eventually retrieval becomes expensive.
**Symptoms:** Slow searches, large storage costs.
**Mitigation:**
- OpenFang: 7-day decay + floor at 0.1 (`consolidation.rs:34-44`).
- Hermes: Stale skill auto-archive (`agent/curator.py`).
- OpenClaw: Dreaming sweeps consolidate (`docs/concepts/memory.md:218-233`).

### 8.8 Search Returning Noise (over-recall)

**Cause:** Hybrid search returns too many low-relevance hits.
**Symptoms:** Agent reads irrelevant context; tokens wasted.
**Mitigation:**
- OpenClaw: MMR re-ranking favors diversity (`hybrid.ts:149-153`).
- claude-mem: 3-layer progressive disclosure — agents decide which IDs to fetch (`round-7-bestof-deep/multi-agent-memory.md:445-450`).
- Mem0: `top_k` parameter limits results (`plugins/memory/mem0/__init__.py:143`).
- OpenFang: 100-result cap (`knowledge.rs:123`).

---

## Section 9 — Master Comparison Table

| Dimension | Hermes | OpenFang | OpenClaw | Bizar | Mem0 | Letta | Honcho | claude-mem |
|---|---|---|---|---|---|---|---|---|
| **Working memory** | messages array | Vec\<Message\> | messages array | opencode runtime | n/a | n/a | n/a | n/a |
| **Session memory** | SQLite+FTS5+trigram | msgpack BLOB | per-agent SQLite | opencode session log | — | — | peer cards | SQLite + Chroma |
| **Project memory** | FTS5 over sessions | entities + relations | MEMORY.md + daily notes | vault + LightRAG | optional add() | memory blocks | peer cards | observations |
| **User memory** | Honcho dialectic | entities (Person) | — | — | ✓✓ append-only | ✓ persona/human | ✓✓ dialectic | ✓ observations |
| **World memory** | — | ✓ entities+relations | LightRAG index | ✓ graphify | ✓ entity linking | — | — | — |
| **Storage** | SQLite | SQLite | SQLite + LanceDB | markdown + git | pgvector/Qdrant | server-side | hosted | SQLite+Chroma |
| **Index** | FTS5+trigram | none (graph only) | BM25+vector+MMR | FTS+vector | hybrid | n/a | n/a | FTS5+Chroma |
| **Search** | FTS5, BM25 | GraphPattern | hybrid (4-stage) | LightRAG | multi-signal | n/a | semantic | progressive disclosure |
| **End-of-turn sync** | ✓ bg | — | — | — | ✓ bg | ✓ resumeSession | — | — |
| **End-of-session** | ✓ on_session_end | ✓ save_session | ✓ flush | ✓ on session.idle | — | ✓ server-side | ✓ conclude | ✓ SessionEnd |
| **Periodic/idle** | ✓ Curator | — | ✓ dreaming | — | — | — | — | — |
| **Auto-extraction** | ✓ Honcho | — | — | — | ✓ add() | — | ✓ dialectic | ✓ observation |
| **Compaction** | ✓ compressor | — | ✓ pre-flush | ✓ 50% threshold | — | ✓ memory blocks | ✓ dialectic | ✓ |
| **Decay** | — | ✓ 7-day | — | — | — | — | — | — |
| **Deduplication** | — | ✗ | — | — | ✓ append-only | — | — | — |
| **Anti-pattern guards** | profile isolation | — | — | path safety (memory-store.mjs:175-199) | — | — | peer scoping | private tags |
| **License** | MIT (open-core) | MIT | MIT | — | Apache-2.0 | Apache-2.0 | (hosted) | Apache-2.0 |
| **Stars** | 5k+ | 1k+ | 6k+ | — | 60.1k | 23.7k | n/a | 85.9k |

The table tells a story: **no system covers all five tiers uniformly**. Hermes + Honcho covers session + user + working. OpenFang covers working + session + project + world (via the graph). OpenClaw covers working + session + project + world (via LightRAG + LanceDB). Mem0 + claude-mem + Letta each specialize in one tier (Mem0 = user, claude-mem = session, Letta = identity).

---

## Section 10 — 2026 Convergence: Where Memory Architecture Is Heading

The four round-7/8 deep dives + this round-9 study converge on five trends.

### 10.1 RAG-Over-History is Becoming Standard

Every modern memory layer implements some form of RAG over its full history. The hybrid retrieval pipeline (BM25 + vector → temporal decay → MMR) is the de facto standard. Per `round-7-bestof-deep/multi-agent-memory.md:721`: *"The progressive-disclosure pattern (claude-mem's three MCP tools) is also generalizable."*

The implication: **don't summarize first; search second.** The opposite pattern — "compress everything to a summary, then read the summary" — is being replaced by "index everything, then search."

### 10.2 Knowledge Graphs Are the Next Layer

OpenFang ships a knowledge graph in production. Mem0 ships entity linking. Bizar ships graphify. The 2026 stack has a graph layer between the LLM and the indexed data.

The graph's role is not to replace RAG — it's to **add a structural layer** that lets the agent reason about relationships, not just similar text. *"Acme Corp invested in Startup X" is a fact the graph can represent, but BM25+vector cannot.*

OpenFang's limitations (no multi-hop, no transactions) are 2026 limitations — 2027 will see hosted graph backends with multi-hop traversal. The graph-as-SQLite pattern will give way to the graph-as-Neo4j/Memgraph pattern once query expressiveness becomes a bottleneck.

### 10.3 Honcho-Style Dialectic for Personalization

The Honcho dialectic pattern (affirmative + critical cards → peer card) is unique in 2026. Per `round-4-hermes-deep/learning-loop.md:389-396`: *"The dialectic works by generating two sides of a conversation from the same session... The two cards together form a peer card for that session. Peer cards are the unit of long-term memory storage."*

The advantage over plain summarization: peer cards encode **what worked AND what failed**, not just "what happened." This is denser signal for downstream retrieval.

The disadvantage: cost — the Honcho provider's `_LEVEL_ORDER` and `reasoning_level_cap` knobs (`__init__.py:337-338`) suggest the LLM calls are expensive.

### 10.4 Memory as a Separate Product (Mem0, Letta)

Both Mem0 and Letta are standalone products with their own APIs. The pattern: memory is **not** a feature of the agent framework; it's a service.

The trade-off: simplicity (just call `memory.add()` / `memory.search()`) vs. lock-in (your facts are in someone else's database). Mem0's self-hosted mode (`round-7-bestof-deep/multi-agent-memory.md:389`) and Letta's three-mode deployment (`round-7-bestof-deep/multi-agent-memory.md:412`) are both responses to this trade-off.

### 10.5 File-System-as-Memory (Obsidian-style)

Obsidian + git is the most common durable archive pattern. Per `round-7-bestof-deep/multi-agent-memory.md:721-722`: *"a human-readable archive (Obsidian + git)."*

The advantage: human-readable, git-diff-friendly, no vendor lock-in. The disadvantage: no built-in search without an index layer (LightRAG, etc.).

The 2026 stack combines this with everything else: **Mem0 + Obsidian + LightRAG + Claude-mem** is a viable four-product stack that covers all four memory surfaces (working, session, long-term facts, identity).

---

## Section 11 — Key Findings for Bizar's Redesign

The deep study surfaces these patterns relevant to Bizar:

1. **The 5-tier hierarchy is universal.** Every system implements some subset. Bizar should explicitly model all five tiers in `.bizar/memory.json` rather than the current flat structure.

2. **The hybrid retrieval pipeline is the standard.** BM25 + vector + MMR + temporal decay is what every 2026 system implements. Bizar's LightRAG covers this; the gap is the in-process tier (Bizar's agents don't have their own working-memory compaction).

3. **The end-of-session trigger is missing in Bizar.** `memory-write-on-end.ts` writes a session summary, but doesn't run an LLM extraction pass. Mem0 + Honcho do this; Bizar should add it.

4. **The knowledge graph is the differentiator.** OpenFang and graphify both have it; Bizar has `.bizar/graph/graph.json` (23,112 lines) but doesn't expose it as a queryable memory surface to agents.

5. **The dialectic pattern is rare.** Honcho is the only system that does affirmative + critical peer cards. Bizar's `AGENTS_SELF_IMPROVEMENT.md` could become dialectic by separating "what worked" from "what failed" lessons.

6. **The skill accumulation pattern is unique to Hermes.** Per `round-4-hermes-deep/learning-loop.md:316-330`, Hermes auto-creates skills from Curator patterns. Bizar has skills but doesn't auto-create them. The `bizar memory search` tool could surface pattern frequency and propose skill creation.

7. **User modeling is the biggest gap.** Bizar has a `users/drb0rk` namespace in `.bizar/memory.json` but no first-class user profile. Honcho/Mem0/Letta all do this; Bizar should pick one and integrate.

These findings drive the redesign in `round-9-memory/bizar-memory-redesign.md`.

---

## Section 12 — Source Citation Index

All claims in this document trace to specific files. The index below groups citations by source repo.

### Hermes

- `agent/memory_provider.py` — `MemoryProvider` ABC (8 lifecycle methods + 7 optional hooks)
- `agent/memory_manager.py:558-614` — `sync_all` runs on background worker (NOT inline)
- `agent/memory_manager.py:495-515` — `prefetch_all` collects provider context
- `agent/memory_manager.py:834-848` — `on_pre_compress` hook
- `plugins/memory/honcho/__init__.py:36-184` — five tool schemas
- `plugins/memory/honcho/__init__.py:191-200` — `HonchoMemoryProvider` class
- `plugins/memory/honcho/__init__.py:325-336` — cost-awareness knobs
- `plugins/memory/mem0/__init__.py:110-200` — Mem0 tool schemas
- `plugins/memory/mem0/__init__.py:206-296` — `Mem0MemoryProvider` class
- `hermes_state.py:695-856` — `SCHEMA_SQL` + FTS5 virtual table
- `hermes_state.py:842-866` — Trigram FTS5 table for CJK
- `hermes_state.py:130` — `MAX_FTS5_QUERY_CHARS = 2_048`

### OpenFang

- `crates/openfang-memory/src/lib.rs` — three storage backends
- `crates/openfang-memory/src/knowledge.rs:17-19` — `KnowledgeStore`
- `crates/openfang-memory/src/knowledge.rs:28-51` — `add_entity` (with upsert)
- `crates/openfang-memory/src/knowledge.rs:54-80` — `add_relation` (insert-only)
- `crates/openfang-memory/src/knowledge.rs:82-188` — `query_graph` SQL JOIN
- `crates/openfang-memory/src/migration.rs:75-185` — schema v1
- `crates/openfang-memory/src/migration.rs:150-172` — entities + relations tables
- `crates/openfang-memory/src/migration.rs:170-172` — three relation indexes
- `crates/openfang-memory/src/consolidation.rs:27-53` — `consolidate()` with 7-day decay
- `crates/openfang-memory/src/session.rs:14-25` — `Session` struct
- `crates/openfang-memory/src/session.rs:78-101` — `save_session` msgpack serialization
- `crates/openfang-memory/src/semantic.rs:56-129` — `remember` and `remember_with_embedding`
- `crates/openfang-memory/src/semantic.rs:172-200` — `recall` with fallback chain
- `crates/openfang-memory/src/structured.rs:22-66` — KV store
- `crates/openfang-memory/src/substrate.rs:30-38` — `MemorySubstrate`
- `crates/openfang-memory/src/substrate.rs:52-53` — WAL pragma
- `crates/openfang-types/src/memory.rs:132-154` — `EntityType` enum
- `crates/openfang-types/src/memory.rs:156-171` — `Relation` struct
- `crates/openfang-types/src/memory.rs:173-199` — `RelationType` enum
- `crates/openfang-types/src/memory.rs:201-212` — `GraphPattern` query filter
- `crates/openfang-runtime/src/tool_runner.rs:2041-2067` — `tool_knowledge_add_entity`
- `crates/openfang-runtime/src/tool_runner.rs:2069-2103` — `tool_knowledge_add_relation`
- `crates/openfang-runtime/src/tool_runner.rs:2105-2140` — `tool_knowledge_query`

### OpenClaw

- `extensions/memory-core/index.ts:57-67` — `MemorySearchSchema`
- `extensions/memory-core/index.ts:69-79` — `MemoryGetSchema`
- `extensions/memory-core/src/prompt-section.ts:4-39` — recall prompt builder
- `extensions/memory-core/src/flush-plan.ts:27-34` — `DEFAULT_MEMORY_FLUSH_PROMPT`
- `extensions/memory-core/src/flush-plan.ts:97-142` — `buildMemoryFlushPlan`
- `extensions/memory-core/src/memory/hybrid.ts:32-39` — `buildFtsQuery`
- `extensions/memory-core/src/memory/hybrid.ts:41-50` — `bm25RankToScore`
- `extensions/memory-core/src/memory/hybrid.ts:52-156` — `mergeHybridResults` (4-stage pipeline)
- `extensions/memory-lancedb/index.ts:1-7` — `memory_recall` + auto-recall/auto-capture hooks
- `extensions/memory-wiki/index.ts:43-62` — five wiki tools
- `docs/concepts/memory.md:11-25` — three memory layers (MEMORY.md / daily / DREAMS)
- `docs/concepts/memory.md:120-126` — user-facing tool surface
- `docs/concepts/memory.md:178-179` — wiki does NOT replace active memory plugin
- `docs/concepts/memory.md:212-216` — pre-compaction flush behavior
- `docs/concepts/memory.md:218-233` — dreaming (background consolidation)
- `docs/concepts/memory.md:248-265` — `rem-backfill` CLI
- `docs/concepts/memory-builtin.md:9-11` — per-agent SQLite
- `docs/concepts/memory-builtin.md:18-19` — CJK + sqlite-vec
- `docs/concepts/memory-builtin.md:67-79` — 10+ embedding providers
- `docs/concepts/multi-agent.md:9-25` — per-agent state directories
- `src/agents/tool-policy-pipeline.ts:38-46` — `ToolPolicyPipelineStep`
- `src/agents/tool-policy-pipeline.ts:57-72` — six-layer pipeline

### Bizar

- `.bizar/PROJECT.md:11-46` — stack + architecture
- `.bizar/PROJECT.md:133-140` — current memory section
- `.bizar/AGENTS_SELF_IMPROVEMENT.md` — 1231 lines of lessons log
- `.bizar/memory.json:1-37` — current memory config
- `plugins/bizar/src/tools/memory-search.ts:144-228` — `createMemorySearchTool`
- `plugins/bizar/src/tools/memory-write.ts` — `bizar_memory_write`
- `plugins/bizar/src/tools/memory-read.ts` — `bizar_memory_read`
- `plugins/bizar/src/tools/memory-list.ts` — `bizar_memory_list`
- `plugins/bizar/src/hooks/memory-write-on-end.ts:104-152` — session-end summary write
- `plugins/bizar/src/hooks/memory-write-on-end.ts:163-187` — `createMemoryWriteOnEnd`
- `plugins/bizar/src/compaction.mjs:36-155` — `shouldCompact()` + `setCompactionThreshold()`
- `bizar-dash/src/server/memory-store.mjs:77` — `DEFAULT_MEMORY_VAULT`
- `bizar-dash/src/server/memory-store.mjs:85` — `LEGACY_MEMORY_VAULT`
- `bizar-dash/src/server/memory-store.mjs:116-148` — `ensureVaultExists`
- `bizar-dash/src/server/memory-store.mjs:175-199` — `resolveSafe` (path safety)
- `bizar-dash/src/server/memory-store.mjs:308-321` — namespace root resolution
- `bizar-dash/src/server/memory-store.mjs:505-558` — `writeNote`
- `bizar-dash/src/server/memory-store.mjs:625-668` — `searchVault` (FTS)
- `bizar-dash/src/server/memory-lightrag.mjs:1477 lines` — LightRAG integration
- `bizar-dash/src/server/routes/memory.mjs:1482 lines` — REST API surface
- `cli/memory.mjs:1747 lines` — `bizar memory <verb>` CLI
- `.bizar/graph/graph.json:23112 lines` — graphify knowledge graph
- `.bizar/lightrag/kv_store_full_docs.json` — LightRAG KV store

### Best-of Catalog

- `round-7-bestof-deep/multi-agent-memory.md:352-389` — Mem0 architecture
- `round-7-bestof-deep/multi-agent-memory.md:394-424` — Letta architecture
- `round-7-bestof-deep/multi-agent-memory.md:427-472` — claude-mem architecture
- `round-7-bestof-deep/multi-agent-memory.md:686-737` — synthesis: memory layer patterns
- `round-7-bestof-deep/multi-agent-memory.md:716-722` — four-surface stack
- `repos/best-of-Agent-Harnesses/comparisons/memory-layers.md:5-15` — three-product comparison
- `repos/best-of-Agent-Harnesses/comparisons/memory-layers.md:18-26` — pick-by-situation

### Prior Round Reports

- `round-4-hermes-deep/learning-loop.md:1-528` — Hermes closed learning loop
- `round-4-hermes-deep/learning-loop.md:316-330` — skill auto-creation
- `round-5-openfang-deep/knowledge-graph.md:1-513` — OpenFang knowledge graph deep dive
- `round-5-openfang-deep/knowledge-graph.md:209-216` — no deduplication
- `round-5-openfang-deep/knowledge-graph.md:271-274` — max_depth ignored, 100 cap
- `round-5-openfang-deep/knowledge-graph.md:418-428` — consistency model
- `round-6-openclaw-deep/memory-tools.md:1-458` — OpenClaw memory + tool policy
- `round-7-bestof-deep/multi-agent-memory.md:1-814` — full memory study
- `round-8-multi-agent/bizar-multi-agent-redesign.md` — Bizar multi-agent redesign

---

*End of Round 9 memory architecture deep study. Total sources cited: 90+ file:line references across 5 source repos. Companion: `round-9-memory/bizar-memory-redesign.md`.*