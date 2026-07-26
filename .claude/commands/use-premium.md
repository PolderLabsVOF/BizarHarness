---
description: Launch Claude Code in this project on the premium tier (cx/gpt-5.6-sol). Prints the exact shell command and env vars to set.
allowed-tools: Bash
---

# /use-premium — Run this session on cx/gpt-5.6-sol (premium)

The local model router at `http://localhost:20128/v1` exposes
`cx/gpt-5.6-sol` as the premium-tier reasoning model. Premium is
expensive — use it intentionally, not by default.

## What it does

Sets `ANTHROPIC_MODEL=cx/gpt-5.6-sol` and `ANTHROPIC_BASE_URL=http://localhost:20128/v1` so the entire session loop runs on the premium model. The model-router is the same one your subagents (`@paul`, `@ria`, `@brad`, `@linda`, `@carl`) already hit.

## Commands

### One-shot launch (recommended)

```bash
ANTHROPIC_BASE_URL=http://localhost:20128/v1 \
ANTHROPIC_MODEL=cx/gpt-5.6-sol \
claude
```

Or with the explicit `--model` flag (Claude Code forwards it to the
router as the model id):

```bash
ANTHROPIC_BASE_URL=http://localhost:20128/v1 \
claude --model cx/gpt-5.6-sol
```

### Make it the default for this project

Add to your local override `.claude/settings.local.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:20128/v1",
    "ANTHROPIC_MODEL": "cx/gpt-5.6-sol"
  }
}
```

Then every Claude Code session in this directory opens on premium.

### Available premium-tier models on the local router

```
cx/gpt-5.6-sol    — strongest reasoning (planning, debug, design, audit)
cx/gpt-5.6-terra  — high reasoning at lower cost (complex impl, routing)
cx/gpt-5.6-luna   — visually-oriented mid-tier (design alt)
```

See `.claude/model-router.json` for the full tier table.

## When to use premium

- Hard debugging that cheaper models loop on.
- Architecture-level planning where the cost of a wrong design is high.
- UI/UX review of a non-trivial surface.
- Adversarial code review.

## When NOT to use premium

- Routine edits, mechanical work, single-file fixes (use default `bizar/MiniMax-M3`).
- Research (always use `@greg` on default).
- Implementation at moderate complexity (use `bizar/MiniMax-M2.7` via `@todd`).

The harness's cost ceiling (`cost_ceiling_per_session_usd: 5.0` in
`model-router.json`) will downgrade you automatically if the budget is
exceeded mid-session.