/**
 * scripts/check-agents.mjs
 *
 * v10.7.0 — Verifies every agent file references the right shared docs.
 *
 * Fails (exit 1) if any shipped Bizar agent is missing the
 * AGENT_BASELINE or CLAUDE_TOOLS reference. This catches drift early —
 * an agent that doesn't reference the baseline doesn't get the
 * always-on rules at runtime.
 *
 * Reads from `.claude/agents/` (canonical Claude Code location).
 * The legacy `config/agents/` tree was removed in F-107.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(__filename, '..', '..');

const agentsDir = join(ROOT, '.claude', 'agents');
const AGENT_FILES = readdirSync(agentsDir)
  .filter((file) => file.endsWith('.md'))
  .sort();

let failed = 0;
const rows = [];
const names = new Map();

for (const file of AGENT_FILES) {
  const path = join(agentsDir, file);
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    rows.push([file, 'MISSING FILE', '']);
    failed++;
    continue;
  }
  const hasBaseline = /AGENT_BASELINE|agent-baseline/i.test(text);
  const hasClaudeTools = /CLAUDE_TOOLS/i.test(text);
  const name = /^name:\s*([^\s]+)\s*$/m.exec(text)?.[1];
  if (!name) {
    rows.push([file, 'NO NAME', 'frontmatter name is required']);
    failed++;
  } else if (names.has(name)) {
    rows.push([file, 'DUPLICATE NAME', `also used by ${names.get(name)}`]);
    failed++;
  } else {
    names.set(name, file);
    if (!hasBaseline && !hasClaudeTools) {
      rows.push([file, 'NO REFERENCE', 'needs AGENT_BASELINE or CLAUDE_TOOLS in body']);
      failed++;
    } else {
      const refs = [
        hasBaseline ? 'AGENT_BASELINE' : null,
        hasClaudeTools ? 'CLAUDE_TOOLS' : null,
      ].filter(Boolean).join('+');
      rows.push([file, 'OK', refs]);
    }
  }
}

console.log('\n  Agent → Shared-Docs reference check (v10.7.0)\n');
console.log('  ' + 'agent'.padEnd(24) + 'status'.padEnd(14) + 'references');
console.log('  ' + '-'.repeat(60));
for (const [file, status, refs] of rows) {
  console.log('  ' + file.padEnd(24) + status.padEnd(14) + refs);
}
console.log('');
if (failed > 0) {
  console.log(`  ✗ ${failed} agent(s) missing the AGENT_BASELINE/CLAUDE_TOOLS reference.\n`);
  process.exit(1);
}
console.log(`  ✓ All ${AGENT_FILES.length} agents have unique names and reference the shared docs.\n`);
