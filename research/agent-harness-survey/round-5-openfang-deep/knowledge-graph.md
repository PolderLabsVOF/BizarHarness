# OpenFang Knowledge Graph — Deep Dive

**Round 5 — OpenFang Deep Analysis**  
**Scope:** Knowledge Graph Architecture, Storage, Population, Query API, and Per-Hand Usage  
**Sources:** `crates/openfang-memory/src/knowledge.rs`, `crates/openfang-memory/src/migration.rs`, `crates/openfang-memory/src/substrate.rs`, `crates/openfang-types/src/memory.rs`, `crates/openfang-runtime/src/tool_runner.rs:2041-2140`

---

## 1. The Schema

### SQL Schema — Full Definition

The knowledge graph consists of two tables defined in migration v1 (`migration.rs:150-172`):

```sql
CREATE TABLE entities (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    name        TEXT NOT NULL,
    properties  TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE relations (
    id              TEXT PRIMARY KEY,
    source_entity   TEXT NOT NULL,
    relation_type   TEXT NOT NULL,
    target_entity   TEXT NOT NULL,
    properties      TEXT NOT NULL DEFAULT '{}',
    confidence      REAL NOT NULL DEFAULT 1.0,
    created_at      TEXT NOT NULL
);

CREATE INDEX idx_relations_source ON relations(source_entity);
CREATE INDEX idx_relations_target ON relations(target_entity);
CREATE INDEX idx_relations_type   ON relations(relation_type);
```

**Schema version**: 8 (current, `migration.rs:8`). The knowledge graph schema has been stable since v1 — no migrations touch `entities` or `relations` after initial creation.

### Entity Types

Defined at `memory.rs:132-154`:

```rust
pub enum EntityType {
    Person,
    Organization,
    Project,
    Concept,
    Event,
    Location,
    Document,
    Tool,
    Custom(String),  // extensible
}
```

### Relation Types

Defined at `memory.rs:173-199`:

```rust
pub enum RelationType {
    WorksAt,
    KnowsAbout,
    RelatedTo,
    DependsOn,
    OwnedBy,
    CreatedBy,
    LocatedIn,
    PartOf,
    Uses,
    Produces,
    Custom(String),  // extensible
}
```

### Entity Rust Type

At `memory.rs:115-130`:

