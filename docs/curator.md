# Skill Curator — Closed Learning Loop

> The plugin's skill-usage tracker. **The differentiator.** Of
> 106 cataloged agent-harness projects, exactly one (Hermes
> Agent) has this. Source: `plugins/bizar/src/hooks/skill-curator.ts`.

> **v6.3.0 note:** The curator runs inside the Claude Code
> skill/MCP setup callback. The skill-usage tracking path
> remains `~/.bizar/skills/usage.jsonl` (Bizar path, unchanged
> from the Cline era). Tool shape references in this doc use
> the Claude Code MCP tool registration shape.

## TL;DR

Tracks per-skill use/failure in `~/.bizar/skills/usage.jsonl`.
Generates a curator report: total / ok / needs-revision /
stale / proposals. Flags skills for revision when 5+ failures
accumulate.

## Why this matters

Bizar ships 14+ bundled skills (`bizar-dash/skills/`). Without
telemetry, the harness can't tell which skills are useful and
which are dead weight. The curator is the loop that closes the
gap:

```
                    ┌────────────────────┐
                    │  SKILL USAGE       │
                    │  (skills used)     │
                    └────────┬───────────┘
                             ↓
                    ┌────────────────────┐
                    │  TRACKER           │  ~/.bizar/skills/usage.jsonl
                    │  (per-skill        │
                    │   counters)        │
                    └────────┬───────────┘
                             ↓
                    ┌────────────────────┐
                    │  REPORT            │  ok / needs-revision / stale
                    │  (curator output)  │
                    └────────┬───────────┘
                             ↓
                    ┌────────────────────┐
                    │  IMPROVE            │  flag for revision, archive stale
                    │  (next sprint)      │
                    └────────────────────┘
```

## API

```ts
// Record a skill use (success or failure)
recordSkillUse("pump-then-test", "success");
recordSkillUse("pump-then-test", "failure");

// Generate a curator report
const report = generateCuratorReport({ worktree, logger });
// → {
//   totalSkills: 14,
//   ok: 12,
//   needsRevision: 1,
//   stale: 0,
//   new: 1,
//   proposals: [{ name: "pump-then-test", reason: "5 failures recorded...", failureCount: 5 }],
// }

// Higher-level hook
const curator = createSkillCurator({ worktree, logger });
const report = curator.report();
curator.record("new-skill", "success");
```

## Data model

`SkillUsageCounter` — one entry per skill:

```ts
interface SkillUsageCounter {
  name: string;
  useCount: number;       // total successful uses
  failureCount: number;  // total failures
  lastUsed: string | null; // ISO timestamp
  status: "ok" | "stale" | "needs-revision" | "new";
}
```

Persisted as JSONL at `~/.bizar/skills/usage.jsonl` (one line
per skill, in update order).

## Thresholds

| Field | Default | Override |
| --- | --- | --- |
| `revisionThreshold` | 5 failures | constructor option |
| `staleDays` | 30 days | constructor option |

Override the file path for tests via env var:

```sh
BIZAR_SKILL_USAGE_FILE=/tmp/test-usage.jsonl bun test ...
```

## Test coverage

`plugins/bizar/tests/safety.test.ts` (4 unit tests):

- records skill use and failure
- flags revision after 5 failures
- `createSkillCurator()` returns a working hook
- file path is overridable via env var

## Design notes

- **Single source of truth:** the JSONL file. The plugin and
  the dashboard can both read it without coordination.
- **Forward-compatible:** adding new fields to
  `SkillUsageCounter` doesn't break old readers.
- **No database:** one-file JSONL is fine for v6.0.0
  (skills are < 100 typically). For v6.1.0, we may move to
  SQLite if skill counts grow.

## v6.1.0 roadmap

- **Scheduled weekly curation.** A `bizar curator run` command
  that runs the report + archives stale skills + proposes
  revisions.
- **Per-project skill libraries.** `.bizar/skills/<project>/`
  in addition to the global `~/.bizar/skills/`.
- **Auto-improvement loop.** When a skill reaches
  `needs-revision`, auto-create a `SKILL.md` revision in
  `.bizar/skills/proposed/<slug>/` for human review.

## References

- [DEC-008](decisions/DEC-008-skill-curator.md) — the decision
  that introduced the curator
- `plugins/bizar/src/hooks/skill-curator.ts` (175 lines)
- `plugins/bizar/tests/safety.test.ts` (4 unit tests)
- Hermes Agent `agent/curator.py` (1976 lines) — the reference
  implementation
- `research/agent-harness-survey/final-reports/01-hermes-agent.md`
- `research/agent-harness-survey/final-reports/06-bizar-improvement-plan.md`
  § Improvement 1 (P0)
