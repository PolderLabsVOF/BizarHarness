# Repository cleanup audit — 2026-07-30

## Scope

Behavior-preserving structural cleanup after the dashboard and Bizar Memory
removal. Retained Claude Code harness functionality is out of scope for redesign.

## Baseline

- Typecheck passed.
- 298 SDK tests and 267 Node tests passed.
- Package dry run contained 427 files, including 29 test files and a stale
  literal-`${HOME}` memory artifact.

## Confirmed dead tracked paths

| Path | Evidence | Planned action |
| --- | --- | --- |
| `fresh901/` | Abandoned v9.0.1 package-install fixture; no references | Delete |
| `bizar-plugins/` | Retired dashboard/deploy plugin registry; no runtime references | Delete |
| `.config/` | Accidentally committed lifecycle hook output | Delete and ignore |
| `.serena/` | User/tool-specific editor metadata; no harness references | Delete |
| `.dockerignore` | Docker surface was removed in F-116 | Delete |
| `skills-lock.json` | Old project-local Skills CLI installation record; no consumer | Delete |
| `templates/eval-fixtures/` | References removed `bizar eval` command | Delete |
| `templates/schedules/` | Unused examples for the removed scheduler runtime | Delete |

## Generated residue

Delete abandoned install trees, literal `${HOME}` paths, old package tarballs,
duplicate generated skill caches, stale logs, nested package runtime data, and
retired untracked templates. Preserve user research, dependency installations,
active OMX state, and bounded current Bizar operational records.

## Package boundary

Replace broad directory inclusion with a runtime-oriented allowlist. The tarball
must contain no test files, local state, memory paths, generated caches, duplicate
`.claude/skills`, or source-only audit fixtures.

## Fallback classification

No production masking fallback was found. Empty catches in scope are test-only
best-effort teardown or deliberate detector fixtures; neither is changed.

## Verification contract

- Executable repository/package structure regression tests
- Actual `npm pack --dry-run` inspection
- `make check`, `make test`, `make e2e`, `make clean-check`
- `make audit`, `make eval-gate`, and `make vcr`

## Result

- Deleted every confirmed dead tracked path in the inventory, plus a broken
  `.claude/skills/find-skills` cache symlink and two committed SDK runtime
  manifests.
- Removed approximately 448 MB of abandoned local fixture, tarball, cache, log,
  and malformed literal-`${HOME}` residue. User research, dependencies, active
  OMX state, and current bounded Bizar records were preserved.
- Reduced the root package from 427 files / 690,269 bytes to 259 files /
  449,561 bytes. The resulting manifest contains zero tests, duplicate
  `.claude/skills`, or local-state paths.
- Replaced dashboard/Cline/Vite-era ignore rules with current dependency,
  Claude Code, Bizar runtime, research, artifact, editor, and credential
  boundaries.
- Synchronized the root package, SDK package, and `SDK_VERSION` at `10.7.2`;
  the provisioner now reads the root manifest instead of printing a hard-coded
  historical version.
- Added `repo-structure` as an executable architecture rule with unit tests and
  actual `npm pack --dry-run` validation.
- Deleted three additional orphans: the queue reader for a removed overnight
  task file, an unwired post-merge hook targeting nonexistent audit scripts, and
  a superseded session-trace writer.
- Replaced the retained container verifier's deleted test paths and lenient
  failure masking with the current strict check/test/E2E/architecture/package
  sequence; added shell and workspace-bootstrap regression tests. A live
  Podman run from `node:22-bookworm-slim` passes the full sequence.
- Removed machine-specific Bun paths from Make/test entry points.

## Verification result

- 298 SDK tests and 276 Node/CLI/hook/script tests passed.
- E2E passed 10/10 checks.
- Architecture passed 4/4 rules.
- Clean-state passed 5/5 dimensions.
- Audit scored 10.0/10.0.
- Eval gate passed 38/38 retained features.
- The publication boundary contains 259 files, 449,561 bytes packed and
  1,386,851 bytes unpacked.
