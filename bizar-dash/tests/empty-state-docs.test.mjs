// bizar-dash/tests/empty-state-docs.test.mjs
// M7: Empty-state cards in Artifacts/Dialogs/Voice/Clipboard/Misc explain the surface.
// Run with: node --test bizar-dash/tests/empty-state-docs.test.mjs

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT    = import.meta.dirname;
const PROJECT = resolve(ROOT, '..', '..');
const DASH    = resolve(ROOT, '..');

function dash(file) {
  return readFileSync(resolve(DASH, file), 'utf-8');
}

describe('M7: Empty-state descriptions explain each surface', () => {
  it('ArtifactsView: description explains generated code artifacts', () => {
    const c = dash('src/web/v8/views/Artifacts/ArtifactsView.tsx');
    if (!c.includes('generated code')) {
      throw new Error('ArtifactsView empty state should explain artifacts are generated code');
    }
  });

  it('DialogsView: description explains agent prompts/confirmations', () => {
    const c = dash('src/web/v8/views/Dialogs/DialogsView.tsx');
    if (!c.includes('agent raises') && !c.includes('user input')) {
      throw new Error('DialogsView empty state should explain agent prompts/confirmations');
    }
  });

  it('VoiceView: description explains audio capture purpose', () => {
    const c = dash('src/web/v8/views/Voice/VoiceView.tsx');
    if (!c.includes('audio recording') && !c.includes('hands-free')) {
      throw new Error('VoiceView empty state should explain audio capture purpose');
    }
  });

  it('ClipboardView: description explains saved clips become markdown notes', () => {
    const c = dash('src/web/v8/views/Clipboard/ClipboardView.tsx');
    if (!c.includes('markdown note') && !c.includes('clips/')) {
      throw new Error('ClipboardView empty state should explain clips become markdown notes');
    }
  });

  it('MiscView: description explains global search + Tailscale', () => {
    const c = dash('src/web/v8/views/Misc/MiscView.tsx');
    if (!c.includes('Global fuzzy search')) {
      throw new Error('MiscView description should mention global search');
    }
    if (!c.includes('Tailscale')) {
      throw new Error('MiscView description should mention Tailscale');
    }
  });
});
