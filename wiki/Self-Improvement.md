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

1. **Per-project Hindsight banks** — every project gets its own bank; default is for general/system knowledge only.
2. **Session start bank check** — always call `hindsight_list_banks` to discover and set the correct bank.
3. **Never use default for project work** — pass `bank_id: "<project-name>"` in all Hindsight calls.
4. **Create bank if missing** — if no bank exists for a project, create it with `hindsight_create_bank`.
5. **AMS Studio bank populated** — 40+ documents migrated from default to ams-studio bank (legacy project-specific note).
6. **Re-run `install.sh` after every `git pull`** — the script does not detect when the installed plugin is older than the source. Pre-v0.5.1, this was masked by the fact that the source rarely changed; post-v0.5.1, source changes land frequently and a stale installed plugin produces silent failures.
7. **Plugin has no hot-reload** — opencode loads the plugin at process start. Restart opencode to pick up source changes.
8. **Real tests for real bugs** — when fixing a bug, write at least one regression test that uses the **real** module, not a hand-rolled fake. The BUGFIX v0.5.1 was missed by the existing test suite because the `bg-spawn.test.ts` and `background.test.ts` fakes mirrored the API but didn't exercise the real `add()` path.

These are the rules BizarHarness follows. Your project's `.bizar/AGENTS_SELF_IMPROVEMENT.md` will have its own Active Rules section, populated by the lessons from that project.

## Per-project Hindsight banks

BizarHarness uses [Hindsight](https://memory-api.polderlabs.io) for persistent memory. Every project gets its own bank, named after the project directory. The default bank is reserved for general system knowledge only.

The bank-selection protocol:

1. At session start, call `hindsight_list_banks` to see what banks exist.
2. Determine the project name from the working directory.
3. Call `hindsight_recall` with the correct `bank_id` (e.g., `bank_id: "bizarharness"`).
4. If no bank exists for the project, create one with `hindsight_create_bank(bank_id: "<project-name>")`.

The default bank is **never** used for project-specific work. It holds general AI-agent system knowledge (model configs, agent definitions, infrastructure) and cross-project preferences.

## Mental models

Hindsight also supports **mental models** — persistent, queryable knowledge summaries that stay current over time. Use them for sustained project context that needs to be refreshed as the project evolves.

Example mental models for a BizarHarness project:

- "Agent Routing Preferences" — what kinds of tasks go to which agent in this project.
- "Project Conventions" — naming, structure, commit format.
- "Known Gotchas" — recurring pitfalls specific to this codebase.

Mental models are created with `hindsight_create_mental_model` and refreshed with `hindsight_refresh_mental_model`. They are the right tool when the answer to a question is "it depends on the current state of the project" — refresh pulls in the latest context.

## Contributing to the pattern

When you (or your agents) discover a new pattern, you can contribute to the self-improvement system in two ways:

1. **Append an entry to `.bizar/AGENTS_SELF_IMPROVEMENT.md`.** Use the standard format (Context, Lesson, Pattern, Agent). The next session will read it.
2. **Create a mental model.** If the pattern is broad and stable, create a mental model with `hindsight_create_mental_model` and tag it appropriately.

The BizarHarness project itself follows this pattern. The `.bizar/AGENTS_SELF_IMPROVEMENT.md` file in the repo records:

- The migration of memories from default to project banks.
- Windows compatibility fixes for the npm package.
- The Vör research-first protocol fix.
- The skill discovery protocol addition.
- The split of the dev sandbox into a separate repo.
- The build of the Bizar plugin (v0.1 → v0.3.1 → v0.4 background agents).

Each entry is a lesson learned the hard way. Reading the log is a quick way to understand the project's history without reading every commit.

## Active rules vs the log

The **Active Rules** section is the short, current list of standing rules. The **Log** is the historical record. The relationship is:

- The log accumulates over time.
- Patterns in the log get distilled into Active Rules.
- The log keeps entries even after they are absorbed into Active Rules, because the context is still useful for future agents.

If you're contributing a new entry and the pattern is novel, put it in the log. If you're writing a new Active Rule, reference the log entries that justify it.

## Limitations

- The `.bizar/AGENTS_SELF_IMPROVEMENT.md` file is local to the project. There is no global cross-project log.
- Entries are append-only. There's no schema for entries; contributors can use any structure as long as the four core fields (Context, Lesson, Pattern, Agent) are present.
- Reading the file at session start is best-effort. If the file is huge, agents may summarize rather than read every entry.
- Hindsight memory requires an API key. Without it, agents operate in stateless mode (no per-session memory beyond what's in `.bizar/`).

## Next steps

Next: [Contributing](Contributing) — how to contribute to BizarHarness itself: repo structure, dev workflow, code style, and PR process.
