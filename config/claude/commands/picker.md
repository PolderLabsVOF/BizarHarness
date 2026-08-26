---
description: Start the 9router picker-proxy that routes Claude Code requests through the Omniroute gateway.
allowed-tools: Read, Bash
---

# /picker — Omniroute picker proxy

Runs `bizar picker-proxy`. The picker-proxy is a local stdin/stdout bridge
between Claude Code and the configured Omniroute gateway
(`http://localhost:20129/v1` by default).

1. Reads `BIZAR_MODEL_ROUTER_URL` (or `ANTHROPIC_BASE_URL`) to find the gateway.
2. Probes `/models` so Mike can choose a live candidate from the task's dynamic
   tier. Discovery failure falls back to session-model inheritance.
3. Proxies Claude Code traffic without imposing a fixed model on an agent role.
   Bizar never cycles aliases after a failed dispatch.
4. Writes its log to `~/.config/bizar/picker-proxy.log` and its PID to
   `~/.config/bizar/picker-proxy.pid`.

Stop it with `bizar picker-proxy stop` or `kill $(cat ~/.config/bizar/picker-proxy.pid)`.
