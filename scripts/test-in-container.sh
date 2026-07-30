#!/usr/bin/env bash
# Run the complete retained harness gate in an isolated Linux checkout.
# Requires a working Podman or Docker installation and network access.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${BIZAR_TEST_IMAGE:-docker.io/library/node:22-bookworm-slim}"
LOG_DIR="${TMPDIR:-/tmp}/bizar-container-logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/test-$(date +%Y%m%d-%H%M%S).log"

if command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then
  RUNTIME=podman
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  RUNTIME=docker
else
  echo "test-in-container: Podman or Docker is required" >&2
  exit 2
fi

echo "▶ Container verification"
echo "  runtime: $RUNTIME"
echo "  image:   $IMAGE"

"$RUNTIME" run --rm \
  --network=host \
  --mount "type=bind,src=$ROOT,dst=/source,ro" \
  --env CI=1 \
  "$IMAGE" bash -lc '
    set -euo pipefail
    mkdir -p /workspace
    cp -a /source/. /workspace/
    cd /workspace
    rm -rf node_modules packages/sdk/node_modules packages/sdk/dist

    apt-get update -qq
    apt-get install -y -qq --no-install-recommends \
      bash build-essential ca-certificates curl git make python3 unzip
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    npm install --global @anthropic-ai/claude-code
    bun install --frozen-lockfile

    make check
    make test
    make e2e
    make check-arch
    make verify-repo-structure
  ' 2>&1 | tee "$LOG"

echo "✓ Container verification passed — $LOG"
