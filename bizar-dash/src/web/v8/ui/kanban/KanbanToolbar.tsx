import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Plus, Search, Trash2, Archive, ArrowRight, X, Filter } from 'lucide-react';
import { Button } from '../controls/Button.js';
import { IconButton } from '../controls/IconButton.js';
import { cx } from '../utils/cx.js';

/**
 * KanbanToolbar — top-of-board toolbar.
 *
 * Three modes:
 *   - normal:   search input + filter chips + "New task" button.
 *   - selecting: replaces the action row with N-selected count +
 *                bulk-actions (Move / Archive / Delete).
 *   - filtered: shows a "Clear filters" pill next to the search.
 *
 * Consumers control query state via callbacks. The toolbar keeps no
 * internal search/filter state of its own — that lives in the view
 * so the board can re-derive visible cards.
 */

export interface KanbanFilter {
  /** Stable filter id; used as the chip key + for clearing. */
  id: string;
  /** Visible chip label (e.g. "High priority"). */
  label: ReactNode;
  /** Optional tone for the chip. */
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
}

export interface KanbanToolbarProps {
  /** Total number of cards on the board (for "showing X of Y"). */
  totalCount: number;
  /** Number of cards currently visible after filtering. */
  visibleCount: number;
  /** Number of selected cards. When >0, the toolbar swaps to bulk mode. */
  selectedCount: number;

  /** Free-text search. */
  query: string;
  onQueryChange: (value: string) => void;

  /** Active filters. */
  filters: readonly KanbanFilter[];
  onFilterToggle: (filterId: string) => void;
  onClearFilters: () => void;

  /** New-task action. Hidden when the toolbar is in bulk mode. */
  onNewTask?: () => void;

  /** Bulk actions, shown only when selectedCount > 0. */
  onBulkMove?: (selectedIds: ReadonlySet<string>) => void;
  onBulkArchive?: (selectedIds: ReadonlySet<string>) => void;
  onBulkDelete?: (selectedIds: ReadonlySet<string>) => void;
  onClearSelection?: () => void;

  className?: string;
}

export function KanbanToolbar(props: KanbanToolbarProps): JSX.Element {
  const {
    totalCount,
    visibleCount,
    selectedCount,
    query,
    onQueryChange,
    filters,
    onFilterToggle,
    onClearFilters,
    onNewTask,
    onBulkMove,
    onBulkArchive,
    onBulkDelete,
    onClearSelection,
    className,
  } = props;

  const [searchFocused, setSearchFocused] = useState(false);
  const isBulk = selectedCount > 0;

  return (
    <div
      className={cx('v8-kanban-toolbar', className)}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--surface-0)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      {isBulk ? (
        <>
          <span
            style={{
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              color: 'var(--fg)',
            }}
          >
            {selectedCount} selected
          </span>
          <span style={{ flex: 1 }} />
          {onBulkMove !== undefined && (
            <Button size="sm" variant="secondary" leftIcon={<ArrowRight size={14} aria-hidden="true" />} onClick={() => onBulkMove(new Set())}>
              Move…
            </Button>
          )}
          {onBulkArchive !== undefined && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Archive size={14} aria-hidden="true" />}
              onClick={() => onBulkArchive(new Set())}
            >
              Archive
            </Button>
          )}
          {onBulkDelete !== undefined && (
            <Button
              size="sm"
              variant="danger"
              leftIcon={<Trash2 size={14} aria-hidden="true" />}
              onClick={() => onBulkDelete(new Set())}
            >
              Delete
            </Button>
          )}
          {onClearSelection !== undefined && (
            <IconButton aria-label="Clear selection" onClick={onClearSelection} size="sm">
              <X size={14} aria-hidden="true" />
            </IconButton>
          )}
        </>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 var(--space-2)',
              height: 32,
              background: 'var(--input-bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              minWidth: 220,
              flex: '1 1 220px',
              maxWidth: 360,
            }}
          >
            <Search size={14} aria-hidden="true" style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
            <input
              type="search"
              value={query}
              placeholder="Filter tasks…"
              onChange={(e: ChangeEvent<HTMLInputElement>) => onQueryChange(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              aria-label="Filter tasks"
              style={{
                flex: 1,
                minWidth: 0,
                border: 0,
                outline: 0,
                background: 'transparent',
                color: 'var(--fg)',
                fontSize: 'var(--fs-13)',
                fontFamily: 'inherit',
              }}
            />
            {query !== '' && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                aria-label="Clear search"
                style={{
                  background: 'transparent',
                  border: 0,
                  padding: 2,
                  color: 'var(--fg-muted)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                }}
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          {filters.length > 0 && (
            <div
              role="toolbar"
              aria-label="Task filters"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                flexWrap: 'wrap',
              }}
            >
              <Filter
                size={12}
                aria-hidden="true"
                style={{ color: 'var(--fg-muted)', marginRight: 2 }}
              />
              {filters.map((f) => {
                const tone = f.tone ?? 'neutral';
                const isActive = f.id.startsWith('active:');
                // Display rule: callers prepend "active:" when toggled on.
                const actualId = isActive ? f.id.slice('active:'.length) : f.id;
                const active = isActive;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onFilterToggle(actualId)}
                    aria-pressed={active}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      height: 26,
                      padding: '0 var(--space-2)',
                      borderRadius: 'var(--radius-pill)',
                      border: `1px solid var(--${active ? 'accent' : 'border'})`,
                      background: active ? 'color-mix(in oklch, var(--accent) 14%, transparent)' : 'transparent',
                      color: 'var(--fg-muted)',
                      fontSize: 'var(--fs-12)',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 'var(--radius-pill)',
                        background:
                          tone === 'neutral'
                            ? 'var(--fg-muted)'
                            : `var(--${tone})`,
                      }}
                    />
                    {f.label}
                  </button>
                );
              })}
              {filters.some((f) => f.id.startsWith('active:')) && (
                <button
                  type="button"
                  onClick={onClearFilters}
                  style={{
                    background: 'transparent',
                    border: 0,
                    color: 'var(--fg-muted)',
                    fontSize: 'var(--fs-12)',
                    cursor: 'pointer',
                    padding: '0 var(--space-2)',
                    height: 26,
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {visibleCount === totalCount
              ? `${totalCount} task${totalCount === 1 ? '' : 's'}`
              : `${visibleCount} of ${totalCount}`}
          </span>
          {onNewTask !== undefined && (
            <Button size="sm" variant="primary" leftIcon={<Plus size={14} aria-hidden="true" />} onClick={onNewTask}>
              New task
            </Button>
          )}
        </>
      )}
    </div>
  );
}
