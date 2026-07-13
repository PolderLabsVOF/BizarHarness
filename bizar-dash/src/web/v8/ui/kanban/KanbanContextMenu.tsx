import { type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '../feedback/ContextMenu.js';
import {
  Copy,
  Trash2,
  Archive,
  ArrowRight,
  ArrowLeft,
  Pencil,
  Eye,
  Link as LinkIcon,
  UserPlus,
} from 'lucide-react';

/**
 * KanbanContextMenu — the right-click menu every kanban card gets.
 *
 * Per DESIGN.md Rule #1, EVERY card must right-click. This is the
 * standard menu: Open, Rename, Duplicate, Move (left/right), Copy link,
 * Assign, Archive, Delete.
 *
 * Callers can extend with `extraItems` between Move and Archive for
 * card-specific actions (e.g. "Run agent", "Open in agent").
 */

export interface KanbanContextMenuProps {
  /** The card content (the visible card surface). */
  children: ReactNode;
  onOpen?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onCopyLink?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onAssign?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  /** Whether "move left" is available (not the leftmost column). */
  canMoveLeft?: boolean;
  /** Whether "move right" is available (not the rightmost column). */
  canMoveRight?: boolean;
  /** Optional card-specific items rendered between Move and Archive. */
  extraItems?: ReactNode;
}

export function KanbanContextMenu(props: KanbanContextMenuProps) {
  const {
    children,
    onOpen,
    onRename,
    onDuplicate,
    onCopyLink,
    onMoveLeft,
    onMoveRight,
    onAssign,
    onArchive,
    onDelete,
    canMoveLeft = true,
    canMoveRight = true,
    extraItems,
  } = props;

  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>Task</ContextMenuLabel>
        <ContextMenuItem leftIcon={<Eye size={14} aria-hidden="true" />} onSelect={onOpen}>
          Open detail
        </ContextMenuItem>
        <ContextMenuItem leftIcon={<Pencil size={14} aria-hidden="true" />} onSelect={onRename}>
          Rename
          <kbd style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10 }}>F2</kbd>
        </ContextMenuItem>
        <ContextMenuItem leftIcon={<Copy size={14} aria-hidden="true" />} onSelect={onDuplicate}>
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem leftIcon={<LinkIcon size={14} aria-hidden="true" />} onSelect={onCopyLink}>
          Copy link
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuLabel>Move</ContextMenuLabel>
        <ContextMenuItem
          leftIcon={<ArrowLeft size={14} aria-hidden="true" />}
          disabled={canMoveLeft === false}
          onSelect={onMoveLeft}
        >
          Move to previous column
          <kbd style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10 }}>←</kbd>
        </ContextMenuItem>
        <ContextMenuItem
          leftIcon={<ArrowRight size={14} aria-hidden="true" />}
          disabled={canMoveRight === false}
          onSelect={onMoveRight}
        >
          Move to next column
          <kbd style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10 }}>→</kbd>
        </ContextMenuItem>
        {extraItems}
        <ContextMenuSeparator />
        <ContextMenuItem leftIcon={<UserPlus size={14} aria-hidden="true" />} onSelect={onAssign}>
          Assign…
        </ContextMenuItem>
        <ContextMenuItem leftIcon={<Archive size={14} aria-hidden="true" />} onSelect={onArchive}>
          Archive
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          leftIcon={<Trash2 size={14} aria-hidden="true" />}
          danger
          onSelect={onDelete}
        >
          Delete
          <kbd style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10 }}>⌫</kbd>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}