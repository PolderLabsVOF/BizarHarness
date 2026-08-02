---
name: self-improvement
description: Use when reviewing Bizar's bounded project learning records and converting repeated evidence into explicit, human-reviewable operating rules.
---

# Bounded Self-Improvement

Bizar retains small operational learning records for routing and continuity:

- `.bizar/learning/instincts.jsonl`
- `.bizar/learning/decisions.jsonl`
- `.bizar/AGENTS_SELF_IMPROVEMENT.md`

These are not a note vault, semantic search index, or general memory API.

## Workflow

1. Read only the recent records relevant to the current failure or repeated
   pattern.
2. Require concrete evidence from tests, commands, or reviewed outcomes.
3. Deduplicate against existing active rules.
4. Propose one specific rule with a trigger, action, evidence, and scope.
5. Tier by reversible-impact:
   - **Tier A (autonomous)** — appending a single instinct with concrete
     evidence; pruning a duplicate instinct already covered by an active rule.
     No ask required; agents do this directly.
   - **Tier B (operator confirm)** — promoting an instinct to a tracked rule
     in `.bizar/AGENTS_SELF_IMPROVEMENT.md`; dropping or materially editing an
     existing tracked rule. Surface the diff and ask the operator once.
6. Keep the active rule set small; remove obsolete advice instead of endlessly
   appending.

Do not store credentials, conversation transcripts, personal data, broad notes,
or copied external content. Repository documentation and Git remain the source
of truth for durable project knowledge.
