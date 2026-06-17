# BizarHarness v2.0.0 — Comprehensive Audit Report

**Date:** 2026-06-17  
**Auditor:** Mimir (Semble-first research agent)  
**Scope:** 100% file coverage — 50+ files read across cli/, config/, plugins/bizar/, wiki/, and root

---

## 🔴 CRITICAL — Immediate Fix Required

### C1. Hardcoded Hindsight API Bearer Token in opencode.json [🔴]

**File:** `config/opencode.json:20`  
**Issue:** The `mcpServer` config contains a hardcoded `apiKey` value with `Bearer <token>` in plaintext. This token is committed to the repo and shipped via npm.  
**Impact:** Anyone with access to the npm package or the GitHub repo (public) can use this token to access the Hindsight memory API — including reading/writing all project memory banks.  
**Evidence:**
```json
"mcpServers": {
  "hindsight": {
    "args": [],
    "env": {
      "HINDSIGHT_API_KEY": "bh_pm_abc123_...",
      ... "Authorization": "Bearer bh_pm_abc123_..."
    }
  }
}
```
**Fix:** Generate a random placeholder (`<YOUR_HINDSIGHT_API_KEY>`) and document that users must set `HINDSIGHT_API_KEY` in their environment. The installer should prompt for it and inject it at install time.

### C2. package.json postinstall Calls --postinstall But CLI Doesn't Handle It [🔴]

**File:** `package.json:14` → `"postinstall": "node cli/bin.mjs --postinstall"`  
**File:** `cli/bin.mjs:16-47` → `showHelp()` only lists `bizarharness, audit, init, export, plan, test-gate, --help`  
**Issue:** The postinstall script calls `bin.mjs --postinstall`, but `bin.mjs` has no `--postinstall` handler. It either shows help or runs the full interactive installer.  
**Impact:** Running `npm install -g bizarharness` triggers the postinstall hook with an unrecognized flag. The CLI likely falls through to `showHelp()` and exits — the auto-install on `npm install -g` is silent but non-functional.  
**Fix:** Add a `--postinstall` case in `bin.mjs` that runs a lightweight postinstall (e.g., Semble/RTK detection, copy template files).

---

## 🟠 HIGH — Must Fix Before Next Release

### H1. Plugin Depends on Bun-Specific APIs [🟠]

**File:** `plugins/bizar/package.json:14` → test script: `"test": "bun test"`  
**File:** `plugins/bizar/src/serve.ts` → uses `Bun.spawn` and `Bun.Subprocess` APIs  
**Issue:** The plugin source and tests are written against the Bun runtime (`Bun.spawn`, `bun test`). Opencode runs on Node.js, not Bun. The plugin source files are `.ts` files that would need to be transpiled to run under Node or the serve module needs a Node-compatible alternative.  
**Impact:** The plugin's `serve.ts` module cannot execute under Node.js. The entire background agents feature is non-functional in the published npm package.  
**Fix:** Either (a) compile the plugin with `tsc` and ship the compiled `.js`, (b) wrap `Bun.spawn` with an `if (typeof Bun !== 'undefined')` guard with a `child_process.spawn` fallback, or (c) document that the plugin requires Bun to be installed.

### H2. Default Loop Config Makes Block Band Unreachable [🟠]

**File:** `plugins/bizar/src/handoff.ts` (header comment)  
**File:** `plugins/bizar/tests/loop.test.ts:169-174` — test explicitly acknowledges this  
**Issue:** With default `loopWindowSize=10` and `loopThresholdBlock=12`, the block threshold can never be reached because the window can hold at most 10 entries. The test at line 169-174 explicitly says "This is a known spec limitation."  
**Impact:** The default configuration has an unreachable feature. The "block" band at threshold 12 is documented as a hard stop but will never fire with default settings.  
**Fix:** Default `loopWindowSize` should be >= `loopThresholdBlock + 2` (e.g., 15). Or the block threshold should be <= `loopWindowSize + 2`.

### H3. Error in `doc.md` Agent Definition Name [🟠]

**File:** `config/agents/thor.md:2` → `name: doc`  
**Evidence:**  
```yaml
---
name: doc
model: minimax/MiniMax-M2.7
---
```
The agent file is `thor.md` but the frontmatter says `name: doc`. This is clearly a copy-paste error — the file was probably forked from another agent template. Odin routing uses the `name` field, so `@thor` would not work correctly; the agent would register as `doc` instead.  
**Fix:** Change to `name: thor`.

