# PROGRESS.md — Cross-Session State

> This file is the single source of truth for current work. Update it before and after implementation changes.

## In Progress — F-116 Core Harness Audit, Dashboard Removal, and Autonomous/HITL Workflow Parity

**Objective:** Audit every non-dashboard Bizar Harness feature, remove `bizar-dash/` and all dashboard functionality, and port the applicable workflows, hooks, and autonomous/human-in-the-loop behavior from `fcakyon/claude-codex-settings` into Bizar.

**Authoritative upstream:** `https://github.com/fcakyon/claude-codex-settings`, commit `39b67e9d244124a575d648364b19e85c510e48a8` (2026-07-29).

### Baseline evidence (2026-07-30)

- `make check` passes TypeScript with zero errors.
- `feature_list.json` is malformed at HEAD because two adjacent `vcr` objects are missing a comma; repair is the first state change.
- `PROGRESS.md` previously described an obsolete v8 dashboard rewrite and contradicted the active user objective.
- Dashboard code and functionality are spread across `bizar-dash/`, root build/dev scripts, dashboard E2E tests, package dependencies, install/provision flows, Docker/deploy files, docs, feature state, bookmarklet/browser-extension integrations, and SDK/CLI references.
- Upstream inventory contains eight hook-bearing plugins: `claude-telemetry-hooks`, `claude-tools`, `codex-advisor`, `fable-advisor`, `github-dev`, `humanize`, `intelligent-compact`, `simplify`, plus Tavily and Ultralytics hook suites that require applicability review.
- OMX Ralplan preflight returned `unsupported_documented_leader_proof`; no adapted role or fabricated delegation authority will be used. Work continues directly in the primary lane.

### Current work

1. Feature ledger repaired; F-116 is active and WIP=1 is restored.
2. Produce a requirement and parity matrix for current Bizar features and the upstream workflows/hooks.
3. Remove all dashboard surfaces without deleting non-dashboard harness capabilities that need relocation.
4. Implement the applicable autonomous and human-approval workflows with tests.
5. Update architecture, install, release, and user documentation.
6. Verify with targeted tests, `make check-arch`, `make test`, `make e2e`, `make clean-check`, and `make check`.

### Stop condition

F-116 remains active until the dashboard is absent from code, packaging, install/runtime commands, dependencies, docs, tests, and feature state; the non-dashboard audit and upstream parity matrix are complete; every selected workflow/hook is installed and exercised; all required verification layers pass; and a final requirement-by-requirement audit proves the user objective.

### Blockers

None. Consensus-role routing is unavailable on this leader proof surface, but direct implementation and verification remain available.
