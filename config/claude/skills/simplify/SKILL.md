---
name: simplify
description: Review the staged diff for reuse, clarity, efficiency, and abstraction quality before each commit.
---

# Simplify

Review only the current staged diff. Preserve behavior unless a defect is proven.

1. **Reuse:** replace duplicate helpers or logic with existing project utilities.
2. **Clarity:** remove needless indirection, defensive noise, redundant comments, and vague names.
3. **Efficiency:** remove repeated work or avoidable allocations only where the diff makes them relevant.
4. **Altitude:** keep abstractions at the repository's established level; delete wrappers that add no policy.

Apply justified fixes, restage the intended files, and rerun the smallest tests that prove behavior. If no fix is justified, say so explicitly. Do not commit; the Git workflow guard handles the final human confirmation.
