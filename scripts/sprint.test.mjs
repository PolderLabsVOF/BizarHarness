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

// Regression test for docs/audits/production-autonomy-improvements-2026-08-28.md
// P0: "Stop pre-completing Definition of Done in sprint generation." The
// generator must leave every `[ ]` inside the `## Definition of Done (DoD)`
// block of the shipped template as `[ ]` — flipping them to `[x]` would
// silently convert unverified acceptance criteria into "done" claims with
// no recorded proof.
test('sprint generator does NOT pre-check Definition of Done checkboxes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-sprint-dod-'));
  try {
    mkdirSync(join(root, 'cli'), { recursive: true });
    mkdirSync(join(root, 'templates'), { recursive: true });
    copyFileSync(join(import.meta.dirname, '..', 'cli', 'progress-parser.mjs'), join(root, 'cli', 'progress-parser.mjs'));
    copyFileSync(join(import.meta.dirname, '..', 'templates', 'sprint-contract.md'), join(root, 'templates', 'sprint-contract.md'));
    writeFileSync(join(root, 'PROGRESS.md'), `# Progress

## In Progress — F-200 Audit fix
Owner: mike
Goal is **active**.
- [ ] Implement the fix
`);

    const path = await fillSprintContract('F-200', root);
    const output = readFileSync(path, 'utf8');
    // Extract the shipped-template DoD block — non-greedy, bounded by the
    // next `## Architecture constraints` heading.
    const dodMatch = output.match(/## Definition of Done \(DoD\)[\s\S]*?(?=\n## )/);
    assert.ok(dodMatch, 'output must contain the shipped-template DoD block');
    const dodSection = dodMatch[0];
    // The seven shipped DoD items must all remain `[ ]`. Pre-fix they were
    // rewritten to `[x]` by `scripts/sprint.mjs:140-144`.
    const shippedDoDItems = [
      'Layer 1: `make check` green',
      'Layer 2: `make test` green',
      'Layer 3: `make e2e` green',
      'Documentation updated in same commit',
      '`feature_list.json` updated with `evidence` field',
      '`PROGRESS.md` reflects new current state',
      'Commit message explains WHY',
    ];
    for (const needle of shippedDoDItems) {
      assert.match(dodSection, new RegExp(`- \\[ \\] ${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        `DoD checkbox for "${needle}" must remain unchecked`);
      assert.doesNotMatch(dodSection, new RegExp(`- \\[x\\] ${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        `DoD checkbox for "${needle}" must NOT be pre-checked`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
