---
description: Launch Claude Code in this project on the premium tier (qct/qwen3.8-max-preview). Prints the exact shell command and env vars to set.
allowed-tools: Bash
---

# /use-premium — Run this session on qct/qwen3.8-max-preview (premium)

The provider gateway you have configured exposes `qct/qwen3.8-max-preview`
as the premium-tier reasoning model. Bizar is provider-agnostic — set
`BIZAR_MODEL_ROUTER_URL` (or `ANTHROPIC_BASE_URL`) to whatever gateway
URL your operator runs, then point the model at the premium tier. Premium
is expensive — use it intentionally, not by default.

## What it does

Sets `ANTHROPIC_MODEL=qct/qwen3.8-max-preview` and forwards
`ANTHROPIC_BASE_URL` from your operator-configured gateway so the entire
session loop runs on the premium model. The model-router is the same
one your subagents (`@mike`, `@paul`, `@carl`) already hit.

## Commands

### One-shot launch (recommended)

```bash
ANTHROPIC_BASE_URL="${BIZAR_MODEL_ROUTER_URL:-http://your-gateway/v1}" \
ANTHROPIC_MODEL=qct/qwen3.8-max-preview \
claude
```

Or with the explicit `--model` flag (Claude Code forwards it to the
router as the model id):

```bash
ANTHROPIC_BASE_URL="${BIZAR_MODEL_ROUTER_URL:-http://your-gateway/v1}" \
claude --model qct/qwen3.8-max-preview
```

### Make it the default for this project

Add to your local override `.claude/settings.local.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "${BIZAR_MODEL_ROUTER_URL}",
    "ANTHROPIC_MODEL": "qct/qwen3.8-max-preview"
  }
}
```

Then every Claude Code session in this directory opens on premium.

### Available premium-tier models on the local router

```
qct/qwen3.8-max-preview  — strongest reasoning (orchestration, planning, debug)
codex/gpt-5.6-sol        — high reasoning at lower cost (complex impl, review)
codex/gpt-5.6-luna       — visually-oriented mid-tier (design)
```

See `.claude/model-router.json` for the full tier table.

## When to use premium

- Hard debugging that cheaper models loop on.
- Architecture-level planning where the cost of a wrong design is high.
- UI/UX review of a non-trivial surface.
- Adversarial code review.

## When NOT to use premium

- Routine edits, mechanical work, single-file fixes (use default `minimax/MiniMax-M3`).
- Research (always use `@greg` on default).
- Implementation at moderate complexity (use `minimax/MiniMax-M2.7` via `@todd`).

The harness's cost ceiling (`costCeilingPerSessionUsd: 5.0` in
`model-router.json`) will downgrade you automatically if the budget is
exceeded mid-session.