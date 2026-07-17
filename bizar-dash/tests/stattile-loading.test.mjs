// Loop task #18 — StatTile loading state.
//
// Source: `ui/data/StatTile.tsx`. When `loading=true`, the value cell
// renders '—' instead of the supplied value. Trend indicator remains
// visible (the source does NOT hide trend on loading).

import test from 'node:test';
import assert from 'node:assert/strict';

function deriveValueDisplay({ loading, value }) {
  return loading === true ? '—' : value;
}

test('loading=true replaces value with em-dash placeholder', () => {
  assert.equal(deriveValueDisplay({ loading: true, value: 42 }), '—');
});

test('loading=false shows the actual value', () => {
  assert.equal(deriveValueDisplay({ loading: false, value: 42 }), 42);
});

test('loading=undefined shows the actual value', () => {
  assert.equal(deriveValueDisplay({ loading: undefined, value: '$1,234' }), '$1,234');
});

test('loading=true with string value still renders em-dash', () => {
  assert.equal(deriveValueDisplay({ loading: true, value: '99.9%' }), '—');
});