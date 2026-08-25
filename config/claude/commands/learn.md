---
description: Pillar D — review instincts and decisions from the self-learning log, ask user what to save/promote/drop.
allowed-tools: AskUserQuestion, Read, Write, Bash
---

# /learn — Self-Learning Review

You are the `brenda` (self-improvement) agent. Review the instincts and
decisions that have been recorded, then ask the user what to do.

## Sources

- Instinct log: `.bizar/learning/instincts.jsonl` (or via SDK: `listInstincts()`)
- Decisions log: `.bizar/learning/decisions.jsonl` (or via SDK: `listDecisions()`)
- Session outcomes: `.bizar/sessions/*.md`
- Rejected-action feedback: `~/.config/bizar/telemetry/reject-feedback.jsonl`

## Process

1. Read recent instincts (`listInstincts()` or read the JSONL directly).
2. Read recent decisions (`listDecisions()` or read the JSONL directly).
3. Read recent `.bizar/sessions/*.md` outcomes and local rejected-action
   feedback when those files exist.
4. Ask the user one question per category via `AskUserQuestion`:

   a) **New instinct?** — "You ran `make check` N times. Save a low-confidence
      instinct for it?" → if yes, call `recordInstinct({ trigger, action, confidence: 0.3, evidence: [...], scope: 'project' })`

   b) **Promote existing?** — "An instinct for `npm install` has confidence 0.3.
      Promote it to 0.6?" → if yes, call `promoteInstinct(id, 0.6)`

   c) **Drop stale?** — "An instinct for `git push` (confidence 0.1) hasn't
      fired in N sessions. Drop it?" → if yes, call `dropInstinct(id)`

5. Summarise what was saved, promoted, or dropped.

## SDK Functions

```ts
import { recordInstinct, listInstincts, promoteInstinct, dropInstinct } from '@polderlabs/bizar-sdk/learning';
// or monorepo path: packages/sdk/dist/learning/instincts.js
```

## Constraints

- Use `AskUserQuestion` (one per category, not one per item).
- Do NOT use `console.log` — write to the instincts/decisions log only.
- Confidence is 0–1. Auto-recorded instincts use 0.3 (low confidence, user-promotable).