```rust
pub struct Entity {
    pub id: String,
    pub entity_type: EntityType,
    pub name: String,
    pub properties: HashMap<String, serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

### Relation Rust Type

At `memory.rs:156-171`:

```rust
pub struct Relation {
    pub source: String,           // source entity ID
    pub relation: RelationType,
    pub target: String,          // target entity ID
    pub properties: HashMap<String, serde_json::Value>,
    pub confidence: f32,         // 0.0 to 1.0
    pub created_at: DateTime<Utc>,
}
```

### Properties Storage

Both `entities.properties` and `relations.properties` are JSON blobs stored as TEXT in SQLite. The schema uses `ON CONFLICT(id) DO UPDATE` for entities (`knowledge.rs:46`), allowing upsert semantics. Relations are insert-only (no upsert — duplicates are allowed).

---

## 2. Storage Backend

### SQLite — Not In-Memory

The knowledge graph is **not** an in-memory graph. It is stored in the same SQLite database as all other memory layers. At `knowledge.rs:16-19`:

```rust
pub struct KnowledgeStore {
    conn: Arc<Mutex<Connection>>,
}
```

The `Connection` is opened from the database path (typically `~/.openfang/data/openfang.db`) and wrapped in `Arc<Mutex<Connection>>`. This is the **same connection** used by all other stores (structured, semantic, session, usage).

### WAL Mode

At `substrate.rs:52-53`:

```rust
conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
```

WAL mode enables concurrent reads during writes and improves multi-threaded throughput. The `busy_timeout=5000` means threads wait up to 5 seconds for a lock before erroring.

### Concurrency Model

`Arc<Mutex<Connection>>` means:
- **One writer at a time** — the `Mutex` serializes all writes
- **Multiple readers** — `Mutex` is held only during the lock, `Connection` can be used concurrently by multiple readers in SQLite (readers don't block writers in WAL mode)

### Performance Tradeoffs

| Aspect | Implication |
|--------|-------------|
| All entities in one table | No typed storage — entity type is a string enum serialized as JSON |
| Properties as JSON blob | Can't query properties without loading the full JSON into Rust |
| Confidence on relations only | Entity confidence must be stored in the properties JSON |
| 100 result limit (`knowledge.rs:123`) | Prevents runaway queries |
| No graph indexes | JOIN on `source_entity` and `target_entity` uses the indexes; no index on `name` for text matching |
| Full graph at startup | Graph is not lazy-loaded; all entities/relations are in SQLite |
| Query = synchronous SQLite | All queries run in `spawn_blocking` via `tokio::task::spawn_blocking` |

### Query API Path

All knowledge graph operations go through the `Memory` trait async API (`memory.rs:258-335`) which wraps synchronous SQLite calls in `tokio::task::spawn_blocking` threads (`substrate.rs:688-706`):

```rust
async fn add_entity(&self, entity: Entity) -> OpenFangResult<String> {
    let store = self.knowledge.clone();
    tokio::task::spawn_blocking(move || store.add_entity(entity))
        .await?
}
```

---

## 3. Population Strategy

### How Entities Are Added

Three code paths:

**1. Via `knowledge_add_entity` tool** (`tool_runner.rs:2041-2067`):
```rust
async fn tool_knowledge_add_entity(input, kernel) -> Result<String, String> {
    let name = input["name"].as_str().ok_or("Missing 'name'")?;
    let entity_type_str = input["entity_type"].as_str().ok_or("Missing 'entity_type'")?;
    let properties = input["properties"].as_object().map(...).unwrap_or_default();
    let entity = Entity { id: String::new(), entity_type: parse_entity_type(entity_type_str), ... };
    let id = kh.knowledge_add_entity(entity).await?;
}
```

The LLM calls `knowledge_add_entity(name="Acme Corp", entity_type="Organization", properties={...})` and the tool constructs the `Entity` struct. The `id` field is empty (`String::new()`) so `KnowledgeStore::add_entity()` generates a UUID (`knowledge.rs:33-34`).

**2. Via direct API** — `MemorySubstrate::add_entity()` called by the kernel or other subsystems.

**3. No auto-extraction** — There is no automatic entity extraction from tool results. The LLM must explicitly call `knowledge_add_entity` in its loop. Hands are instructed to do this in specific phases.

### Confidence Scoring

Confidence is a **relation-level field only** (`Relation.confidence: f32`, 0.0-1.0). Entity-level confidence must be stored in `properties`. The Collector Hand (Phase 4) tags entities with `confidence` in properties:

```rust
// Collector instructs the LLM to call:
knowledge_add_entity(
    name="Company X",
    entity_type="Organization",
    properties={confidence: "high", source: "SEC filing"}
)
```

No automatic confidence scoring — the LLM assigns it based on source quality heuristics in the prompt.

### Deduplication

**No deduplication exists at the storage layer.** `KnowledgeStore::add_entity` uses `ON CONFLICT(id) DO UPDATE` (`knowledge.rs:46`), which means if you call `add_entity` with the same UUID, it updates the entity. But if you call it with `id: String::new()` (empty, triggering UUID generation), you get a **new UUID each time**.

Hands are responsible for deduplication:
- **Lead Hand Phase 5**: Deduplicates leads by comparing new leads against `leads_database.json` (a separate JSON file, not the knowledge graph)
- **Collector Hand Phase 5**: Compares against `collector_knowledge_base.json` snapshot
- **No UUID coordination**: If two Hands independently add "Acme Corp" as an Organization, they get different UUIDs and the graph has two `Acme Corp` entity nodes

### Population Pattern Across Hands

| Hand | What it adds | Phase |
|------|-------------|-------|
| **Collector** | Person, Company, Product, Event, Number entities; works_at, founded, invested_in, partnered_with, competes_with relations | Phase 4 |
| **Researcher** | Key concepts, people, organizations, data points as entities; source-claim relations | Phase 4 |
| **Lead** | Lead person + company entities; lead→company, company→industry relations | Phase 4 |
| **Predictor** | Signal entities linked to prediction domains | Phase 2 |
| **Twitter** | Topic entities, trend entities | Content generation |
| **Trader** | Market signal entities, asset entities | Phase 2 |
| **Infisical-Sync** | Secret path entities, service entities | Phase 3 |
| **Browser** | Webpage entities, form entities (limited use) | Task execution |
| **Clip** | No knowledge graph usage | N/A |

---

## 4. Query API

### `GraphPattern` — The Query Filter

Defined at `memory.rs:201-212`:

```rust
pub struct GraphPattern {
    pub source: Option<String>,        // entity ID or name
    pub relation: Option<RelationType>,
    pub target: Option<String>,        // entity ID or name
    pub max_depth: u32,
}
```

### `KnowledgeStore::query_graph` — SQL JOIN Implementation

At `knowledge.rs:82-188`:

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

### Key Behavior

- **Source/Target matching**: Matches both `id` AND `name` — `source = "Acme Corp"` matches any entity with `name = "Acme Corp"` OR `id = "Acme Corp"`. This is permissive but can cause false positives.
- **`max_depth` is unused**: The `max_depth` field in `GraphPattern` is accepted but **never used** in the SQL. The query always does a single JOIN with no recursion. A `max_depth=2` query returns the same results as `max_depth=1`.
- **Relation filtering**: The relation type is JSON-serialized before comparison — `RelationType::WorksAt` becomes `"WorksAt"` in the SQL query. This works for standard enums but `Custom(String)` relations would need exact string matching.
- **100 result cap**: Hard limit at `knowledge.rs:123`. No pagination.
- **No negation**: No `NOT source`, `NOT target`, `NOT relation` filters.

### `tool_knowledge_query` — LLM-Facing Interface

At `tool_runner.rs:2105-2140`:

```rust
async fn tool_knowledge_query(input, kernel) -> Result<String, String> {
    let source = input["source"].as_str().map(|s| s.to_string());
    let target = input["target"].as_str().map(|s| s.to_string());
    let relation = input["relation"].as_str().map(parse_relation_type);
    let max_depth = input["max_depth"].as_u64().unwrap_or(1) as u32;

    let pattern = GraphPattern { source, relation, target, max_depth };
    let matches = kh.knowledge_query(pattern).await?;

    // Returns formatted string:
    // "Found 2 match(es):
    //   Alice (Person) --[WorksAt (95%)]--> Acme Corp (Organization)"
}
```

The LLM sees human-readable output. Note: `max_depth` is passed but ignored.

---

## 5. Per-Hand Usage Patterns

### Collector — Change Detection + Sentiment Tracking

The Collector uses the knowledge graph for **entity tracking over time**:

**Phase 4 (Knowledge Graph Construction)** — `bundled/collector/HAND.toml:228-244`:
```
For each collected data point:
1. knowledge_add_entity for new entities (people, companies, products, events)
2. knowledge_add_relation for relationships between entities
3. Attach metadata: source, timestamp, confidence, focus_area
```

Entity types tracked:
- `Person` (name, role, company, last_seen)
- `Company` (name, industry, size, funding_stage)
- `Product` (name, company, category, launch_date)
- `Event` (type, date, entities_involved, significance)
- `Number` (metric, value, date, context)

**Phase 5 (Change Detection)** — `bundled/collector/HAND.toml:248-268`:
- Compares current collection against `collector_knowledge_base.json` snapshot
- Identifies new entities, changed attributes, new relationships, disappeared entities
- Scores significance (critical/important/minor)
- `alert_on_changes` toggle triggers `event_publish` on critical changes

**`track_sentiment` toggle** — Phase 5 also classifies sources as positive/negative/neutral toward the target, tracking sentiment trend vs previous cycle.

### Researcher — Cross-Reference + Citation Tracking

The Researcher uses the knowledge graph for **source-claim graph**:

**Phase 4 (Cross-Reference & Synthesis)** — `bundled/researcher/HAND.toml:249-268`:
```
Build the knowledge graph:
- knowledge_add_entity for key concepts, people, organizations, data points
- knowledge_add_relation for relationships between findings
```

**Phase 5 (Fact-Check Pass)** — `bundled/researcher/HAND.toml:271-284`:
- Confidence levels: Verified (3+ authoritative sources), Likely (2 sources), Unverified (single source), Disputed (sources disagree)
- These confidence levels are stored in the `properties` JSON of relation edges

### Lead — ICP Profile + Deduplication

**Phase 2 (Target Profile Construction)** — `bundled/lead/HAND.toml:201-211`:
```
Store the ICP in the knowledge graph:
- knowledge_add_entity: ICP profile node
- knowledge_add_relation: link ICP to target attributes
```

**Phase 4 (Enrichment)** — `bundled/lead/HAND.toml:245-247`:
```
knowledge_add_entity for each lead and company
knowledge_add_relation for lead→company, company→industry relationships
```

**Deduplication**: Lead deduplication is NOT in the knowledge graph — it uses `leads_database.json` (a file-based ledger). The knowledge graph has no deduplication.

### Predictor — Brier Score History + Accuracy Tracking

**Phase 3 (Accuracy Review)** — `bundled/predictor/HAND.toml:235-248`:
```
For each prediction in ledger where resolution_date <= today:
1. web_search for evidence of predicted outcome
2. Score: Correct / Partially correct / Incorrect / Unresolvable
3. Calculate Brier score: (predicted_probability - actual_outcome)^2
4. Update cumulative accuracy metrics
5. Analyze calibration: are 70% predictions right ~70% of the time?
```

Accuracy metrics stored via `memory_store` (structured KV), not in the knowledge graph. The graph is used for **signal tracking** — entities representing signals that feed into predictions.

### Twitter — Topic + Trend Tracking

Twitter uses the knowledge graph for:
- Topic entities tracked over time
- Trend entities with `knowledge_add_entity`
- Sentiment relations (positive/negative/neutral toward entities)

### Trader — Signal Graph

Trader uses the knowledge graph for:
- Market signal entities (earnings, macro indicators, news events)
- Asset entities (stocks, crypto pairs)
- Relations between signals and assets (e.g., `bullish_signal --[affects]--> AAPL`)

### Browser — Minimal Use

Browser's primary use of the knowledge graph is for **entity tracking during web automation tasks**:
- Stores webpage entities it has visited
- Stores form entities it has interacted with
- Not a primary population strategy

### Clip — No KG Usage

Clip (video processing) does not use the knowledge graph. Its tools are `shell_exec`, `file_read`, `file_write`, `file_list`, `web_fetch`, `memory_store`, `memory_recall`.

---

## 6. Cross-Hand Shared State

### The Graph as Shared Workspace

The knowledge graph is the **only cross-Hand persistent state mechanism** that doesn't require explicit file-based coordination. All six Einstein Hands access the same `entities` and `relations` tables.

### What This Enables

| Coordination Pattern | How It Works |
|---------------------|--------------|
| **Collector → Lead** | Collector builds company/person entities. Lead queries them when scoring leads. |
| **Collector → Predictor** | Collector tracks market/technology events. Predictor queries them as signals. |
| **Researcher → any Hand** | Researcher stores source entities. Other Hands can query for domain knowledge. |
| **Lead → Collector** | Lead's ICP stored in KG. Collector can use it as a focus filter. |

### Consistency Model

**No transactions**: Each `add_entity`/`add_relation` is a separate SQLite statement. There's no multi-step atomic operation. If a Hand's Phase 4 population (5 entities + 4 relations) crashes partway through, the graph is left partially populated.

**No isolation**: Two Hands writing concurrently both succeed — there's no optimistic locking. The worst case is duplicate entities (different UUIDs for the same logical entity).

**No read-after-write consistency**: After `add_entity`, the entity is immediately queryable by all Hands.

### Event Bus Coordination

`event_publish` + `TriggerEngine` pattern matching allows Hands to coordinate reactively. A Hand can publish an event (e.g., "company X announced funding") and another Hand with a matching trigger activates. But this is **event-driven, not graph-driven**.

---

## 7. Visual / Debug Interface

### Dashboard Graph Viewer

The web dashboard (`crates/openfang-api/static/`) includes a knowledge graph viewer. From R1 (`openfang-recon.md:240-241`): the dashboard includes interactive visualization of Hand state, including knowledge graph queries.

The `routes.rs` exposes API endpoints for graph queries:
- `GET /api/knowledge/entities` — list entities
- `GET /api/knowledge/relations` — list relations
- `POST /api/knowledge/query` — execute `GraphPattern` query

### Query Interface for Users

Hands expose their knowledge graph state through their reports. The Collector report (`bundled/collector/HAND.toml:276-296`) includes an "Entity Map" table showing tracked entities with type, status, and confidence.

There is **no user-facing graph query language**. Users can only see what Hands have stored, filtered through each Hand's report format.

---

## 8. Comparison to External Graph DBs

### Why Not Neo4j / Memgraph?

| Factor | OpenFang's SQLite Approach | External Graph DB |
|--------|---------------------------|------------------|
| **Operational complexity** | Zero — same SQLite as rest of memory | Requires separate service, backup, monitoring |
| **Query expressiveness** | Single JOIN, no recursion | Cypher/Memgraph QL with multi-hop traversal |
| **Transactions** | No ACID transactions across graph ops | Full ACID transactions |
| **Scalability** | SQLite handles ~100K entities comfortably | Scales to billions |
| **Embedding** | Must store vector separately | Native vector properties |
| **Deployment** | Single binary, no external deps | Separate container/process |

### The `max_depth` Gap

The most significant limitation is that `GraphPattern.max_depth` is **accepted but ignored**. The SQL query always returns single-hop results. For use cases requiring multi-hop queries (e.g., "find all companies that have a board member who worked at a company that acquired X"), OpenFang's graph cannot answer in one query. The caller must iteratively query.

### Tradeoffs Summary

OpenFang chose **simplicity and zero-dependency** over graph expressiveness. The knowledge graph is a **typed entity store with relations**, not a full graph database. For the Einstein Hands' use cases (tracking entities, simple relationship queries), SQLite is sufficient.

The tradeoff is deliberate: OpenFang's "Agent OS" philosophy prioritizes operational simplicity. Running a Neo4j container alongside the agent binary would break the single-binary distribution model.

---

## 9. Code References

| Claim | File:Line |
|-------|-----------|
| KnowledgeStore struct | `knowledge.rs:16-19` |
| add_entity (with upsert) | `knowledge.rs:28-51` |
| add_relation (insert-only) | `knowledge.rs:54-80` |
| query_graph (full SQL JOIN) | `knowledge.rs:82-188` |
| RawGraphRow struct | `knowledge.rs:192-212` |
| parse_entity | `knowledge.rs:222-248` |
| parse_relation | `knowledge.rs:250-272` |
| EntityType enum | `memory.rs:132-154` |
| RelationType enum | `memory.rs:173-199` |
| Entity struct | `memory.rs:115-130` |
| Relation struct | `memory.rs:156-171` |
| GraphPattern struct | `memory.rs:201-212` |
| GraphMatch struct | `memory.rs:214-223` |
| Memory trait (async API) | `memory.rs:258-335` |
| add_entity async wrapper | `substrate.rs:688-693` |
| add_relation async wrapper | `substrate.rs:695-700` |
| query_graph async wrapper | `substrate.rs:702-707` |
| tool_knowledge_add_entity | `tool_runner.rs:2041-2067` |
| tool_knowledge_add_relation | `tool_runner.rs:2069-2103` |
| tool_knowledge_query | `tool_runner.rs:2105-2140` |
| entities table schema | `migration.rs:150-158` |
| relations table schema | `migration.rs:160-172` |
| idx_relations_source | `migration.rs:170` |
| idx_relations_target | `migration.rs:171` |
| idx_relations_type | `migration.rs:172` |
| WAL pragma | `substrate.rs:52` |
| MemorySubstrate struct | `substrate.rs:30-38` |
| Collector KG construction | `bundled/collector/HAND.toml:228-244` |
| Collector change detection | `bundled/collector/HAND.toml:248-268` |
| Researcher KG construction | `bundled/researcher/HAND.toml:261-263` |
| Researcher fact-check | `bundled/researcher/HAND.toml:271-284` |
| Lead KG enrichment | `bundled/lead/HAND.toml:245-247` |
| Lead ICP KG storage | `bundled/lead/HAND.toml:209-211` |
| Predictor accuracy review | `bundled/predictor/HAND.toml:235-248` |
