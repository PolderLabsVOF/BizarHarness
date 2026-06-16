# Git Rules

- Write conventional commit messages: `type(scope): description`
  Types: feat, fix, chore, docs, style, refactor, perf, test, ci
- Keep commits small and atomic — one logical change per commit
- Never force-push to shared branches
- Always rebase onto target branch before opening a PR
- Squash fixup commits before merging
- Write meaningful commit bodies when the subject line is insufficient
- Reference issue numbers in commits that fix bugs: `fix(#123): description`
- Never commit generated files, build artifacts, or dependency lockfiles unless intentional