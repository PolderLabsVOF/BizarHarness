# Dev Sandbox

The dev sandbox is a Docker-based development environment for testing changes to BizarHarness — agent definitions, the plugin, the CLI — without touching your real `~/.config/opencode/` install. It lives in a sibling project called `BizarHarness-dev`, checked out next to the main `BizarHarness` repo in your projects directory.

## What it is

The dev sandbox is:

- A `Dockerfile` that builds an image with `opencode`, `node`, `jq`, `uv`, and the npm packages BizarHarness depends on.
- A `docker-compose.yml` that mounts your project as `/project` and your `auth.json` read-only.
- A `scripts/dev.sh` entry point that builds the image (on first run) and drops you into `opencode` inside the container.
- A `scripts/sandbox-disable-extras.sh` that strips Vidarr (the GPT-5.5 agent) and the Hindsight MCP server on every container start, so the default sandbox works with just a MiniMax API key.

The sandbox uses the same code you have on disk — your edits in `config/agents/thor.md` are visible inside the container instantly, no rebuild needed.

## Quick start

```bash
cd BizarHarness-dev
./scripts/dev.sh
```

First run builds the Docker image automatically (1-2 minutes), then drops you into `opencode` inside the container. The project directory is mounted at `/project` — any edits you make on the host are visible inside the container, and vice versa.

The container starts `opencode` directly. To get a shell inside the container instead:

```bash
./scripts/dev.sh bash
```

To rebuild the image (after changing `Dockerfile` or `package.json`):

```bash
./scripts/dev.sh --rebuild
```

## The Docker image

The image is built from a `Dockerfile` in the dev sandbox project. It includes:

- `node` 20+
- `opencode` CLI
- `jq` (for `opencode.json` merging in the install script)
- `uv` (for installing `semble[mcp]`)
- `git`, `bash`, `curl`, `ca-certificates`

The image is persistent across runs — it's only rebuilt when you ask (`--rebuild`) or when it doesn't exist yet. Most iterations are just a `./scripts/dev.sh` away with near-instant startup.

A named Docker volume `bizarharness-dev-cache` is mounted at `~/.cache` inside the container. It includes `~/.cache/opencode/` and `~/.cache/bizarharness/`. The volume is **isolated from the host** — nothing leaks into your real `~/.cache/`. Use `./scripts/dev.sh --clean` to wipe it.

## .env configuration

The recommended way to pass API keys into the sandbox is via `.env`. Copy the example and fill in your keys:

```bash
cp .env.example .env
$EDITOR .env
```

The `.env` file is gitignored. `.env.example` is the committed template. Docker Compose loads `.env` automatically — no `--env-file` flags needed.

The key variables:

| Variable | Required? | Purpose |
|---|---|---|
| `MINIMAX_API_KEY` | No (but model calls fail without it) | M2.7 and M3 model access (Thor, Tyr, Hermod, Baldr, Forseti) |
| `OPENCODE_API_KEY` | No | opencode platform auth (alternative to `auth.json`) |
| `OPENAI_API_KEY` | No (sandbox default strips Vidarr) | GPT-5.5 access (only if you re-enable Vidarr) |
| `HINDSIGHT_API_KEY` | No (sandbox default strips Hindsight) | Hindsight memory service (only if you re-enable) |
| `BIZAR_LOG_LEVEL` | No | Plugin log verbosity (`debug`, `info`, `warn`, `error`) |
| `BIZAR_DISABLE` | No | `=1` to disable the Bizar plugin entirely |

Precedence: host shell env vars override `.env` overrides docker-compose defaults. So you can set default keys in `.env` and override a single key from the shell for a one-off run:

```bash
MINIMAX_API_KEY=sk-... ./scripts/dev.sh
```

## Disabling Vidarr and Hindsight

The dev sandbox deliberately ships **without** two features that the main BizarHarness repo provides:

| Feature | Why disabled |
|---|---|
| **Vidarr** (GPT-5.5 last-resort agent) | Requires OpenAI API key; not needed for most work |
| **Hindsight** (cross-session memory MCP) | Requires Hindsight API key; external dependency |

Every time the container starts, the entrypoint runs `scripts/sandbox-disable-extras.sh`, which:

1. Removes `vidarr.md` from `~/.config/opencode/agents/`.
2. Removes the `hindsight` MCP entry from `opencode.json`.
3. Strips any remaining Anthropic model references.

