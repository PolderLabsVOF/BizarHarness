/*
 * CommandPalette.tsx — Cmd+K command palette (Wave 2B).
 *
 * Self-contained palette: provides its own overlay, input, results list
 * and keyboard handling. The next Wave 2C Dialog component will replace
 * the overlay/modal wrapper, but the search/filter/keyboard guts stay here
 * because the search UX (fuzzy match, grouping, arrow nav) is intrinsic to
 * the palette rather than the modal primitive.
 *
 * Filter pipeline: input change → fuse.js (weighted across label +
 * description, threshold loose so typos still hit) → group-by-type →
 * flatten into a flat list for arrow-key navigation.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { Search } from 'lucide-react';
import Fuse from 'fuse.js';
import { cx } from '../utils/cx';

export type CommandPaletteItemType =
  | 'agent' | 'task' | 'mod' | 'schedule' | 'project' | 'command' | 'setting';

export type CommandPaletteItem = {
  id: string;
  type: CommandPaletteItemType;
  label: string;
  description?: string;
  icon?: ReactNode;
  shortcut?: string[];
  onSelect: () => void;
};

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  items: CommandPaletteItem[];
  placeholder?: string;
  className?: string;
};

const TYPE_LABELS: Record<CommandPaletteItemType, string> = {
  agent: 'Agents', task: 'Tasks', mod: 'Mods', schedule: 'Schedules',
  project: 'Projects', command: 'Commands', setting: 'Settings',
};
const TYPE_ORDER = Object.keys(TYPE_LABELS) as CommandPaletteItemType[];

type Grouped = Array<readonly [CommandPaletteItemType, CommandPaletteItem[]]>;
type FlatRow = { index: number; item: CommandPaletteItem };

function groupByType(items: CommandPaletteItem[]): Grouped {
  const byType = new Map<CommandPaletteItemType, CommandPaletteItem[]>();
  for (const it of items) {
    const arr = byType.get(it.type) ?? [];
    arr.push(it);
    byType.set(it.type, arr);
  }
  return TYPE_ORDER.flatMap((t) => {
    const arr = byType.get(t);
    return arr && arr.length > 0 ? ([[t, arr]] as const) : [];
  });
}

function flatten(rows: Grouped): FlatRow[] {
  const flat: FlatRow[] = [];
  let i = 0;
  for (const [, items] of rows) for (const it of items) flat.push({ index: i++, item: it });
  return flat;
}

export function CommandPalette({
  open, onClose, items, placeholder = 'Search anything…', className,
}: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const fuse = useMemo(
    () => new Fuse(items, {
      keys: [{ name: 'label', weight: 2 }, { name: 'description', weight: 1 }],
      threshold: 0.4, ignoreLocation: true,
    }),
    [items],
  );

  const grouped = useMemo<Grouped>(() => {
    const base = query.trim() === '' ? items : fuse.search(query).map((r) => r.item);
    return groupByType(base);
  }, [query, items, fuse]);
  const flat = useMemo(() => flatten(grouped), [grouped]);

  // Side-effects: reset on open, clamp activeIndex, focus input, scroll into
  // view, lock body scroll. jsdom lacks scrollIntoView so we guard the call.
  useEffect(() => { if (open) { setQuery(''); setActiveIndex(0); } }, [open]);
  useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(Math.max(0, flat.length - 1));
  }, [flat.length, activeIndex]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-cmdk-index="${activeIndex}"]`,
    );
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const selectIndex = useCallback(
    (i: number) => { const row = flat[i]; if (!row) return; row.item.onSelect(); onClose(); },
    [flat, onClose],
  );
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (flat.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => (i + 1) % flat.length); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => (i - 1 + flat.length) % flat.length); return; }
    if (e.key === 'Enter') { e.preventDefault(); selectIndex(activeIndex); }
  }, [flat.length, activeIndex, onClose, selectIndex]);

  if (!open) return null;

  return (
    <div
      className="bd-cmdk-overlay" role="dialog" aria-modal="true" aria-label="Command palette"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={cx('bd-cmdk', className)} onKeyDown={onKeyDown}>
        <div className="bd-cmdk__input-wrap">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef} className="bd-cmdk__input" value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            placeholder={placeholder} autoComplete="off" spellCheck={false}
          />
          <kbd className="bd-cmdk__kbd-hint">esc</kbd>
        </div>
        <div className="bd-cmdk__results" ref={listRef}>
          {flat.length === 0 ? <div className="bd-cmdk__empty">No results</div> : (
            grouped.map(([type, list]) => (
              <div key={type} className="bd-cmdk__group">
                <div className="bd-cmdk__group-header">{TYPE_LABELS[type]}</div>
                {list.map((item) => {
                  const rowIndex = flat.find((r) => r.item === item)!.index;
                  return <PaletteRow
                    key={item.id}
                    item={item}
                    rowIndex={rowIndex}
                    active={rowIndex === activeIndex}
                    onHover={setActiveIndex}
                    onSelect={selectIndex}
                  />;
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

type PaletteRowProps = {
  item: CommandPaletteItem;
  rowIndex: number;
  active: boolean;
  onHover: (i: number) => void;
  onSelect: (i: number) => void;
};
function PaletteRow({ item, rowIndex, active, onHover, onSelect }: PaletteRowProps): React.JSX.Element {
  return (
    <button
      type="button" data-cmdk-index={rowIndex}
      className={cx('bd-cmdk__item', active && 'bd-cmdk__item--active')}
      onMouseEnter={() => onHover(rowIndex)}
      onClick={() => onSelect(rowIndex)}
    >
      {item.icon && <span className="bd-cmdk__item-icon" aria-hidden="true">{item.icon}</span>}
      <span className="bd-cmdk__item-body">
        <span className="bd-cmdk__item-label">{item.label}</span>
        {item.description && <span className="bd-cmdk__item-description">{item.description}</span>}
      </span>
      {item.shortcut && item.shortcut.length > 0 && (
        <span className="bd-cmdk__item-shortcut">
          {item.shortcut.map((k, i) => <kbd key={`${k}-${i}`}>{k}</kbd>)}
        </span>
      )}
    </button>
  );
}
