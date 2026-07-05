# Releasing BizarHarness

A comprehensive guide to cutting a release of `@polderlabs/bizar`. This document is written for both humans and agents — it is the canonical reference for any agent orchestrating a release (Odin, Thor, Tyr, Vidarr, Heimdall).

The most recent release as of this writing is **v4.7.0** (commit `3005611`, tag `v4.7.0`, published as `@polderlabs/bizar@4.7.0`). It shipped:

- 62 files changed, **+7,361 / −4,083 lines**
- **388 npm tests + 75 vitest tests = 463 pass, 0 fail** (plus 295 bun plugin tests = **765 total**)
- `npx tsc --noEmit` clean (0 errors)
- `npm run build` succeeded (372 KB main + 476 KB mobile JS bundles)
- Tag pushed to `origin`, package published to npm

This guide uses v4.7.0 as the worked example throughout.

---

## 1. Overview

### What this guide is for

A complete, copy-pasteable procedure for cutting, validating, and publishing a release of BizarHarness to the npm registry and the `DrB0rk/BizarHarness` GitHub repo. It covers:

- Pre-flight checks (tests, types, build, docs)
- Version bumping and CHANGELOG discipline
- Commit, tag, push, publish flow
- Verification steps on both npm and Git remotes
- Hotfixes and rollbacks
- 10 real pitfalls learned from prior releases (v4.5.2, v4.7.0)

### Who should use it

| Role | Use this when |
|---|---|
| **Odin** (router) | Decomposing a release request into parallel prep streams (CHANGELOG, tests, docs, bump) |
| **Thor** (M2.7) | Mid-complexity release prep: bumping versions, updating CHANGELOG, running tests |
| **Tyr** (M3) | Complex releases with breaking changes, large refactors, multi-stream coordination |
| **Vidarr** (last resort) | When a release is blocked by a subtle issue Thor/Tyr cannot resolve |
| **Heimdall** (free) | Mechanical edits: bumping `version` in `package.json`, appending to `AGENTS_SELF_IMPROVEMENT.md` |
| **Hermod** (git) | The final `git commit` + `git tag` + `git push` + `npm publish` sequence — only agent with write-level git |

### Critical reminders

- **Auth is handled by Tailscale, not the dashboard.** When refactoring v1 routes, do NOT add auth middleware — that is explicitly out of scope for releases and is the responsibility of the deployment operator's network.
- **Always use `--agent` explicitly when spawning sub-agents.** The `--title` is UI-only; `--agent` is the sole discriminator for model routing. This applies to release prep work too.
- **The release agent is typically Hermod.** Only Hermod has write-level git permissions. Other agents must hand off commit/tag/push/publish to Hermod via a clear handoff (commit message body, file list, target version).
- **npm auth must be valid before you start.** `npm whoami` should return `drb0rk`. If it returns nothing or errors, stop and re-auth before proceeding.
- **`prepublishOnly` runs `npm run build` automatically.** Do not run build separately before publish — you will run it twice.

---

## 2. Pre-release checklist

Run every check before bumping the version. If any check fails, fix it first — never publish on a red build.

### 2.1 Environment checks

```bash
# Working tree clean (no uncommitted changes, no untracked files)
git status --short
# Expected: empty output

# On master branch
git branch --show-current
# Expected: master

# npm auth works
npm whoami
# Expected: drb0rk
```

### 2.2 Test gate (all 4 runners must pass)

BizarHarness has **four test runners**. The canonical `npm test` script runs them in sequence via `&&`. If any fails, the release is blocked.

