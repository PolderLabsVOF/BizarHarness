# Skill curation

`config/skills/<name>/SKILL.md` is canonical. `scripts/sync-skills-mirror.mjs` creates the `.claude/skills` project mirror and reports missing, changed, and orphaned entries. `scripts/verify-thinking-skills.mjs` adds stricter metadata/body checks for the thinking-model library.

New skills need a narrow trigger, explicit boundaries, deterministic workflow, and validation evidence. Prefer updating an existing skill over adding overlapping instructions. The self-improvement hooks may record compact instincts and decisions, but skill promotion remains a reviewed code change.
