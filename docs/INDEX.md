# Documentation Index

> Top-level map of the Bizar Harness documentation. Start here
> to find what you need.

## TL;DR

If you have **5 minutes**, read this file.

If you have **15 minutes**, read [AGENTS.md](../AGENTS.md) and
[docs/architecture.md](architecture.md).

If you have **1 hour**, add [DECISIONS.md](../DECISIONS.md) and
the relevant topic doc below.

## By role

### I'm an agent starting a new session

1. [AGENTS.md](../AGENTS.md) — entry point, hard constraints,
   clock-in/clock-out routines
2. [PROGRESS.md](../PROGRESS.md) — current state, in-progress,
   next steps
3. [DECISIONS.md](../DECISIONS.md) — architectural decisions
4. [feature_list.json](../feature_list.json) — features and their
   state

### I'm a contributor adding a feature

1. [AGENTS.md](../AGENTS.md) § Hard constraints
2. [docs/architecture.md](architecture.md) — layer model
3. [templates/sprint-contract.md](../templates/sprint-contract.md) —
   scope, DoD, exclusions
4. [templates/evaluator-rubric.md](../templates/evaluator-rubric.md) —
   scoring rubric
5. [.harness/arch-rules.json](../.harness/arch-rules.json) — what
   `make check-arch` enforces

### I'm a reviewer

1. [AGENTS.md](../AGENTS.md) — what's allowed
2. [docs/architecture.md](architecture.md) § Architectural invariants
3. [docs/decisions/](decisions/) — the ADRs
4. [Makefile](../Makefile) — the targets

### I'm an operator

1. [docs/architecture.md](architecture.md) — system overview
2. [docs/quality-document.md](quality-document.md) — A/B/C/D scores
3. [templates/clean-state-checklist.md](../templates/clean-state-checklist.md) —
   5-dimension exit gate

## By topic

### Architecture

- [docs/architecture.md](architecture.md) — layer model + module
  map + inter-component contracts
- [plugins/bizar/ARCHITECTURE.md](../plugins/bizar/ARCHITECTURE.md) —
  plugin module
- [bizar-dash/ARCHITECTURE.md](../bizar-dash/ARCHITECTURE.md) —
  dashboard module
- [packages/sdk/ARCHITECTURE.md](../packages/sdk/ARCHITECTURE.md) —
  SDK module

### Constraints

- [AGENTS.md](../AGENTS.md) § Hard constraints — top-level rules
- [plugins/bizar/CONSTRAINTS.md](../plugins/bizar/CONSTRAINTS.md) —
  plugin module rules
- [.harness/arch-rules.json](../.harness/arch-rules.json) — 7
  enforced rules

### Decisions

- [DECISIONS.md](../DECISIONS.md) — index of all ADRs
- [docs/decisions/](decisions/) — individual ADR files

### Safety (v6.0.0)

- [docs/safety.md](safety.md) — DANGEROUS_PATTERNS reference
  (Cline-era `{ stop: true, reason }` + Claude Code
  `{ hookSpecificOutput: { permissionDecision: "deny" } }`)
- [plugins/bizar/src/dangerous-patterns.ts](../plugins/bizar/src/dangerous-patterns.ts) —
  source code (36 patterns)
- [docs/decisions/DEC-007-tool-approval-gate.md](decisions/DEC-007-tool-approval-gate.md) —
  the decision

### Curator (v6.0.0)

- [docs/curator.md](curator.md) — Skill curator reference
- [plugins/bizar/src/hooks/skill-curator.ts](../plugins/bizar/src/hooks/skill-curator.ts) —
  source code

### Graph tools (v6.0.0)

- [docs/graph-tools.md](graph-tools.md) — Knowledge graph tools
- [plugins/bizar/src/tools/graph-query.ts](../plugins/bizar/src/tools/graph-query.ts) —
  source code

### Pre-compaction flush (v6.0.0)

- [plugins/bizar/src/hooks/memory-flush-on-compact.ts](../plugins/bizar/src/hooks/memory-flush-on-compact.ts) —
  source code