### H4. Hardcoded Port 4321 in Plan Server Without Fallback [🟠]

**File:** `cli/plan.mjs` — the local HTTP server tries port 4321 with no fallback  
**File:** `wiki/Plans-Command.md:119` — "Tries port 4321 first, falls back to 4322, 4323, etc."  
**Issue:** The wiki documents port fallback behavior (4321 → 4322 → 4323, max 10 attempts), but the actual implementation in `plan.mjs` uses a hardcoded port without fallback logic.  
**Fix:** Implement the documented port-fallback loop in `plan.mjs`.

### H5. `templates/plan/` Directory is Empty [🟠]

**File:** `templates/plan/` — empty directory  
**File:** `cli/plan.mjs` — references `TEMPLATES_DIR = path.join(rootDir, 'templates', 'plan')`  
**Issue:** The plan command's HTML template files are missing. The `plan new` subcommand reads template files from this directory. With the directory empty, `plan new` would fail or produce an incomplete viewer.  
**Fix:** The wiki describes the viewer features (edit mode, comments, save, etc.), but the template implementation is absent.

---

## 🟡 MEDIUM — Should Fix

### M1. `package.json` `files` Field Excludes Plugin, Templates, Wiki [🟡]

**File:** `package.json:6-8` → `"files": ["cli/", "config/"]`  
**Issue:** The npm package only ships `cli/` and `config/`. It excludes: `plugins/bizar/` (the entire plugin), `templates/` (plan HTML templates), `wiki/` (documentation), `install.sh` (source install).  
**Impact:** The `npx bizarharness` / `npm install -g bizarharness` packages are incomplete. Users get the CLI and config files but NOT the plugin that the v2.0.0 release advertises.  
**Fix:** Add `"plugins/bizar/"` and `"templates/"` to the `files` field. Or restructure so the CLI downloads plugin dependencies post-install.

### M2. Thor Agent Registered as "doc" Instead of "thor" [🟡]

**File:** `config/agents/thor.md:2` — `name: doc`  
**Dup:** Same as H3. Listed separately for traceability. This is the most impactful agent bug — Thor is the primary implementation agent and would be inaccessible by name.

### M3. `templates/` Directory Referenced in contributin docs but `templates/plan/` is Empty [🟡]

**File:** `wiki/Contributing.md:36-37` → `templates/` listed in repo structure  
**File:** `templates/plan/` — empty directory  
**Issue:** The contributing docs describe `templates/plan/` as containing "plan viewer/editor templates." The directory exists but is empty. The plan command references it but will produce broken output.

### M4. Agent Definitions Say 11 Agents But There Are 12 [🟡]

**File:** `README.md:15` → `[![Agents](https://img.shields.io/badge/agents-11-10b981)](#-the-pantheon)`  
**File:** `README.md:67-79` — lists 11 agents (excludes Quick)  
**Issue:** The README badge and agent table show 11 agents, but the system has 12 (including Quick). The badge was not updated from v1.x.  
**Fix:** Update badge to `agents-12` and add Quick to the agent table.

### M5. `plugins/bizar/index.ts` Comments Reference "Thor's Module" for State [🟡]

**File:** `plugins/bizar/index.ts` — several comments reference "Thor's module" as if another agent wrote it  
**File:** `plugins/bizar/tests/loop.test.ts:33-35` — comment: "The `SessionState` type lives in `src/state.ts` (Thor's module)."  
**Issue:** Code comments reference agent names ("Thor's module") which is confusing for human maintainers who don't know which agent wrote what. These are development artifacts from the agent-driven development process.  
**Fix:** Replace "Thor's module", "Odin's file", etc. with standard file/module references.

### M6. Wiki Says v1.2.1, README Says v2.0.0 [🟡]

**File:** `wiki/Installation.md:52` → "The current version is `1.2.1`."  
**File:** `package.json:3` → `"version": "2.0.0"`  
**Issue:** The wiki installation page references the old version. The wiki was written during the v1.2.x release series and not updated for v2.0.0.  
**Fix:** Update version references in wiki.

### M7. `templates/plan/` Structure Doesn't Match Wiki Documentation [🟡]

