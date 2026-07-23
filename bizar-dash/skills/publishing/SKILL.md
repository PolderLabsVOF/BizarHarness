---
name: publishing
description: Cut and publish a release of BizarHarness (@polderlabs/bizar). Use when bumping version, updating CHANGELOG, committing release commits, tagging, pushing, or publishing to npm. Covers the 4 test runners, version bump rules, hotfixes, and 10 known pitfalls.
---

# Publishing BizarHarness

Cut a release of `@polderlabs/bizar`. Read `/home/drb0rk/Projects/BizarHarness/docs/RELEASING.md` for the comprehensive guide; this skill is the action-oriented checklist.

## Pre-flight (must all be true)

```bash
git status --short                                # empty
git branch --show-current                         # master
npm whoami                                        # drb0rk
```

## Test gate (all 4 runners must pass)

```bash
npx tsc --noEmit                                  # 0 errors
npm test                                          # 388 node + 75 SDK + 295 bun + 7 smoke = 765 pass
npm run build                                     # 0 errors
```

Counts above are post-v4.7.0 (commit `3005611`, tag `v4.7.0`).

## Doc updates (in order)

1. **`CHANGELOG.md`** — add `## vX.Y.Z — short title` at top, sections: Highlights / What's New / Tests / Upgrade.
2. **`package.json`** — bump `"version"` field.
3. **`.bizar/PROJECT.md`** — bump `Current Version` line.
4. **`.bizar/AGENTS_SELF_IMPROVEMENT.md`** — append `### YYYY-MM-DD — vX.Y.Z` entry under `## Log`.

## Release sequence

```bash
# Pre-flight + tests + build (see above)

# Commit (hand off to Hermod for write-level git)
git add -A
git commit -m "vX.Y.Z: short title

Highlights:
- bullet 1
- bullet 2
- bullet 3

Tests: <N> pass / 0 fail across <M> runners.
tsc: clean. build: <main> KB + <mobile> KB."

# Tag
git tag -a vX.Y.Z -m "vX.Y.Z — short title"

# Push
git push origin master --follow-tags

# Publish (prepublishOnly runs build automatically)
npm publish

# Verify
npm view @polderlabs/bizar@X.Y.Z version
git ls-remote --tags origin | grep vX.Y.Z
```

## Versioning

| Bump | When |
|---|---|
| Patch | Bug fixes only |
| Minor | New features, behavior-preserving changes |
| Major | Breaking changes requiring user action |

When in doubt, ask the user.

## Hotfix

```bash
git checkout -b hotfix/vX.Y.Z+1 vX.Y.Z
# make minimal fix
npx tsc --noEmit && npm test && npm run build
# bump version, update CHANGELOG with "Hotfix" entry
git add -A && git commit -m "vX.Y.Z+1: hotfix — ..."
git tag -a vX.Y.Z+1 -m "vX.Y.Z+1 — Hotfix: ..."
git push origin hotfix/vX.Y.Z+1 --follow-tags
git checkout master && git merge --no-ff hotfix/vX.Y.Z+1
git push origin master
npm publish
```

## Rollback

`npm unpublish` is almost never right (breaks existing installs, 72h limit). Prefer:

```bash
npm deprecate @polderlabs/bizar@X.Y.Z "Critical bug; use X.Y.Z-1 instead"
# then cut a new patch with the fix
```

## 10 pitfalls (avoid these)

1. **Auth is NOT needed in v1 routes.** Tailscale handles it. Don't add auth during a release refactor.
2. **`--help` global vs per-subcommand.** `bizar --help` ≠ `bizar <cmd> --help`. Test both.
3. **Pre-existing merge conflict markers.** `grep -c '<<<<<<<\|>>>>>>>' <file>` before declaring a file clean. TS1185 will fail otherwise.
4. **Source maps.** `vite.config.ts` must have `sourcemap: 'hidden'`. Don't ship 3 MB of maps.
5. **Empty catch blocks.** Replace `catch { /* ignore */ }` with `catch (err) { logger.warn('swallowed in <ctx>:', err.message); }`.
6. **Sibling collisions.** Define `Owns (read+write)` and `Siblings READ-ONLY` before dispatching parallel streams.
7. **Test imports after refactor.** `grep -rn 'from.*<old-path>' <test-dirs>` to find stale imports.
8. **`npm publish` requires version bump.** Re-publishing the same version is rejected.
9. **`prepublishOnly` runs build.** Don't run build separately before publish — it runs anyway.
10. **`npm view` propagation delay.** New version may 404 for ~5s after publish. Retry.

## Agent routing

| Agent | Release role |
|---|---|
| Odin | Decompose release into parallel prep streams |
| Heimdall | Mechanical edits (bump `package.json`, append to AGENTS_SELF_IMPROVEMENT.md) |
| Mimir | Research prior releases, summarize changes |
| Thor | CHANGELOG drafting, test additions |
| Tyr | Full release orchestration, breaking-change analysis |
| **Hermod** | **The only agent that runs `git commit`, `git tag`, `git push`, `npm publish`** |
| Forseti | Review the release plan (when called by Odin) |

If a non-Hermod agent tries to push or publish, stop — route to Hermod via handoff.

## Post-release verification

```bash
npm view @polderlabs/bizar version                          # X.Y.Z
npm view @polderlabs/bizar@X.Y.Z dist.tarball                # registry URL
git ls-remote --tags origin | grep vX.Y.Z                   # tag visible

# Smoke test in a clean dir
mkdir /tmp/bizar-smoke && cd /tmp/bizar-smoke
npm install -g @polderlabs/bizar@X.Y.Z
bizar --version                                             # X.Y.Z
bizar doctor                                                # exit 0
```

## Reference

- Comprehensive guide: `docs/RELEASING.md` (~600 lines, all details)
- Most recent release: **v4.7.0** (commit `3005611`, tag `v4.7.0`, npm `@polderlabs/bizar@4.7.0`)
- Diff stats: 62 files, +7,361 / −4,083 lines
- Test counts: 388 node + 75 vitest + 295 bun + 7 smoke = **765 pass, 0 fail**
- Build: 372 KB main + 476 KB mobile JS bundles