- [docs/decisions/DEC-009-pre-compaction-flush.md](decisions/DEC-009-pre-compaction-flush.md) —
  the decision

### Memory

- [plugins/bizar/src/memory-vault.ts](../plugins/bizar/src/memory-vault.ts) —
  in-process vault
- [docs/decisions/DEC-003-in-process-memory-vault.md](decisions/DEC-003-in-process-memory-vault.md)
- `bizar-dash/src/server/memory-store.mjs` — full-featured
  service (LightRAG, git sync, secret scanning)

### Agent teams

- [docs/decisions/DEC-004-cline-agent-teams.md](decisions/DEC-004-cline-agent-teams.md)
  — Claude Code agent teams (decision predates the
  Cline → Claude Code migration; concept still applies)
- [plugins/bizar/src/tools/team-spawn.ts](../plugins/bizar/src/tools/team-spawn.ts) —
  `bizar_spawn_team`
- [plugins/bizar/src/tools/team-status.ts](../plugins/bizar/src/tools/team-status.ts) —
  `bizar_team_status`

### Kanban

- [docs/decisions/DEC-006-kanban-board.md](decisions/DEC-006-kanban-board.md)
- [bizar-dash/src/web/views/Tasks.tsx](../bizar-dash/src/web/views/Tasks.tsx) —
  5-column kanban
- [bizar-dash/src/server/routes/tasks.mjs](../bizar-dash/src/server/routes/tasks.mjs) —
  12 REST endpoints

### Harness engineering (L01–L12)

- [AGENTS.md](../AGENTS.md) — entry point + L01–L12 sections
- [PROGRESS.md](../PROGRESS.md) — current state (73/73 audit)
- [docs/quality-document.md](quality-document.md) — A/B/C/D scores
- [docs/code-review.md](code-review.md) — code review findings + actions
- [templates/sprint-contract.md](../templates/sprint-contract.md) —
  L11 Observability
- [templates/evaluator-rubric.md](../templates/evaluator-rubric.md) —
  L11 Observability
- [templates/clean-state-checklist.md](../templates/clean-state-checklist.md) —
  L12 Clean State

### Claude Code migration (v6.3.0)

- [docs/migration-guide.md](migration-guide.md) — Cline → Claude
  Code upgrade guide (v6.2.x → v6.3.0)
- [CHANGELOG.md](../CHANGELOG.md) — full release history
- [docs/decisions/DEC-011-claude-code-migration.md](decisions/DEC-011-claude-code-migration.md) —
  the v6.3.0 Claude Code migration decision

### Cline rewrite (v6.0.0, historical)

- [docs/migration-guide.md](migration-guide.md) — also covers the
  v5.5.x → v6.0.0 OpenCode → Cline rewrite (archived section)
- [docs/decisions/DEC-001-cline-rewrite.md](decisions/DEC-001-cline-rewrite.md) —
  the OpenCode → Cline rewrite decision (historical)

### Release

- [CHANGELOG.md](../CHANGELOG.md) — chronological changelog
- [docs/RELEASING.md](RELEASING.md) — release process
- [.harness/traces/](../.harness/traces/) — runtime session traces

## Quick links

| What | Where |
| --- | --- |
| System description | [AGENTS.md](../AGENTS.md) (first 10 lines) |
| Hard constraints | [AGENTS.md](../AGENTS.md) § Hard constraints |
| Layer model | [docs/architecture.md](architecture.md) |
| Module map | [docs/architecture.md](architecture.md) § Module map |
| ADRs | [DECISIONS.md](../DECISIONS.md) |
| Audit score | [PROGRESS.md](../PROGRESS.md) § Current State |
| Make targets | [Makefile](../Makefile) |
| Tests | `bun test plugins/bizar` |
| E2E | `bun run /tmp/bh-full-e2e.mjs` |
| Latest release | [CHANGELOG.md](../CHANGELOG.md) (top) |

## Update policy

- ADRs are append-only. New decisions go in
  `docs/decisions/DEC-NNN-<slug>.md`.
- Topic docs are updated when the corresponding code changes.
- Module docs are updated when the module's API changes.
- This index is updated when a new doc is added or a topic is
  restructured.
