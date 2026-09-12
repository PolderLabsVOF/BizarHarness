# Bizar Harness — Makefile
#
# Single source of truth for agent commands. Every target is idempotent
# and exits 0 on success. Run `make help` to see all targets.
#
# Agent Orchestrator is the primary multi-agent runtime. Bizar supplies Codex /
# Claude Code worker policy plus the SDK, hooks, skills, commands, and gates.
# `bizar ao setup` configures a project through AO's supported daemon CLI;
# standalone Claude Code and OpenKan surfaces remain available.

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# ── Helpers ─────────────────────────────────────────────────────────────────
help:  ## Show this help message
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ── Setup / dev ─────────────────────────────────────────────────────────────
setup:  ## Install Bizar dependencies
	npm install
	@echo "✓ Bizar dependencies installed; use 'bizar ao doctor' to verify Agent Orchestrator"

dev:  ## Run the SDK test watcher
	npm run test:sdk:watch

check:  ## Typecheck + lint
	@echo "▶ Running TypeScript check..."
	@bunx tsc --noEmit
	@echo "✓ TypeScript check passed"

test:  ## Run all unit tests (sdk + cli)
	@npm test

e2e:  ## End-to-end tests (SDK + Claude Code integration)
	@echo "▶ E2E: SDK load + tool registration..."
	@node scripts/with-sdk-dist-lock.mjs node scripts/run-e2e-with-sdk-build.mjs

# ── Harness primitives (L07-L12) ────────────────────────────────────────────
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

mcp-serve:  ## Run the Bizar MCP server (stdio) for Claude Code
	@node packages/sdk/dist/mcp/bin.js

worktree-init:  ## Bootstrap a new worktree with shared node_modules / dist symlinks — usage: make worktree-init WORKTREE=/path/to/worktree
	@./scripts/worktree-setup.sh "$(WORKTREE)"

# ── Convenience ─────────────────────────────────────────────────────────────
.PHONY: help setup dev check test e2e check-arch clean-check verify-removed-surfaces verify-repo-structure verify-no-9router audit session-start session-end init mirror-claude-md mirror-claude-md-check mcp-serve worktree-init cleanup sync-skills-mirror verify-thinking-skills
