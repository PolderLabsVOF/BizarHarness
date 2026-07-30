---
name: review-pr
description: Review a pull request read-only, rank findings by severity, and publish only when explicitly requested.
---

# Review a pull request

Fetch the PR metadata and diff with read-only `gh` commands. Inspect related code and tests locally. Report only actionable findings with severity, file, line, consequence, and minimal repair. Separate confirmed defects from questions and non-blocking suggestions. State what was not verified.

Do not approve, request changes, comment, merge, or modify files unless the user explicitly requests that external or local action.