```bash
# 1. TypeScript (cheapest correctness check)
npx tsc --noEmit
# Expected: exits 0, no output

# 2. Vitest (web components + SDK)
npm run test:sdk
# Expected: 75 tests pass, 0 fail (post-v4.7.0)

# 3. Bun (opencode plugin)
bun test plugins/bizar/tests/loop.test.ts \
          plugins/bizar/tests/block.test.ts \
          plugins/bizar/tests/stall-think.test.ts \
          plugins/bizar/tests/tools/bg-get-comments.test.ts \
          plugins/bizar/tests/tools/bg-spawn-delegation.test.ts \
          plugins/bizar/tests/tools/opencode-runner.test.ts \
          plugins/bizar/tests/settings.test.ts \
          plugins/bizar/tests/commands.test.ts \
          plugins/bizar/tests/commands-impl.test.ts \
          plugins/bizar/tests/tools/plan-action.test.ts \
          plugins/bizar/tests/tools/wait-for-feedback.test.ts \
          plugins/bizar/tests/tools/read-glyph-feedback.test.ts \
          plugins/bizar/tests/reasoning-clean.test.ts \
          plugins/bizar/tests/key-rotation.test.ts
# Expected: 295 tests pass, 0 fail

# 4. Node --test (dashboard server) + smoke test
node --test bizar-dash/tests/*.test.mjs \
      && node bizar-dash/tests/smoke-v2.mjs
# Expected: 388 tests pass + 7 smoke checks
```

**Total after v4.7.0: 765 tests across 4 runners, all green.**

If you want a single command, `npm test` runs typecheck + SDK + bun + node + smoke in sequence and is the canonical gate.

### 2.3 Build check

```bash
npm run build
# Runs: build:sdk (tsc for packages/sdk) && build:dash (vite)
# Expected: succeeds; check final output line for main + mobile bundle sizes
# v4.7.0: 372 KB main + 476 KB mobile
```

### 2.4 Doc updates

Before bumping the version, update these files (the version bump itself is the LAST edit):

```bash
# 1. CHANGELOG.md — add new version entry at TOP (below the # Changelog header)
#    Sections: Title → Highlights → What's New → Tests → Upgrade

# 2. package.json — bump "version" field

# 3. .bizar/PROJECT.md — bump "Current Version" line, add "Recently Shipped" entry

# 4. .bizar/AGENTS_SELF_IMPROVEMENT.md — append "### YYYY-MM-DD — vX.Y.Z" entry

# 5. SUGGESTIONS.md (only if roadmap changed) — update "Next" section
```

The order matters: write the CHANGELOG entry **before** bumping `package.json` so the CHANGELOG commit and the bump commit can be separate (or one combined commit if you prefer; v4.7.0 used a single combined commit).

---

## 3. Step-by-step release process

This is the canonical sequence. Each step is a separate bash invocation; do not chain unrelated commands because failures need to be diagnosed individually.

### Step 1 — Pre-flight

```bash
git status --short                                # must be empty
git branch --show-current                         # master
npm whoami                                        # drb0rk
cat package.json | grep '"version"'               # current version
```

### Step 2 — Update CHANGELOG.md

Open `CHANGELOG.md` and add a new entry **at the top**, below the `# Changelog` header. Use this template:

```markdown
## vX.Y.Z — short title

### Highlights

Two-or-three-bullet summary of the most important changes.

### What's New

Grouped lists by area: CLI, Server, Frontend, Tests, Build, Docs.

### Tests

- New tests added (count)
- Total `npm test`: <N> pass / 0 fail
- Total `npm run test:web`: <N> pass / 0 fail
- `npx tsc --noEmit`: 0 errors
- `npm run build`: success (<main> KB main + <mobile> KB mobile JS bundles)

### Upgrade

`npm install -g @polderlabs/bizar@X.Y.Z`
```

The v4.7.0 entry ran ~75 lines (the longest entry so far) because it combined v4.6 + v4.7 into one release. Shorter entries (~20-30 lines) are normal.

### Step 3 — Update package.json

```bash
# Manual edit, or via sed:
sed -i 's/"version": "X.Y.Z"/"version": "X.Y.Z+1"/' package.json
```

Verify:

```bash
cat package.json | grep '"version"'
# Expected: "version": "X.Y.Z+1",
```

### Step 4 — Update .bizar/PROJECT.md

Two edits:

1. Bump the `## Current Version` line:
   ```markdown
   ## Current Version

   - v4.7.0 — Quality & Stability + Performance & Polish release (...)
   ```
