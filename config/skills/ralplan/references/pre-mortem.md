# Pre-mortem reference

See `config/skills/thinking-pre-mortem/SKILL.md` for the canonical
pre-mortem methodology (Gary Klein's prospective hindsight: assume the
plan has already failed, reason backward through why).

## When the ralplan skill pre-pends a pre-mortem

RALPLAN deliberate mode (`bizar workflow start --mode ralplan
--deliberate`) prepends a pre-mortem round to the Architect pass:

1. The Planner's draft is finalized at `docs/specs/ralplan/<slug>.md`.
2. The pre-mortem skill is loaded against that draft and produces a
   failure-reason list ranked by likelihood × impact.
3. The Architect pass (`@plan-architect`) ingests the pre-mortem output
   alongside the Planner's draft and folds P0/P1 risks into
   `tradeoff_tensions` and `open_questions`.
4. The Critic pass (`@linda` RALPLAN-Critic) reads both.

## When deliberate mode is auto-enabled

RALPLAN deliberate mode is auto-enabled when the prompt signals any of
the seven-category floor at
`config/claude/hooks/permission-request.mjs:64–69`:

- auth / security
- migration
- destructive operation
- public API breakage
- production incident
- compliance / PII
- irreversible destruction

The signal detection lives in the workflow routing hook and writes the
deliberate flag onto the workflow state at start; downstream consumers
read it from there. The skill itself does not gate on the keyword
heuristics.
