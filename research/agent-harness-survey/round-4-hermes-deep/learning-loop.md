# Hermes Learning Loop — End-to-End Closed-Loop Architecture

## 1. The Closed Learning Loop — End to End

The Hermes agent implements a **closed learning loop**: every conversation generates telemetry, the telemetry is indexed and stored, similar past sessions are retrieved when relevant, and the agent can synthesize net-new skills from cross-session patterns — all without human intervention. The loop closes when a self-created skill is authored, stored in the workspace, and picked up by future agent invocations.

### Full Cycle in Code

The loop operates in four stages that chain together across the codebase:

**Stage 1 — Conversation runs, telemetry is emitted.**
`agent/curator.py` instruments every tool call and message via `maybe_run_curator()`, called from two call sites: `cli.py:13171` and `gateway/run.py:19779`. At appropriate points (idle transitions, session end, inactivity threshold), the Curator is invoked.

**Stage 2 — Session stored, FTS5 indexed.**
`hermes_state.py:813–856` defines the FTS5 virtual table `messages_fts` with INSERT/UPDATE/DELETE triggers, plus a TRIGRAM index for CJK tokenization. Sessions are stored via the memory provider system (`agent/memory_provider.py`), which is pluggable — `plugins/memory/honcho/__init__.py` implements `HonchoMemoryProvider` with dialectic Q&A recall and thread-based async retrieval.

**Stage 3 — Similar sessions retrieved, LLM summarization.**
`plugins/memory/honcho/__init__.py` exposes a `search` tool that retrieves past sessions. `agent/skill_usage.py` provides usage telemetry: it tracks skills as `active`, `stale`, `archived`, or `pinned` based on recency and hit count. The Honcho provider exposes `conclude` and `context` tools that drive LLM summarization of retrieved sessions.

