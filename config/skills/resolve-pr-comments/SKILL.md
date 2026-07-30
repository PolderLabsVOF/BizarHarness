---
name: resolve-pr-comments
description: Resolve actionable pull-request review comments with local fixes, tests, and approval-gated GitHub updates.
---

# Resolve pull-request comments

1. Read all review threads and classify each as actionable, already resolved, question, or disagreement.
2. Map actionable comments to current code; do not blindly follow stale line references.
3. Make minimal local fixes and add regression coverage where behavior changes.
4. Run targeted and required gates.
5. Summarize each thread with evidence. Ask through the configured Git/GitHub guard before pushing, replying, resolving, or updating the PR.

Never mark a thread resolved before its fix is present and verified.
