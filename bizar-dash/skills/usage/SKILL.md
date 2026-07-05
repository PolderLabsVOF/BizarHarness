---
name: usage
description: Usage monitoring and analytics in BizarHarness - token tracking, cost estimation, usage store, and the MiniMax usage dashboard.
---

# Usage Monitoring

BizarHarness tracks LLM token usage across all sessions and agents. Data is stored in `bizar-dash/src/server/minimax-usage-store.mjs` and surfaced in the dashboard.

## What Is Tracked

Per request:
- **Input tokens** - prompt tokens sent to the model
- **Output tokens** - tokens received from the model
- **Model** - which model was used (MiniMax-M2.7, MiniMax-M3, etc.)
- **Provider** - which provider handled the request
- **Session ID** - which session this belongs to
- **Agent** - which agent made the request (Thor, Tyr, etc.)
- **Timestamp** - when the request completed

## Cost Estimation

Token counts are converted to cost using the model's published pricing:
- MiniMax-M2.7: $0.30/M input · $1.20/M output
- MiniMax-M3: $0.30/M input · $1.20/M output

The usage dashboard shows:
- Total cost (current billing period)
- Cost breakdown by agent
- Cost breakdown by day/week
- Token count vs cost trend

## Usage Store

`bizar-dash/src/server/minimax-usage-store.mjs` uses a simple JSON file at `~/.config/bizar/usage.jsonl` (one JSON object per line - append-only log).

The store aggregates on read:
- Daily totals
- Per-agent totals
- Per-session totals

## Usage API Endpoints

- `GET /api/minimax/usage` - aggregated usage stats
- `GET /api/minimax/usage/daily` - daily breakdown
- `GET /api/minimax/usage/sessions` - per-session usage

## Dashboard View

`bizar-dash/src/web/views/MiniMaxUsage.tsx` renders:
- Summary cards (total cost, total tokens, avg cost/session)
- Line chart of daily cost
- Bar chart of cost by agent
- Table of recent sessions with usage

## Retention

Usage data is retained for 90 days by default. Old entries are pruned on each write to keep the log manageable.

## Cost Alerts

When a session's cumulative cost exceeds a threshold, the system logs a warning. The threshold is configurable via `MINIMAX_COST_ALERT_THRESHOLD` env var (default: $5 per session).
