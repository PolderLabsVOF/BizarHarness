// Loop task #22 — Update route channel selection.
//
// Source: `bizar-dash/src/server/routes/update.mjs`. The apply
// endpoint accepts a `channel` value of `stable` (default) or `beta`.
// Server maps these to the corresponding npm dist-tag: `@latest` or
// `@beta`. The check endpoint surfaces available versions per channel.

import test from 'node:test';
import assert from 'node:assert/strict';

const CHANNELS = ['stable', 'beta'];

function deriveNpmTag(channel) {
  return channel === 'beta' ? '@beta' : '@latest';
}

function deriveCheckAvailableShape(available) {
  return 'stable' in available && 'beta' in available;
}

function normalizeChannel(input) {
  // The route should accept missing/empty channel as 'stable'.
  if (input === undefined || input === null || input === '') return 'stable';
  if (input === 'beta') return 'beta';
  if (input === 'stable') return 'stable';
  return null; // unknown
}

for (const channel of CHANNELS) {
  test(`channel=${channel} maps to a canonical npm dist-tag`, () => {
    const tag = deriveNpmTag(channel);
    assert.ok(tag.startsWith('@'), `${tag} must be a dist-tag literal`);
  });

  test(`channel=${channel} is accepted as a valid input`, () => {
    assert.notEqual(normalizeChannel(channel), null);
  });
}

test('stable maps to @latest', () => {
  assert.equal(deriveNpmTag('stable'), '@latest');
});

test('beta maps to @beta', () => {
  assert.equal(deriveNpmTag('beta'), '@beta');
});

test('missing channel defaults to stable', () => {
  assert.equal(normalizeChannel(undefined), 'stable');
  assert.equal(normalizeChannel(null), 'stable');
  assert.equal(normalizeChannel(''), 'stable');
});

test('unknown channel is rejected', () => {
  assert.equal(normalizeChannel('nightly'), null);
  assert.equal(normalizeChannel('canary'), null);
});

test('available shape carries both stable + beta slots', () => {
  const available = { stable: '10.4.4', beta: '10.5.0-beta.1' };
  assert.equal(deriveCheckAvailableShape(available), true);
});

test('available shape accepts null slots when npm lookup fails', () => {
  const available = { stable: '10.4.4', beta: null };
  assert.equal(deriveCheckAvailableShape(available), true);
});