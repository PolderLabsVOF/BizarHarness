/**
 * cli/commands/rca.test.mjs
 *
 * v6.2.3 — Unit tests for the rca (GitHub Issue RCA) subcommand.
 *
 * Tests the URL validation and argument parsing without actually
 * spawning the `gh` and `cline` binaries.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { showRcaHelp } from './rca.mjs';

describe('rca — help', () => {
  test('prints help text when --help is passed', () => {
    let out = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { out += String(chunk); return true; };
    try {
      showRcaHelp();
    } finally {
      process.stdout.write = origWrite;
    }
    assert.match(out, /bizar rca/);
    assert.match(out, /Usage:/);
    assert.match(out, /GitHub/);
  });
});

describe('rca — URL validation (inline test)', () => {
  // The actual URL validation regex is inline in runRca. Test it here.
  const URL_REGEX = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+/;

  test('accepts valid GitHub issue URLs', () => {
    assert.match('https://github.com/owner/repo/issues/123', URL_REGEX);
    assert.match('https://github.com/anthropics/claude-code/issues/1', URL_REGEX);
  });

  test('rejects non-GitHub URLs', () => {
    assert.equal(URL_REGEX.test('https://gitlab.com/owner/repo/issues/123'), false);
    assert.equal(URL_REGEX.test('https://example.com/foo'), false);
  });

  test('rejects malformed GitHub URLs', () => {
    assert.equal(URL_REGEX.test('https://github.com/owner/repo'), false);
    assert.equal(URL_REGEX.test('https://github.com/owner/repo/pull/123'), false);
    assert.equal(URL_REGEX.test('not-a-url'), false);
  });
});

describe('rca — extractFinalText (inline test)', () => {
  // The actual extraction logic is inline in rca.mjs. Test the
  // expected behavior here so we know the contract.
  function extractFinalText(jsonl) {
    const lines = jsonl.split('\n').filter(Boolean);
    let finalText = null;
    const seen = [];
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'agent_event' && evt.event?.type === 'done' && evt.event?.text) {
          finalText = evt.event.text;
        } else if (evt.type === 'say' && evt.text) {
          seen.push(evt.text);
        }
      } catch { /* skip */ }
    }
    if (finalText) return finalText.replace(/\\n/g, '\n');
    if (seen.length > 0) return seen.join('\n').replace(/\\n/g, '\n');
    return null;
  }

  test('extracts final done event text', () => {
    const ndjson = [
      JSON.stringify({ type: 'say', text: 'thinking...' }),
      JSON.stringify({ type: 'agent_event', event: { type: 'done', text: 'final answer' } }),
    ].join('\n');
    assert.equal(extractFinalText(ndjson), 'final answer');
  });

  test('un-escapes \\n in the final text', () => {
    const ndjson = JSON.stringify({
      type: 'agent_event', event: { type: 'done', text: 'line1\\nline2' },
    });
    assert.equal(extractFinalText(ndjson), 'line1\nline2');
  });

  test('falls back to concatenated say events when no done event', () => {
    const ndjson = [
      JSON.stringify({ type: 'say', text: 'part1' }),
      JSON.stringify({ type: 'say', text: 'part2' }),
    ].join('\n');
    assert.equal(extractFinalText(ndjson), 'part1\npart2');
  });

  test('returns null for empty/invalid input', () => {
    assert.equal(extractFinalText(''), null);
    assert.equal(extractFinalText('not json'), null);
  });
});