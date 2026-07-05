---
name: minimax
description: MiniMax integration for the Bizar multi-agent system. Covers chat completions, usage tracking, multi-key rotation, rate limiting, and agent awareness of model limits and pricing.
---

# MiniMax Integration

Bizar agents use MiniMax models as the primary paid tier. This skill covers the provider configuration, usage tracking, and common failure modes.

## Model Reference

| Model ID | Context | Cost (in/out) | Best for |
|---|---|---|---|
| `minimax/MiniMax-M2.7` | 32k | $0.30/M · $1.20/M | Mid-tier implementation, Git ops, moderate tasks |
| `minimax/MiniMax-M3` | 32k | $0.30/M · $1.20/M | Complex features, deep debugging, architecture |

The `MiniMax-M3` model is the primary high-tier agent (Tyr, Forseti). The `MiniMax-M2.7` model is used for Thor and Hermod.

## Provider Configuration

Do NOT set `baseURL` on the `minimax` provider - opencode ships a built-in MiniMax provider that resolves the correct API endpoint. Adding an explicit baseURL is a common cause of 404s.

```json
{
  "provider": "minimax",
  "model": "minimax/MiniMax-M3"
}
```

## Multi-Key Rotation

When you have multiple MiniMax accounts and want to distribute load:

```bash
# Comma-separated (simplest)
export MINIMAX_API_KEYS="key1,key2,key3"

# Numbered env vars (explicit ordering)
export MINIMAX_API_KEY="primary-key"
export MINIMAX_API_KEY_2="backup-key"
```

**Rotation triggers:** 429 (rate limit), 402 (quota exhausted), 500/502/503/504 (server error).

**Does NOT rotate on:** 401 (unauthorized - fix the key), 4xx client errors (the request is bad).

**Round-robin on success:** the next request starts on the next key, spreading load evenly.

## Usage Tracking

The dashboard tracks token usage per session via `bizar-dash/src/server/minimax-usage-store.mjs`. Usage is recorded for:
- Input tokens
- Output tokens
- Model used
- Session ID
- Timestamp

View usage at `/usage` in the dashboard.

## Common Failure Modes

### 429 / Rate Limit
Cause: single key hit rate limit. Fix: add more keys to rotation.

### 402 / Quota Exhausted
Cause: monthly spend limit reached on the key. Fix: add a different key with remaining quota.

### 404 on Chat Completions
Cause: wrong baseURL or malformed model ID. Fix: remove custom baseURL, use `minimax/MiniMax-M3` as model ID.

### Empty Responses / Truncated Output
Cause: output hit token limit or streaming was interrupted. Fix: increase `maxTokens` if possible, or split the request.

## Agent Cost Awareness

When routing work:
- Free: Mimir, Heimdall (DeepSeek V4 Flash - no MiniMax cost)
- Mid: Thor, Hermod (MiniMax-M2.7)
- High: Tyr, Forseti (MiniMax-M3)
- Ultra: Vidarr (GPT-5.5 via OpenAI-compatible endpoint)
