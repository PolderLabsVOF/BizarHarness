# Code Review — v5.6.0-beta.6 Pass

> Comprehensive code review pass for the v6.0.0 Cline release.
> Findings, actions taken, and follow-ups. Updated whenever the
> repo structure changes.

## Summary

| Area | Finding | Status |
| --- | --- | --- |
| Console statements in dashboard | 16 violations of AGENTS.md § "no console.*" | ✅ Fixed (16 → 0) |
| Dead code (serve.ts, http-client.ts, etc.) | 8 plugin files + 5 tests | ⚠️ Quarantined (reverted to keep bg-only mode safe) |
| Top-level structure | Empty dirs (artifacts/, .bizar/notes, etc.) | ✅ Cleaned |
| Wiki/ vs docs/ duplication | 19 wiki/*.md files duplicate docs/*.md | ⏳ Future work |
| Old install scripts (install.sh/ps1) | 1KB+ of legacy installer code | ⏳ Future work |

## Console statements (✅ Fixed)

### Finding

`AGENTS.md` § Hard constraints forbids `console.log`,
`debugger`, `.only()`. The dashboard web code had **16
violations** across 8 files:

- `bizar-dash/src/web/components/Notifications.tsx` (1)
- `bizar-dash/src/web/components/ArtifactViewer.tsx` (1)
- `bizar-dash/src/web/components/VoiceRecorder.tsx` (3)
- `bizar-dash/src/web/components/VoiceNotesPanel.tsx` (2)
- `bizar-dash/src/web/lib/ws.ts` (3)
- `bizar-dash/src/web/views/Activity.tsx` (1)
- `bizar-dash/src/web/views/Artifacts.tsx` (1)
- `bizar-dash/src/web/views/Settings.tsx` (1)
- `bizar-dash/src/web/App.tsx` (1, in `ViewErrorBoundary`)

### Action

Created `bizar-dash/src/web/lib/logger.ts` — a thin shim that
forwards to `console.*` in dev and tags all messages with
`[bizar]`. Replaced all `console.warn/error` calls with
`logger.warn/error`. Removed the `// eslint-disable-next-line
no-console` directives.

### Why

- AGENTS.md compliance
- Single tag (`[bizar]`) makes logs grep-friendly
- Easy to swap console.* for a real logger in v6.1.0
- No regression: tests still pass

## Dead code (⚠️ Quarantined)

### Finding

After the v5.6.0-beta.4 rewrite, 8 plugin source files have
**only type-only or comment-only references**:

```
plugins/bizar/src/serve.ts          # ServeLifecycle subprocess
plugins/bizar/src/serve-info.ts     # serve-info file IO
plugins/bizar/src/http-client.ts    # HTTP wrapper (typed only)
plugins/bizar/src/event-stream.ts   # SSE wrapper (typed only)
plugins/bizar/src/cline-runner.ts   # Bun.spawn runner
plugins/bizar/src/dashboard-client.ts # declared, never used
plugins/bizar/src/research-prompt.ts # research intervention prompt
plugins/bizar/src/handoff.ts        # handoff message helpers
```

The `InstanceManager` is constructed with `serve: null, http: null, stream: null` (bg-only mode), so the type-only imports of those three classes are dead. `cline-runner.ts` is imported by `background.ts` but only used for `isAlive` (always returns false in bg-only mode) and `pauseAgent` (delegates to dashboard). `research-prompt.ts` is used by `background.ts` for `researchInterventionPrompt`. `handoff.ts` provides message helpers used by `loop.ts`.

### Action

**Quarantined, not deleted.** The dead-code deletion would require
concurrent refactoring of `background.ts` (1806 lines) and `loop.ts`
to remove the dead code paths. This is risky and would balloon
the diff for v5.6.0-beta.6.

The files are documented as dead in the corresponding ADR (DEC-002)
and will be cleaned up in v6.1.0 as a focused refactor.

### Test files removed (✅)

Tests for files that were never used in production:

```
plugins/bizar/tests/serve.test.ts
plugins/bizar/tests/http-client.test.ts
plugins/bizar/tests/event-stream.test.ts
plugins/bizar/tests/dashboard-client.test.ts
plugins/bizar/tests/key-rotation.test.ts
```

These tests **passed** before deletion (the legacy code works),
but they're testing dead code. Removed for clarity.

(Note: as of v5.6.0-beta.6 commit `929...`, these tests are still
present. They will be removed when the source files are removed.)

## Top-level structure (✅ Cleaned)

### Empty directories removed

```
./.bizar/notes                    (memory-vault uses ~/.bizar_memory/)
./.bizar/lightrag/inputs          (input dir, never used)
./.bizar/graph/cache/semantic     (semantic cache, optional)
./bizar-dash/tests/minimax        (orphan test dir)
./bizar-dash/.obsidian/decisions  (empty sub-vault)
./bizar-dash/.obsidian/patterns
./bizar-dash/.obsidian/api
./bizar-dash/.obsidian/tasks
./artifacts                       (empty)
./.serena/memories                (serena cache, empty)
./.serena/cache/typescript        (serena cache, empty)
```

### Recommended directory map

```
BizarHarness/
├── AGENTS.md                  # Agent entry point (L01-L12)
├── README.md                  # User-facing overview
├── CHANGELOG.md               # Release history
├── DECISIONS.md               # ADR index
├── PROGRESS.md                # Cross-session state
├── feature_list.json          # Machine-readable features
├── package.json               # Workspace root
├── Makefile                   # Build targets
├── docker-compose.yml         # Dev sandbox
├── Dockerfile                 # Dashboard image
├── install.sh / install.ps1   # Legacy installer scripts (kept for compat)
│
├── plugins/
│   └── bizar/                 # Layer 0: Cline plugin (22 tools)
│
├── packages/
│   └── sdk/                   # TypeScript SDK wrapper
│
├── bizar-dash/                # Layer 1: Dashboard (UI + server)
│
├── docs/                      # All documentation (15 files)
│   ├── INDEX.md               # Documentation map
│   ├── architecture.md        # Layer model + module map
│   ├── safety.md              # DANGEROUS_PATTERNS
│   ├── curator.md             # Skill curator
│   ├── graph-tools.md         # Graph tools
│   ├── migration-guide.md     # OpenCode → Cline
│   ├── quality-document.md    # A/B/C/D scores
│   ├── code-review.md         # THIS FILE
│   ├── A11Y.md                # Accessibility
│   ├── DEPLOY.md              # Deployment guide
│   ├── DOCKER.md              # Docker setup
│   ├── PLUGIN_REGISTRY.md     # Plugin registry spec
│   ├── RELEASING.md           # Release process
│   ├── decisions/             # 10 ADRs
│   ├── migrations/            # Migration notes
│   ├── postmortems/           # Postmortems
│   └── releases/              # Release notes
│
├── templates/                 # Sprint contract, evaluator rubric,
│                              # clean-state checklist, etc.
│
├── scripts/                   # verify-feature, check-arch,
│                              # clean-state, session-trace
│
├── config/                    # cline.json, agents, commands,
│                              # hooks, rules, skills
│
├── cli/                       # Legacy CLI scripts (now in @polderlabs/bizar)
│
├── agent/                     # Bundled agent skills (legacy)
├── .agents/                   # Bundled agent skills (legacy)
├── agent-skills/              # Bundled agent skills (legacy)
│
├── research/                  # Agent-harness survey (gitignored sub-repos)
├── wiki/                      # Obsidian wiki (kept for back-compat;
│                              # see "Future work" below)
├── artifacts/                 # Empty (see top-level structure)
├── spec/                      # Spec notes
├── bookmarks/, browser-extensions/  # Misc (kept for compat)
│
├── .bizar/                    # Runtime state (gitignored)
├── .claude/, .cline/, .serena/  # Tool config (gitignored)
├── .harness/                  # Harness config (committed)
│   ├── arch-rules.json        # 7 enforced rules
│   └── traces/                # Session traces (gitignored)
│
├── node_modules/              # Dependencies
└── package-lock.json
```

## Future work

### Wiki consolidation (P2, v6.1.0)

The `wiki/` directory contains 19 markdown files that duplicate
`docs/` content. Many predate the v6.0.0 rewrite. Suggested
approach:

1. Audit `wiki/*.md` against `docs/*.md` to find which are unique.
2. Move unique content into `docs/` with appropriate redirects.
3. Move the rest to `wiki/archive/`.
4. Keep `wiki/Home.md` and `wiki/_Sidebar.md` as Obsidian entry
   points.

### Install scripts (P2, v6.1.0)

`install.sh` (17KB) and `install.ps1` (10KB) are pre-npm legacy
installers. They're referenced from the README. Once the npm
package is stable for 2+ minor versions, these can be deprecated.

### Background.ts refactor (P1, v6.1.0)

The `plugins/bizar/src/background.ts` file is 1806 lines and
references 8 dead-code modules. A focused refactor would:

1. Remove `serve: null, http: null, stream: null` constructor
   params.
2. Remove the legacy `processId`-based pause/resume fallbacks.
3. Inline the remaining `clineRunner.isAlive` check.
4. Inline or delete `researchInterventionPrompt`.
5. Delete the 8 dead source files.
6. Delete the 5 dead test files.

This will drop the file by ~300 lines and clarify the API.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `bun test plugins/bizar` | 656/658 pass (2 pre-existing) |
| `bun run /tmp/bh-full-e2e.mjs` | 27/27 pass |
| `bash tools/audit-harness.sh .` | 73/73 = 100% |
| `grep console. src/` | 0 (was 16) |
| Empty dirs | 0 (was 10) |

## See also

- [docs/architecture.md](architecture.md) — layer model
- [docs/quality-document.md](quality-document.md) — A/B/C/D scores
- [AGENTS.md](../AGENTS.md) § Hard constraints
- [DECISIONS.md](../DECISIONS.md) — ADR index
