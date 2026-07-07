# DEC-009 — Pre-compaction memory flush

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @tyr
**Related:** DEC-003

## Context

The plugin's `compaction.mjs` decides when to compact (default
threshold: 50% of max context). The summarizer — which actually
discards the older messages — runs after the threshold is hit.
The summarizer's output replaces the older messages but is **not
persisted to memory** before the discard.

This is the durability gap: between the threshold and the
summarizer's completion, the older messages are gone. If the
process crashes mid-summary, the agent has lost context that
wasn't in the vault.

OpenClaw's `flush-plan.ts:27-34` solves this by writing
durable notes to memory **before** the summarizer runs.

## Decision

Implement `plugins/bizar/src/hooks/memory-flush-on-compact.ts`.
Wired into the `beforeModel` hook:

```ts
// plugins/bizar/index.ts (in beforeModel)
const flusher = createMemoryFlushOnCompact({
  worktree: ctx.worktree,
  logger: ctx.logger,
  enabled: true,
});
await flusher.maybeFlush({
  sessionId,
  usage: snap.usage,
  maxContext: snap.maxContext,
  recentMessages: (modelCtx.request.messages ?? []).slice(-10).map(...),
});
```

When `shouldCompact()` returns true, the hook writes a
"pre-compact snapshot" to
`~/.bizar_memory/projects/BizarHarness/compaction-snapshots/<ts>-<session>.md`:

```markdown
---
kind: pre-compact-snapshot
session_id: ses_abc12345
timestamp: 2026-07-07T15:00:00.000Z
usage_total: 6000
max_context: 10000
usage_ratio: 0.6
tags: [snapshot, compaction]
---

# Pre-compaction snapshot — 2026-07-07T15-00-00

Session `ses_abc12345` crossed the compaction threshold (60% of
10000 tokens). This note captures the recent context so it can
be retrieved after summarization.

## Recent messages

### user
...

### assistant
...
```

## Consequences

### Positive

- Closes the durability gap — context is persisted to memory
  **before** the summarizer runs.
- Snapshots are greppable (timestamp + session-id in filename).
- The `recentMessages` slice gives the agent a recovery point
  after compaction.

### Negative

- One extra write per compaction. Negligible.
- Snapshots are stored in the user's vault; if the vault is
  very large, the snapshot directory grows. We don't prune
  for v6.0.0.

### Neutral

- The hook is opt-in via `enabled: true`. Users can disable it
  per-project if they don't want the writes.
- Future versions may consolidate snapshots into a single
  rolling summary (one per session, not one per compaction).

## References

- `plugins/bizar/src/hooks/memory-flush-on-compact.ts` (123 lines)
- `plugins/bizar/index.ts` — `beforeModel` hook integration
- `plugins/bizar/tests/safety.test.ts` — 3 unit tests
- OpenClaw `src/lifecycle/flush-plan.ts:27-34` — reference
  pattern
- `research/agent-harness-survey/round-9-memory/bizar-memory-redesign.md`
  § C.1 — Tier 1 Working Memory: pre-compaction flush
