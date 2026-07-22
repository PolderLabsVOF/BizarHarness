---
description: Authenticate Tailscale Serve and expose a local port on your tailnet
allowed-tools: Read, Bash
---

# Tailscale Serve Command

Authenticate and configure Tailscale Serve to expose a local service on your
tailnet. Auto-detects whether Serve is enabled on the tailnet and either
provisions HTTPS automatically or surfaces the admin-enable URL clearly.

## Usage

```
/tailscale-serve                 # expose port 8765 (the BizarHarness dashboard default)
/tailscale-serve 3000            # expose port 3000
/tailscale-serve --status        # show current serve config, no changes
/tailscale-serve --reset         # remove the current serve config
```

The full arguments are available as `$ARGUMENTS` (and `$1` for the port).
Parse them and route to the matching step below.

## Steps

1. **Parse the argument**: first arg is the port (default `8765`). If `--status`, run step 3 only. If `--reset`, run step 6 only.

2. **Verify the local port is listening**:
   ```bash
   ss -lntp 2>/dev/null | grep -E ":${PORT}\b" || curl -sS -o /dev/null -w "HTTP %{http_code}\n" --max-time 2 http://127.0.0.1:${PORT}/
   ```
   If the port is not open, tell the user clearly which command starts the
   service (e.g. `npm run host:start` for the BizarHarness demo, or
   `python3 -m http.server 8765` for a pam static server). Do not proceed
   without an upstream.

3. **Check current Tailscale Serve status**:
   ```bash
   tailscale serve status
   tailscale status --json | jq -r '.Self.DNSName, .Self.TailscaleIPs[0]'
   ```
   Capture the MagicDNS name and the Tailscale IP. The DNS name will look
   like `devbox.tail2cdf4d.ts.net` (trim the trailing dot).

4. **If already configured** (status shows `https://`):
   - Print the current config
   - Print the existing endpoints
   - **Stop** — do not re-configure

5. **Try to enable Serve** (with a hard timeout — it may try to open a browser):
   ```bash
   timeout 5 tailscale serve --bg --https=443 "http://127.0.0.1:${PORT}" 2>&1
   ```
   - **On success**: print the new config, print the `https://<dnsname>/` endpoint.
   - **If the output contains "Serve is not enabled"**:
     - Parse the admin-enable URL from the output (it's the
       `https://login.tailscale.com/f/serve?node=...` line).
     - Print it prominently with a clear message:
       > **Tailscale Serve is not enabled on this tailnet.**
       > An admin must visit this URL once to enable it:
       > **<URL>**
       > Then re-run `/tailscale-serve ${PORT}`.
     - Do not fall back to plain HTTP automatically — the user asked for
       authentication, not a workaround. They can run the demo's
       `host:start` script for the HTTP fallback.
   - **On any other error**: print the full error, suggest
     `tailscale serve status` and `sudo tailscale up` as debug steps.

6. **For `--reset`**:
   ```bash
   tailscale serve reset
   ```
   Confirm the reset succeeded by re-running `tailscale serve status`.

7. **Final output** — always end with a clear status block:

   ```
   === Tailscale Serve ===
   config:    <status>
   upstream:  http://127.0.0.1:<port>
   endpoints:
     - https://<dnsname>/         (HTTPS, only if Serve is enabled)
     - http://<dnsname>:<port>/   (HTTP fallback, only if upstream binds 0.0.0.0)

   To remove: /tailscale-serve --reset
   ```

## Notes

- `tailscale serve` requires a one-time tailnet admin enable. There is no
  per-device flag — only the admin can authorize it. The command surfaces
  the admin URL and stops rather than silently falling back.
- This command does not start the upstream service. It assumes the service
  is already running and only wires the HTTPS proxy.
- For the BizarHarness Demo Dashboard, the typical flow is:
  ```
  /tailscale-serve --status       # see current state
  npm run host:start              # upstream on port 8765
  /tailscale-serve                # expose it on the tailnet
  ```