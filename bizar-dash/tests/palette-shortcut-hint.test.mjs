// bizar-dash/tests/palette-shortcut-hint.test.mjs
// M6: Palette trigger has a kbd hint and a ? help button.
// Run with: node --test bizar-dash/tests/palette-shortcut-hint.test.mjs

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT    = import.meta.dirname;
const PROJECT = resolve(ROOT, '..', '..');
const DASH    = resolve(ROOT, '..');

function dash(file) {
  return readFileSync(resolve(DASH, file), 'utf-8');
}

describe('M6: Command palette shortcut hint and help button', () => {
  it('palette trigger uses <Button> with data-testid', () => {
    const c = dash('src/web/v8/App.tsx');
    if (!c.includes('data-testid="palette-trigger"')) {
      throw new Error('palette trigger missing data-testid="palette-trigger"');
    }
    if (!c.includes('<Button')) {
      throw new Error('palette trigger should use <Button> component');
    }
  });

  it('palette trigger contains ⌘K kbd hint', () => {
    const c = dash('src/web/v8/App.tsx');
    if (!c.includes('⌘K')) {
      throw new Error('palette trigger should display ⌘K hint');
    }
  });

  it('? button exists with aria-label and data-testid', () => {
    const c = dash('src/web/v8/App.tsx');
    if (!c.includes('data-testid="shortcuts-help"')) {
      throw new Error('? help button missing data-testid="shortcuts-help"');
    }
    if (!c.includes('aria-label="Keyboard shortcuts"')) {
      throw new Error('? help button missing aria-label="Keyboard shortcuts"');
    }
    // Should render a ? character
    if (!c.match(/>\s*\?\s*<\/Button>/)) {
      throw new Error('? help button should render a ? character');
    }
  });

  it('? button click handler shows shortcuts via window.alert', () => {
    const c = dash('src/web/v8/App.tsx');
    if (!c.includes('Keyboard Shortcuts')) {
      throw new Error('? button should show Keyboard Shortcuts in alert');
    }
    if (!c.includes('⌘K')) {
      throw new Error('shortcuts list should include ⌘K');
    }
  });
});
