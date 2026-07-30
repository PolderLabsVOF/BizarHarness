# PROGRESS.md — Cross-Session State

> Canonical current-work record. Update before and after implementation.

## In Progress — F-117 Repository Structure Cleanup

**Objective:** Remove confirmed obsolete files, abandoned fixtures, generated
residue, and package-boundary leaks while preserving every retained Claude Code
harness behavior.

### Behavior lock

- `make check`: passed before cleanup.
- `make test`: 298 SDK tests and 267 Node/CLI/hook/script tests passed.
- `npm pack --dry-run`: baseline captured at 427 files; the package currently
  leaks 29 test files and one stale literal-`${HOME}` memory path.

### Regression guard status

- Added unit coverage for forbidden tracked roots and publish-manifest leaks.
- Repository/package structure tests pass 5/5 and the live verifier reports a
  clean tracked tree, publication boundary, and version state.
- Container-verifier contract tests pass 3/3, including the workspace-bootstrap
  ordering regression found by the first live Podman run.

### Completed cleanup passes

- Dead tracked paths removed; the structure verifier reports no obsolete tracked
  roots.
- Package allowlist narrowed from 427 files (690,269 bytes) to 259 files
  (449,561 bytes): zero tests, duplicate `.claude/skills`, or literal-`${HOME}`
  state paths remain in the tarball.
- Removed 448 MB of abandoned local fixture/package/cache residue and rewrote
  `.gitignore` around current Claude Code, Bizar runtime, research, build, and
  credential boundaries.
- Removed the broken external skill-cache symlink and committed SDK runtime
  manifests; synchronized root/SDK version metadata at `10.7.2` and made the
  provisioner read its version from the package manifest.
- Deleted the broken overnight queue, unwired post-merge audit, and superseded
  trace writer; repaired the retained container verifier to run current strict
  gates without swallowing failures.
- Removed machine-specific Bun paths from Make/test scripts and replaced the old
  name-specific cleanup target with the executable structure/package verifier.

### Retained-script regression status

- Added a container-verifier contract covering shell syntax, workspace
  bootstrap ordering, and the current strict `make` gates.
- Live Podman verification passes from a clean `node:22-bookworm-slim`
  container: 298 SDK tests, 276 Node tests, 10/10 E2E checks, 4/4 architecture
  rules, and the repository/package structure verifier.

### Final verification

- `make check`: passed.
- `make test`: 298 SDK tests and 276 Node/CLI/hook/script tests passed.
- `make e2e`: 10/10 checks passed.
- `make check-arch`: 4/4 rules passed.
- `make verify-repo-structure`: passed.
- `make clean-check`: 5/5 dimensions passed.
- `make audit`: 10.0/10.0.
- `make eval-gate`: 38 passing, 0 failing.
- `npm pack --dry-run`: 259 files, 449,561 bytes, 1,386,851 bytes
  unpacked; no test source, duplicate skills, local state, or memory residue.

### Cleanup plan

1. Delete tracked dead paths with no retained references: the `fresh901` install
   fixture, retired `bizar-plugins` registry, committed `.config` hook log,
   project-local Serena config, obsolete Docker ignore file, root Skills CLI
   lock, retired eval fixtures, and retired schedule templates.
2. Remove local generated residue proven unrelated to source: literal `${HOME}`
   trees, package tarballs, duplicate Skills CLI caches, old resume logs,
   abandoned fixture dependencies, stale package-local runtime data, and
   already-retired template remnants.
3. Rewrite ignore/package boundaries around the current Claude Code harness;
   eliminate Cline/Vite/dashboard/memory-era rules and prevent tests, local
   state, duplicate skill mirrors, and source-only tooling from entering the
   published package.
4. Add executable repository/package structure regression checks before the
   deletion pass, then run targeted validation after each smell category.
5. Synchronize architecture, packaging, and cleanup documentation and close the
   feature only after the full test, E2E, clean-state, audit, eval, and VCR gates.

### Fallback review

- Production masking fallbacks: none found in the cleanup scope.
- Masking verification fallbacks were found in the old container script; its
  lenient install/test/validation branches were replaced with explicit failure.
- Remaining `catch {}` findings are confined to test cleanup or fixtures that
  detect swallowed errors; teardown is a grounded best-effort cleanup path.
- Documentation mentioning model fallbacks is decision guidance, not an
  alternate runtime path.
- Escalation: none required; no ambiguous cross-layer fallback is being changed.

### Explicit exclusions

- `research/` is user-owned comparative research and remains untouched.
- Root `node_modules/`, `.omx/`, and current bounded `.bizar/` operational state
  remain local runtime material, not cleanup targets during the active session.
- No retained CLI, SDK, MCP, hook, agent, command, or skill behavior is in scope
  for redesign.

### Blockers

None.
