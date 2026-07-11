# DECISIONS.md — Architectural Decision Log

> ADRs (Architecture Decision Records) for the Bizar Harness. New
> decisions append to `docs/decisions/DEC-NNN-<slug>.md`. Each
> decision gets a unique ID, date, status, and a short rationale.

## Index

| ID | Date | Status | Title | File |
| --- | --- | --- | --- | --- |
| DEC-011 | 2026-07-11 | Accepted | Cline → Claude Code migration | [docs/decisions/DEC-011-claude-code-migration.md](docs/decisions/DEC-011-claude-code-migration.md) |
| DEC-001 | 2026-07-07 | Accepted | OpenCode → Cline rewrite (superseded by DEC-011; the OpenCode→Cline migration was only temporary — Claude Code is the runtime as of v6.3.0) | [docs/decisions/DEC-001-cline-rewrite.md](docs/decisions/DEC-001-cline-rewrite.md) |
| DEC-002 | 2026-07-07 | Accepted | In-process ClineCore (no `cline serve` subprocess — now no `claude daemon` subprocess; spirit preserved by DEC-011) | [docs/decisions/DEC-002-in-process-clinecore.md](docs/decisions/DEC-002-in-process-clinecore.md) |
| DEC-003 | 2026-07-07 | Accepted | In-process memory vault (no dashboard HTTP) | [docs/decisions/DEC-003-in-process-memory-vault.md](docs/decisions/DEC-003-in-process-memory-vault.md) |
| DEC-004 | 2026-07-07 | Accepted | Cline agent teams integration (`bizar_spawn_team`) | [docs/decisions/DEC-004-cline-agent-teams.md](docs/decisions/DEC-004-cline-agent-teams.md) |
| DEC-005 | 2026-07-07 | Accepted | Background agents via dashboard HTTP + in-process Cline | [docs/decisions/DEC-005-bg-agents-via-dashboard.md](docs/decisions/DEC-005-bg-agents-via-dashboard.md) |
| DEC-006 | 2026-07-07 | Accepted | Kanban board (Tasks.tsx + `/api/tasks`) | [docs/decisions/DEC-006-kanban-board.md](docs/decisions/DEC-006-kanban-board.md) |
| DEC-007 | 2026-07-07 | Accepted | Tool approval gate (DANGEROUS_PATTERNS) | [docs/decisions/DEC-007-tool-approval-gate.md](docs/decisions/DEC-007-tool-approval-gate.md) |
| DEC-008 | 2026-07-07 | Accepted | Skill curator (closed learning loop) | [docs/decisions/DEC-008-skill-curator.md](docs/decisions/DEC-008-skill-curator.md) |
| DEC-009 | 2026-07-07 | Accepted | Pre-compaction memory flush | [docs/decisions/DEC-009-pre-compaction-flush.md](docs/decisions/DEC-009-pre-compaction-flush.md) |
| DEC-010 | 2026-07-07 | Accepted | Knowledge graph query tools (`bizar_graph_*`) | [docs/decisions/DEC-010-knowledge-graph-tools.md](docs/decisions/DEC-010-knowledge-graph-tools.md) |

## How to write a new ADR

1. Create `docs/decisions/DEC-NNN-<slug>.md` where `NNN` is the
   next number and `<slug>` is a short kebab-case description.
2. Use the standard format:
   ```markdown
   # DEC-NNN — <title>

   **Date:** YYYY-MM-DD
   **Status:** Proposed | Accepted | Deprecated | Superseded
   **Deciders:** @author
   **Related:** DEC-NNN

   ## Context
   ## Decision
   ## Consequences
   ```
3. Update this index with the new row.
4. Commit the ADR in the same commit as the code change.

## How to find an ADR

Each ADR is also referenced in:

- `AGENTS.md` (high-level summary)
- `CHANGELOG.md` (chronological log)
- `feature_list.json` (the feature this ADR enables, if any)
- `.harness/arch-rules.json` (the rule this ADR enables, if any)

## See also

- `docs/architecture.md` — layer model and module map
- `docs/quality-document.md` — per-module A/B/C/D scores
- `feature_list.json` — features and their state

## How decisions evolve

ADRs are immutable once accepted; superseded decisions are marked
with a banner and a "Superseded by DEC-NNN" cross-reference rather
than rewritten in place. Historical DECs (001, 002) were partially
superseded by DEC-011 (v6.3.0, Claude Code migration) — their
underlying *spirit* still applies (in-process, single runtime per
session, plugin-as-MCP-server) but the references to Cline-specific
subprocesses and tool shapes are rewritten in v6.3.0.