**Stage 4 — Skills auto-created, skills consumed.**
When cross-session patterns emerge (via the Curator's review pass) and no existing skill covers the gap, the Curator authors a new SKILL.md via the skill auto-creation flow. Future sessions load the skill via `skills/` directory scan, and usage is tracked via `skill_usage.py`.

The loop is closed because the output of Stage 4 (a new skill) feeds Stage 1 of future sessions (the skill is loaded and used, generating new telemetry).

```
Conversation → Curator → FTS5 Index → Honcho Recall → LLM Summarization → Skill Auto-Creation → Future Sessions
```

---

## 2. The Curator

**File:** `agent/curator.py` (~1,900 lines)

### What the Curator Does

The Curator is a periodic review process that runs after the agent has been idle for a configurable threshold. It does not interrupt active work — it only fires when the agent transitions to an idle state or when an explicit session-end signal is received.

The Curator performs three distinct operations:

1. **Consolidation** — merges fragmented tool calls, resolves partial outputs, and writes a cleaned session record.
2. **Review** — evaluates the session against recent prior sessions to detect patterns (repeated failures, repeated workarounds, missing capabilities).
3. **Archival** — stores the session in long-term memory, updates FTS5 indexes, and triggers Honcho dialectic processing.

### When It Runs

Entry point: `maybe_run_curator()` at `agent/curator.py`. It is called from:

- `cli.py:13171` — after every top-level command completes or the REPL loop cycles
- `gateway/run.py:19779–19785` — after each agent turn in gateway mode

The Curator checks several gating conditions before firing:

- **Idle gating**: the agent must have been quiet for `curator_idle_threshold_seconds` (default 300)
- **Inactivity gating**: a separate `curator_inactivity_threshold_seconds` gate that fires if the session has been running but inactive for longer than this window
- **Auto-transition gating**: if `curator_auto_transition` is enabled, the Curator can trigger a state transition (e.g., from `active` → `review` → `active`) without user input

### What Gets Reviewed

`run_curator_review()` is the core review method. It:

1. Loads the last N sessions from the FTS5 index (via HonchoMemoryProvider's `search` tool)
2. Computes a diff against the current session
3. Detects repeated tool sequences that failed in prior sessions but succeeded (or vice versa)
4. Identifies gaps — capability areas with no corresponding SKILL.md
5. Triggers `skill_auto_create()` if a gap meets the auto-creation threshold

### State Persistence

The Curator maintains `.curator_state` — a JSON blob persisted at the agent's session root. It records:

- Last review timestamp
- Pattern frequency counts per capability area
- Skill gaps identified and their status (pending / authored / rejected)
- Archive pointer (which FTS5 record holds the consolidated session)

---

## 3. SKILL.md Format Deep Dive

### Schema

A valid SKILL.md follows this structure:

```markdown
---
name: <slugified-name>
description: <one-line-summary>
triggers:
  - <phrase or pattern that activates this skill>
  - <...>
version: <semver>
agent_only: <true|false>
---

# <Human-Readable Title>

## What This Skill Does

## When to Use

## Key Commands / Patterns

## Examples

## Integration Points
```

### Frontmatter Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Lowercase slug, unique per workspace |
| `description` | string | Yes | One line, used in skill discovery |
| `triggers` | string[] | Yes | Phrases/patterns that activate this skill |
| `version` | semver | Yes | Tracks skill evolution |
| `agent_only` | boolean | No | If true, not shown in user-facing lists |

### agentskills.io Compatibility

The SKILL.md format is compatible with the agentskills.io manifest schema. The Curator writes skill manifests to `.agents/skills/<name>/SKILL.md` and registers them in `.agents/skills/index.json`. This allows `skills list` CLI commands to enumerate and search skills by trigger phrase.

### Example SKILL.md Files

**Example 1 — Bash Safety (`skills/bash/SKILL.md`)**

```markdown
---
name: bash-safety
description: Safe shell command execution with guardrails
triggers:
  - "run a shell command"
  - "execute bash"
  - "run npm install"
version: 1.0.0
agent_only: false
---

# Bash Safety

## What This Skill Does

Executes shell commands with permission checks, dry-run support, and rollback on destructive operations.

## When to Use

- Any shell invocation in agent code
- npm/pip/brew install commands
- git operations (guarded)

## Key Commands

- `bash --dangerous-commands-allowed` flag to bypass guardrails
- `DRY_RUN=true` to preview without executing

## Integration Points

Calls `tools/skill_usage.py` to log usage telemetry.
```

**Example 2 — Web Research (`skills/web-research/SKILL.md`)**

```markdown
---
name: web-research
description: Structured web search and fact-checking
triggers:
  - "look up"
  - "search the web"
  - "verify this fact"
version: 2.1.0
agent_only: true
---

# Web Research Skill

## What This Skill Does

Performs structured web searches via the configured search backend (openrouter/nousresearch/hermes-3-llama-3.1-405b), compresses results, and produces cited summaries.

## When to Use

- Factual queries requiring up-to-date information
- Verification of claims mid-conversation
- Research tasks spanning multiple sources

## Key Commands

- `web_research.yaml` env config for backend selection
- Compression enabled by default (target_max_tokens: 29000)

## Integration Points

Reads `web_research.yaml` for backend config. Writes compressed summaries to session state.
```

**Example 3 — Trajectory Compression (`skills/trajectory-compression/SKILL.md`)**

```markdown
---
name: trajectory-compression
description: Compress multi-turn agent trajectories for training
triggers:
  - "compress trajectories"
  - "generate training data"
  - "build replay buffer"
version: 1.0.0
agent_only: true
---

# Trajectory Compression

## What This Skill Does

Runs the 6-step compression pipeline (protect head/tail, summarize middle via LLM) to produce training-ready trajectory pairs from multi-turn agent sessions.

## When to Use

- Batch runs that produce trajectories for model fine-tuning
- Post-session consolidation for replay-based learning

## Key Commands

- `trajectory_compressor.py` — `TrajectoryCompressor` class
- `CompressionConfig` — config object with `target_max_tokens`, `protected_turns`
- `google/gemini-3-flash-preview` as the summarization model

## Integration Points

Consumes output from `batch_runner.py`. Feeds compressed trajectories to training data generation pipelines.
```

**Example 4 — Honcho Memory (`plugins/memory/honcho/SKILL.md`)**

```markdown
---
name: honcho-memory
description: Long-term memory with dialectic peer cards
triggers:
  - "remember this"
  - "what did we discuss about"
  - "pull up context"
version: 1.0.0
agent_only: true
---

# Honcho Memory Provider

## What This Skill Does

Provides long-term session memory via a dialectic Q&A system. Stores peer cards (structured session summaries) and supports thread-based async recall.

## When to Use

- Cross-session context retrieval
- Pattern detection over multiple sessions
- Building a cumulative context window

## Key Commands

Four tool schemas: `profile`, `search`, `context`, `conclude`

## Integration Points

Implements `MemoryProviderABC` from `agent/memory_provider.py`. Plugs in via `memory.provider: honcho` in config.
```

**Example 5 — Auto-Created Skill (output of skill auto-creation)**

Generated by Curator when a gap is detected. Example pattern:

```markdown
---
name: git-conflict-resolution
description: Detected repeated git merge conflicts in session history
triggers:
  - "git merge conflict"
  - "resolve merge conflict"
version: 0.1.0
agent_only: true
---

# Git Conflict Resolution

## What This Skill Does

Detected from pattern: sessions at `research/agent-harness-survey/round-*` repeatedly invoked `git merge` without `--no-ff` and encountered conflicts.

## When to Use

- Before any `git merge` operation
- After a failed merge

## Key Commands

- `git merge --no-ff` to preserve feature branch history
- `git rerere` to record conflict resolutions

## Integration Points

Created by `run_curator_review()` in `agent/curator.py`. Registered by `skill_usage.py` as `active` on first use.
```

---

## 4. Skill Auto-Creation

### Triggers

The Curator triggers auto-creation via `skill_auto_create()` in `agent/curator.py` when all of the following are true:

1. A capability gap is detected (a needed action has no corresponding SKILL.md)
2. The gap has appeared in at least `curator_min_pattern_frequency` distinct sessions (default: 3)
3. The most recent session involving the gap ended without a workaround (i.e., the agent failed or worked around it manually)
4. `curator_auto_create_skills: true` in config

### The "Nudges Itself" Loop

The auto-creation mechanism "nudges itself" because the newly authored skill immediately participates in future sessions:

1. **Skill authored** → written to `.agents/skills/<slug>/SKILL.md`
2. **Next session starts** → `skills/` directory scanned at startup
3. **Skill loaded** → `skill_usage.py` registers it as `active`
4. **Skill used** → telemetry flows through `maybe_run_curator()`
5. **Curator reviews** → sees the skill was used, updates its `active` state and hit count
6. **Skill refined** → if the skill's recommendations are followed but still produce failures, the Curator notes the pattern and can trigger a revision (incrementing the version in frontmatter)

This creates a feedback loop where the skill system self-improves based on execution outcomes. No human reviews the skill before it is used — it is immediately available, but the Curator tracks its hit/fail ratio and can archive it if it consistently misfires.

### Naming and Registration

Auto-created skills are written with `version: 0.1.0` and `agent_only: true`. They are registered in `.agents/skills/index.json` with a `provenance: auto` field to distinguish them from manually authored skills. The Curator maintains a `curator_state` entry for each auto-created skill tracking its invocation count and failure rate.

---

## 5. FTS5 Session Search + LLM Summarization

### Schema

**File:** `hermes_state.py:813–856`

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  session_id UNINDEXED,
  turn_index UNINDEXED,
  role,
  content,
  tool_name,
  token_count,
  content='messages',
  content_rowid='rowid'
);

-- Triggers for keeping FTS in sync
CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN ... END;
CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN ... END;
CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN ... END;

-- TRIGRAM index for CJK
CREATE INDEX IF NOT EXISTS messages_trigram ON messages(trigram_index(content));
```

The FTS5 table is backed by the `messages` base table. Every INSERT/UPDATE/DELETE on `messages` automatically updates the FTS index via triggers, ensuring the index is always consistent with the source of truth.

### Indexing

Indexing happens automatically on every message insert. The `token_count` column is precomputed and stored, allowing the Honcho provider to filter results by session length before fetching full content.

### Recall Flow

1. A query arrives (from the Curator's `run_curator_review()` or from a direct `search` tool call)
2. `HonchoMemoryProvider.search()` executes a CJK-aware FTS5 query against `messages_fts`
3. Results are returned as a ranked list of `(session_id, turn_index, snippet)`
4. Full sessions are reconstructed by fetching related `messages` rows
5. The `context` tool exposes full session context to the LLM
6. The `conclude` tool produces a structured peer card (dialectic Q&A summary)

### How It Nudges the Learning Loop

FTS5 recall provides the signal that drives the entire Curator review. Without fast, semantically rich session retrieval, the Curator could not detect cross-session patterns. The TRIGRAM index on CJK content ensures that even multi-byte character content is searchable without n-gram tokenization artifacts.

---

## 6. Honcho Dialectic Integration

### What Honcho Is

Honcho is a memory provider plugin (`plugins/memory/honcho/__init__.py`) that implements the `MemoryProviderABC` interface. It provides **dialectic Q&A** — a structured peer-card system where each session is summarized not as a flat transcript but as a Q&A dialogue between the agent-as-it-was and the agent-as-it-should-have-been.

### Dialectic Method

The dialectic works by generating two sides of a conversation from the same session:

- **Affirmative card** ("what worked"): summarizes successful tool sequences, effective prompts, correct tool parameterizations
- **Critical card** ("what failed"): summarizes failures, workarounds that succeeded, missing skills

The two cards together form a **peer card** for that session. Peer cards are the unit of long-term memory storage.

### Integration Points

| Point | Location | Data Exchanged |
|---|---|---|
| Memory registration | `HonchoMemoryProvider.store()` | Session JSON → peer card JSON |
| Recall | `HonchoMemoryProvider.search()` | Query → ranked peer card list |
| Context provision | `HonchoMemoryProvider.context()` | Session ID → full peer card + related sessions |
| Conclusion | `HonchoMemoryProvider.conclude()` | Full session → dialectic Q&A peer card |
| Async recall | Thread-based in `__init__` | Background thread fetches peer cards for session N-1 |

### Data Exchanged

- **In**: raw session JSON (messages array, tool calls, turn metadata)
- **Out**: peer card JSON with `affirmative`, `critical`, `pattern_tags`, `skill_gaps`, `session_id`, `created_at`

The peer cards are what get stored in FTS5 via the `messages_fts` triggers. The dialectic structure makes the FTS5 content richer for downstream LLM summarization because each stored "content" is already a structured argument, not a flat transcript.

---

## 7. Memory Provider ABCs

**File:** `agent/memory_provider.py` (full)

### Abstract Interface

`MemoryProviderABC` defines 8 lifecycle methods:

```python
class MemoryProviderABC(ABC):
    @abstractmethod
    def store(self, session_id: str, messages: list[dict]) -> None: ...

    @abstractmethod
    def search(self, query: str, limit: int = 10) -> list[dict]: ...

    @abstractmethod
    def retrieve(self, session_id: str) -> list[dict] | None: ...

    @abstractmethod
    def delete(self, session_id: str) -> bool: ...

    @abstractmethod
    def list_sessions(self, limit: int = 100) -> list[str]: ...

    @abstractmethod
    def get_metrics(self, session_id: str) -> dict | None: ...

    @abstractmethod
    def conclude(self, session_id: str) -> dict: ...

    @abstractmethod
    def context(self, session_id: str, depth: int = 5) -> dict: ...
```

### Pluggable Registration

Providers are registered via the `memory.provider` config key. The active provider is instantiated at agent startup:

```python
# In agent initialization
provider_name = config.get("memory.provider", "honcho")
provider_class = get_provider_class(provider_name)  # registry lookup
provider = provider_class(config)
```

The registry is populated by `@register_provider` decorators. `HonchoMemoryProvider` registers itself as `"honcho"`.

### Built-in Providers

| Provider | Config Value | Description |
|---|---|---|
| HonchoMemoryProvider | `honcho` | Dialectic Q&A, peer cards, thread async |
| InMemoryProvider | `memory` | Ephemeral dict, no persistence |
| FileBasedProvider | `file` | JSON files on disk, no FTS |

### Swap Mechanism

To swap providers: change `memory.provider` in config and restart the agent. All downstream code (Curator, skill auto-creation, FTS5 triggers) operates on the provider interface, so the swap is transparent to callers.

---

## 8. The "Closed Loop" Compared to Industry

### Why This Is Unique

Most agent frameworks implement **open loops**: they generate logs, but logs are consumed by human reviewers or offline pipelines. The Hermes closed loop is unique in three respects:

1. **No human in the loop for skill creation** — the Curator authors skills autonomously, registers them, and they participate in future sessions immediately.
2. **Dialectic memory as the unit of learning** — not raw transcripts but structured peer cards that encode what worked and what failed, making the LLM summarization step more signal-dense.
3. **Full-stack instrumentation** — from `maybe_run_curator()` at every idle transition → FTS5 indexing → Honcho peer cards → Curator review → skill authoring → `skill_usage.py` telemetry. The loop is closed at every layer.

### Comparison to Related Systems

| System | Learning Loop | Skill Creation | Human Required |
|---|---|---|---|
| Hermes | Fully closed, automated | Auto-authored by Curator | No |
| OpenAI Agents SDK | Open, log-based | Manual via API | Review required |
| LangGraph | Open, via checkpoints | Manual skill authoring | Review recommended |
| AutoGPT | Open, via memory retrieval | None | Yes, for skill creation |
| SmolLM agent | Open, via preference learning | Via curated dataset | Yes, dataset curation |

### Failure Modes

1. **Skill drift** — auto-created skills with `version: 0.1.0` may encode session-specific workarounds that are not general. The Curator mitigates this by requiring 3+ sessions before authoring, but noisy environments can still produce poor skills.
2. **FTS5 index corruption** — if triggers diverge from base table (e.g., a failed migration), the Curator operates on stale index data. The `honcho` provider includes a `rebuild_index()` method callable from config.
3. **Memory provider swap mid-session** — if the provider is swapped via config change without a restart, in-flight sessions may use the old provider for storage and the new provider for retrieval. This is mitigated by requiring restart on provider change.
4. **Skill telemetry gaps** — if `skill_usage.py` is disabled or returns errors, the Curator cannot update skill hit/fail counts, causing active skills to appear stale and be archived prematurely.

### User Controls

Users control the loop via configuration keys:

```yaml
# Disable auto-creation entirely
curator_auto_create_skills: false

# Raise the bar for auto-creation (require more sessions)
curator_min_pattern_frequency: 5

# Disable periodic review (still runs at session end)
curator_idle_threshold_seconds: 0  # effectively disables idle-triggered review

# Use a different memory provider
memory.provider: file  # switch to FileBasedProvider

# Disable FTS5 indexing
fts5_enabled: false
```

These controls allow users to run an open loop (auto-creation disabled, human reviews skills before use), a semi-open loop (auto-creation enabled, skills auto-registered but surfaced for human approval), or the full closed loop (all automation enabled).
