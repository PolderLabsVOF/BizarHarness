---
name: update-pr-summary
description: Refresh a pull-request description from the current diff and verified test evidence.
---

# Update pull-request summary

Read the current PR, base-to-head diff, commits, and fresh validation output. Rewrite only stale sections. Preserve valid issue references and human-authored context. Include exact test commands and results, known gaps, risks, and visual evidence where relevant. Use `gh pr edit` only after the human confirmation hook approves the external update.
