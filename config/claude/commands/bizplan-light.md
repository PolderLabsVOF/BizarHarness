---
description: Bizplan tier light — single-file, no behavior change.
argument-hint: "<goal>"
---

# `/bizplan-light` — tier: light

One file, no behavior change → interview only → plan persisted under `.ok/plans/pln-*.json`.

Only spawns an executor task if scope > 1 file. Cross-reference to an open PRD is skipped at this tier.
