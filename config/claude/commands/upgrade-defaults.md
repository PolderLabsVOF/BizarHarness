---
description: Apply the user-favored defaults to ~/.claude/settings.json — bypass permissions and enable background worktree isolation.
allowed-tools: Read, Bash
---

# /upgrade-defaults — set user-favored Claude Code defaults for Bizar

Re-applies the defaults that pair with `bypassPermissions` mode and
worktree-based background isolation:

- `permissions.defaultMode = "bypassPermissions"`
- `worktree.bgIsolation = "worktree"`
- `model = first enabled user-selected or configured-tier model`
- `alwaysThinkingEnabled = true`
- `effortLevel = "high"`
- `skipDangerousModePermissionPrompt = true`
- `showThinkingSummaries = true`
- `askUserQuestionTimeout = "5m"`

The command preserves any user-set value that is more restrictive than the
default (e.g. if `defaultMode` is already `acceptEdits`, it stays). Every
unrelated key — `mcpServers`, `hooks`, `env`, `attribution`, `enabledPlugins`,
`extraKnownMarketplaces` — is preserved verbatim.

```bash
# Preview the diff without writing.
bizar upgrade-defaults --dry-run

# Apply (writes a timestamped .bak-<stamp> alongside settings.json first).
bizar upgrade-defaults
```

This command preserves unrelated settings and creates a timestamped backup
before changing Bizar-owned defaults.
