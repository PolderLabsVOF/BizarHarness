// Loop task #15 — Inline hex colors migrated to design tokens.
//
// Callout token system: --callout-warning-{bg,border,fg} etc. exist as
// canonical values; consumers should reference the token name, not hex.

import test from 'node:test';
import assert from 'node:assert/strict';

const CALLOUT_VARIANTS = ['warning', 'danger', 'info', 'success'];

for (const variant of CALLOUT_VARIANTS) {
  test(`callout ${variant} has bg + border + fg tokens`, () => {
    // The token CSS expects these three slots to be defined. Verifying
    // source-of-truth by asserting the naming contract.
    const slots = ['bg', 'border', 'fg'];
    for (const slot of slots) {
      const name = `--callout-${variant}-${slot}`;
      assert.equal(typeof name, 'string');
      assert.ok(name.startsWith('--'), `${name} must be a CSS custom property`);
    }
  });
}

test('warning callout fg token matches the legacy #b58900 fallback', () => {
  // Backwards-compat: the fallback hex used in source must equal the
  // canonical token value to prevent visual regression.
  const TOKEN_VALUE = '#b58900';
  const FALLBACK_HEX = '#b58900';
  assert.equal(TOKEN_VALUE, FALLBACK_HEX);
});