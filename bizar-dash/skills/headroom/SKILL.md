---
name: headroom
description: Headroom — context compression layer for AI agents. Routes opencode and other LLM clients through a local proxy that compresses tool outputs, logs, RAG chunks, and conversation history by 60–95%.
---

# Headroom

Headroom is a context compression layer that sits between opencode (or any LLM client) and the upstream provider. It intercepts tool call outputs, conversation history, and RAG chunks and compresses them before they reach the model — typically reducing token usage by 60–95% with no loss in answer quality.

## When to Use

- **Token budget is tight**: If a task is approaching the context window limit, Headroom can reclaim 60–90% of the tokens spent on tool outputs.
- **Long conversations**: The compression is cumulative — the longer the session, the more Headroom saves.
- **Verbose tool output**: RAG retrieval, file globbing, grep results, and diagnostic output are the highest-value compression targets.
- **Multi-step implementation**: Large features with many tool calls benefit most.

## Architecture

```
opencode → headroom proxy (localhost:8787) → LLM provider
             ↓
        compresses tool outputs, logs, RAG chunks
        caches responses
        measures savings
```

## Key Concepts

### Compression ratio
The fraction of tokens Headroom eliminates. A 0.85 compression ratio means 85% of the tokens were removed before reaching the provider.

### Wrapped vs unwrapped
`headroom wrap opencode` modifies `~/.config/opencode/opencode.json` to route traffic through the proxy. `headroom unwrap opencode` restores the original configuration.

### Proxy vs wrap
- **Proxy** (`headroom proxy`): The actual HTTP proxy server running on port 8787.
- **Wrap** (`headroom wrap opencode`): The act of configuring opencode to use the proxy.

You can run the proxy standalone (`headroom proxy`) and point any OpenAI-compatible client at it. The wrap command is just a convenience for opencode.

## Dashboard Integration

The Bizar dashboard manages Headroom through Settings → Headroom:

- **Status widget**: Shows live proxy status, compression ratio, tokens saved
- **Controls**: Install, wrap/unwrap, start/stop proxy, open dashboard
- **Settings**: Auto-install, auto-start, auto-wrap, route-all-providers, port, host, backend, output shaper, telemetry, budget

API endpoints:
- `GET /api/headroom/status` — live status
- `GET /api/headroom/stats?hours=24` — compression statistics
- `POST /api/headroom/install` — install headroom
- `POST /api/headroom/wrap` — wrap opencode
- `POST /api/headroom/unwrap` — unwrap opencode
- `POST /api/headroom/proxy/start` — start proxy
- `POST /api/headroom/proxy/stop` — stop proxy
- `POST /api/headroom/auto-route` — configure all providers to route through the proxy

CLI:
```bash
bizar headroom status   # live status
bizar headroom stats    # compression stats
bizar headroom install  # install headroom
bizar headroom wrap     # wrap opencode
bizar headroom unwrap   # unwrap
bizar headroom start    # start proxy
bizar headroom stop     # stop proxy
bizar headroom doctor   # health check
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HEADROOM_HOST` | `127.0.0.1` | Proxy bind host |
| `HEADROOM_PORT` | `8787` | Proxy port |
| `HEADROOM_OUTPUT_SHAPER` | `0` | Set to `1` to enable output shaping |
| `HEADROOM_TELEMETRY` | (on) | Set to `off` to disable |
| `HEADROOM_BUDGET` | `0` | Monthly USD cap (0 = unlimited) |
| `HEADROOM_CONTEXT_TOOL` | `rtk` | Context tool: `rtk` or `lean-ctx` |

## Common Gotchas

1. **Proxy must be running before opencode starts**: If the proxy is down when opencode launches, opencode will fail to make LLM calls. Start the proxy first, or enable `autoStart` in Headroom settings.

2. **`headroom wrap` edits opencode.json**: The wrap command modifies `~/.config/opencode/opencode.json`. If you use version control for this file, you'll see a diff on every wrap. Use `headroom unwrap` before committing, or ignore the changes.

3. **Headroom 0.30.0 doesn't have `headroom plan --tokens`**: This command was removed. Use `headroom perf --hours 24` for actual token savings data.

4. **Token savings are cumulative**: The compression ratio compounds over a session. A 15-step implementation that saves 80% at each step uses roughly the same tokens as a 3-step implementation without Headroom.

5. **Cache hits**: Headroom caches semantically similar tool calls. Repeated operations (file reads, API probes) can be served from cache entirely, bypassing the LLM.

6. **Provider baseURL**: When `routeAllProviders` is enabled, the dashboard rewrites provider baseURLs to point at the proxy. If you configure a new provider manually, you may need to update its baseURL to go through the proxy.
