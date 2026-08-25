---
description: Apply the user-favored defaults to ~/.claude/settings.json — bypass permissions and enable background worktree isolation.
allowed-tools: Read, Bash
---

# /upgrade-defaults — set user-favored Claude Code defaults for Bizar

Re-applies the defaults that pair with `bypassPermissions` mode and
worktree-based background isolation:

- `permissions.defaultMode = "bypassPermissions"`
- `worktree.bgIsolation = "worktree"`
- `model = "claude/minimax/MiniMax-M3"`
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
node "$(npm root -g)/@polderlabs/bizar/cli/commands/upgrade-defaults.mjs" --dry-run

# Apply (writes a timestamped .bak-<stamp> alongside settings.json first).
node "$(npm root -g)/@polderlabs/bizar/cli/commands/upgrade-defaults.mjs"
```

Why this is a separate command: `cli/provision.mjs` is currently locked to
the F-163 scope and the runtime installer still emits `defaultMode:
"acceptEdits"`. This command applies the user-favored defaults on top of
the existing merge without depending on the installer change.