This means `OPENAI_API_KEY` and `HINDSIGHT_API_KEY` are not used in the default sandbox. The sandbox works with just `MINIMAX_API_KEY` (for M2.7/M3).

To re-enable Vidarr inside the container:

```bash
./scripts/dev.sh bash
# inside the container:
cp /project/config/agents/vidarr.md ~/.config/opencode/agents/
```

To re-enable Hindsight, edit `~/.config/opencode/opencode.json` and add the `hindsight` entry back under `mcp` (see the template at `/project/config/opencode.json`).

To skip the disable script entirely (e.g., for a full-feature test):

```bash
docker compose -f docker-compose.yml run --entrypoint /bin/bash --rm dev
# then inside:
/project/install.sh
opencode
```

## When to use the sandbox vs system install

| You want to... | Use |
|---|---|
| Edit `config/agents/thor.md` and test the change | **Sandbox** — `/project` is mounted live, just rerun `./scripts/dev.sh` |
| Edit `plugins/bizar/src/loop.ts` and test the change | **Sandbox** — same, just rerun |
| Edit `cli/install.mjs` and test the install flow | **Sandbox** — same |
| Test a clean install of a published npm version | **Sandbox** — `./scripts/dev.sh --clean` for a fresh state |
| Develop on your daily opencode setup with the new agent | **System install** — `./install.sh` in BizarHarness |
| Test that a plugin change works in production config | **Sandbox** with the disable script skipped (full feature set) |

The rule of thumb: the sandbox is for development and testing. The system install is for your daily opencode.

## Commands reference

```bash
# Normal usage — run opencode in the sandbox (builds image on first run)
./scripts/dev.sh

# Get a shell instead of opencode
./scripts/dev.sh bash

# Rebuild the Docker image first
./scripts/dev.sh --rebuild

# Force a no-cache Docker build
./scripts/dev.sh --no-cache

# Wipe the cache volume (resets plugin state, opencode cache, npm cache)
./scripts/dev.sh --clean

# Combine flags
./scripts/dev.sh --rebuild --clean
```

## Testing a clean install (smoke test)

```bash
./scripts/dev-clean.sh
```

Runs `opencode run --pure "echo ready"` inside the container to verify that opencode loads, the npm install is sound, and the binary responds. It does not require a PTY and exits immediately with a pass/fail message.

Use this after changing `Dockerfile` or `package.json` dependencies.

## When to rebuild

| You changed... | Action |
|---|---|
| `config/agents/*.md` | Just rerun `./scripts/dev.sh` |
| `config/opencode.json` | Just rerun `./scripts/dev.sh` |
| `cli/*.mjs` | Just rerun `./scripts/dev.sh` |
| `plugins/bizar/src/*` | Just rerun `./scripts/dev.sh` |
| `install.sh` or `package.json` | Just rerun `./scripts/dev.sh` |
| `Dockerfile` or system deps | `./scripts/dev.sh --rebuild` |
| npm dependencies (`package.json`) | `./scripts/dev.sh --rebuild` |
| Want a completely fresh state | `./scripts/dev.sh --clean` |

## Auth.json mount

Your host has API auth stored at `~/.local/share/opencode/auth.json`. This file is mounted **read-only** at the same path inside the container:

```
host: ~/.local/share/opencode/auth.json
  → container: /home/dev/.local/share/opencode/auth.json (ro)
```

- opencode inside the sandbox can **read** your API keys.
- The sandbox can **never modify** `auth.json` — no risk of corrupting your real config.
- Other files in `~/.local/share/opencode/` (opencode.db, snapshots, repos) are not mounted, so they start fresh and are ephemeral.

## Troubleshooting

**"docker: command not found"** — Install Docker from https://docs.docker.com/engine/install/

**"auth.json missing — sandbox will work but auth will fail"** — Log into opencode on the host first (`opencode` → `/connect`) to generate `~/.local/share/opencode/auth.json`, or set `MINIMAX_API_KEY` directly in `.env`.

**"Permission denied" on mounted files** — Your host UID is detected automatically (default 1000). If your UID is different:

```bash
DEV_UID=$(id -u) ./scripts/dev.sh --rebuild
```

**"The sandbox feels slow"** — First run downloads npm packages. Subsequent runs are instant unless `--rebuild` is used. The cache volume (`bizarharness-dev-cache`) speeds up repeated use significantly.

## Next steps

Next: [Plans Command](Plans-Command) — the visual plan tool for drafting and reviewing architectural decisions.
