---
description: Produce an implementation-ready plan with evidence, approval boundaries, and explicit verification.
---

# Plan

Create a repository-grounded plan for the request.

1. Read repository instructions and current progress/state files.
2. Inspect the smallest set of files needed to establish current behavior.
3. State target result, constraints, assumptions, exclusions, and stop condition.
4. Break work into ordered, verifiable steps with concrete file ownership.
5. Identify destructive, production, credential, publish, deploy, merge, or push
   actions that require human approval.
6. Include targeted tests followed by the project’s required full gates.

For non-trivial work, route drafting to `@paul` and adversarial review to
`@linda` when that orchestration surface is available. Otherwise perform both
passes directly and keep the reviewer pass visibly separate.

Do not implement while the user explicitly requests planning only.
