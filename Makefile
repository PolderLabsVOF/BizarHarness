# Bizar Harness — Makefile
#
# Single source of truth for agent commands. Every target is idempotent
# and exits 0 on success. Run `make help` to see all targets.

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# ── Helpers ─────────────────────────────────────────────────────────────────
help:  ## Show this help message
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ── Setup / dev ─────────────────────────────────────────────────────────────
setup:  ## Install all dependencies from scratch
	bun install
	@echo "✓ Dependencies installed"

dev:  ## Start dashboard + plugin in dev mode (background)
	bun run --watch plugins/bizar/index.ts &
	bun run bizar-dash/src/server/index.mjs

# ── Verification ────────────────────────────────────────────────────────────
check:  ## Full verification pipeline (typecheck + tests)
	@echo "▶ Running TypeScript check..."
	@bunx tsc --noEmit
	@echo "▶ Running tests..."
	@bun test plugins/bizar packages/sdk 2>&1 | tail -5
	@echo "✓ make check passed"

test:  ## Run all unit tests (plugin + sdk + cli)
	bun test plugins/bizar packages/sdk
	@node --test cli/install.test.mjs cli/provision.test.mjs cli/commands/validate.test.mjs cli/commands/setup-provider.test.mjs cli/commands/rca.test.mjs 2>&1 | tail -5

e2e:  ## End-to-end tests (real plugin load + tool exercise)
	@echo "▶ E2E: real plugin load + 22 tool/hook checks..."
	@bun run scripts/bh-full-e2e.mjs

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

clean-check:  ## 5-dimension clean-state check (build/tests/no-debug/progress)
	@bash scripts/clean-state-check.sh .

session-start:  ## Record session start to .harness/traces/sessions.jsonl
	@bash scripts/session-trace.sh start

session-end:  ## Record session end to .harness/traces/sessions.jsonl
	@bash scripts/session-trace.sh end

# ── Convenience ─────────────────────────────────────────────────────────────
.PHONY: help setup dev check test e2e vcr verify-feature check-arch clean-check session-start session-end
