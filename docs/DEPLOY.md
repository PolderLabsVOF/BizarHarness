# Deploying the Bizar Dashboard

v5.0 adds `bizar deploy` — one-command deployment to the hosting platform of
your choice. No manual config, no guesswork.

---

## Quick Reference

```bash
bizar deploy --to vercel     [--token <token>] [--project-name <name>]
bizar deploy --to cloudflare [--token <token>] [--project-name <name>]
bizar deploy --to fly        [--token <token>] [--app-name <name>] [--region <region>]
bizar deploy --to docker     [--registry <url>] [--image-name <name>]
bizar deploy --to docker --compose
```

---

## Prerequisites

### All platforms

- **Node.js 18+** — the dashboard builds with npm.
- **npm run build** must succeed in the project root (produces `dist/`).

---

## Vercel

### Prerequisites

- A [Vercel](https://vercel.com) account
- A Vercel API token: [vercel.com/account/tokens](https://vercel.com/account/tokens)

### Walkthrough

```bash
# Deploy with a token (recommended for CI/automation)
bizar deploy --to vercel --token $VERCEL_TOKEN

# Or set the env var and omit --token
export VERCEL_TOKEN=your_token_here
bizar deploy --to vercel

# Custom project name
bizar deploy --to vercel --token $VERCEL_TOKEN --project-name my-bizar
```

### What it does

1. Builds the dashboard (`npm run build`)
2. Generates `bizar-deploy/vercel/` with `vercel.json` + `api/index.js` + `public/`
3. Uploads files to Vercel via REST API (`POST /v13/deployments`)
4. Polls until deployment is ready
5. Prints the deployment URL

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VERCEL_TOKEN` | Yes (or `--token`) | Vercel API token |

### Custom domain

1. Go to [vercel.com](https://vercel.com) → your project → Domains
2. Add your custom domain
3. Update your DNS with the CNAME record Vercel provides

### Rollback

```bash
# List deployments (via Vercel CLI)
vercel list

# Rollback to a specific deployment
vercel rollback <deployment-url>
```

### Cost

- **Hobby**: Free — 100 GB bandwidth, 100 serverless function invocations/day
- **Pro**: $20/month — unlimited invocations, team features, SLAs

---

## Cloudflare

### Prerequisites

- A [Cloudflare](https://dash.cloudflare.com) account
- A Cloudflare API token with **Pages** and **Workers** permissions:
  [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)

### Walkthrough

```bash
# Deploy with a token
bizar deploy --to cloudflare --token $CLOUDFLARE_API_TOKEN

# Or set the env var
export CLOUDFLARE_API_TOKEN=your_token_here
bizar deploy --to cloudflare

# Custom project name
bizar deploy --to cloudflare --project-name my-bizar-dash
```

### What it does

1. Builds the dashboard (`npm run build`)
2. Generates `bizar-deploy/cloudflare/` with `wrangler.toml` + `functions/` + `public/`
3. Tries wrangler CLI first; falls back to Cloudflare REST API
4. Creates the Pages project if it doesn't exist
5. Uploads files and starts a deployment
6. Prints the `.pages.dev` URL

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUDFLARE_API_TOKEN` | Yes (or `--token`) | Cloudflare API token |

### Custom domain

1. In Cloudflare Dashboard → Pages → your project → Custom domains
2. Add your domain (must be on Cloudflare's DNS)
3. Cloudflare provisions the SSL certificate automatically

### Rollback

In Cloudflare Dashboard → Pages → your project → Deployments → click `...` →
**Rollback to this deployment**.

### Cost

- **Free**: Unlimited requests, 500 builds/month, 1 GB storage
- **Pro**: $20/month — 5,000 builds/month, 50 GB storage, early analytics

---

## Fly.io

### Prerequisites

- The **flyctl** CLI: `curl -L https://fly.io/install.sh | sh`
- A [Fly.io](https://fly.io) account
- A Fly.io API token: `flyctl auth token`

### Walkthrough

```bash
# Deploy
bizar deploy --to fly --app-name my-bizar

# Custom region
bizar deploy --to fly --app-name my-bizar --region lhr

# With token
bizar deploy --to fly --token $(flyctl auth token)
```

### What it does

1. Checks flyctl is installed
2. Generates `bizar-deploy/fly/fly.toml` referencing the project's `Dockerfile`
3. Creates the app on Fly.io if it doesn't exist
4. Runs `flyctl deploy` to build and deploy
5. Prints the `.fly.dev` URL

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FLY_API_TOKEN` | Optional | Fly.io API token (flyctl can use its own auth) |
| `--app-name` | Recommended | Fly.io app name (auto-generated if omitted) |
| `--region` | No | Fly.io region code (default: `iad`) |

### Common regions

| Code | Location |
|------|----------|
| `iad` | Washington, D.C. (default) |
| `lhr` | London, UK |
| `fra` | Frankfurt, Germany |
| `hkg` | Hong Kong |
| `syd` | Sydney, Australia |

### Custom domain

```bash
flyctl certs create my-dash.example.com --app my-bizar
```

Then add the CNAME record from `flyctl certs show` to your DNS provider.

### Rollback

```bash
flyctl releases list --app my-bizar
flyctl deploy --app my-bizar --image <registry>/<image>@<digest>
```

### Cost

- **Free**: 3 shared-CPU VMs (256 MB each), 3 GB persistent volume
- **Start at $19.17/month**: Dedicated CPU, more memory, faster builds

---

## Docker

### Prerequisites

- **Docker Engine** 24+ running (check: `docker info`)
- Credentials to push to a registry (GitHub Container Registry, Docker Hub, etc.)

### Walkthrough — Build & Push

```bash
# Build and push to GitHub Container Registry (default)
bizar deploy --to docker --registry ghcr.io/my-org --image-name bizar-dash

# Or to Docker Hub
bizar deploy --to docker --registry docker.io/myusername --image-name bizar-dash

# With registry token for auth
bizar deploy --to docker --registry ghcr.io/my-org --image-name bizar-dash \
  --token $GHCR_TOKEN
```

### Walkthrough — Generate Compose Files Only

```bash
bizar deploy --to docker --compose
# Creates bizar-deploy/docker/docker-compose.yml + .env.template

# Then customize and run:
cd bizar-deploy/docker
cp .env.template .env
$EDITOR .env
docker compose up -d
```

### What it does

1. Builds the Docker image from the project's `Dockerfile`
2. Tags it as `<registry>/<image-name>:<version>` and `:latest`
3. Optionally logs into the registry (if `--token` provided)
4. Pushes both tags
5. With `--compose`: generates `docker-compose.yml` + `.env.template` without building

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `--registry` | Yes (default: `ghcr.io`) | Container registry URL |
| `--image-name` | Yes (default: `bizar-dash`) | Image name |
| `--token` | No | Registry token/password for `docker login` |

### Custom domain

Docker deployment is self-hosted. Put a reverse proxy in front:

```nginx
# nginx example
server {
    server_name dash.example.com;
    location / {
        proxy_pass http://127.0.0.1:4097;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Rollback

```bash
# Re-tag a previous version
docker pull ghcr.io/my-org/bizar-dash:v4.8.0
docker tag ghcr.io/my-org/bizar-dash:v4.8.0 ghcr.io/my-org/bizar-dash:latest
docker push ghcr.io/my-org/bizar-dash:latest

# Redeploy with compose
cd bizar-deploy/docker
docker compose up -d
```

### Cost

- **Docker Hub**: Free (1 private repo, 200 pulls/6h), Pro $5/month
- **GitHub Container Registry**: Free with GitHub account, unlimited public/private
- **Self-hosting**: Your own server costs (typical ~$5-15/month on a VPS)

---

## Output Directory

All scaffold files are written to `./bizar-deploy/` by default. Override with:

```bash
bizar deploy --to vercel --out-dir /path/to/output
```

The output directory contains one subdirectory per platform with all the files
needed to inspect, customize, or manually deploy.

---

## Troubleshooting

### "Dashboard build failed"

Run `npm run build` manually in the project root and fix any errors.

### "Token required"

Each platform needs an API token. Pass `--token <token>` or set the
corresponding environment variable (`VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`,
`FLY_API_TOKEN`).

### "flyctl not found"

Install Fly.io's CLI:

```bash
curl -L https://fly.io/install.sh | sh
```

Then add `~/.fly/bin` to your PATH, or restart your shell.

### "Docker daemon is not running"

Start Docker:

```bash
# Linux
sudo systemctl start docker

# macOS
open -a Docker

# Windows
# Start Docker Desktop from the Start menu
```

### Deployment times out

Large builds can take several minutes. Default timeout is 5 minutes. If your
deployment consistently times out, try:

- Manually building first (`npm run build`)
- Using a smaller VPS/plan with faster network
- For Fly.io: use `--remote-only` to build on Fly's servers

### "No dist/ found"

The scaffold is generated but no `dist/` exists yet. Run `npm run build` first,
then try again.
