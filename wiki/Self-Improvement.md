# Self-Improvement

BizarHarness agents learn across sessions. Every project has a `.bizar/AGENTS_SELF_IMPROVEMENT.md` file that records lessons learned. The next session reads it before routing, so past mistakes inform future decisions.

## How agents record lessons

When an agent completes a task, Odin (or the agent itself, for some self-improvement entries) appends a structured entry to `.bizar/AGENTS_SELF_IMPROVEMENT.md`. The format is:

```markdown
### 2026-06-16: Fixed routing issue
- **Context**: Odin was self-handling instead of routing
- **Lesson**: Stripped bash/glob/grep/edit from Odin — forces delegation
- **Pattern**: Primary agents should never have executable tools
- **Agent**: heimdall
```

Four fields per entry:

- **Context** — what was happening when the lesson was learned.
- **Lesson** — the takeaway in one sentence.
- **Pattern** — the reusable rule that future agents should follow.
- **Agent** — which agent filed the entry (for accountability).

Some entries include additional sections — **Files** (paths that were changed), **Details** (multi-paragraph explanation), **Agents used** (the team that worked on the task).

## The .bizar/AGENTS_SELF_IMPROVEMENT.md file

The file has two parts:

1. **Active Rules** — a numbered list of the standing rules that all agents should follow. These distill the patterns from past entries. They are read at session start, before routing.
2. **Log** — a chronological list of past entries. Append-only. The most recent entry is at the bottom.

The current Active Rules for the BizarHarness project itself (from `.bizar/AGENTS_SELF_IMPROVEMENT.md`):

1. **Per-project memory namespace** — every project gets its own `projects/<projectId>/` namespace in the shared vault; the default state (`mode: local-only` + vault at `.obsidian/`) is fine for solo work.
2. **Session start vault check** — read `.bizar/memory.json` and resolve the active vault root, then check `bizar memory status` for git state.
3. **Write Markdown, not API calls** — durable memory always flows through the dashboard `/api/memory/notes` (rich shape) or `/api/obsidian/notes` (legacy back-compat). Never write directly to LightRAG.
4. **Schema + secret scan gate commits** — `bizar memory commit` validates frontmatter and blocks HIGH-severity secrets. Use `.template` for reference files; never commit a live secret.
5. **AMS Studio bank populated** — 40+ documents migrated from Hindsight default to ams-studio bank (legacy project-specific note; preserved for history).
6. **Re-run `install.sh` after every `git pull`** — the script does not detect when the installed plugin is older than the source. Pre-v0.5.1, this was masked by the fact that the source rarely changed; post-v0.5.1, source changes land frequently and a stale installed plugin produces silent failures.
7. **Plugin has no hot-reload** — cline loads the plugin at process start. Restart cline to pick up source changes.
8. **Real tests for real bugs** — when fixing a bug, write at least one regression test that uses the **real** module, not a hand-rolled fake. The BUGFIX v0.5.1 was missed by the existing test suite because the `bg-spawn.test.ts` and `background.test.ts` fakes mirrored the API but didn't exercise the real `add()` path.

These are the rules BizarHarness follows. Your project's `.bizar/AGENTS_SELF_IMPROVEMENT.md` will have its own Active Rules section, populated by the lessons from that project.

## Per-project memory (Bizar Memory Service)

BizarHarness ships the **Bizar Memory Service** — local Obsidian-compatible Markdown + Git-shared sync — as the per-project memory layer. The Hindsight MCP service is retired.

The vault location is determined by `.bizar/memory.json` in the active project:

- **`mode: local-only`** (default) — vault lives at `.obsidian/` inside the project. Single-machine, no remote. Fine for solo work.
- **`mode: managed`** — vault lives at `~/.local/share/bizar/memory/<repoName>/`, a user-level shared Git repo. Use this for cross-project search and a single source of truth across all your Bizar projects.

The project namespace:

