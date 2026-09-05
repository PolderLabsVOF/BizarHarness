import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillSprintContract } from './sprint.mjs';

function fixtureRoot() {
  return mkdtempSync(join(tmpdir(), 'bizar-sprint-'));
}

function seedPrd(root, prd) {
  const prdDir = join(root, '.ok', 'prds');
  mkdirSync(prdDir, { recursive: true });
  writeFileSync(join(prdDir, 'prd-fixture.json'), JSON.stringify(prd));
}

test('fills a sprint contract from an OpenKan PRD in .ok/prds/', async () => {
  const root = fixtureRoot();
  try {
    mkdirSync(join(root, 'templates'), { recursive: true });
    copyFileSync(join(import.meta.dirname, '..', 'templates', 'sprint-contract.md'), join(root, 'templates', 'sprint-contract.md'));
    seedPrd(root, {
      schema: 'ok.prd.v1',
      id: 'prd-fixture',
      title: 'OpenKan-first Bizar planning',
      owners: ['mike'],
      goals: [
        { id: 'F-116', text: 'Core audit', status: 'open' },
      ],
      status: 'active',
    });

    const path = await fillSprintContract('F-116', root);
    const output = readFileSync(path, 'utf8');
    assert.equal((output.match(/\*\*Feature ID:\*\*/g) || []).length, 1);
    assert.equal((output.match(/\*\*Sprint date:\*\*/g) || []).length, 1);
    assert.match(output, /- \*\*Feature ID:\*\* F-116/);
    assert.match(output, /- \*\*Title:\*\* Core audit/);
    assert.match(output, /- \[ \] Core audit/);
    assert.match(output, /- \*\*Owner:\*\* mike/);
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
  const root = fixtureRoot();
  try {
    mkdirSync(join(root, 'templates'), { recursive: true });
    copyFileSync(join(import.meta.dirname, '..', 'templates', 'sprint-contract.md'), join(root, 'templates', 'sprint-contract.md'));
    seedPrd(root, {
      schema: 'ok.prd.v1',
      id: 'prd-fixture',
      title: 'Audit fix PRD',
      owners: ['mike'],
      goals: [
        { id: 'F-200', text: 'Implement the fix', status: 'open' },
      ],
      status: 'active',
    });

    const path = await fillSprintContract('F-200', root);
    const output = readFileSync(path, 'utf8');
    // Extract the shipped-template DoD block — non-greedy, bounded by the
    // next `## Architecture constraints` heading.
    const dodMatch = output.match(/## Definition of Done \(DoD\)[\s\S]*?(?=\n## )/);
    assert.ok(dodMatch, 'output must contain the shipped-template DoD block');
    const dodSection = dodMatch[0];
    // Every shipped DoD item must remain `[ ]`. Pre-fix they were
    // rewritten to `[x]` by `scripts/sprint.mjs:140-144`.
    const shippedDoDItems = [
      'Layer 1: `make check` green',
      'Layer 2: `make test` green',
      'Layer 3: `make e2e` green',
      'Documentation updated in same commit',
      'OpenKan PRD/task updated with fresh evidence in `.ok/`',
      '`bizar doctor` (or `.ok/` validation) reflects new state',
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

test('sprint generator throws an actionable error when the goal is missing from .ok/prds/', async () => {
  const root = fixtureRoot();
  try {
    mkdirSync(join(root, 'templates'), { recursive: true });
    copyFileSync(join(import.meta.dirname, '..', 'templates', 'sprint-contract.md'), join(root, 'templates', 'sprint-contract.md'));
    seedPrd(root, {
      schema: 'ok.prd.v1',
      id: 'prd-fixture',
      title: 'Empty PRD',
      goals: [],
      status: 'active',
    });
    let caught;
    try {
      await fillSprintContract('F-999', root);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'fillSprintContract should reject when the goal is absent');
    // Substring assertion keeps the test resilient against any future
    // help-message formatting (backticks, line breaks, etc.).
    assert.ok(caught.message.includes("goal 'F-999' not found under .ok/prds/."),
      `error message should mention the missing .ok/prds/ path; got: ${caught.message}`);
    assert.ok(caught.message.includes('bizar goals list'),
      `error message should hint at the goals list CLI; got: ${caught.message}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