2. Update or add a `## Recently Shipped` section if it doesn't exist for this version.

### Step 5 — Update .bizar/AGENTS_SELF_IMPROVEMENT.md

Append a new entry below the existing `## Log` section. Use this template (the project uses these headings consistently):

```markdown
### YYYY-MM-DD — vX.Y.Z — short title

- **Task**: One-line description of what shipped.
- **Approach**: Number of agents, parallel/solo, key decisions.
- **Lessons learned**: 3-5 bullet points of agent-behavior improvements.
- **Files changed**: <count> files, key paths.
- **Agents used**: Odin (router), Thor/Tyr (impl), Hermod (publish).
- **Published**: `@polderlabs/bizar@X.Y.Z` (commit `<sha>`, tag `vX.Y.Z`).
```

### Step 6 — Run full test gate

```bash
npx tsc --noEmit                                       # 0 errors
npm test                                               # 388 pass + 75 SDK + 295 bun + 7 smoke
```

If `npm test` fails, fix the failures and re-run. Do NOT proceed.

### Step 7 — Verify build

```bash
npm run build                                          # succeeds
ls -lh bizar-dash/dist/assets/*.js                    # verify bundle sizes
```

Expected after v4.7.0: `index-<hash>.js` (~372 KB) and `mobile-<hash>.js` (~476 KB). These are reasonable for a React app with code-splitting. If a bundle balloons >1 MB, audit your imports.

### Step 8 — Commit

Hand off to **Hermod** for the commit (only agent with write-level git):

```bash
git add -A
git commit -m "vX.Y.Z: short title

Highlights:
- Bullet 1
- Bullet 2
- Bullet 3

Tests: <N> pass / 0 fail across <M> runners.
tsc: clean. build: <main> KB + <mobile> KB.

Co-authored-by: Odin <noreply@polderlabs.dev>
Co-authored-by: Thor <noreply@polderlabs.dev>
Co-authored-by: Tyr <noreply@polderlabs.dev>"
```

Use `Co-authored-by:` trailers for each agent that contributed. v4.7.0 used a multi-paragraph commit body with a `Highlights:` block — this is preferred over a single-line commit.

### Step 9 — Tag

```bash
git tag -a vX.Y.Z -m "vX.Y.Z — short title"
```

Annotated tags (`-a`) carry the message into `git show vX.Y.Z` output. Lightweight tags (`vX.Y.Z` without `-a`) do not. Always use annotated.

### Step 10 — Push

```bash
git push origin master --follow-tags
```

`--follow-tags` pushes the tag along with the commit. If you forget this, the tag stays local and the GitHub release / npm publish will reference a SHA that no one can browse.

### Step 11 — Publish

```bash
npm publish
```

This runs `prepublishOnly` (`npm run build`) automatically. If build fails here, the publish aborts and nothing is published. The npm CLI will print:

```
+ @polderlabs/bizar@X.Y.Z
```

### Step 12 — Verify

```bash
# Confirm npm registry
npm view @polderlabs/bizar version
npm view @polderlabs/bizar@X.Y.Z version
npm view @polderlabs/bizar@X.Y.Z dist.tarball

# Confirm git tag
git ls-remote --tags origin | grep vX.Y.Z
# Expected: <sha>	refs/tags/vX.Y.Z
#            <sha>	refs/tags/vX.Y.Z^{}    (peeled commit)
```

If `npm view` returns 404 for the new version, wait ~5 seconds and retry — npm registry propagation is not instant.

---

## 4. The four test runners (IMPORTANT)

BizarHarness uses **four** distinct test runners because each runner targets a different runtime. They are **not interchangeable** — all four must pass.

