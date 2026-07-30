#!/usr/bin/env bash
# verify-feature.sh — Verify a feature from feature_list.json by ID.
#
# Usage: ./scripts/verify-feature.sh F-001
#
# Multi-layer validation in strict order (Layer 1 → Layer 2 → Layer 3).
# On layer failure, prints the `repair` instruction from feature_list.json
# so the agent knows exactly what to fix.
#
# On success, marks the feature `passing` and recomputes VCR.

set -euo pipefail

FEATURE_ID="${1:-}"
if [[ -z "$FEATURE_ID" ]]; then
  echo "Usage: $0 <feature-id>"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FL="$ROOT/feature_list.json"

if [[ ! -f "$FL" ]]; then
  echo "FAIL: feature_list.json not found at $FL"
  exit 1
fi

echo "▶ Verifying feature $FEATURE_ID..."
echo "──────────────────────────────────────"

# Run layers in order. Read the layers array from feature_list.json.
# Stop on first failure; print repair instructions.

# Layer 1: Compile (always runs)
echo "Layer 1: TypeScript compile"
if ! (cd "$ROOT" && bunx tsc --noEmit 2>&1 | tail -3); then
  echo "FAIL: Layer 1 (compile) failed"
  echo "REPAIR: Run 'make check' and fix TypeScript errors. Common issues:"
  echo "        - Missing type annotation"
  echo "        - Wrong zod shape passed to createTool"
  echo "        - Missing implementation or executable verification evidence"
  exit 1
fi
echo "  PASS"

# Layers 2-N: Read from feature_list.json
LAYERS=$(bun -e "
const f = JSON.parse(await Bun.file('$FL').text());
const x = f.features.find(y => y.id === '$FEATURE_ID');
if (x && x.layers) {
  for (const l of x.layers.slice(1)) {  // skip compile (already run)
    console.log(JSON.stringify(l));
  }
}
" 2>/dev/null || echo "")

while IFS= read -r LAYER_JSON; do
  [[ -z "$LAYER_JSON" ]] && continue
  LABEL=$(echo "$LAYER_JSON" | bun -e "const d = JSON.parse(await Bun.stdin.text()); console.log(d.label);" 2>/dev/null)
  CMD=$(echo "$LAYER_JSON" | bun -e "const d = JSON.parse(await Bun.stdin.text()); console.log(d.cmd);" 2>/dev/null)
  REPAIR=$(echo "$LAYER_JSON" | bun -e "const d = JSON.parse(await Bun.stdin.text()); console.log(d.repair);" 2>/dev/null)

  echo "Layer ($LABEL): $CMD"
  set +e
  OUTPUT=$(cd "$ROOT" && eval "$CMD" 2>&1)
  RC=$?
  set -e
  if [[ $RC -eq 0 ]]; then
    echo "  PASS"
  else
    echo "FAIL: Layer ($LABEL) failed (exit $RC)"
    echo "REPAIR: $REPAIR"
    echo "OUTPUT: $(echo "$OUTPUT" | tail -5)"
    echo ""
    echo "Do NOT proceed to the next layer. Fix this one first."
    exit 1
  fi
done <<< "$LAYERS"

# All layers passed — mark the feature `passing`
COMMIT=$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo "no-commit")
NOW=$(date -u +%Y-%m-%d)

echo "▶ Marking $FEATURE_ID as passing..."
bun -e "
const f = JSON.parse(await Bun.file('$FL').text());
const x = f.features.find(y => y.id === '$FEATURE_ID');
if (x) {
  x.state = 'passing';
  x.passed = '$NOW';
  x.commit = '$COMMIT';
  x.evidence = 'make verify-feature $FEATURE_ID — all layers green ($NOW)';
  const activated = f.features.filter(y => y.state !== 'not_started').length;
  const passing = f.features.filter(y => y.state === 'passing').length;
  f.vcr = { passing, activated, ratio: activated === 0 ? 1.0 : +(passing / activated).toFixed(3) };
  await Bun.write('$FL', JSON.stringify(f, null, 2));
  console.log('VCR:', passing + '/' + activated, '=', f.vcr.ratio);
}
"

echo "──────────────────────────────────────"
echo "✓ Feature $FEATURE_ID verified"
