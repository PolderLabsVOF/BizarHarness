// bizar-dash/tests/topbar-design-system.test.mjs
// M9: Palette trigger uses design-system <Button> not inline styles.
// Run with: node --test bizar-dash/tests/topbar-design-system.test.mjs

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT    = import.meta.dirname;
const PROJECT = resolve(ROOT, '..', '..');
const DASH    = resolve(ROOT, '..');

function dash(file) {
  return readFileSync(resolve(DASH, file), 'utf-8');
}

describe('M9: Palette trigger uses design-system Button', () => {
  it('App.tsx imports Button from design-system', () => {
    const c = dash('src/web/v8/App.tsx');
    if (!c.includes("import { Button } from './ui/controls/Button.js'")) {
      throw new Error('App.tsx should import Button from design-system');
    }
  });

  it('palette trigger is a <Button> element (not <button> or <div>)', () => {
    const c = dash('src/web/v8/App.tsx');
    // The palette trigger should be a <Button ... data-testid="palette-trigger"
    // NOT a raw <button ... or <div ...
    // Check that after data-testid="palette-trigger" the next significant token is a > closing (i.e. it's a component, not a raw tag)
    const idx = c.indexOf('data-testid="palette-trigger"');
    if (idx === -1) throw new Error('palette trigger data-testid not found');
    // Look for <Button variant= before the closing > — the Button tag should open before the />
    const snippet = c.slice(Math.max(0, idx - 200), idx + 50);
    if (!snippet.includes('<Button')) {
      throw new Error('palette trigger should use <Button> component');
    }
    // Should NOT use raw <button or <div with the palette testid
    const rawButtonIdx = c.indexOf('<button', Math.max(0, idx - 300));
    const rawButtonSnippet = c.slice(rawButtonIdx, idx);
    if (rawButtonSnippet.includes('palette-trigger')) {
      throw new Error('palette trigger still uses raw <button> instead of <Button>');
    }
  });

  it('palette trigger uses variant="ghost" and size="sm"', () => {
    const c = dash('src/web/v8/App.tsx');
    const idx = c.indexOf('data-testid="palette-trigger"');
    const snippet = c.slice(Math.max(0, idx - 300), idx + 30);
    if (!snippet.includes('variant="ghost"')) {
      throw new Error('palette trigger should use variant="ghost"');
    }
    if (!snippet.includes('size="sm"')) {
      throw new Error('palette trigger should use size="sm"');
    }
  });
});
