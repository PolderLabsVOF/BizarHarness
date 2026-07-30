import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillSprintContract } from './sprint.mjs';

test('fills a sprint contract from canonical root PROGRESS.md', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-sprint-'));
  try {
    mkdirSync(join(root, 'cli'), { recursive: true });
    mkdirSync(join(root, 'templates'), { recursive: true });
    copyFileSync(join(import.meta.dirname, '..', 'cli', 'progress-parser.mjs'), join(root, 'cli', 'progress-parser.mjs'));
    copyFileSync(join(import.meta.dirname, '..', 'templates', 'sprint-contract.md'), join(root, 'templates', 'sprint-contract.md'));
    writeFileSync(join(root, 'PROGRESS.md'), `# Progress

## In Progress — F-116 Core audit
Owner: mike
Goal is **active**.
- [x] Remove retired surfaces
- [ ] Run final gates
`);

    const path = await fillSprintContract('F-116', root);
    const output = readFileSync(path, 'utf8');
    assert.equal((output.match(/\*\*Feature ID:\*\*/g) || []).length, 1);
    assert.equal((output.match(/\*\*Sprint date:\*\*/g) || []).length, 1);
    assert.match(output, /- \*\*Feature ID:\*\* F-116/);
    assert.match(output, /- \*\*Title:\*\* Core audit/);
    assert.match(output, /- \[ \] Run final gates/);
    assert.match(output, /- \[x\] Remove retired surfaces/);
    assert.doesNotMatch(output, /\.bizar\/PROGRESS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
