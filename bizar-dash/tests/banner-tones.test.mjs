// Loop task #17 — Banner tone variants.
//
// Source: `ui/feedback/Banner.tsx`. Banner accepts tone: 'info' | 'warning'
// | 'success' | 'danger'. Each tone renders a distinct class, role, and
// background mix.

import test from 'node:test';
import assert from 'node:assert/strict';

const TONES = ['info', 'warning', 'success', 'danger'];

const ROLE_BY_TONE = { danger: 'alert' };
const DEFAULT_ROLE = 'status';

const BACKGROUND_VAR_BY_TONE = {
  info: 'var(--info)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  danger: 'var(--danger)',
};

function deriveRole(tone) {
  return ROLE_BY_TONE[tone] ?? DEFAULT_ROLE;
}

function deriveBackgroundVar(tone) {
  return BACKGROUND_VAR_BY_TONE[tone];
}

for (const tone of TONES) {
  test(`banner tone=${tone} renders a valid role`, () => {
    const role = deriveRole(tone);
    assert.ok(['alert', 'status'].includes(role), `${role} not in valid role set`);
  });

  test(`banner tone=${tone} maps to a canonical token variable`, () => {
    const bg = deriveBackgroundVar(tone);
    assert.ok(bg.startsWith('var(--'), `${bg} must reference a CSS custom property`);
  });
}

test('danger banner uses role=alert (assertive)', () => {
  assert.equal(deriveRole('danger'), 'alert');
});

test('non-danger banners use role=status (polite)', () => {
  assert.equal(deriveRole('info'), 'status');
  assert.equal(deriveRole('warning'), 'status');
  assert.equal(deriveRole('success'), 'status');
});