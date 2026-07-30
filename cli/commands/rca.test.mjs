import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRcaPrompt, parseIssueUrl, showRcaHelp } from './rca.mjs';

test('parses canonical GitHub issue URLs', () => {
  assert.deepEqual(parseIssueUrl('https://github.com/openai/codex/issues/123'), {
    owner: 'openai',
    repo: 'codex',
    number: '123',
  });
});

test('rejects non-issue URLs', () => {
  assert.equal(parseIssueUrl('https://example.com/openai/codex/issues/123'), null);
  assert.equal(parseIssueUrl('https://github.com/openai/codex/pull/123'), null);
});

test('builds a read-only structured RCA prompt', () => {
  const prompt = buildRcaPrompt('{"title":"broken"}', 'security impact');
  assert.match(prompt, /Do not modify files/);
  assert.match(prompt, /ranked hypotheses/);
  assert.match(prompt, /security impact/);
  assert.match(prompt, /"title":"broken"/);
});

test('help documents Claude Code plan mode behavior', () => {
  let output = '';
  const original = console.log;
  console.log = (...parts) => { output += `${parts.join(' ')}\n`; };
  try {
    showRcaHelp();
  } finally {
    console.log = original;
  }
  assert.match(output, /Claude Code/);
  assert.match(output, /no repository mutation/i);
});
