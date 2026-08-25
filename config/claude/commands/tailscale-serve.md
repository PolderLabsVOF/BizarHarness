---
description: Expose an explicitly selected local service through Tailscale Serve with confirmation.
---

# Tailscale Serve

This command is generic and does not start any Bizar service.

1. Require the user to provide the local port or socket to expose.
2. Verify the target is listening locally.
3. Show the exact `tailscale serve` command and exposure scope.
4. Ask before changing the machine's Tailscale Serve configuration.
5. After approval, run the command and verify `tailscale serve status`.
6. Report the public/private URL and the reversal command: `tailscale serve reset`.
