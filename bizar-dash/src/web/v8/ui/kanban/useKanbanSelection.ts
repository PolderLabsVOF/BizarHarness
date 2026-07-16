import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * useKanbanSelection — track a Set<string> of selected card ids with
 * a small set of helpers, plus an Esc-to-clear keyboard shortcut.
 *
 * Designed for the kanban board's multi-select toolbar. Selection is
 * kept in component state so the board can hand it to the toolbar +
 * card checkbox without prop-drilling.
 */

export interface UseKanbanSelectionApi {
  /** Current selection. Use `.size` for the count. */
  selected: ReadonlySet<string>;
  /** True iff `id` is in the selection. */
  has: (id: string) => boolean;
  /** Add or remove a single id. */
  toggle: (id: string) => void;
  /** Add ids (no-op if already present). */
  add: (ids: readonly string[]) => void;
  /** Remove ids. */
  remove: (ids: readonly string[]) => void;
  /** Replace the whole selection. */
  set: (ids: readonly string[]) => void;
  /** Drop everything. */
  clear: () => void;
}

export function useKanbanSelection(): UseKanbanSelectionApi {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const add = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const remove = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const set = useCallback((ids: readonly string[]) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  // Esc clears selection, but only when focus is not inside a text
  // input/textarea/contenteditable (so the user can still press Esc
  // inside an editor).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear]);

  const has = useCallback((id: string) => selected.has(id), [selected]);

  return useMemo(
    () => ({ selected, has, toggle, add, remove, set, clear }),
    [selected, has, toggle, add, remove, set, clear],
  );
}
