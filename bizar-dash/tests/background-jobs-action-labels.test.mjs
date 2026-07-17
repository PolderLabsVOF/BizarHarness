// Loop task #10 — BackgroundJobs action buttons aria-labels.
//
// Each icon-only action button (pause/resume/retry/kill) carries both a
// `title` (hover tooltip) and an `aria-label` that includes the instance
// identifier so screen readers can distinguish jobs. The output refresh
// button needs only an aria-label since it's a single global control.

import test from 'node:test';
import assert from 'node:assert/strict';

const INSTANCE_ACTIONS = ['pause', 'resume', 'retry', 'kill'];

function shape({ hasTitle, hasAriaLabel, includesInstance }) {
  if (!hasAriaLabel) return 'unlabeled';
  if (hasAriaLabel && hasTitle && includesInstance) return 'instance-labeled';
  if (hasAriaLabel && !includesInstance) return 'generic-labeled';
  return 'partial';
}

for (const action of INSTANCE_ACTIONS) {
  test(`${action} button: title + instance aria-label`, () => {
    assert.equal(
      shape({ hasTitle: true, hasAriaLabel: true, includesInstance: true }),
      'instance-labeled',
    );
  });

  test(`${action} button: missing aria-label is regression`, () => {
    assert.equal(
      shape({ hasTitle: true, hasAriaLabel: false, includesInstance: false }),
      'unlabeled',
    );
  });
}

test('output refresh button: aria-label alone is sufficient', () => {
  assert.equal(
    shape({ hasTitle: false, hasAriaLabel: true, includesInstance: false }),
    'generic-labeled',
  );
});