import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * KanbanQuickAdd — inline card composer at the bottom of a column.
 *
 * Two states:
 *   - idle: shows a "+ Add task" affordance.
 *   - editing: shows a textarea with submit/cancel.
 *
 * On submit, the typed title is reported via onAdd and the field clears.
 */

export interface KanbanQuickAddProps {
  /** Called when the user submits a new card title. */
  onAdd: (title: string) => void;
  /** Placeholder shown in the textarea. */
  placeholder?: string;
  /** Optional label for the idle button. */
  addLabel?: ReactNode;
  className?: string;
}

export function KanbanQuickAdd({
  onAdd,
  placeholder = 'Task title…',
  addLabel = 'Add task',
  className,
}: KanbanQuickAddProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const submit = () => {
    const title = value.trim();
    if (title === '') return;
    onAdd(title);
    setValue('');
    // Keep the editor open so users can add multiple in a row.
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
      setValue('');
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cx('v8-kanban-quick-add v8-kanban-quick-add--idle', className)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          width: '100%',
          padding: 'var(--space-2) var(--space-3)',
          background: 'transparent',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius)',
          color: 'var(--fg-muted)',
          fontSize: 'var(--fs-13)',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <Plus size={14} aria-hidden="true" />
        {addLabel}
      </button>
    );
  }

  return (
    <div
      className={cx('v8-kanban-quick-add v8-kanban-quick-add--editing', className)}
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-2)',
      }}
    >
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        rows={2}
        style={{
          width: '100%',
          border: 0,
          outline: 0,
          background: 'transparent',
          resize: 'none',
          fontFamily: 'inherit',
          fontSize: 'var(--fs-13)',
          color: 'var(--fg)',
          lineHeight: 'var(--lh-snug)',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
          marginTop: 'var(--space-2)',
        }}
      >
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)' }}>
          <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>↵</kbd> add ·{' '}
          <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>Esc</kbd> cancel
        </span>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setValue('');
          }}
          style={{
            background: 'transparent',
            border: 0,
            fontSize: 'var(--fs-12)',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}