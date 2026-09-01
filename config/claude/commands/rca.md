---
description: Fetch a GitHub issue and ask Claude Code for a read-only root-cause plan.
allowed-tools: Read, Bash
---

# /rca

Run `bizar rca <issue-url>`. The command fetches the issue JSON with `gh` and
runs one read-only Claude planning session. It prints the resulting analysis;
it does not write an RCA document, inspect linked PRs/comments, or register an
autopilot workflow.
