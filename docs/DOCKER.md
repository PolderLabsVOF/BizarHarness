# Running Bizar Dashboard in Docker

Self-host the Bizar dashboard in a container for always-on access on a server,
in CI, or via Tailscale Funnel.

---

## Prerequisites

- **Docker** 24+ and **Docker Compose** v2 (the `docker compose` plugin)
- A host with **at least 512 MB RAM** (1 GB recommended)

---

## Quick Start

```bash
# Clone the repo (or copy the files manually)
git clone https://github.com/DrB0rk/BizarHarness.git
cd BizarHarness

# Start the dashboard
docker compose up -d

# Check logs
docker compose logs -f

# Open the dashboard
open http://localhost:4097
```

The first build takes 1–3 minutes depending on your network and hardware.
Subsequent starts use the cached image and take seconds.

---

## Configuration

Set environment variables in a `.env` file next to `docker-compose.yml`:

```env
# ── Dashboard ────────────────────────────────────────────────────────────────
BIZAR_DASHBOARD_PORT=4097
BIZAR_DASHBOARD_HOST=0.0.0.0

# ── OpenTelemetry ────────────────────────────────────────────────────────────
BIZAR_OTEL=1
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318

# ── Headroom context compression ────────────────────────────────────────────
HEADROOM_ENABLED=1

# ── Tailscale ────────────────────────────────────────────────────────────────
TAILSCALE_AUTHKEY=tskey-auth-xxxxxxxxxxxxxxxxxxxx
```

Or pass them inline:

```bash
BIZAR_OTEL=1 docker compose up -d
```

---

## Volume Mounts

| Volume | Container path | Purpose |
|--------|---------------|---------|
| `bizar-config` | `/home/bizar/.config/bizar` | Dashboard config, auth secrets, pair tokens |
| `bizar-memory` | `/home/bizar/.local/share/bizar/memory` | Obsidian-compatible memory notes (git-backed) |
| `bizar-usage` | `/home/bizar/.local/share/bizar/usage.jsonl` | Model usage logs (append-only JSONL) |
| `bizar-backups` | `/home/bizar/.local/share/bizar/backups` | Automated backups of config + memory |

Volumes persist across container restarts, upgrades, and rebuilds. To inspect:

```bash
docker volume inspect bizar-dash_bizar-config
```

To back up a volume:

```bash
docker run --rm -v bizar-dash_bizar-config:/source -v $(pwd)/backups:/backup alpine \
  tar czf /backup/bizar-config-$(date +%Y%m%d).tgz -C /source .
```

---

## Upgrading

```bash
# Pull the latest code and rebuild
git pull
docker compose build --no-cache

# Recreate the container (volumes persist)
docker compose up -d

# Prune old images
docker image prune -f
```

---

## Backing Up Volumes

```bash
# Stop the container first
docker compose down

# Backup each volume
for vol in bizar-config bizar-memory bizar-usage bizar-backups; do
  docker run --rm -v bizar-dash_${vol}:/source -v $(pwd)/backups:/backup alpine \
    tar czf /backup/${vol}-$(date +%Y%m%d).tgz -C /source .
done

# Restart
docker compose up -d
```

---

## Tailscale Integration

Enable Tailscale Funnel to expose the dashboard over the internet without a
public IP or reverse proxy:

```bash
# Set your Tailscale auth key
export TAILSCALE_AUTHKEY=tskey-auth-xxxxxxxxxxxxxxxxxxxx

# Start with Tailscale
docker compose up -d

# Enable Tailscale Serve inside the dashboard settings, or via API:
curl -X POST http://localhost:4097/api/tailscale/enable \
  -H 'Content-Type: application/json' \
  -d '{"funnel": true}'
```

---

## Headroom in Docker

[Headroom](https://github.com/DrB0rk/BizarHarness/tree/main/headroom) compresses
conversation context to reduce token usage. Enable it in the container:

```env
HEADROOM_ENABLED=1
```

Headroom runs as a sidecar process inside the same container. No additional
services needed.

---

## OpenTelemetry Export

To export traces and metrics to an OTLP collector:

```env
BIZAR_OTEL=1
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

If your collector is on the Docker host (not in a container), use
`host.docker.internal`:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
```

---

## Troubleshooting

### Container exits immediately

Check the logs:

```bash
docker compose logs
```

Common causes:
- Port 4097 already in use → change `BIZAR_DASHBOARD_PORT`
- Permission denied on volume mount → check `docker compose down -v` and retry

### Healthcheck failing

```bash
docker compose exec bizar-dash wget --spider http://localhost:4097/api/v2/health
```

If this fails, the dashboard process may have crashed. Check logs.

### "docker: command not found"

Install Docker Desktop or the Docker Engine:
https://docs.docker.com/engine/install/

### Volume permission issues

The container runs as `node` user (UID 1000). If volumes were created by root,
you may see EACCES errors. Fix:

```bash
docker compose down
docker compose run --rm bizar-dash chown -R 1000:1000 /home/bizar
docker compose up -d
```

---

## Production Considerations

### Reverse proxy (Caddy / Nginx)

Put the dashboard behind a reverse proxy for TLS termination and domain-based
access. Example Caddyfile:

```caddy
dash.example.com {
    reverse_proxy localhost:4097
}
```

Then run the container on `127.0.0.1` only:

```env
BIZAR_DASHBOARD_HOST=127.0.0.1
```

### Resource limits

```yaml
# In docker-compose.yml under bizar-dash:
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 512M
    reservations:
      memory: 256M
```

### Docker healthcheck

The container's `HEALTHCHECK` pings `/api/v2/health` every 30 seconds. Use it
with your orchestrator's restart policy or monitoring system.
