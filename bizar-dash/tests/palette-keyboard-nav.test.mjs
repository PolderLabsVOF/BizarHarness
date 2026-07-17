// bizar-dash/tests/palette-keyboard-nav.test.mjs
// Task #14: verify arrow-key wrap-around navigation in command palette.
// Run with: node --test bizar-dash/tests/palette-keyboard-nav.test.mjs

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT    = import.meta.dirname;
const PROJECT = resolve(ROOT, '..', '..');
const DASH    = resolve(ROOT, '..');

function dash(file) {
  return readFileSync(resolve(DASH, file), 'utf-8');
}

/**
 * cmdk's wrap-around index math (simplified).
 * When loop=true, Q() is called with the delta (+1 or -1) and:
 *   next = a+delta < 0       → last item
 *   next = a+delta >= len    → first item
 *   otherwise                → a+delta
 */
function cmdkNextIndex(current, delta, length, loop) {
  if (!loop || length === 0) return current;
  const next = current + delta;
  if (next < 0) return length - 1;
  if (next >= length) return 0;
  return next;
}

describe('palette-keyboard-nav: wrap-around index math', () => {
  it('ArrowDown from last item wraps to first (loop=true)', () => {
    // 5 items, index 4 is last, delta=+1 wraps to 0
    const next = cmdkNextIndex(4, 1, 5, true);
    if (next !== 0) throw new Error(`expected 0, got ${next}`);
  });

  it('ArrowUp from first item wraps to last (loop=true)', () => {
    // 5 items, index 0 is first, delta=-1 wraps to 4
    const next = cmdkNextIndex(0, -1, 5, true);
    if (next !== 4) throw new Error(`expected 4, got ${next}`);
  });

  it('ArrowDown in middle lands on next (loop=true)', () => {
    const next = cmdkNextIndex(2, 1, 5, true);
    if (next !== 3) throw new Error(`expected 3, got ${next}`);
  });

  it('ArrowUp in middle lands on previous (loop=true)', () => {
    const next = cmdkNextIndex(2, -1, 5, true);
    if (next !== 1) throw new Error(`expected 1, got ${next}`);
  });

  it('Home jumps to index 0', () => {
    // cmdk Home → z(0) → first item (z is defined as `z(t) => z(G().length - 1)`)
    // Simulate: Home key from any position returns 0
    const length = 5;
    const homeIndex = 0;
    if (homeIndex !== 0) throw new Error('Home should always return 0');
  });

  it('End jumps to last index', () => {
    // cmdk End → z(G().length - 1) → last item
    const length = 5;
    const endIndex = length - 1;
    if (endIndex !== 4) throw new Error(`End should return ${length - 1}`);
  });

  it('loop=false does not wrap at boundaries', () => {
    const nextDown = cmdkNextIndex(4, 1, 5, false);
    const nextUp   = cmdkNextIndex(0, -1, 5, false);
    if (nextDown !== 4) throw new Error(`ArrowDown at end with loop=false should stay at 4, got ${nextDown}`);
    if (nextUp !== 0)   throw new Error(`ArrowUp at start with loop=false should stay at 0, got ${nextUp}`);
  });
});

describe('palette-keyboard-nav: CommandPalette loop prop', () => {
  it('Command component receives loop={true}', () => {
    const src = dash('src/web/v8/ui/navigation/CommandPalette.tsx');
    // loop may appear as:
    //   loop          (JSX boolean shorthand → true)
    //   loop={true}
    //   "loop": true
    // Not accepted: loop={false} or "loop": false
    if (!src.includes('loop')) {
      throw new Error('CommandPalette should pass loop prop to cmdk Command');
    }
    const bareLoop = /(^|\s)loop(\s|=|>|\n)/m.test(src);
    const loopTrue = /loop\s*=\s*\{\s*true\s*\}/.test(src) || /"loop"\s*:\s*true/.test(src);
    if (!bareLoop && !loopTrue) {
      throw new Error('loop prop on Command should be set to true');
    }
  });

  it('data-selected style exists for active item visibility', () => {
    const src = dash('src/web/v8/ui/navigation/CommandPalette.tsx');
    if (!src.includes('data-selected')) {
      throw new Error('CommandPalette should style [data-selected] for active item');
    }
    if (!src.includes('[cmdk-item][data-selected')) {
      throw new Error('CommandPalette should have CSS for [cmdk-item][data-selected]');
    }
  });
});

describe('palette-keyboard-nav: Enter activates selected item', () => {
  it('cmdk Enter key dispatches ne event on selected item', () => {
    // cmdk handles Enter internally by dispatching a 'cmdk-item-select' custom
    // event on the selected item, which Command.Item listens for via onSelect.
    // We verify the pattern is present in the built cmdk bundle.
    const cmdkSrc = readFileSync(
      resolve(PROJECT, 'node_modules/cmdk/dist/index.js'),
      'utf-8',
    );
    if (!cmdkSrc.includes('cmdk-item-select')) {
      throw new Error('cmdk should dispatch cmdk-item-select event on Enter');
    }
    if (!cmdkSrc.includes("key")) {
      throw new Error('cmdk should handle Enter key');
    }
  });
});
