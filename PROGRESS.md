# PROGRESS.md — Cross-Session State

> Canonical current-work record. Update before and after implementation.

## In Progress — F-116 Core Harness Audit, Retired-Surface Removal, and Guarded Workflow Parity

**Objective:** Audit every retained Bizar feature, remove the complete web
control plane and Bizar note-vault/search system, and adapt the applicable
autonomous/human-approval workflows from `fcakyon/claude-codex-settings`.

**Authoritative upstream:** `fcakyon/claude-codex-settings` commit
`39b67e9d244124a575d648364b19e85c510e48a8` (2026-07-29).

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

### Fresh evidence

- `make check`: passed.
- `make test`: 298 SDK tests and 267 Node/CLI/hook/script tests passed.
- `make e2e`: 10/10 core Claude Code integration checks passed.
- `make clean-check`: 5/5 dimensions passed.
- `make audit`: 10.0/10.0 across all 12 categories.
- `make check-arch`: 3/3 executable architecture rules passed.
- Removed-surface verifier: dashboard and Bizar note-vault/search surfaces absent.
- Skill mirror: 65 canonical skills, 65 synchronized, 0 orphans.
- Agent check: 16 unique agent identities, all shared-contract references valid.

### Current state

The implementation tree is verified and ready for its atomic core-audit commit.
F-116 remains the only active feature until that commit hash can be recorded in
`feature_list.json`; the final closure commit will then mark it passing and
record the eval evidence.

### Blockers

None.
