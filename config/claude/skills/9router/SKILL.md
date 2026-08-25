---
name: 9router
description: Entry point for 9Router — local/remote AI gateway with OpenAI-compatible REST for chat, image, TTS, STT, embeddings, web search, web fetch. Use when the user mentions 9Router, NINEROUTER_URL, or wants AI without writing provider boilerplate. This skill covers setup + indexes capability skills; fetch the relevant capability SKILL.md from the URLs below when needed.
---

# 9Router

Local/remote AI gateway exposing OpenAI-compatible REST. One key, many providers, auto-fallback.

## Setup

The Bizar harness expects 9Router at `http://localhost:20128` by default. Override with:

```bash
export NINEROUTER_URL="http://localhost:20128"      # or VPS / tunnel URL
export NINEROUTER_KEY="sk-..."                      # from your provider configuration (only if requireApiKey=true)
```

All requests: `${NINEROUTER_URL}/v1/...` with header `Authorization: Bearer ${NINEROUTER_KEY}` (omit if auth disabled).

Verify: `curl $NINEROUTER_URL/api/health` → `{"ok":true}`

## Discover models

```bash
curl $NINEROUTER_URL/v1/models                  # chat/LLM (default)
curl $NINEROUTER_URL/v1/models/image            # image-gen
curl $NINEROUTER_URL/v1/models/tts              # text-to-speech
curl $NINEROUTER_URL/v1/models/embedding        # embeddings
curl $NINEROUTER_URL/v1/models/web              # web search + fetch (entries have `kind` field)
curl $NINEROUTER_URL/v1/models/stt              # speech-to-text
curl $NINEROUTER_URL/v1/models/image-to-text    # vision
```

Use `data[].id` as `model` field in requests. Combos appear with `owned_by:"combo"`.

Response shape:
```json
{ "object": "list", "data": [
  { "id": "openai/gpt-5", "object": "model", "owned_by": "openai", "created": 1735000000 },
  { "id": "tavily/search", "object": "model", "kind": "webSearch", "owned_by": "tavily", "created": 1735000000 }
]}
```

## Capability skills

When the user needs a specific capability, fetch that skill's `SKILL.md` from its raw URL:

| Capability | Raw URL |
|---|---|
| Chat / code-gen | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-image/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-web-fetch/SKILL.md |

## Bizar harness integration

This skill is auto-installed by `bizar install` into `~/.claude/skills/9router/`. All
Bizar agents that need chat or web capabilities should read these skill files
before starting a task.

**Quick-check command** (run from anywhere in a Bizar session):

```bash
curl -sS http://localhost:20128/api/health
```

If the response is not `{"ok":true}`, record the failure (stderr note or
`.bizar/9router-health.json`). Continue only through a fallback that the
current project or session explicitly configured. Never infer, invent, or
silently substitute a non-routed provider. If no explicit fallback exists,
stop the affected capability and report 9Router's unavailability as a
blocker rather than guess-and-try.

## Errors

- 401 → set/refresh `NINEROUTER_KEY` (provider configuration)
- 400 `Invalid model format` → check `model` exists in `/v1/models/<kind>`
- 503 `All accounts unavailable` → wait `retry-after` or add another provider account
