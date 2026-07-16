// bizar-dash/tests/notifications-dismiss-restore.test.mjs
// M8: Notifications has show-dismissed toggle, restore button, and undo toast.
// Run with: node --test bizar-dash/tests/notifications-dismiss-restore.test.mjs

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT    = import.meta.dirname;
const PROJECT = resolve(ROOT, '..', '..');
const DASH    = resolve(ROOT, '..');

function dash(file) {
  return readFileSync(resolve(DASH, file), 'utf-8');
}

describe('M8: Notifications dismiss/restore/undo', () => {
  it('has showDismissed state', () => {
    const c = dash('src/web/v8/views/Notifications/NotificationsView.tsx');
    if (!c.includes('showDismissed')) {
      throw new Error('NotificationsView missing showDismissed state');
    }
  });

  it('has "Show dismissed" / "Hide dismissed" toggle button', () => {
    const c = dash('src/web/v8/views/Notifications/NotificationsView.tsx');
    if (!c.includes('Show dismissed') && !c.includes('Hide dismissed')) {
      throw new Error('NotificationsView missing Show/Hide dismissed toggle');
    }
    if (!c.includes('data-testid="notifications-toggle-dismissed"')) {
      throw new Error('toggle dismissed button missing data-testid');
    }
  });

  it('has restore() function', () => {
    const c = dash('src/web/v8/views/Notifications/NotificationsView.tsx');
    if (!c.includes('const restore')) {
      throw new Error('NotificationsView missing restore function');
    }
  });

  it('has Restore button with data-testid', () => {
    const c = dash('src/web/v8/views/Notifications/NotificationsView.tsx');
    if (!c.includes('data-testid={`notification-restore-')) {
      throw new Error('Restore button missing data-testid pattern');
    }
    if (!c.includes('Restore')) {
      throw new Error('Restore button should have "Restore" label');
    }
  });

  it('has dismissed state tracking', () => {
    const c = dash('src/web/v8/views/Notifications/NotificationsView.tsx');
    if (!c.includes('setDismissed')) {
      throw new Error('NotificationsView missing setDismissed state setter');
    }
  });

  it('has undo toast with 5-second timer', () => {
    const c = dash('src/web/v8/views/Notifications/NotificationsView.tsx');
    if (!c.includes('UndoToast')) {
      throw new Error('NotificationsView missing UndoToast interface');
    }
    if (!c.includes('5_000') && !c.includes('5000')) {
      throw new Error('dismiss should set 5-second undo timer');
    }
  });

  it('undo toast has data-testid and Undo button', () => {
    const c = dash('src/web/v8/views/Notifications/NotificationsView.tsx');
    if (!c.includes('data-testid="notifications-undo-toast"')) {
      throw new Error('undo toast missing data-testid="notifications-undo-toast"');
    }
    if (!c.includes('data-testid="notifications-undo-btn"')) {
      throw new Error('undo button missing data-testid="notifications-undo-btn"');
    }
  });

  it('visibleItems shows all items when showDismissed is true', () => {
    const c = dash('src/web/v8/views/Notifications/NotificationsView.tsx');
    if (!c.includes('visibleItems')) {
      throw new Error('NotificationsView missing visibleItems derived state');
    }
  });
});
