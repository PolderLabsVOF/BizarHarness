#!/usr/bin/env bash
#
# init.sh — Bizar harness session initializer (Claude Code).
#
# Synthesizes Lecture 06 of walkinglabs/learn-harness-engineering:
#   "Why initialization needs its own phase".
#
# Verifies the environment is healthy BEFORE the agent starts work.
# Cheap to run, deterministic, idempotent. Exits non-zero if anything is
# broken so the agent's first move cannot be "discover the environment
# is rotten".
#
# Usage:  ./init.sh              # full check (good for first boot)
#         ./init.sh --fast       # skip heavy checks
#         ./init.sh --strict     # also fail on lenient checks
#
# Returns: 0 on success, 1 on any blocker.

set -euo pipefail

FAST=0
STRICT=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --strict) STRICT=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) echo "init.sh: unknown arg: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")"

# Header for the log
echo "▶ init.sh — $(date -Iseconds) (Bizar harness initializer, Claude Code)"

ok()   { echo "  ✓ $1"; }
warn() { echo "  ⚠ $1"; W=1; }
err()  { echo "  ✗ $1"; E=1; }

W=0
E=0

# ── 1. Toolchain ──────────────────────────────────────────────────────────
echo
echo "① Toolchain"

if command -v bun >/dev/null 2>&1; then
  ok "bun $(bun --version | head -c 30)"
else
  err "bun not on PATH — install via https://bun.sh"
fi

if command -v node >/dev/null 2>&1; then
  ok "node $(node --version)"
else
  err "node not on PATH"
fi

if command -v git >/dev/null 2>&1; then
  ok "git $(git --version | head -c 60)"
else
  err "git not on PATH"
fi

if command -v claude >/dev/null 2>&1; then
  ok "claude $(claude --version 2>&1 | head -1)"
else
  warn "claude not on PATH (required for Claude Code sessions)"
fi

# ── 2. Bizar state ───────────────────────────────────────────────────────
echo
echo "② Bizar state"

if [[ -f AGENTS.md ]]; then
  ok "AGENTS.md present ($(wc -l < AGENTS.md) lines)"
else
  err "AGENTS.md missing — every session must start by reading this"
fi

if [[ -d .ok && -f .ok/index.json ]]; then
  ok "OpenKan workspace .ok/ present"
else
  warn ".ok/ missing — bootstrap with: bizar openkan init"
fi

if [[ -d .harness ]]; then
  ok ".harness/ directory exists"
else
  warn ".harness/ missing (run \`make session-start\` to bootstrap)"
fi

# ── 3. WIP=1 invariant ───────────────────────────────────────────────────
echo
echo "③ WIP=1 invariant (one in-progress task only)"

if [[ -d .ok/tasks ]]; then
  ACTIVE_COUNT=$(node -e '
    const fs = require("fs"), path = require("path");
    try {
      const dir = path.join(process.cwd(), ".ok", "tasks");
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const tasks = entries
        .filter((e) => e.isDirectory())
        .map((e) => {
          const taskPath = path.join(dir, e.name, "task.json");
          return fs.existsSync(taskPath) ? JSON.parse(fs.readFileSync(taskPath, "utf8")) : null;
        })
        .filter((t) => t && t.schema === "ok.task.v2");
      console.log(tasks.filter((t) => t.status === "in_progress").length);
    } catch (e) { console.log(-1); }
  ')
  if [[ "$ACTIVE_COUNT" == "1" ]]; then
    ok "exactly one OpenKan task is 'in_progress'"
  elif [[ "$ACTIVE_COUNT" == "0" ]]; then
    ok "zero tasks in_progress (ready to pick a new one)"
  elif [[ "$ACTIVE_COUNT" == "-1" ]]; then
    err ".ok/tasks corrupt — cannot check WIP=1"
  else
    err "WIP=1 violated: $ACTIVE_COUNT OpenKan tasks are 'in_progress'. Pick one or finish the others."
  fi
fi

# ── 4. Clean state ───────────────────────────────────────────────────────
echo
echo "④ Clean state"

if command -v rg >/dev/null 2>&1; then
  if rg -q 'console\.log\(|console\.debug\(' --type ts --type tsx packages/sdk/src 2>/dev/null; then
    warn "console.log/debug found in packages/sdk/src — clean before commit"
  else
    ok "no console.log/debug in packages/sdk/src"
  fi
  if rg -q 'debugger;|\.only\(' --type ts --type tsx packages/sdk/src 2>/dev/null; then
    err "debugger or .only() found in packages/sdk/src — remove before commit"
  fi
fi

# ── 5. Verification (skippable via --fast) ────────────────────────────────
echo
echo "⑤ Verification"

if [[ $FAST -eq 1 ]]; then
  echo "  (--fast: skipping make check)"
else
  if make check >/tmp/init-check.log 2>&1; then
    ok "make check passed"
  else
    err "make check failed — see /tmp/init-check.log"
    tail -20 /tmp/init-check.log | sed 's/^/    /'
  fi
fi

# ── 6. Claude Code install + skill/agent mirrors ────────────────────────
echo
echo "⑥ Claude Code install + skill/agent mirrors"

# v6.3.0 — migrated from Cline to Claude Code. The "skill + agent"
# mirrors now live under `~/.claude/` (NOT `~/.cline/` or
# `~/.agents/skills/`). The canonical mirror path is `~/.claude/skills/`
# — `npx skills add` no longer points there.
if [[ -d ~/.claude/skills/bizar ]]; then
  ok "~/.claude/skills/bizar present (mirrored from config/skills/)"
else
  warn "~/.claude/skills/bizar missing — run \`bizar update\` to materialize"
fi

if [[ -d ~/.claude/agents ]]; then
  COUNT=$(find ~/.claude/agents -maxdepth 1 -name "*.md" 2>/dev/null | wc -l)
  ok "$COUNT agent file(s) in ~/.claude/agents"
else
  warn "~/.claude/agents missing"
fi

if [[ -f ~/.claude/settings.json ]]; then
  if node -e "JSON.parse(require('fs').readFileSync(process.env.HOME + '/.claude/settings.json','utf8'))" 2>/dev/null; then
    ok "~/.claude/settings.json parses"
  else
    err "~/.claude/settings.json is corrupt — fix it before running"
  fi
else
  warn "~/.claude/settings.json missing — run \`bizar install\`"
fi

if [[ -d ~/.claude/commands ]]; then
  CMD_COUNT=$(find ~/.claude/commands -maxdepth 1 -name "*.md" 2>/dev/null | wc -l)
  ok "$CMD_COUNT slash command(s) in ~/.claude/commands"
else
  warn "~/.claude/commands missing"
fi

# ── Summary ──────────────────────────────────────────────────────────────
echo
if [[ $E -eq 0 && ( $W -eq 0 || $STRICT -eq 0 ) ]]; then
  echo "✓ init.sh: environment is healthy"
  exit 0
elif [[ $E -eq 0 && $W -gt 0 && $STRICT -eq 1 ]]; then
  echo "⚠ init.sh: --strict; lenient warnings treated as blockers"
  exit 1
else
  echo "✗ init.sh: $E blocker(s), $W warning(s) — fix blockers before running agents"
  exit 1
fi
