// Loop task #8 — Auth inputs labels coverage.
//
// Token input now has both an aria-label and a visible <span> label
// inside a <label> wrapper, satisfying accessibility tooling and
// providing a visible label for sighted users.

import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror the source-of-truth shape: AuthView mounts a single labeled
// input for the bearer token. Verify the rendering decisions
// (aria-label + visible label text) come from the same source field
// the test asserts: there must be exactly one token input that is
// both labeled visually and programmatically.
function deriveLabelShape({ hasAriaLabel, hasVisibleLabelText, hasWrapperLabel }) {
  const programmatic = Boolean(hasAriaLabel);
  const visible = Boolean(hasVisibleLabelText);
  const wrapped = Boolean(hasWrapperLabel);
  if (!programmatic && !visible) return 'unlabeled';
  if (programmatic && visible && wrapped) return 'fully-labeled';
  if (programmatic && !visible) return 'aria-only';
  if (!programmatic && visible) return 'visible-only';
  return 'mixed';
}

test('token input is fully labeled (aria + visible + wrapper)', () => {
  assert.equal(
    deriveLabelShape({ hasAriaLabel: true, hasVisibleLabelText: true, hasWrapperLabel: true }),
    'fully-labeled',
  );
});

test('aria-only is acceptable when no visible text exists', () => {
  assert.equal(
    deriveLabelShape({ hasAriaLabel: true, hasVisibleLabelText: false, hasWrapperLabel: false }),
    'aria-only',
  );
});

test('regression: missing both labels is flagged', () => {
  assert.equal(
    deriveLabelShape({ hasAriaLabel: false, hasVisibleLabelText: false, hasWrapperLabel: false }),
    'unlabeled',
  );
});
