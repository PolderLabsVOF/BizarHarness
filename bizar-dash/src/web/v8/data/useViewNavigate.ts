import { useCallback } from 'react';

/**
 * useViewNavigate — fire-and-forget view router navigation.
 *
 * The v8 dashboard owns `activeId` state inside `App.tsx`. Components deep
 * in the tree (e.g. `ActivityLane` rows inside `ActivityView`) need to
 * switch the active view without prop-drilling. This hook dispatches a
 * `bizar:navigate` `CustomEvent` on `window` that `App.tsx` listens for
 * and forwards to its `setActiveId` setter.
 *
 * Event shape:
 *   { id: string; detail?: { entity?: string; slug?: string } }
 *
 * The receiving view may read `entity`/`slug` from `useLocation().hash` or
 * its own props — the event itself is intentionally minimal.
 */

declare global {
  interface WindowEventMap {
    'bizar:navigate': CustomEvent<{ id: string; entity?: string; slug?: string }>;
  }
}

export interface ViewNavigateDetail {
  id: string;
  entity?: string;
  slug?: string;
}

export function useViewNavigate(): (detail: ViewNavigateDetail) => void {
  return useCallback((detail: ViewNavigateDetail) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('bizar:navigate', { detail }));
  }, []);
}

/**
 * Map an `ActivityEvent` (kind + slug) to a target view id + entity scope.
 *
 * Returns `null` when no specific target is known — the caller should
 * still dispatch the event so the user lands somewhere useful, but
 * `null` means "no specific deep-link scope".
 */
export function activityTarget(kind: string | undefined, slug: string | undefined): ViewNavigateDetail | null {
  const k = (kind || '').toLowerCase();
  const s = slug || '';
  if (k.startsWith('task')) return { id: 'tasks', entity: s };
  if (k.startsWith('goal')) return { id: 'goals', entity: s };
  if (k.startsWith('agent')) return { id: 'agents', entity: s };
  if (k === 'artifact.new' || k.startsWith('artifact')) return { id: 'artifacts', entity: s };
  if (k.startsWith('git')) return { id: 'git', entity: s };
  return null;
}
