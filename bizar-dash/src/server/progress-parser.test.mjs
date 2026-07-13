/**
 * src/server/progress-parser.test.mjs
 *
 * Sprint S10 — Unit tests for progress-parser.mjs.
 * Uses node:test (matches the existing `cli/__tests__/*.test.mjs` pattern
 * shipped across the harness — no vitest/jsdom dependency).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProgress, serializeProgress } from './progress-parser.mjs';

test('empty input → empty goals + empty preamble', () => {
  const r = parseProgress('');
  assert.equal(r.goals.length, 0);
  assert.equal(r.preamble, '');
  assert.equal(r.postamble, '');
});

test('parses single F-NNN header with status + progress + owner', () => {
  const text = `# Title\n\nIntro line.\n\n## F-052 — Ship dashboard\nOwner: sam\nDue: Q3 2026\n\nGoal is **at-risk**. About 42% done.\n\nKey results:\n- [x] First KR\n- [ ] Second KR (@alex)\n`;
  const r = parseProgress(text);
  assert.equal(r.goals.length, 1);
  const g = r.goals[0];
  assert.equal(g.id, 'F-052');
  assert.equal(g.title, 'Ship dashboard');
  assert.equal(g.status, 'at-risk');
  assert.equal(g.owner, 'sam');
  assert.equal(g.due, 'Q3 2026');
  assert.equal(g.keyResults.length, 2);
  assert.equal(g.keyResults[0].done, true);
  assert.equal(g.keyResults[1].done, false);
  assert.equal(g.keyResults[1].assignee, 'alex');
  assert.equal(g.progress, 0.5);
});

test('parses bare title (no F-NNN id)', () => {
  const r = parseProgress('## Cut S9 polish in half\nGoal is **on-track**.\n');
  assert.equal(r.goals.length, 1);
  assert.equal(r.goals[0].id, 'cut-s9-polish-in-half');
  assert.equal(r.goals[0].title, 'Cut S9 polish in half');
});

test('multi-goal preserves preamble and orders', () => {
  const text = `# Header\nPreamble line.\n\n## F-001 — One\nGoal is **done**.\n\n## F-002 — Two\nGoal is **active**. 25%.\n\n## F-003 — Three\nGoal is **blocked**.\n`;
  const r = parseProgress(text);
  assert.equal(r.goals.length, 3);
  assert.equal(r.goals[0].id, 'F-001');
  assert.equal(r.goals[0].status, 'done');
  assert.equal(r.goals[1].status, 'active');
  assert.equal(r.goals[2].status, 'blocked');
  assert.ok(r.preamble.includes('Preamble line.'));
});

test('progress derives from KRs when no % present', () => {
  const text = '## F-A — Title\n- [x] a\n- [x] b\n- [ ] c\n- [ ] d\n';
  const r = parseProgress(text);
  assert.equal(r.goals[0].progress, 0.5);
});

test('unknown status defaults to on-track', () => {
  const r = parseProgress('## F-X — Title\nNo status marker here.\n');
  assert.equal(r.goals[0].status, 'on-track');
});

test('serialise round-trips goal + KR structure', () => {
  const parsed = {
    preamble: '# Header\n',
    postamble: '',
    goals: [
      {
        id: 'F-052',
        title: 'Ship dashboard',
        status: 'at-risk',
        description: 'Description body.',
        progress: 0.5,
        keyResults: [
          { id: 'kr-1', title: 'First KR', done: true },
          { id: 'kr-2', title: 'Second KR', done: false, assignee: 'alex' },
        ],
        owner: 'sam',
        due: 'Q3 2026',
        section: 'in-progress',
      },
    ],
  };
  const out = serializeProgress(parsed);
  assert.ok(out.includes('## F-052 — Ship dashboard'));
  assert.ok(out.includes('Owner: sam'));
  assert.ok(out.includes('Goal is **at-risk**.'));
  assert.ok(out.includes('- [x] First KR'));
  assert.ok(out.includes('- [ ] Second KR (@alex)'));
});

test('serialise preserves preamble verbatim', () => {
  const parsed = {
    preamble: '# Title\n\nIntro stays here.\n\n',
    postamble: '\n## Footnotes\nThis stays too.\n',
    goals: [],
  };
  const out = serializeProgress(parsed);
  assert.ok(out.startsWith('# Title'));
  assert.ok(out.includes('Intro stays here.'));
  assert.ok(out.includes('## Footnotes'));
});