1. **At session start, read `.bizar/memory.json`** — resolve `mode` and `memoryRepo.path`.
2. **Pick the namespace for any new note** — `projects/<projectId>/` for project-local, `global/bizar/` for cross-project Bizar-system knowledge, `users/<userId>/` for purely personal notes.
3. **Write Markdown** via the dashboard `POST /api/memory/notes` endpoint (or the `bizar memory write` CLI). The orchestrator validates schema, scans secrets (HIGH blocks commit), and stages the Git commit.
4. **`bizar memory sync`** runs the full pull → schema check → secret scan → commit → optional push pipeline.

`bizar memory status` shows the active mode and resolved paths; `bizar memory doctor` validates the vault is reachable and the Git state is consistent.

The vault is always canonical in Markdown. Git provides history. LightRAG (Phase 2) is a derived index. Never write to LightRAG directly.

## Mental models

In the Bizar Memory Service, "mental models" are `architecture_decision` notes with `confidence: verified`. They are persistent, queryable knowledge summaries — one file per topic — that stay useful over time because they're anchored to evidence (linked files with `path:line` references).

Example topics for a BizarHarness project:

- "Agent Routing Preferences" — what kinds of tasks go to which agent in this project.
- "Project Conventions" — naming, structure, commit format.
- "Known Gotchas" — recurring pitfalls specific to this codebase.

Because they're Markdown, mental models:

1. Can be searched via the dashboard `POST /api/memory/search` endpoint or `bizar memory search`.
2. Have Git history for free — see when the model changed and why.
3. Live in the same namespace as everything else, so the resolution rule applies: project model in `projects/<id>/`, cross-project model in `global/bizar/`.

For "the answer depends on the current state of the project," refresh = `bizar memory search` (current Markdown) rather than a refresh-API call.

## Contributing to the pattern

When you (or your agents) discover a new pattern, you can contribute to the self-improvement system in three ways:

1. **Append an entry to `.bizar/AGENTS_SELF_IMPROVEMENT.md`.** Use the standard format (Context, Lesson, Pattern, Agent). The next session will read it.
2. **Write a vault note** in the appropriate namespace via `POST /api/memory/notes` or `bizar memory write`. Use `type: pattern` or `type: lesson_learned`.
3. **Promote a frequently-referenced vault note into an Active Rule** — when a vault note is being consulted on every task, distill the rule into `.bizar/AGENTS_SELF_IMPROVEMENT.md` and keep the note as the evidence trail.

The BizarHarness project itself follows this pattern. The `.bizar/AGENTS_SELF_IMPROVEMENT.md` file in the repo records:

- The migration of memories from Hindsight default to per-project vaults.
- Windows compatibility fixes for the npm package.
- The Vör research-first protocol fix.
- The skill discovery protocol addition.
- The split of the dev sandbox into a separate repo.
- The build of the Bizar plugin (v0.1 → v0.3.1 → v0.4 background agents).
- The Phase 1 rollout of the Bizar Memory Service (replacing Hindsight MCP).

Each entry is a lesson learned the hard way. Reading the log is a quick way to understand the project's history without reading every commit.

## Active rules vs the log

The **Active Rules** section is the short, current list of standing rules. The **Log** is the historical record. The relationship is:

- The log accumulates over time.
- Patterns in the log get distilled into Active Rules.
- The log keeps entries even after they are absorbed into Active Rules, because the context is still useful for future agents.

If you're contributing a new entry and the pattern is novel, put it in the log. If you're writing a new Active Rule, reference the log entries that justify it, and (optionally) a vault note as the durable evidence trail.

## Limitations

- The `.bizar/AGENTS_SELF_IMPROVEMENT.md` file is local to the project. Cross-project rules live in the `global/bizar/` namespace of the shared vault.
- Entries are append-only. There's no schema for entries; contributors can use any structure as long as the four core fields (Context, Lesson, Pattern, Agent) are present.
- Reading the file at session start is best-effort. If the file is huge, agents may summarize rather than read every entry.
- The Bizar Memory Service is fully local/Git — no API key required. Phase 2 adds an optional LightRAG sidecar for semantic search across Markdown; it is disabled by default and rebuildable from Markdown on demand.

## Next steps

Next: [Contributing](Contributing) — how to contribute to BizarHarness itself: repo structure, dev workflow, code style, and PR process.
