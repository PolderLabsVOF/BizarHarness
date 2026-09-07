---
description: Run the bizplan planning workflow (default tier: standard).
argument-hint: "<goal>"
---

# `/bizplan` — default tier: standard

Multi-file request → planner + architect + critic → plan persisted to `.ok/plans/pln-*.json` with PRD cross-ref → executor task spawned in `.ok/tasks/`.

Use `/bizplan-light` for one-file no-behavior-change requests.
Use `/bizplan-heavy` for architectural or multi-lane work.
See `config/claude/skills/bizplan/SKILL.md` for the tier decision tree and playbook.
