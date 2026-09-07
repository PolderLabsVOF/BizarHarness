# Pre-mortem reference

See `config/skills/thinking-pre-mortem/SKILL.md` for the canonical
pre-mortem methodology (Gary Klein's prospective hindsight: assume the
plan has already failed, reason backward through why).

## When the bizplan skill pre-pends a pre-mortem

BIZPLAN deliberate mode (signalled to the bizplan skill via the planner's
deliberate-mode flag) prepends a pre-mortem round to the Architect pass.
The bizplan CLI surface was retired; deliberate-mode is recorded as
`mode: "deliberate"` in the OpenKan plan metadata written by
`ok plan add --summary "bizplan deliberate ..."` and read by downstream
consumers (`@plan-architect`, `@linda` BIZPLAN-Critic) from there:

1. The Planner's draft is finalized at `docs/specs/bizplan/<slug>.md`.
2. The pre-mortem skill is loaded against that draft and produces a
   failure-reason list ranked by likelihood × impact.
3. The Architect pass (`@plan-architect`) ingests the pre-mortem output
   alongside the Planner's draft and folds P0/P1 risks into
   `tradeoff_tensions` and `open_questions`.
4. The Critic pass (`@linda` BIZPLAN-Critic) reads both.

## When deliberate mode is auto-enabled

BIZPLAN deliberate mode is auto-enabled when the prompt signals any of
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