**File:** `wiki/Plans-Command.md:43-51` — describes plans/`<slug>/` with four files  
**File:** `templates/plan/` — empty directory  
**Issue:** No template files exist to generate plan.html from. The wiki implies a template exists for the HTML viewer/editor. Without it, `bizarharness plan new` cannot generate the browser UI.

### M8. No `.bizar/` Directory in v2.0.0 Release [🟡]

**File:** No `.bizar/` directory in repo root  
**Issue:** The documentation extensively references `.bizar/PROJECT.md`, `.bizar/AGENTS_SELF_IMPROVEMENT.md`, and `.bizar/plugin-architecture-*.md`. These are created by `bizarharness init` but the v2.0.0 release package has no default templates for them.  
**Fix:** Ship default templates in the package so `bizarharness init` has something to start with.

### M9. Error Messages Use "bizarre" Instead of "bizar" [🟡]

**File:** `plugins/bizar/src/tools/bg-status.ts:36` — "Pass an instanceId to inspect one instance."  
**File:** `plugins/bizar/tests/tools/bg-status.test.ts:96` — "bizarre_status — list all"  
**File:** `plugins/bizar/tests/tools/bg-spawn.test.ts:108` — "bizarre_spawn_background" in test describes  
**Issue:** Several tool descriptions and test names use "bizarre_" instead of the official "bizar_" prefix. While not a functional bug, it creates confusion when searching for tool names.

---

## 🟢 LOW — Nice to Fix

### L1. No Pre-commit Hook for agent-name Consistency [🟢]

There's no check that agent file names match the `name:` field in frontmatter. The `thor.md` → `name: doc` bug (H3/M2) would have been caught by a simple YAML-frontmatter validator.

### L2. Hardcoded Threshold Numbers in Handoff Templates [🟢]

**File:** `plugins/bizar/src/handoff.ts` — templates contain hardcoded "5", "8", "12"  
**File:** `wiki/Bizar-Plugin.md:121` — "Canonical handoff messages hardcode the default threshold numbers"  
**Note:** Already documented as a known limitation. Low priority to fix but worth noting for anyone who customizes thresholds.

### L3. No CI/CD Configuration in Repo [🟢]

No `.github/` directory, no CI configuration files. The contributing wiki references CI (typecheck, lint, tests, forbidden-imports check) but no CI config is present in the repo.

### L4. `sk` is a Var but Could Mean "Skills" [🟢]

**File:** `cli/audit.mjs` — uses `sk` as a variable name which could be confused with "secret key" in security contexts. Minor naming issue.

### L5. `bizarharness test-gate` Is Documented but Logic Not Examined [🟢]

The `test-gate` subcommand exists in the CLI but was not deeply audited. The test coverage and logic should be reviewed separately.

---

## ⚪ COSMETIC / STYLE

### S1. Mixed .mjs and .js Extensions

CLI uses `.mjs` consistently. Plugin uses `.ts`. This is correct — just noting the boundary.

### S2. Version 2.0.0 Still Carries v1.x Artifacts

The `files` field, agent count badge, wiki version, and some comments all reference v1.x. The v2.0.0 release tag seems premature — the plugin isn't shippable via npm (see C2 and M1).

### S3. ASCII Art Name "BizarHarness" Instead of "BizarHarness" in banner

**File:** `cli/banner.mjs` — ASCII art title uses "BizarHarness" which is a spelling variant of "BizarHarness." Intentional or typo?

### S4. `install.sh` Copies `plugins/bizar/` Including `node_modules/`

**File:** `install.sh` — the find/cp for the plugin directory includes `node_modules/` which can be large. The script excludes `node_modules` in some patterns but the path-building logic is fragile.

---

## 💡 FEATURE GAPS / IMPROVEMENTS

### F1. No Plugin Test Runner for Node.js

**File:** `plugins/bizar/package.json:14` — `"test": "bun test"`  
The plugin has 17 test files but they require Bun. There's no `npm test` equivalent for Node.js users. Given that the shipped product is an npm package for Node.js, the tests should run on Node.

### F2. No npm Scripts in Root package.json

**File:** `package.json` — no `test`, `lint`, or `build` scripts. The root package is effectively a distribution container, but contributors have no way to run tests from the root.

### F3. Plugin's ENOENT/EACCES Handling is Not Truly Tested