| Runner | What it tests | Why this runner | Expected count (post-v4.7.0) |
|---|---|---|---|
| `node --test` | Dashboard server (HTTP routes, memory store, providers-store, mods loader, etc.) | Node's built-in test runner — no extra deps, runs anywhere | 388 |
| `vitest` | Web components, hooks, lib utilities (jsdom + RTL) | Vitest with jsdom is the only sane way to test React components without a full browser | 75 |
| `bun test` | opencode plugin (background agents, commands, tools, key rotation, settings) | Plugin code uses Bun-specific APIs (`Bun.file`, `Bun.serve`, etc.) | 295 |
| `node bizar-dash/tests/smoke-v2.mjs` | End-to-end smoke (server starts, snapshot loads, basic API calls) | The integration test that proves the parts work together | 7 |

**Total: 765 tests.** If any single runner fails, the release is blocked.

The `npm test` script in `package.json` runs them in this sequence via `&&`:

```bash
npm run typecheck && \
  npm run test:sdk && \
  bun test plugins/bizar/tests/*.test.ts && \
  node bizar-dash/tests/smoke-v2.mjs && \
  node --test bizar-dash/tests/*.test.mjs
```

If you add a new test file, append it to the `npm test` script. If you add a new test runner (e.g., `deno test`), add it as a new step.

---

## 5. Versioning rules

