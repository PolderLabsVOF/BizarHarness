---
description: Autonomous local execution with explicit human approval boundaries.
---

# Plow Through — Guarded Autonomous Mode

Execute the requested local work end-to-end without pausing for ordinary reversible steps.

1. Read repository instructions, `PROGRESS.md`, and relevant project files.
2. Infer reasonable details from evidence; record material assumptions.
3. Form the default native Agent team with bounded research, implementation,
   and review/integration ownership. Use direct execution only for an explicit
   `/quick` request or an unmistakably tiny edit.
4. Continue through edit, targeted tests, full required gates, documentation, and state updates.
5. Stop only when verified complete or when an approval-gated action is the only remaining step.

No clarifying questions are needed for ordinary, reversible work whose intent
is established by repository evidence.

## When not to use

Do not use this mode when the request is planning-only, materially ambiguous,
destructive, production-facing, credential-gated, or changes scope beyond the
user's stated objective.

## Approval boundary

Do not push, publish, deploy, merge, change credentials/access, modify production data, or perform a destructive action that the user did not explicitly request. Prepare the exact action and evidence, then request approval once.

## Completion report

Report the result, changed files, validation evidence, assumptions, and any approval-gated next action. Never claim completion while required local verification is still pending.
