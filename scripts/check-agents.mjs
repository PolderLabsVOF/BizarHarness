/**
 * scripts/check-agents.mjs
 *
 * v6.2.4 — Verifies every agent file references the right shared docs.
 *
 * Fails (exit 1) if any of the 14 Bizar agents is missing the
 * AGENT_BASELINE or CLINE_TOOLS reference. This catches drift early —
 * an agent that doesn't reference the baseline doesn't get the
 * always-on rules at runtime.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(__filename, '..', '..');

const AGENT_FILES = [
  'agent-browser.md',
  'baldr.md',
  'forseti.md',
  'frigg.md',
  'heimdall.md',
  'hermod.md',
  'mimir.md',
  'odin.md',
  'quick.md',
  'semble-search.md',
  'thor.md',
  'tyr.md',
  'vidarr.md',
  'vor.md',
];

let failed = 0;
const rows = [];

for (const file of AGENT_FILES) {
  const path = join(ROOT, 'config', 'agents', file);
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    rows.push([file, 'MISSING FILE', '']);
    failed++;
    continue;
  }
  const hasBaseline = /AGENT_BASELINE|agent-baseline/i.test(text);
  const hasClineTools = /CLINE_TOOLS/i.test(text);
  if (!hasBaseline && !hasClineTools) {
    rows.push([file, 'NO REFERENCE', 'needs AGENT_BASELINE or CLINE_TOOLS in description']);
    failed++;
  } else {
    const refs = [
      hasBaseline ? 'AGENT_BASELINE' : null,
      hasClineTools ? 'CLINE_TOOLS' : null,
    ].filter(Boolean).join('+');
    rows.push([file, 'OK', refs]);
  }
}

console.log('\n  Agent → Shared-Docs reference check (v6.2.4)\n');
console.log('  ' + 'agent'.padEnd(24) + 'status'.padEnd(14) + 'references');
console.log('  ' + '-'.repeat(60));
for (const [file, status, refs] of rows) {
  console.log('  ' + file.padEnd(24) + status.padEnd(14) + refs);
}
console.log('');
if (failed > 0) {
  console.log(`  ✗ ${failed} agent(s) missing the AGENT_BASELINE/CLINE_TOOLS reference.\n`);
  process.exit(1);
}
console.log(`  ✓ All ${AGENT_FILES.length} agents reference the shared docs.\n`);