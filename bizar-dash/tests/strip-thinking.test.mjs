/**
 * tests/strip-thinking.test.mjs
 *
 * Unit tests for `stripThinkingTags` and `extractContentFromClineMessage`
 * in src/server/serve-info.mjs. The M3 model emits `<thinking>...</thinking>`
 * inline in the assistant text; these tags must be stripped from any string
 * that flows out of `extractContentFromClineMessage` so that
 * react-markdown (desktop + mobile chat) renders clean text.
 *
 * Run with: node --test tests/strip-thinking.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripThinkingTags,
  extractContentFromClineMessage,
} from '../src/server/serve-info.mjs';

test('stripThinkingTags: passes through plain text untouched', () => {
  assert.equal(
    stripThinkingTags('Hello, world.'),
    'Hello, world.'
  );
});

test('stripThinkingTags: strips a single thinking block', () => {
  const input = '<thinking>let me reason about this</thinking>Here is my answer.';
  assert.equal(stripThinkingTags(input), 'Here is my answer.');
});

test('stripThinkingTags: strips multiline thinking blocks', () => {
  const input = '<thinking>\nstep 1\nstep 2\nstep 3\n</thinking>\nFinal answer.';
  assert.equal(stripThinkingTags(input), 'Final answer.');
});

test('stripThinkingTags: strips multiple thinking blocks', () => {
  const input = '<thinking>a</thinking>foo<thinking>b</thinking>bar<thinking>c</thinking>baz';
  assert.equal(stripThinkingTags(input), 'foobarbaz');
});

test('stripThinkingTags: strips THINKING block (uppercase, case-insensitive)', () => {
  const input = '<THINKING>reasoning here</THINKING>visible output';
  assert.equal(stripThinkingTags(input), 'visible output');
});

test('stripThinkingTags: strips MixedCase thinking block', () => {
  const input = '<Thinking>x</Thinking>visible';
  assert.equal(stripThinkingTags(input), 'visible');
});

test('stripThinkingTags: strips thinking tag with attributes', () => {
  const input = '<thinking mode="deep" intensity="high">deep thought</thinking>answer';
  assert.equal(stripThinkingTags(input), 'answer');
});

test('stripThinkingTags: strips self-closing thinking tag', () => {
  const input = 'before<thinking/>after';
  assert.equal(stripThinkingTags(input), 'beforeafter');
});

test('stripThinkingTags: strips self-closing thinking tag with attributes', () => {
  const input = 'before<thinking mode="deep"/>after';
  assert.equal(stripThinkingTags(input), 'beforeafter');
});

test('stripThinkingTags: strips stray closing tag with no opener', () => {
  const input = 'before</thinking>after';
  assert.equal(stripThinkingTags(input), 'beforeafter');
});

test('stripThinkingTags: returns empty string when content is only a thinking block', () => {
  assert.equal(stripThinkingTags('<thinking>only this</thinking>'), '');
});

test('stripThinkingTags: returns empty string for empty input', () => {
  assert.equal(stripThinkingTags(''), '');
});

test('stripThinkingTags: returns empty string for non-string input', () => {
  assert.equal(stripThinkingTags(null), '');
  assert.equal(stripThinkingTags(undefined), '');
  assert.equal(stripThinkingTags(42), '');
  assert.equal(stripThinkingTags({}), '');
});

test('stripThinkingTags: collapses 3+ newlines to 2 after stripping', () => {
  const input = 'before<thinking>hidden</thinking>\n\n\n\n\nafter';
  assert.equal(stripThinkingTags(input), 'before\n\nafter');
});

test('stripThinkingTags: collapses newlines left over after stripping a block', () => {
  const input = '<thinking>hidden</thinking>\n\n\n\nvisible';
  assert.equal(stripThinkingTags(input), 'visible');
});

test('stripThinkingTags: trims leading and trailing whitespace', () => {
  assert.equal(stripThinkingTags('   hello   '), 'hello');
});

test('stripThinkingTags: handles nested-looking but separate blocks', () => {
  // Non-greedy match eats `<thinking>a<thinking>b</thinking>` first,
  // then the stray-closer pass strips the remaining `</thinking>`.
  const input = '<thinking>a<thinking>b</thinking>middle</thinking>visible';
  assert.equal(stripThinkingTags(input), 'middlevisible');
});

test('extractContentFromClineMessage: returns empty string for null/undefined', () => {
  assert.equal(extractContentFromClineMessage(null), '');
  assert.equal(extractContentFromClineMessage(undefined), '');
});

test('extractContentFromClineMessage: strips thinking from msg.text', () => {
  const msg = { text: '<thinking>reasoning</thinking>final answer' };
  assert.equal(extractContentFromClineMessage(msg), 'final answer');
});

test('extractContentFromClineMessage: strips thinking from msg.content', () => {
  const msg = { content: '<thinking>reasoning</thinking>final answer' };
  assert.equal(extractContentFromClineMessage(msg), 'final answer');
});

test('extractContentFromClineMessage: strips thinking from each text part', () => {
  const msg = {
    parts: [
      { type: 'text', text: '<thinking>step 1</thinking>first part' },
      { type: 'text', text: '<thinking>step 2</thinking>second part' },
    ],
  };
  assert.equal(
    extractContentFromClineMessage(msg),
    'first part\n\nsecond part'
  );
});

test('extractContentFromClineMessage: skips non-text parts', () => {
  const msg = {
    parts: [
      { type: 'text', text: 'visible' },
      { type: 'tool_use', id: 'x', name: 'bash', input: {} },
      { type: 'text', text: '<thinking>hidden</thinking>also visible' },
    ],
  };
  assert.equal(
    extractContentFromClineMessage(msg),
    'visible\n\nalso visible'
  );
});

test('extractContentFromClineMessage: returns empty for empty parts', () => {
  assert.equal(extractContentFromClineMessage({ parts: [] }), '');
  assert.equal(extractContentFromClineMessage({}), '');
});

test('extractContentFromClineMessage: real-world M3 message shape', () => {
  // Approximate shape of an interleaved-thinking assistant message
  const msg = {
    info: { id: 'm1', role: 'assistant', time: { created: 1000 } },
    parts: [
      {
        type: 'reasoning',
        text: '',
        reasoning_details: [{ type: 'reasoning.text', text: 'internal' }],
      },
      {
        type: 'text',
        text: '<thinking>let me think</thinking>Here is my answer.\n\nIt covers A, B, C.',
      },
    ],
  };
  assert.equal(
    extractContentFromClineMessage(msg),
    'Here is my answer.\n\nIt covers A, B, C.'
  );
});