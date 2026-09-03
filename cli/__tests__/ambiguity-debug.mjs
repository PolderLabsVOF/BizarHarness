import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { run } from '/home/drb0rk/projects/BizarHarness/.claude/worktrees/agent-a4676ce87904bc0ce/cli/commands/ambiguity.mjs';

const root = mkdtempSync(join(tmpdir(), 'bizar-ambiguity-debug-'));
mkdirSync(join(root, 'docs', 'specs'), { recursive: true });
const clarity = { intent: 0.95, outcome: 0.95, scope: 0.95, constraints: 0.95, success: 0.95, context: 0.95 };
const specPath = join(root, 'docs', 'specs', 'deep-interview-foo.md');
const body = '# Deep Interview — foo\n\n## Ambiguity breakdown\n\n```json\n' + JSON.stringify({ kind: 'greenfield', score: 0.05, clarityBreakdown: clarity }, null, 2) + '\n```\n';
writeFileSync(specPath, body);

(async () => {
  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.join(' '));
  try {
    const code = await run([specPath]);
    console.error('CODE:', code);
    console.error('CAPTURED:', JSON.stringify(captured));
  } finally {
    console.log = origLog;
  }
  rmSync(root, { recursive: true, force: true });
})();
