---
description: Validate the Bizar install end-to-end — settings.json parses, plugin entry resolves, all agent files are installed, all skills/rules/hooks/commands are in place, provider config is sane, and the 9router gateway is reachable.
allowed-tools: Read, Bash
---

# /validate — Validate the Bizar Install

The `/validate` command runs `bizar doctor` with the full check
battery. It is the fastest way to confirm the install is healthy
and Claude Code will see every Bizar component on the next session
start.

## What It Checks

1. **claude-reachable** — `claude --version` exits 0.
2. **claude-config-valid** — `~/.claude/settings.json` parses as JSON.
3. **plugin-entry-present** — `settings.json` has a Bizar plugin entry.
4. **plugin-path-resolves** — the plugin path on disk actually exists.
5. **agent-files-installed** — all agent files in `~/.claude/agents/`
   (odin, vor, frigg, quick, mimir, heimdall, hermod, thor, baldr,
   tyr, vidarr, forseti, semble-search, agent-browser).
6. **tools-available** — at least one of `headroom`, `semble`, `skills`
   is on PATH.
7. **provider-config-sanity** — `provider.9router` (preferred) or
   `provider.minimax` (legacy) has at least one sane model entry.
8. **9router-reachable** — 9Router gateway responds at
   `http://localhost:20128/api/health` (lenient — warn, don't fail).
9. **slash-commands-installed** — all Bizar slash commands
   (`/audit`, `/explain`, `/init`, `/learn`, `/plan`, `/plow-through`,
   `/pr-review`, `/tailscale-serve`, `/visual-plan`, `/bizar`,
   `/team`, `/test`, `/validate`) are present in `~/.claude/commands/`.
10. **skills-installed** — every subdir of `config/skills/` is
    mirrored to `~/.claude/skills/`.
11. **rules-installed** — every `.md` in `config/rules/` is mirrored
    to `~/.claude/rules/`.
12. **hooks-installed** — `config/hooks/` is mirrored to
    `~/.claude/hooks/`.

## How to Use

Invoke `/validate` (no arguments) from anywhere. It is read-only and
never modifies the system.

If any check fails, the user should run `bizar update` to refresh the
install, or `bizar repair` to fix common issues.

## Output

Each check prints ✓ or ✗ with a one-line message. The summary line
shows the total pass/fail count. Exits non-zero if any check fails.

For machine-readable output, the user can run `bizar doctor --json`
directly.

## When to Use

- After a manual config edit — confirm nothing broke.
- Before a `/team` mission — confirm the install is healthy so the
  team has all the tools it needs.
- After `bizar install` or `bizar update` — the install already
  calls doctor, but a manual re-run is cheap.
- When a user asks "why is Claude Code misbehaving?" — start here.

## Related

- `bizar doctor` — the underlying CLI command
- `bizar update` — refreshes the install (re-runs syncConfigExtras)
- `bizar repair` — fixes common issues (stale symlinks, version drift)