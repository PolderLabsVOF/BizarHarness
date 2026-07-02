// src/components/chat/SessionRowMenu.tsx — three-mode popover for a session rail row.
//
// Three modes:
//   'main'           — Rename + Delete buttons
//   'rename'         — Inline input with Cancel/Save
//   'confirm-delete' — Inline confirmation with Cancel/Delete
//
// Rendered via createPortal on document.body so it isn't clipped by
// the rail's overflow:auto scroll container. The parent row supplies
// the anchor's bounding rect (or the menu uses an anchor prop).

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Edit, Trash2 } from 'lucide-react';

export type SessionMenuMode = 'main' | 'rename' | 'confirm-delete';

export interface SessionRowMenuAnchor {
  /** Bounding rect of the trigger / row used to position the popover. */
  rect: DOMRect;
}

export interface SessionRowMenuProps {
  session: { id: string; title: string };
  mode: SessionMenuMode;
  anchor: SessionRowMenuAnchor;
  renameDraft: string;
  setRenameDraft: (s: string) => void;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onConfirmDelete: () => void;
  onConfirmRename: () => void;
  onClose: () => void;
}

export function SessionRowMenu({
  session,
  mode,
  anchor,
  renameDraft,
  setRenameDraft,
  onEdit,
  onDeleteRequest,
  onConfirmDelete,
  onConfirmRename,
  onClose,
}: SessionRowMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Position the popover just below the row's right edge.
  const top = Math.round(anchor.rect.bottom + 2);
  const right = Math.max(8, Math.round(window.innerWidth - anchor.rect.right));

  // Close on outside click + Esc.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!ref.current || !t) return;
      if (ref.current.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Defer attaching the outside-click handler so the click that opened
    // the menu doesn't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Auto-focus the rename input when entering rename mode.
  useEffect(() => {
    if (mode !== 'rename') return;
    const id = window.setTimeout(() => {
      const input = ref.current?.querySelector<HTMLInputElement>('input.session-row-menu-input');
      input?.focus();
      input?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [mode]);

  const body = (
    <div
      ref={ref}
      className="session-row-menu"
      role="menu"
      aria-label={`Options for ${session.title}`}
      style={{ position: 'fixed', top, right }}
      onClick={(e) => e.stopPropagation()}
    >
      {mode === 'main' && (
        <>
          <button
            type="button"
            className="session-row-menu-item"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Edit size={13} aria-hidden />
            <span>Rename</span>
            <kbd>R</kbd>
          </button>
          <button
            type="button"
            className="session-row-menu-item session-row-menu-item-danger"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteRequest();
            }}
          >
            <Trash2 size={13} aria-hidden />
            <span>Delete</span>
            <kbd>⌫</kbd>
          </button>
        </>
      )}
      {mode === 'rename' && (
        <div className="session-row-menu-inline">
          <div className="session-row-menu-inline-label chat-mono">Rename session</div>
          <input
            type="text"
            className="session-row-menu-input"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onConfirmRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label="New session name"
          />
          <div className="session-row-menu-inline-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                onConfirmRename();
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
      {mode === 'confirm-delete' && (
        <div className="session-row-menu-inline">
          <div className="session-row-menu-inline-label chat-mono">Delete this session?</div>
          <div className="session-row-menu-inline-message">
            "{session.title}" and its sub-agents will be removed.
          </div>
          <div className="session-row-menu-inline-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={(e) => {
                e.stopPropagation();
                onConfirmDelete();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(body, document.body);
}