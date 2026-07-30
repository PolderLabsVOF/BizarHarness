# Bizar Harness — Makefile
#
# Single source of truth for agent commands. Every target is idempotent
# and exits 0 on success. Run `make help` to see all targets.
#
# Claude Code-native: the runtime is the SDK + stdio MCP server under
# `packages/sdk/`, with hooks, agents, skills, and commands under `.claude/`.

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
	@/home/drb0rk/.bun/bin/bunx tsc --noEmit
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
	@/home/drb0rk/.bun/bin/bun -e "const f = JSON.parse(await Bun.file('feature_list.json').text()); const total = f.features.filter(x => x.state !== 'not_started').length; const passing = f.features.filter(x => x.state === 'passing').length; const ratio = total === 0 ? 1.0 : passing / total; console.log('VCR:', passing + '/' + total, '=', ratio.toFixed(3)); if (ratio < 1.0 && total > 0) process.exit(1);"

verify-feature:  ## Verify a feature by ID — usage: make verify-feature ID=F-001
	@if [ -z "$(ID)" ]; then echo "Usage: make verify-feature ID=<feature-id>"; exit 1; fi
	@echo "▶ Verifying feature $(ID)..."
	@bash scripts/verify-feature.sh $(ID)

check-arch:  ## Run architectural constraints (scripts/check-arch.sh)
	@bash scripts/check-arch.sh .
	@echo "▶ Verifying thinking-* skill files..."
	@node scripts/verify-thinking-skills.mjs

sync-skills-mirror:  ## Mirror config/skills/ -> .claude/skills/ (idempotent)
	@node scripts/sync-skills-mirror.mjs

verify-thinking-skills:  ## Verify every thinking-*/skillopt SKILL.md is well-formed
	@node scripts/verify-thinking-skills.mjs

clean-check:  ## Run the five-dimension clock-out verifier
	@bash scripts/clean-state-check.sh

verify-removed-surfaces:  ## Prove removed UI and note-vault systems are absent
	@node scripts/verify-removed-surfaces.mjs

audit:  ## Run harness audit (12 categories, 0-100 score)
	@echo "▶ Running harness audit..."
	@node scripts/audit.mjs --write
	@echo "✓ audit complete — output written to .harness/audit/latest.json"

eval-gate:  ## Verify passing features have satisfying eval files (>= 0.9 pass-rate)
	@echo "▶ Running eval gate..."
	@/home/drb0rk/.bun/bin/bun run scripts/eval-gate.mjs
	@echo "✓ eval gate passed"

feature-state-machine:  ## Enforce plan→exec→verify→audit state machine per passing feature
	@echo "▶ Running feature state machine..."
	@/home/drb0rk/.bun/bin/bun run scripts/feature-state-machine.mjs
	@echo "✓ feature state machine passed"

# ── Claude Code-specific ───────────────────────────────────────────────────
# session-start / session-end were Cline-era targets. Claude Code now
# auto-primes via the SessionStart hook (see .claude/settings.json), so
# the targets are kept as thin no-op echoes for backward compat.
session-start:  ## [deprecated] Claude Code auto-primes via SessionStart hook
	@echo "✓ Claude Code auto-primes via .claude/hooks/sessionstart-prime.mjs"

session-end:  ## [deprecated] Claude Code handles session end automatically
	@echo "✓ Claude Code handles session end via SessionEnd hook"

init:  ## Run the Claude Code-native initializer
	@./init.sh --fast

mirror-claude-md:  ## Regenerate .claude/CLAUDE.md mirror from AGENTS.md
	@./scripts/mirror-claude-md.sh

mirror-claude-md-check:  ## CI check: .claude/CLAUDE.md is in sync with AGENTS.md
	@./scripts/mirror-claude-md.sh --check

cleanup:  ## Scan for stale rtk/headroom/ponytail references (exits 1 if any found)
	@echo "▶ Scanning for rtk/headroom/ponytail references..."
	@matches=$$(grep -rEn "rtk|headroom|ponytail|RTK|Headroom|Ponytail" \
		--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
		--exclude-dir=.harness/traces --exclude-dir=research . 2>/dev/null \
		| grep -v '^[^:]*:# ponytail:' || true); \
	if [ -n "$$matches" ]; then \
		echo "✗ Found stale references:"; echo "$$matches"; exit 1; \
	else \
		echo "✓ no stale rtk/headroom/ponytail references"; \
	fi

mcp-serve:  ## Run the Bizar MCP server (stdio) for Claude Code
	@node packages/sdk/dist/mcp/bin.js

worktree-init:  ## Bootstrap a new worktree with shared node_modules / dist symlinks — usage: make worktree-init WORKTREE=/path/to/worktree
	@./scripts/worktree-setup.sh "$(WORKTREE)"

# ── Convenience ─────────────────────────────────────────────────────────────
.PHONY: help setup dev check test e2e vcr verify-feature check-arch clean-check verify-removed-surfaces audit eval-gate feature-state-machine session-start session-end init mirror-claude-md mirror-claude-md-check mcp-serve worktree-init cleanup sync-skills-mirror verify-thinking-skills
