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
