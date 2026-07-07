# DEC-008 — Skill curator (closed learning loop)

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @tyr

## Context

Bizar ships 14+ bundled skills (`bizar-dash/skills/`). Agents
load them on demand. There's no mechanism to:

1. Track which skills are used (and how often).
2. Detect when a skill is failing (5+ failures = needs revision).
3. Flag stale skills (no usage in 30+ days).
4. Propose new skills from patterns in the agent's history.

The reference system with this pattern is **Hermes Agent**
(`agent/curator.py`, 1976 lines). Of 106 cataloged projects in
the `best-of-Agent-Harnesses` repo, exactly one has it. It's the
differentiator.

## Decision

Implement a minimal Skill Curator in
`plugins/bizar/src/hooks/skill-curator.ts`. Tracks per-skill
use/failure in `~/.bizar/skills/usage.jsonl` (JSONL, one entry
per skill). The curator generates a report:

```ts
interface CuratorReport {
  totalSkills: number;
  ok: number;
  needsRevision: number;
  stale: number;
  new: number;
  proposals: Array<{ name: string; reason: string; failureCount: number }>;
}
```

Default thresholds (overridable via constructor options):

- `revisionThreshold: 5` failures → flag for revision
- `staleDays: 30` days without use → flag as stale

## API

```ts
// plugins/bizar/src/hooks/skill-curator.ts
const curator = createSkillCurator({ worktree, logger });
const report = curator.report();
curator.record("pump-then-test", "failure");
```

The JSONL file at `~/.bizar/skills/usage.jsonl` is the
single source of truth. The path can be overridden via
`BIZAR_SKILL_USAGE_FILE` env var (mainly for tests).

## Consequences

### Positive

- Per-skill usage telemetry — the harness can identify which
  skills are most/least useful.
- Failure detection — agents get a warning when 5+ failures
  accumulate on a single skill.
- The pattern is the differentiator. Bizar is now the second
  project (after Hermes) with a closed learning loop.

### Negative

- One-file JSONL — not a database. For v6.0.0 this is fine
  (skills are < 100 typically).
- The curator hook is **manually triggered** today. Scheduled
  weekly curation is queued for v6.1.0.

### Neutral

- Future versions may add per-project skill libraries
  (`.bizar/skills/<project>/`) in addition to the global
  `~/.bizar/skills/`.

## Implementation notes

- `homedir()` is evaluated at module load time, so the file
  path is captured early. We expose a `getUsageFile()` function
  that reads `BIZAR_SKILL_USAGE_FILE` at call time, allowing
  tests to override.
- The JSONL format is forward-compatible: adding new fields
  doesn't break old readers.

## References

- `plugins/bizar/src/hooks/skill-curator.ts` (175 lines)
- `plugins/bizar/tests/safety.test.ts` — 4 unit tests
- Hermes Agent `agent/curator.py` — reference implementation
  (1976 lines, Python)
- `research/agent-harness-survey/final-reports/01-hermes-agent.md`
  — the Hermes deep study
- `research/agent-harness-survey/final-reports/06-bizar-improvement-plan.md`
  — Improvement 1 (P0)
