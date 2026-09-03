---
name: ralplan
description: Produce a research-grounded implementation plan through separate planner and adversarial reviewer passes, persisted in the Bizar workflow.
argument-hint: "<task to research and plan>"
---

# Ralplan

Ralplan is the consensus-planning entry point. It may prepare an execution-ready run, but it does not implement when the user asked for planning only.

## State and research

```sh
bizar workflow status --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
bizar workflow resume --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
# When no run exists:
bizar workflow start --profile default --goal "$ARGUMENTS" --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
```

Ground the specification in repository evidence. For external APIs, frameworks, CLI behavior, configuration formats, or version-sensitive dependencies, WebSearch current official documentation and WebFetch the exact page. State acceptance criteria, exclusions, risks, approval boundaries, and stop condition. Re-read status and advance `research` with bounded evidence.

## Consensus gate

1. A planner drafts ordered steps, file ownership, dependency edges, rollback, and targeted/full verification.
2. A separate QA reviewer challenges assumptions, race/interference risks, failure recovery, approval boundaries, and test adequacy.
3. Resolve every material finding. Shared root files have one owner; independent scopes are explicitly parallel; dependent work is serialized.
4. Persist the accepted plan in the repository's normal planning/state files, not in a note vault or wiki.
5. Re-read workflow status, then mark planning complete:

   ```sh
   bizar workflow advance --run "$RUN_ID" --revision "$REVISION" --stage plan --evidence "$BOUNDED_EVIDENCE" --json
   ```

The resulting workflow is ready at execution. If the user requested plan-only work, stop there and report the resumable run identity. Do not auto-commit, push, publish, release, deploy, change credentials/access, perform destructive work, or launch a daemon/tmux controller.

## OMX-shape 8-step protocol

The OMX-derived strengthening of `/ralplan` adds three named roles and a
hard iteration cap on top of the existing consensus gate. The existing
Planner → QA-reviewer flow above is preserved; the OMX shape layers the
Architect (`@plan-architect`) and the RALPLAN-Critic sub-mode of
`@linda` between them.

### 8-step shape

1. **Planner** (`@paul`) drafts the plan per the consensus-gate section
   above. Output: `docs/specs/ralplan/<slug>.md`.
2. **Pre-mortem round** (deliberate mode only — see below).
3. **Architect** (`@plan-architect`) consumes the Planner's draft (and
   the pre-mortem output when present) and emits a structured
   `ArchitectPass` JSON. Verdict: `PROCEED | ITERATE`.
4. **Critic** (`@linda` RALPLAN-Critic sub-mode) consumes the
   Architect's pass and emits one of `APPROVED | CHANGES REQUIRED |
   REJECTED` plus a structured handoff JSON.
5. **Iterate** on `ITERATE` or `CHANGES REQUIRED`. The iteration
   counter increments only on non-APPROVE verdicts.
6. **Cap at 5 iterations.** Five iterations without `APPROVED` fails
   the workflow; the last verdict is recorded in the workflow state.
7. **Gate execution.** The Critic's `APPROVED` is the hard gate
   independent of the Architect's score. Without `APPROVED`, the plan
   does not advance to execution.
8. **Persist handoff.** Write the typed handoff JSON to
   `docs/specs/ralplan/<slug>.handoff.json` per DEC-022.

### Deliberate mode (`--deliberate`)

Deliberate mode prepends a pre-mortem round between step 1 and step 3.
The canonical methodology lives at
`config/skills/thinking-pre-mortem/SKILL.md`; see
`config/skills/ralplan/references/pre-mortem.md` for how the round is
folded into the Architect pass.

Deliberate mode is **auto-enabled** when the prompt signals any of the
seven-category floor at
`config/claude/hooks/permission-request.mjs:64–69`:

- auth / security
- migration
- destructive operation
- public API breakage
- production incident
- compliance / PII
- irreversible destruction

The signal detection lives in the workflow routing hook and writes the
deliberate flag onto the workflow state at start; this skill reads the
flag and runs the pre-mortem round.

### Pre-execution gate (Mike's adaptive routing)

Prompts that satisfy both:

- effective word count ≤ 15, and
- contain no concrete anchors (no file path, no command, no error
  message, no API name, no named system),

route to `/ralplan`. The `force:` and `!` prefixes bypass this gate and
let the prompt land on the dispatcher's default selection. This row
sits alongside Mike's existing decision tree; it does not replace
`office-manager.md`'s other rules.

### Handoff JSON contract

The Critic consumes the Architect's pass and emits a handoff JSON. The
shared contract is:

```json
{
  "schema_version": "1.0.0",
  "planner_complete": false,
  "architect_complete": false,
  "critic_complete": false
}
```

All three flags must be `true` for the workflow to advance past the
ralplan gate. The typed shape is the SDK's `RalplanHandoff` from
`packages/sdk/src/handoff/ralplan.ts` (Phase 1 of the OMX adoption
plan); the skill references the type by name and does not import it.

### Handoff file location

Per DEC-022, the typed handoff lives at
`docs/specs/ralplan/<slug>.handoff.json`. The skill writes this file
when the gate closes (Critic emits `APPROVED`); the workflow state
references the file path so downstream consumers can find it.
