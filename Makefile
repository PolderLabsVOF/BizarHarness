# Bizar Harness — Makefile
#
# Single source of truth for agent commands. Every target is idempotent
# and exits 0 on success. Run `make help` to see all targets.
#
# Claude Code-native: the runtime is the SDK + stdio MCP server under
# `packages/sdk/`, with hooks, agents, skills, and commands in `config/claude/`
# (the repo deliberately has no top-level `.claude/` so Claude Code sessions
# inside the repo do not auto-load Bizar's own assets; `bizar install`
# provisions them to the user's `~/.claude/`).

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# ── Helpers ─────────────────────────────────────────────────────────────────
help:  ## Show this help message
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ── Setup / dev ─────────────────────────────────────────────────────────────
setup:  ## Install Claude Code CLI + Bizar deps
	npm install -g @anthropic-ai/claude-code
	npm install
	@echo "✓ Claude Code CLI + Bizar deps installed"

dev:  ## Run the SDK test watcher
	npm run test:sdk:watch

check:  ## Typecheck + lint
	@echo "▶ Running TypeScript check..."
	@bunx tsc --noEmit
	@echo "✓ TypeScript check passed"
	@echo "▶ Skipping eval gate (run 'make eval-gate' to enforce)."

test:  ## Run all unit tests (sdk + cli)
	@npm test

e2e:  ## End-to-end tests (SDK + Claude Code integration)
	@echo "▶ E2E: SDK load + tool registration..."
	@npm run build:sdk
	@node scripts/bh-full-e2e.mjs

# ── Harness primitives (L07-L12) ────────────────────────────────────────────
vcr:  ## Verify Code Reality (VCR) check via feature_list.json
	@echo "▶ Computing VCR ratio from feature_list.json..."
	@node -e "const fs = require('node:fs'); const f = JSON.parse(fs.readFileSync('feature_list.json', 'utf8')); const total = f.features.filter(x => x.state !== 'not_started').length; const passing = f.features.filter(x => x.state === 'passing').length; const ratio = total === 0 ? 1.0 : passing / total; console.log('VCR:', passing + '/' + total, '=', ratio.toFixed(3)); if (ratio < 1.0 && total > 0) process.exit(1);"

verify-feature:  ## Verify a feature by ID — usage: make verify-feature ID=F-001
	@if [ -z "$(ID)" ]; then echo "Usage: make verify-feature ID=<feature-id>"; exit 1; fi
	@echo "▶ Verifying feature $(ID)..."
	@bash scripts/verify-feature.sh $(ID)

check-arch:  ## Run architectural constraints (scripts/check-arch.sh)
	@bash scripts/check-arch.sh .
	@echo "▶ Verifying thinking-* skill files..."
	@node scripts/verify-thinking-skills.mjs

sync-skills-mirror:  ## Mirror config/skills/ -> config/claude/skills/ (idempotent)
	@node scripts/sync-skills-mirror.mjs

verify-thinking-skills:  ## Verify every thinking-*/skillopt SKILL.md is well-formed
	@node scripts/verify-thinking-skills.mjs

clean-check:  ## Run the five-dimension clock-out verifier
	@bash scripts/clean-state-check.sh

verify-removed-surfaces:  ## Prove removed UI and note-vault systems are absent
	@node scripts/verify-removed-surfaces.mjs

verify-no-9router:  ## Drift guard: 9Router must not reappear in the shipped surface
	@node scripts/verify-no-9router.mjs

verify-repo-structure:  ## Prove tracked and published paths match the core harness
	@node scripts/verify-repo-structure.mjs

audit:  ## Run harness audit (12 categories, 0-100 score)
	@echo "▶ Running harness audit..."
	@node scripts/audit.mjs --write
	@echo "✓ audit complete — output written to .harness/audit/latest.json"

eval-gate:  ## Verify local eval pass rates or tracked commit-backed evidence
	@echo "▶ Running eval gate..."
	@bun run scripts/eval-gate.mjs
	@echo "✓ eval gate passed"

feature-state-machine:  ## Enforce plan→exec→verify→audit state machine per passing feature
	@echo "▶ Running feature state machine..."
	@bun run scripts/feature-state-machine.mjs
	@echo "✓ feature state machine passed"

# ── Claude Code-specific ───────────────────────────────────────────────────
# session-start / session-end were Cline-era targets. Claude Code now
# auto-primes via the SessionStart hook (see config/claude/settings.json), so
# the targets are kept as thin no-op echoes for backward compat.
session-start:  ## [deprecated] Claude Code auto-primes via SessionStart hook
	@echo "✓ Claude Code auto-primes via config/claude/hooks/sessionstart-prime.mjs"

session-end:  ## [deprecated] Claude Code handles session end automatically
	@echo "✓ Claude Code handles session end via SessionEnd hook"

init:  ## Run the Claude Code-native initializer
	@./init.sh --fast

mirror-claude-md:  ## Regenerate config/claude/CLAUDE.md mirror from AGENTS.md
	@./scripts/mirror-claude-md.sh

mirror-claude-md-check:  ## CI check: config/claude/CLAUDE.md is in sync with AGENTS.md
	@./scripts/mirror-claude-md.sh --check

cleanup: verify-repo-structure  ## Verify the repository and package contain no stale paths

workflow-gc:  ## Garbage-collect .bizar/runs/ older than 14 days (Phase B.3)
	@node cli/commands/workflow-gc.mjs

workflow-gc-dry:  ## List GC candidates without deleting (Phase B.3)
	@node cli/commands/workflow-gc.mjs --dry-run

mcp-serve:  ## Run the Bizar MCP server (stdio) for Claude Code
	@node packages/sdk/dist/mcp/bin.js

worktree-init:  ## Bootstrap a new worktree with shared node_modules / dist symlinks — usage: make worktree-init WORKTREE=/path/to/worktree
	@./scripts/worktree-setup.sh "$(WORKTREE)"

# ── Convenience ─────────────────────────────────────────────────────────────
.PHONY: help setup dev check test e2e vcr verify-feature check-arch clean-check verify-removed-surfaces verify-repo-structure verify-no-9router audit eval-gate feature-state-machine session-start session-end init mirror-claude-md mirror-claude-md-check mcp-serve worktree-init cleanup workflow-gc workflow-gc-dry sync-skills-mirror verify-thinking-skills
