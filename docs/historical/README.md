# Historical artifacts

This directory preserves the retired Bizar task/progress state for
traceability only. **It is not live planning state** and Bizar agents
MUST NOT read it to drive new work.

## Why it exists

From 2026-09-04 (commit `b691a25`) through 2026-09-05, Bizar migrated
its durable planning surface to OpenKan `.ok/` (PRD
`prd-zxfjEL_3`, task `tsk-T1Aobcjj`). The legacy file formats below
were the only live state for years of agent coordination; they are
preserved here as historical evidence, not as input to new workflows.

| File | Retired surface | Live replacement |
|---|---|---|
| `feature_list.legacy.json` | Bizar `feature_list.json` (per-feature state, layers, evidence) | OpenKan tasks under `.ok/tasks/` |
| `PROGRESS.legacy.md` | Bizar `PROGRESS.md` cross-session notes | OpenKan task `evidence` + plan `acceptance` + PRD `goals` |

## What replaced it

- **Tasks** — `bizar task list`, `bizar task claim`, `bizar task complete` (OpenKan-backed)
- **Plans** — `bizar plan list`, `bizar plan show` (OpenKan-backed, schema `ok.plan.v1`)
- **PRDs / Goals** — `bizar goals list`, `bizar goals show` (OpenKan-backed, schema `ok.prd.v1`)
- **Scoping / leases** — `bizar claim <task-id>` (OpenKan lease under `.ok/locks/`)
- **Bootstrapping** — `bizar openkan init` creates `.ok/` if absent
- **Audit / verification** — `make audit` reports `openKanState` (replaces `featureListState`)

## What MUST NOT happen

- New tasks MUST NOT be added to `feature_list.legacy.json`.
- New progress notes MUST NOT be added to `PROGRESS.legacy.md`.
- Hooks, scripts, agents, or skills MUST NOT read these files at runtime.
- AGENTS.md, CLAUDE.md, and the agent frontmatter describe OpenKan as the
  only durable planning surface; the entries here are intentionally
  excluded from that contract.
