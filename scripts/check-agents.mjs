/**
 * scripts/check-agents.mjs
 *
 * Verifies every agent file references the shared baseline and can search
 * current official documentation.
 *
 * Fails (exit 1) if any shipped Bizar agent is missing AGENT_BASELINE or
 * WebSearch access. This catches drift before an agent can bypass the
 * always-on routing and documentation-grounding rules.
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
const NON_ISOLATED_WRITERS = new Set(['it-lead.md']);

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
  const tools = /^tools:\s*(.+)$/m.exec(text)?.[1] || '';
  const writesCode = /\b(?:Edit|Write)\b/.test(tools);
  const isolated = /^isolation:\s*worktree\s*$/m.test(text);
  if (!name) {
    rows.push([file, 'NO NAME', 'frontmatter name is required']);
    failed++;
  } else if (names.has(name)) {
    rows.push([file, 'DUPLICATE NAME', `also used by ${names.get(name)}`]);
    failed++;
  } else {
    names.set(name, file);
    if (writesCode && !NON_ISOLATED_WRITERS.has(file) && !isolated) {
      rows.push([file, 'NO ISOLATION', 'code-writing agents require isolation: worktree']);
      failed++;
    } else if (!hasBaseline) {
      rows.push([file, 'NO BASELINE', 'must reference AGENT_BASELINE']);
      failed++;
    } else if (!/\bWebSearch\b/.test(tools)) {
      rows.push([file, 'NO WEBSEARCH', 'tools must include WebSearch']);
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

console.log('\n  Agent grounding policy check\n');
console.log('  ' + 'agent'.padEnd(24) + 'status'.padEnd(14) + 'references');
console.log('  ' + '-'.repeat(60));
for (const [file, status, refs] of rows) {
  console.log('  ' + file.padEnd(24) + status.padEnd(14) + refs);
}
console.log('');
if (failed > 0) {
  console.log(`  ✗ ${failed} agent(s) violate the baseline/WebSearch policy.\n`);
  process.exit(1);
}
console.log(`  ✓ All ${AGENT_FILES.length} agents have unique names, baseline grounding, and WebSearch access.\n`);
