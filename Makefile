# Bizar Harness — Makefile
#
# Single source of truth for agent commands. Every target is idempotent
# and exits 0 on success. Run `make help` to see all targets.
#
# Migrated to Claude Code (v6.3.0). All `cline`-era targets are gone;
# the harness now consumes Claude Code via the SDK + MCP server under
# `packages/sdk/`. Plugin lives under `plugins/bizar/` as a thin shim
# that re-exports the SDK; the previous framework-coupled plugin source
# has been deleted.

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

dev:  ## Start dashboard + SDK in dev mode
	npm run dev

check:  ## Typecheck + lint
	@echo "▶ Running TypeScript check..."
	@bunx tsc --noEmit
	@echo "✓ make check passed"

test:  ## Run all unit tests (sdk + cli)
	@if command -v bun >/dev/null 2>&1; then \
		bun test packages/sdk; \
	else \
		echo "(bun not found — falling back to vitest via npm)"; \
		node_modules/.bin/vitest run --root packages/sdk; \
	fi
	@node --test cli/install.test.mjs cli/provision.test.mjs cli/worker-dispatcher.test.mjs cli/__tests__/cost-gate.test.mjs cli/__tests__/feature-list-bridge.test.mjs cli/commands/setup-provider.test.mjs cli/commands/rca.test.mjs 2>&1 | tail -5

e2e:  ## End-to-end tests (SDK + Claude Code integration)
	@echo "▶ E2E: SDK load + tool registration..."
	@if command -v bun >/dev/null 2>&1; then \
		bun run scripts/bh-full-e2e.mjs; \
	else \
		echo "(bun not found — running e2e with node)"; \
		node scripts/bh-full-e2e.mjs; \
	fi

e2e-orchestration:  ## Sprint S25 — boot dashboard, hit merged endpoints, exercise admin
	@echo "▶ E2E orchestration: boot + snapshot + agents + goals + ws + admin..."
	@BIZAR_E2E_SKIP_RESTART=$${BIZAR_E2E_SKIP_RESTART:-1} node tests/e2e/orchestration-center.mjs --port=$${BIZAR_E2E_PORT:-4173}

e2e-real-env:  ## Sprint S36 — real-env harness: every new v9.2.0 page endpoint against live server
	@echo "▶ E2E real-environment: 7 new pages, real server, no fixture..."
	@node tests/e2e/real-environment.mjs --port=$${BIZAR_E2E_PORT:-4183}

# ── Harness primitives (L07-L12) ────────────────────────────────────────────
vcr:  ## Verify Code Reality (VCR) check via feature_list.json
	@echo "▶ Computing VCR ratio from feature_list.json..."
	@bun -e "const f = JSON.parse(await Bun.file('feature_list.json').text()); const total = f.features.filter(x => x.state !== 'not_started').length; const passing = f.features.filter(x => x.state === 'passing').length; const ratio = total === 0 ? 1.0 : passing / total; console.log('VCR:', passing + '/' + total, '=', ratio.toFixed(3)); if (ratio < 1.0 && total > 0) process.exit(1);"

verify-feature:  ## Verify a feature by ID — usage: make verify-feature ID=F-001
	@if [ -z "$(ID)" ]; then echo "Usage: make verify-feature ID=<feature-id>"; exit 1; fi
	@echo "▶ Verifying feature $(ID)..."
	@bash scripts/verify-feature.sh $(ID)

check-arch:  ## Run architectural constraints (scripts/check-arch.sh)
	@bash scripts/check-arch.sh .

clean-check:  ## Remove console.log/debugger and run lint
	@echo "▶ Scanning for console.log / debugger / .only()..."
	@! grep -rEn '(console\.log|debugger|\.only\()' packages/sdk/src plugins/bizar/index.ts --include='*.ts' --include='*.mjs' 2>/dev/null | grep -v test | grep -v '\.test\.' || (echo "✗ debug artifacts found" && exit 1)
	@echo "✓ clean-check passed"

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

# ── Convenience ─────────────────────────────────────────────────────────────
.PHONY: help setup dev check test e2e e2e-orchestration e2e-real-env vcr verify-feature check-arch clean-check session-start session-end init mirror-claude-md mirror-claude-md-check mcp-serve cleanup