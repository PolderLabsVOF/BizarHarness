// bizar-dash/tests/frontend-bugfixes.test.mjs
// Lightweight verification of dashboard web + build bug fixes.
// Run with: node --test bizar-dash/tests/frontend-bugfixes.test.mjs

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

// import.meta.dirname = /.../BizarHarness/bizar-dash/tests
// So project root is up 2 levels
const ROOT    = import.meta.dirname;                              // .../BizarHarness/bizar-dash/tests
const PROJECT = resolve(ROOT, '..', '..');                        // .../BizarHarness/
const DASH    = resolve(ROOT, '..');                             // .../BizarHarness/bizar-dash/

function read(file) {
  return readFileSync(resolve(PROJECT, file), 'utf-8');
}
function dash(file) {
  return readFileSync(resolve(DASH, file), 'utf-8');
}

describe('W1: vite.config.ts sourcemap: hidden', () => {
  it("sourcemap is 'hidden'", () => {
    const content = read('vite.config.ts');
    if (!content.includes("sourcemap: 'hidden'")) {
      throw new Error("vite.config.ts missing sourcemap: 'hidden'");
    }
    if (content.includes('sourcemap: true')) {
      throw new Error('vite.config.ts still contains sourcemap: true');
    }
  });
});

describe('W2: .npmignore excludes source maps and tests', () => {
  it('excludes .map files from dist', () => {
    const c = read('.npmignore');
    if (!c.includes('bizar-dash/dist/**/*.map')) throw new Error('.npmignore missing bizar-dash/dist/**/*.map');
  });
  it('excludes **/__tests__/', () => {
    const c = read('.npmignore');
    if (!c.includes('**/__tests__/')) throw new Error('.npmignore missing **/__tests__/');
  });
  it('excludes **/*.test.mjs', () => {
    const c = read('.npmignore');
    if (!c.includes('**/*.test.mjs')) throw new Error('.npmignore missing **/*.test.mjs');
  });
  it('excludes **/*.test.ts', () => {
    const c = read('.npmignore');
    if (!c.includes('**/*.test.ts')) throw new Error('.npmignore missing **/*.test.ts');
  });
  it('excludes **/*.test.tsx', () => {
    const c = read('.npmignore');
    if (!c.includes('**/*.test.tsx')) throw new Error('.npmignore missing **/*.test.tsx');
  });
});

describe('W3: Toast.tsx accessibility', () => {
  it('ToastItem has role="alert"', () => {
    const c = dash('src/web/components/Toast.tsx');
    if (!c.includes('role="alert"')) throw new Error('Toast.tsx missing role="alert"');
  });
  it('ToastItem has aria-live="assertive"', () => {
    const c = dash('src/web/components/Toast.tsx');
    if (!c.includes('aria-live="assertive"')) throw new Error('Toast.tsx missing aria-live="assertive"');
  });
  it('ToastItem has aria-atomic="true"', () => {
    const c = dash('src/web/components/Toast.tsx');
    if (!c.includes('aria-atomic="true"')) throw new Error('Toast.tsx missing aria-atomic="true"');
  });
});

describe('W4: App.tsx Suspense wrapper', () => {
  it('Suspense imported from react', () => {
    const c = dash('src/web/App.tsx');
    if (!c.includes('Suspense')) throw new Error('App.tsx missing Suspense import');
  });
  it('renderedView wrapped in Suspense', () => {
    const c = dash('src/web/App.tsx');
    if (!c.includes('<Suspense')) throw new Error('App.tsx missing <Suspense> wrapper');
  });
});

describe('W5: React.memo on view components', () => {
  const views = [
    ['Tasks',       dash('src/web/views/Tasks.tsx')],
    ['Settings',    dash('src/web/views/Settings.tsx')],
    ['Memory',      dash('src/web/views/Memory.tsx')],
    ['Overview',    dash('src/web/views/Overview.tsx')],
    ['Skills',      dash('src/web/views/Skills.tsx')],
    ['MiniMaxUsage',dash('src/web/views/MiniMaxUsage.tsx')],
  ];
  for (const [name, content] of views) {
    it(`${name} is wrapped in React.memo`, () => {
      // Pattern: const Name = React.memo(...) or export const Name = React.memo(...)
      if (!content.includes('React.memo(')) {
        throw new Error(`${name} is not wrapped in React.memo`);
      }
    });
  }
});

describe('W6: Topbar ARIA roles', () => {
  const c = dash('src/web/components/Topbar.tsx');
  it('tabs-row has role="tablist"', () => { if (!c.includes('role="tablist"')) throw new Error('Topbar missing role="tablist"'); });
  it('tabs-row has aria-label="Primary tabs"', () => { if (!c.includes('aria-label="Primary tabs"')) throw new Error('Topbar missing aria-label="Primary tabs"'); });
  it('tab buttons have role="tab"', () => { if (!c.includes('role="tab"')) throw new Error('Topbar missing role="tab"'); });
  it('tab buttons have aria-selected', () => { if (!c.includes('aria-selected=')) throw new Error('Topbar missing aria-selected on tabs'); });
});

describe('F1: Manual snapshot refetch removed from file change WS event', () => {
  it("'change' WS handler no longer calls api.get('/snapshot')", () => {
    const c = dash('src/web/App.tsx');
    const idx = c.indexOf("msg.type === 'change'");
    if (idx === -1) throw new Error("msg.type === 'change' not found");
    const block = c.slice(idx, idx + 600);
    if (block.includes("api.get<Snapshot>('/snapshot')") || block.includes('api.get("/snapshot")')) {
      throw new Error("Manual api.get('/snapshot') still present in 'change' handler");
    }
  });
});

describe('F2: content-visibility: auto on list items', () => {
  it('.activity-item has content-visibility: auto (main.css)', () => {
    const c = dash('src/web/styles/main.css');
    const i = c.indexOf('.activity-item');
    if (!c.slice(i, i + 500).includes('content-visibility: auto')) {
      throw new Error('.activity-item missing content-visibility: auto in main.css');
    }
  });
  it('.task-card has content-visibility: auto (main.css)', () => {
    const c = dash('src/web/styles/main.css');
    const i = c.indexOf('.task-card');
    if (!c.slice(i, i + 500).includes('content-visibility: auto')) {
      throw new Error('.task-card missing content-visibility: auto in main.css');
    }
  });
  it('.chat-message has content-visibility: auto (chat.css)', () => {
    const c = dash('src/web/styles/chat.css');
    const i = c.indexOf('.chat-message');
    if (!c.slice(i, i + 300).includes('content-visibility: auto')) {
      throw new Error('.chat-message missing content-visibility: auto in chat.css');
    }
  });
  it('.task-card has content-visibility: auto (tasks.css)', () => {
    const c = dash('src/web/styles/tasks.css');
    const i = c.indexOf('.task-card');
    if (!c.slice(i, i + 500).includes('content-visibility: auto')) {
      throw new Error('.task-card missing content-visibility: auto in tasks.css');
    }
  });
});
