# PROGRESS.md — Cross-Session State

> Canonical current-work record. Update before and after implementation.

## Current State — F-116 Complete

**Objective achieved:** Audited every retained Bizar feature, removed the
complete web control plane and Bizar note-vault/search system, and adapted the
applicable autonomous/human-approval workflows from
`fcakyon/claude-codex-settings`.

**Authoritative upstream:** `fcakyon/claude-codex-settings` commit
`39b67e9d244124a575d648364b19e85c510e48a8` (2026-07-29).

**Implementation commit:** `0f1090f` — `refactor: rebuild Bizar as a guarded
Claude Code harness`.

### Completed implementation

- Deleted the dashboard, local artifact editor, browser extensions/bookmarklet,
  web-service/deployment plumbing, UI dependencies, application E2E suite, old
  plugin compatibility package, and obsolete documentation.
- Deleted the Bizar note-vault/search implementation, memory MCP tools, SDK
  exports/dist artifacts, CLI/service commands, skills, settings, integrations,
  tests, and stale ignored project state.
- Added executable removal and SDK network-boundary checks.
- Ported guarded Git/PR workflows, simplify-before-commit, content-style,
  intelligent compaction, bounded advisor context, and local-only telemetry.
- Updated Claude settings and provisioning for explicit ask/deny boundaries,
  optional Auto policy, portable hooks, and the official agent-browser MCP.
- Re-audited retained CLI/SDK/agent behavior and fixed current API/runtime drift:
  CubeSandbox, agent-browser, provider setup, RCA, migration, runtime paths,
  sprint parsing, schedule claims, agent identities, and generated SDK cleanup.
- Added retained-feature and upstream-parity matrices under `docs/audits/`.

### Verification evidence

- `make check`: passed.
- `make test`: 298 SDK tests and 268 Node/CLI/hook/script tests passed.
- `make e2e`: 10/10 core Claude Code integration checks passed.
- `make clean-check`: 5/5 dimensions passed.
- `make audit`: 10.0/10.0 across all 12 categories.
- `make check-arch`: 3/3 executable architecture rules passed.
- Removed-surface verifier: dashboard and Bizar note-vault/search surfaces absent.
- Skill mirror: 65 canonical skills, 65 synchronized, 0 orphans.
- Agent check: 16 unique agent identities, all shared-contract references valid.

### Sprint scoring — F-116

| Dimension             | Score | Evidence                                      |
| --------------------- | ----- | --------------------------------------------- |
| Correctness           | A     | Compile, unit/integration, and E2E gates green |
| Arch compliance       | A     | `make check-arch` passed 3/3                  |
| Test coverage         | A     | 566 tests plus 10 E2E checks passed           |
| Verification evidence | A     | Commit `0f1090f` plus recorded gate output    |

### Closure verification

- `make eval-gate`: 37/37 retained features passed. Local JSONL pass rates are
  enforced when present; clean checkouts use tracked commit-backed evidence.
- `make vcr`: 37/37 = 1.000.
- Post-ledger `make check`, `make clean-check`, `make audit`, `make check-arch`,
  and the removed-surface verifier all passed.

### Next Steps

No active feature. Select a new `not_started` feature before further code work.

### Blockers

None.
