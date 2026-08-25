---
name: commit-staged
description: Verify and commit exactly the staged Git changes through Bizar's simplify and human-approval gates.
---

# Commit staged changes

1. Inspect `git status --short`, `git diff --cached --stat`, and `git diff --cached`.
2. Stop if unrelated or secret files are staged. Never stage extra files implicitly.
3. Run the repository's targeted tests and required gate.
4. Invoke `/simplify`, apply justified fixes, restage, and rerun affected tests.
5. Use one conventional subject: `feat|fix|refactor|docs|style|test|build|chore: description`.
6. Attempt one commit containing only the reviewed staged files. The PreToolUse hook must ask the human before Git executes it.

Do not add AI attribution, amend existing commits, rebase, or force-push.
