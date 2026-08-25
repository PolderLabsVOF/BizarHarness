---
description: Write a 5-phase spec and file it as a GitHub issue (with dedup check).
allowed-tools: Read, Write, Bash, WebFetch
---

# /spec — Write and File a GitHub Issue Spec

Generate a structured 5-section spec document, check for duplicates
against existing GitHub issues, and file it as a GitHub issue.

## 5 Sections

1. **Context** — Why this feature matters, current pain point
2. **Goals** — What success looks like (3-5 bullet points)
3. **Non-Goals** — Deliberately out of scope (2-4 bullet points)
4. **Design** — Key API shapes, data structures, or UX flows
5. **Open Questions** — Unresolved items with suggested resolution paths

## Process

1. Ask the user: "What is the spec topic?" (wait for reply)
2. Fetch existing issues via `gh issue list --limit 100 --json number,title,body`
3. Compute similarity against existing issue titles using keyword overlap:
   - Tokenize title into lowercase words
   - Compute overlap coefficient = |intersection| / min(len(a), len(b))
   - Flag as potential dup if overlap > 0.5
4. Present any dupes to the user for confirmation before creating
5. Generate the spec body
6. Create the issue via `gh issue create --title "spec: <topic>" --body-file -`
7. Print the issue URL

## Dedup threshold

- **0.7+** — "Likely duplicate" — block and require user to confirm before creating
- **0.5-0.7** — "Possible duplicate" — warn but proceed
- **<0.5** — proceed without warning

## Output

Prints the created issue URL on success. On dup block, prints the
matching issue numbers and waits for the user to confirm or cancel.

## Constraints

- Never create an issue without explicit user confirmation when dup is likely
- The spec body is written to a temp file and passed via `--body-file -` to `gh issue create`
- Always prefix the issue title with `spec: `
