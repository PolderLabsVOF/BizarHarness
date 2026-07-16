// Tests L4 — focus-visible CSS rule exists for custom buttons + sidebar items.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cssPath = resolve(import.meta.dirname, '../src/web/v8/ui/styles/globals.css');
const css = readFileSync(cssPath, 'utf8');

test('globals.css defines a focus-visible ring for .v8-btn', () => {
  assert.match(css, /\.v8-btn:focus-visible/);
});

test('globals.css defines a focus-visible ring for .v8-button', () => {
  assert.match(css, /\.v8-button:focus-visible/);
});

test('globals.css defines a focus-visible ring for sidebar section toggle', () => {
  assert.match(css, /button\[data-section-toggle\]:focus-visible/);
});

test('globals.css defines a focus-visible ring for sidebar nav item', () => {
  assert.match(css, /button\[data-nav-item\]:focus-visible/);
});

test('focus rule uses outline + outline-offset (visible keyboard affordance)', () => {
  assert.match(css, /outline:\s*2px solid var\(--accent\)/);
  assert.match(css, /outline-offset:\s*2px/);
});