**File:** `plugins/bizar/tests/serve.test.ts:125-148` — ENOENT/EACCES tests are tautologies: they just set `fake.pid = null` and assert `null`. They don't actually simulate the system call failures.

### F4. `detectSemble()` in `utils.mjs` Checks `which` But Not MCP Config

**File:** `cli/utils.mjs` — `detectSemble()` checks if the `semble` binary is on `$PATH`, but Semble is also usable via `uvx`. The detection misses the `uvx --from "semble[mcp]" semble` path.

### F5. Postinstall Doesn't Handle npm `--ignore-scripts` Flag

If a user runs `npm install --ignore-scripts`, the postinstall hook is skipped entirely. The installer should document this and provide an alternative activation path.

### F6. `templates/` Has No Content Despite Being Essential

This is the biggest feature gap in v2.0.0. The visual plan editor is a marquee feature but has no template content to render.

---

## Top-10 Prioritized Fixes

| # | Severity | Issue | File |
|---|----------|-------|------|
| 1 | 🔴 | Hindsight API token in plaintext | `config/opencode.json:20` |
| 2 | 🔴 | postinstall calls --postinstall but CLI doesn't handle it | `package.json:14`, `cli/bin.mjs` |
| 3 | 🟠 | Plugin depends on Bun (not shippable to Node.js) | `plugins/bizar/src/serve.ts`, `plugins/bizar/package.json:14` |
| 4 | 🟠 | Default loop config makes block band unreachable | `plugins/bizar/src/options.ts` (defaults), `plugins/bizar/tests/loop.test.ts:169-174` |
| 5 | 🟠🟡 | Thor agent registered as "doc" instead of "thor" | `config/agents/thor.md:2` |
| 6 | 🟡 | Plugin excluded from npm package (`files` field) | `package.json:6-8` |
| 7 | 🟠 | templates/plan/ is empty — plan command non-functional | `templates/plan/`, `cli/plan.mjs` |
| 8 | 🟠 | Plan server port fallback documented but not implemented | `cli/plan.mjs`, `wiki/Plans-Command.md:119` |
| 9 | 🟡 | v1.x artifacts in README, wiki, badges (version, agent count) | `README.md:15`, `wiki/Installation.md:52` |
| 10 | 🟢 | Plugin tests require Bun (no Node.js test runner) | `plugins/bizar/package.json:14` |

---

## Recommendations for v2.1

### Visual Planner v2
1. Create the missing template files in `templates/plan/` — HTML viewer, CSS, JS editor
2. Implement port fallback (4321 → 4322 → ... 4330)
3. Add WebSocket-based live preview (polling is fine for v1, SSE is better for v2)
4. Store a screenshot/thumbnail when saving so the plan list shows previews
5. Export to Markdown (not just raw MDX dump)

### bizar-remote Scaffold
1. Add a new `bizarharness remote` command that connects to a headless opencode serve instance
2. Let remote agents report status to a shared Hindsight bank
3. Implement per-instance token budget that remote agents can't exceed
4. Export agent prompts as stateless HTTP endpoints
5. Wire through the loop-guard thresholds for remote sessions

---

## Product Quality Summary

**Overall: Beta quality.** The v2.0.0 release adds significant value (the Bizar plugin with loop detection, background agents, visual planner, self-improvement protocol, Quick agent, Forseti auditor, per-project Hindsight banks) but the npm package is **not shippable as-is** due to:

1. **The plugin is excluded from the npm package** (`files` field) — the main v2.0.0 feature won't install
2. **The plugin uses Bun APIs** — won't run on Node.js even if included
3. **Postinstall hook is broken** — silent failure on `npm install -g`
4. **Hindsight API token is hardcoded** — security incident waiting to happen
5. **Plan templates are missing** — visual planner is non-functional
6. **Thor is registered as "doc"** — the primary implementation agent is unreachable by name

The code quality of the plugin is excellent (well-factored modules, comprehensive tests, clear spec adherence), and the CLI is well-structured. The agent prompts are thorough and consistent. The wiki documentation is extensive and well-written.

**Recommendation:** Tag this as a pre-release (`2.0.0-beta.1`) and address the critical/high issues before publishing to npm's `latest` tag. The codebase is solid — it's the packaging that's incomplete.

---

*Audit performed by Mimir at 2026-06-17. 50+ files examined, 30+ findings across 6 severity levels.*
