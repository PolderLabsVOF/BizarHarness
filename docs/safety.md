# Safety and human approval

Bizar enforces safety at Claude Code's native hook and permission
boundaries:

- `config/claude/hooks/pretooluse-bash.mjs` denies destructive shell patterns.
- `config/claude/hooks/pretooluse-editwrite.mjs` protects sensitive paths.
- `config/claude/hooks/git-workflow-guard.mjs` denies history rewriting and asks
  for human approval before commits, pushes, PR mutations, releases,
  publication, and deployment.
- `config/claude/hooks/simplify-guard.mjs` requires a fresh `/simplify` pass
  before a commit.
- `config/claude/settings.json` adds declarative `allow`, `ask`, and `deny`
  patterns. Hook denial has priority over approval.

Safe commands return no permission decision, allowing Claude Code's own
policy engine to decide. Bizar never manufactures an unconditional
`allow`.

Executable coverage lives in:

- `config/claude/hooks/__tests__/pretooluse-bash.test.mjs`
- `config/claude/hooks/__tests__/pretooluse-editwrite.test.mjs`
- `config/claude/hooks/__tests__/workflow-guards.test.mjs`
- `packages/sdk/tests/approval.test.ts`

See [DEC-007](decisions/DEC-007-tool-approval-gate.md).
