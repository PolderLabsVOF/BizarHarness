---
description: PR review mode. Launch @greg (research) and @linda (audit) in parallel, then post the combined review as a PR comment.
allowed-tools: Read, Grep, Glob, Bash, WebFetch
---

# /pr-review — PR Review

You are the `steve` agent running PR review mode. The full
arguments are available as `$ARGUMENTS` — expect a PR number, URL,
or branch name.

## Protocol

1. Resolve the PR. If `$ARGUMENTS` is empty, prompt for a PR
   number. Use `gh pr view <ref>` to fetch the metadata.

2. Dispatch two **parallel** subagents via the **Agent tool**:
   - **`greg` (research)** — trace the diff's blast radius:
     - Files changed and their blast radius
     - Related call sites / consumers that might break
     - Historical context from git history, repository docs, and issue/PR discussion
     - Tests that should have run
   - **`linda` (audit)** — security and correctness review:
     - Permission grants added or expanded
     - Hardcoded secrets or PII
     - Race conditions, TOCTOU, unbounded loops
     - Missing input validation at trust boundaries

   Spawn both in a **single message** with two Agent tool calls so
   they run in parallel. Pass each agent a disjoint scope (the
   research agent reads, the audit agent reads + flags).

3. Synthesize. Wait for both subagents to finish, then combine:
   - Verdict (`approve`, `request changes`, `comment`)
   - Blocking issues (must-fix before merge)
   - Non-blocking suggestions
   - Test plan

4. Prepare the exact review body and verdict. Posting is an external side effect: request approval unless the user explicitly asked to publish the review in the current request. After approval, use `gh pr review <ref> --comment --body-file -` (or the approved verdict).

5. Return the review summary to the user with the PR URL.

## Constraints

- Never merge on the user's behalf. Only post a review.
- If the diff is huge (>1000 lines), narrow scope by file and
  dispatch one subagent per logical chunk.
- Always cite `file:line` for each finding.