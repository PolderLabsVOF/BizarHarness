---
description: Start the 9router picker-proxy that routes Claude Code requests through the Omniroute gateway.
allowed-tools: Read, Bash
---

# /picker — Omniroute picker proxy

Runs `bizar picker-proxy`. The picker-proxy is a local stdin/stdout bridge
between Claude Code and the configured Omniroute gateway
(`http://localhost:20128/v1`).

1. Reads `BIZAR_MODEL_ROUTER_URL` (or `ANTHROPIC_BASE_URL`) to find the gateway.
2. Validates the gateway exposes `/models` and returns the expected model set.
3. Proxies Claude Code traffic and forwards the per-agent model assignment
   derived from `~/.claude/model-router.json` (synced at install time).
4. Writes its log to `~/.config/bizar/picker-proxy.log` and its PID to
   `~/.config/bizar/picker-proxy.pid`.

Stop it with `bizar picker-proxy stop` or `kill $(cat ~/.config/bizar/picker-proxy.pid)`.