BizarHarness follows [Semantic Versioning 2.0.0](https://semver.org/):

| Bump type | When | Examples |
|---|---|---|
| **Patch** (`X.Y.Z` → `X.Y.Z+1`) | Bug fixes only, no new features, no API changes | v4.5.1 (Headroom default compression fix) |
| **Minor** (`X.Y.Z` → `X.Y+1.0`) | New features, possibly with breaking changes documented in upgrade guide | v4.7.0 (CLI refactor — still semver-minor because external CLI surface was preserved) |
| **Major** (`X.Y.Z` → `X+1.0.0`) | Breaking changes that require user action (config migrations, removed APIs) | v4.0.0 (consolidated to single npm package, broke old multi-package consumers) |

**When in doubt, ask the user.** A wrongly-versioned release is much harder to fix than a 10-second conversation about which bucket a change belongs in.

The most recent three releases demonstrate the spectrum:

- **v4.5.1** — patch (single bugfix)
- **v4.5.2** — patch (16-bug sweep across CLI/server/frontend/build, but all behavior-preserving)
- **v4.7.0** — minor (CLI internals refactored; no user-facing breakage but significant internal restructuring)

---

## 6. Common pitfalls (from actual releases)

These are real issues that came up during prior releases (v4.5.0, v4.5.1, v4.5.2, v4.7.0). Each one cost at least one round-trip to diagnose. Avoid them by reading this section before starting.

### 6.1 Auth is NOT needed in v1 routes

**Tailscale handles authentication.** When refactoring v1 routes, do NOT add auth middleware. This was explicitly called out in the v4.5.2 release notes as "auth-related items intentionally skipped — Tailscale handles auth." If you find yourself wanting to add a `req.user` check, stop and ask: is this a release-time concern or a deployment-time concern? It's always the latter.

### 6.2 `--help` global vs per-subcommand

`bizar --help` shows global help (lists all commands). `bizar <cmd> --help` shows the specific subcommand's help. The CLI refactor in v4.6 had to make BOTH work — fixing one but not the other is a regression. If you change the command router, run both invocations before declaring done.

### 6.3 Pre-existing merge conflict markers

After a rebase or merge, files sometimes contain leftover `<<<<<<<` / `>>>>>>>` markers. TypeScript will fail with:

```
error TS1185: Merge conflict marker encountered.
```

**Before declaring a file clean**, run:

```bash
grep -c '<<<<<<<\|>>>>>>>' <file>
```

Expected: `0` (or `grep` exits non-zero). The `.bizar/AGENTS_SELF_IMPROVEMENT.md` Active Rules already calls this out as a mandatory pre-step for any parallel work — apply it here too.

### 6.4 Source maps

The npm tarball should NOT include ~3 MB of source maps. Set `sourcemap: 'hidden'` in `vite.config.ts` — this generates maps for stack-trace resolution but excludes them from the published bundle:

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    sourcemap: 'hidden',  // ← this is the magic line
  },
});
```

Also verify `.npmignore` excludes `dist/**/*.map`. The v4.5.2 release added this fix and shaved ~3 MB off the published tarball.

### 6.5 Empty catch blocks

`catch { /* ignore */ }` hides errors. Replace with structured logging:

```javascript
catch (err) {
  logger.warn('swallowed in <context>:', err.message);
}
```

Empty catches are a top-three source of "works on my machine" bugs. If you see one during a refactor, fix it before committing. The v4.5.2 release swept 6 such cases in `memory-lightrag.mjs`.

### 6.6 Sibling collisions

When dispatching parallel streams (e.g., CHANGELOG update + bump + tests + docs in parallel), each agent MUST have a disjoint file scope. Define upfront:

```markdown
Agent A: Owns (read+write) CHANGELOG.md
Agent B: Owns (read+write) package.json
Agent C: Owns (read+write) .bizar/PROJECT.md
Agent D: Owns (read+write) .bizar/AGENTS_SELF_IMPROVEMENT.md
Siblings READ-ONLY: each other's files
```

If two agents write the same file, you get silent last-writer-wins data loss. The `.bizar/AGENTS_SELF_IMPROVEMENT.md` Active Rules #2 makes this mandatory for multi-stream work.

### 6.7 Test imports after refactor

When moving code between files (e.g., extracting `cli/bin.mjs` into `cli/commands/*.mjs`), grep all tests for imports from the old path:

```bash
grep -rn 'from.*cli/bin\.mjs' bizar-dash/tests/ plugins/bizar/tests/ packages/sdk/tests/
```

Stale imports will fail at runtime, not at typecheck. v4.6's CLI refactor moved ~1,200 lines of code; every test that imported from the old monolith had to be updated.

### 6.8 `npm publish` requires version bump

If you try to publish the same version twice, npm rejects with `You cannot publish over the previously published versions`. **Always bump before publish.** If you discover you forgot to bump after a failed publish, bump and try again — npm does not cache "published-but-not-tagged" state.

### 6.9 `prepublishOnly` runs build

The `package.json` script:

```json
"prepublishOnly": "npm run build"
```

runs automatically before `npm publish`. Do not run build separately before publish — you will run it twice and waste 30 seconds. If you ran the build in Step 7 (Verify build), trust that result and let `prepublishOnly` re-run it.

### 6.10 `npm view` propagation delay

After `npm publish` succeeds, `npm view @polderlabs/bizar@X.Y.Z` may 404 for ~5 seconds while the registry propagates. This is not a publish failure — it's a CDN cache. Retry after 5-10 seconds.

---

## 7. Post-release verification

After publish, run this verification suite in a fresh shell:

```bash
# 1. Confirm npm registry has the new version
npm view @polderlabs/bizar version
# Expected: X.Y.Z (the version you just published)

npm view @polderlabs/bizar@X.Y.Z dist.tarball
# Expected: https://registry.npmjs.org/@polderlabs/bizar/-/bizar-X.Y.Z.tgz

# 2. Confirm git tag exists on origin
git ls-remote --tags origin | grep vX.Y.Z
# Expected:
#   <sha>	refs/tags/vX.Y.Z
#   <sha>	refs/tags/vX.Y.Z^{}

# 3. Smoke-test the install (in a clean dir, NOT the BizarHarness repo)
mkdir -p /tmp/bizar-smoke && cd /tmp/bizar-smoke
npm install -g @polderlabs/bizar@X.Y.Z
bizar --version
# Expected: X.Y.Z

bizar doctor
# Expected: exits 0 (or prints warnings, but exits 0)

# 4. Verify the install hooks work (optional, for major releases)
bizar install --check
bizar dash start --help
```

If any check fails, see Section 9 (Rolling back).

---

## 8. Hotfix process

When a release ships a critical bug (data loss, security issue, hard crash on common paths), cut a hotfix:

1. **Identify the broken commit.** `git log --oneline -20` and read the commit messages. The bug was likely introduced in the most recent release commit.

2. **Create a hotfix branch from the released tag:**
   ```bash
   git checkout -b hotfix/vX.Y.Z+1 vX.Y.Z
   ```

3. **Make the minimal fix.** Do NOT refactor adjacent code. Do NOT add features. One commit, one purpose.

4. **Run the full test gate:**
   ```bash
   npx tsc --noEmit
   npm test
   npm run build
   ```

5. **Bump the version (patch only):**
   ```bash
   # package.json: "version": "X.Y.Z" → "X.Y.Z+1"
   ```

6. **Update CHANGELOG with a "Hotfix" entry.** Add it ABOVE the broken version:
   ```markdown
   ## vX.Y.Z+1 — Hotfix: <one-line description of fix>

   ### Highlights

   - Fixes <bug> introduced in vX.Y.Z. See upgrade notes.

   ### Tests

   - <count> new regression tests
   - Total `npm test`: <N> pass / 0 fail
   ```

7. **Commit, tag, push, publish:**
   ```bash
   git add -A
   git commit -m "vX.Y.Z+1: hotfix — <short description>"
   git tag -a vX.Y.Z+1 -m "vX.Y.Z+1 — Hotfix: <short description>"
   git push origin hotfix/vX.Y.Z+1 --follow-tags
   # Then merge back to master:
   git checkout master
   git merge --no-ff hotfix/vX.Y.Z+1
   git push origin master
   npm publish
   ```

8. **Verify.** Run Section 7.

---

## 9. Rolling back a release

`npm unpublish` is **almost never the right answer**. It is only allowed within 72 hours of publish AND it breaks installations of the broken version (anyone who already installed will see broken state on next `npm install`). The correct path is:

```bash
# 1. Deprecate the broken version
npm deprecate @polderlabs/bizar@X.Y.Z "Critical bug in <feature>; use X.Y.Z-1 instead. See <link>."

# 2. Cut a new patch version with the fix (Section 8)
```

The deprecation message appears whenever someone tries to install that specific version, but the version remains available for users who explicitly pin it. This is the standard npm convention for "this release was bad, do not use it."

Only unpublish if:
- The package was published with **private/secrets** in it (auth tokens, internal URLs)
- **No installs have happened** in the 72-hour window (check `npm view @polderlabs/bizar@X.Y.Z` for install counts)
- The user explicitly authorizes unpublish

In all other cases: deprecate + new patch.

---

## 10. The Bizar Release Checklist (copy-paste)

This is the canonical pre-release checklist. Copy it into the agent's working memory at the start of a release flow.

```markdown
## vX.Y.Z Release Checklist

### Pre-flight
- [ ] Working tree clean: `git status --short` returns empty
- [ ] On master branch: `git branch --show-current` → master
- [ ] npm auth works: `npm whoami` returns drb0rk
- [ ] All 4 test runners pass:
  - [ ] `npx tsc --noEmit` exits 0
  - [ ] `npm test` passes (388 expected for node + 75 for SDK + 295 for bun + 7 for smoke)
  - [ ] `npm run test:sdk` passes
  - [ ] `bun test plugins/bizar/tests/...` passes (295 expected)
  - [ ] `node bizar-dash/tests/smoke-v2.mjs` passes (7 expected)
- [ ] Build succeeds: `npm run build`

### Documentation
- [ ] CHANGELOG.md has vX.Y.Z entry at top
- [ ] package.json version bumped
- [ ] .bizar/PROJECT.md Current Version bumped
- [ ] .bizar/AGENTS_SELF_IMPROVEMENT.md has new entry appended
- [ ] SUGGESTIONS.md updated (if roadmap changed)

### Release
- [ ] Commit: `git add -A && git commit -m "vX.Y.Z: ..."`
- [ ] Tag: `git tag -a vX.Y.Z -m "..."`
- [ ] Push: `git push origin master --follow-tags`
- [ ] Publish: `npm publish`
- [ ] Verify: `npm view @polderlabs/bizar@X.Y.Z version`

### Post-release
- [ ] Confirm npm registry updated
- [ ] Confirm git tag on origin
- [ ] Smoke test the install in a clean dir
- [ ] Notify users (if breaking change)
```

---

## Appendix A — Worked example: v4.7.0

This is the exact sequence used to ship v4.7.0. Use it as a reference implementation.

| Step | Command / Action | Output |
|---|---|---|
| Pre-flight | `git status --short` | (empty) |
| Pre-flight | `git branch --show-current` | `master` |
| Pre-flight | `npm whoami` | `drb0rk` |
| CHANGELOG | Edit `CHANGELOG.md`, add v4.7.0 entry | ~75 lines added |
| Version bump | `package.json` | `4.5.2` → `4.7.0` |
| PROJECT.md | Edit `.bizar/PROJECT.md` Current Version | bumped to v4.7.0 |
| Self-improvement | Append to `.bizar/AGENTS_SELF_IMPROVEMENT.md` | new entry |
| Typecheck | `npx tsc --noEmit` | 0 errors |
| Test gate | `npm test` | 388 + 75 + 295 + 7 = **765 pass, 0 fail** |
| Build | `npm run build` | success, **372 KB main + 476 KB mobile** |
| Commit | `git add -A && git commit -m "v4.7.0: ..."` | commit `3005611` |
| Tag | `git tag -a v4.7.0 -m "v4.7.0 — Quality & Stability + Performance & Polish"` | tag `v4.7.0` |
| Push | `git push origin master --follow-tags` | tag visible on origin |
| Publish | `npm publish` | `@polderlabs/bizar@4.7.0` published |
| Verify | `npm view @polderlabs/bizar@4.7.0 version` | `4.7.0` |
| Verify | `git ls-remote --tags origin \| grep v4.7.0` | `<sha>  refs/tags/v4.7.0` |

**Diff stats:** 62 files, **+7,361 / −4,083 lines** net **+3,278**.

The bulk of the change was the CLI refactor (`cli/bin.mjs` 1,498 → 275 lines, `cli/artifact.mjs` 2,121 → 63 lines, 10 new command modules, 3 new artifact modules) plus 75 new vitest tests for the web layer.

---

## Appendix B — Quick command reference

```bash
# Full release gate (run this once before bumping)
npx tsc --noEmit && npm test && npm run build

# Just the dashboard tests
node --test bizar-dash/tests/*.test.mjs

# Just the SDK tests
npm run test:sdk

# Just the bun plugin tests
bun test plugins/bizar/tests/*.test.ts

# Just the smoke test
node bizar-dash/tests/smoke-v2.mjs

# Verify a published version
npm view @polderlabs/bizar@X.Y.Z version

# Check git tag exists
git ls-remote --tags origin | grep vX.Y.Z

# Deprecate a bad release
npm deprecate @polderlabs/bizar@X.Y.Z "Reason here"

# See all published versions
npm view @polderlabs/bizar versions --json
```

---

## Appendix C — Agent responsibilities during a release

| Agent | Role in release | Tools allowed |
|---|---|---|
| **Odin** (router) | Decomposes release into parallel streams; assigns scopes | `task`, `read`, `grep`, `semble` (no write) |
| **Heimdall** (free) | Mechanical edits: bump `package.json`, append to AGENTS_SELF_IMPROVEMENT.md | `read`, `edit`, `write`, `bash` |
| **Mimir** (free) | Research: read prior release notes, summarize what changed | `read`, `grep`, `semble` |
| **Thor** (M2.7) | Mid-complexity: CHANGELOG drafting, test additions, doc updates | full edit + test |
| **Tyr** (M3) | Complex: full release orchestration, breaking-change analysis | full edit + test |
| **Hermod** (git) | The ONLY agent that runs `git commit`, `git tag`, `git push`, `npm publish` | write-level git + npm |
| **Forseti** (audit) | Reviews the release plan before commit (when called by Odin) | read-only |
| **Vidarr** (last resort) | Debugging subtle release blockers | full |

If a non-Hermod agent needs to push a tag or run `npm publish`, STOP — that is a routing violation. Hand off to Hermod via a clear handoff document (commit message + file list + version).

---

*Last updated: 2026-07-05, after v4.7.0 release (commit `3005611`, tag `v4.7.0`).*