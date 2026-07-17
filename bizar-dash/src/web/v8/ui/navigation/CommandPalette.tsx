import { useEffect, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * CommandPalette — global ⌘K command palette.
 *
 * Built on cmdk. Renders inside a Dialog overlay (caller wires Dialog +
 * DialogContent + DialogTitle). This component is the palette content.
 *
 * Usage:
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent title="Command palette">
 *       <CommandPalette>
 *         <CommandPaletteGroup heading="Navigation">
 *           <CommandPaletteItem value="go:tasks">Go to Tasks</CommandPaletteItem>
 *         </CommandPaletteGroup>
 *       </CommandPalette>
 *     </DialogContent>
 *   </Dialog>
 *
 * For triggering the dialog with ⌘K, see `useCommandPaletteHotkey`.
 */

export interface CommandPaletteProps {
  query?: string;
  onQueryChange?: (q: string) => void;
  placeholder?: string;
  hideIcon?: boolean;
  emptyMessage?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CommandPalette(props: CommandPaletteProps) {
  const {
    query,
    onQueryChange,
    placeholder = 'Type a command or search…',
    hideIcon,
    emptyMessage = 'No results found.',
    children,
    className,
  } = props;

  return (
    <Command
      className={cx('v8-command', className)}
      label="Command palette"
      shouldFilter
      loop
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {hideIcon !== true && (
          <Search size={14} aria-hidden="true" style={{ color: 'var(--fg-muted)' }} />
        )}
        <Command.Input
          value={query}
          onValueChange={onQueryChange}
          placeholder={placeholder}
          style={{
            flex: 1,
            border: 0,
            outline: 0,
            background: 'transparent',
            fontFamily: 'inherit',
            fontSize: 'var(--fs-14)',
            color: 'var(--fg)',
          }}
        />
      </div>
      <Command.List
        style={{
          maxHeight: 'min(60vh, 480px)',
          overflow: 'auto',
          padding: 'var(--space-2)',
        }}
      >
        <Command.Empty
          style={{
            padding: 'var(--space-6)',
            textAlign: 'center',
            color: 'var(--fg-muted)',
            fontSize: 'var(--fs-13)',
          }}
        >
          {emptyMessage}
        </Command.Empty>
        {children}
      </Command.List>
      <style>{`
        [cmdk-item][data-selected='true'] {
          background: var(--surface-2);
        }
        [cmdk-item][data-disabled='true'] {
          color: var(--fg-subtle);
        }
      `}</style>
    </Command>
  );
}

export interface CommandPaletteGroupProps {
  heading?: ReactNode;
  children: ReactNode;
}

export function CommandPaletteGroup({ heading, children }: CommandPaletteGroupProps) {
  return (
    <Command.Group
      style={{ padding: 'var(--space-1) 0' }}
      heading={typeof heading === 'string' ? heading : undefined}
    >
      {heading !== undefined && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-3) var(--space-1)',
            fontSize: 'var(--fs-12)',
            fontWeight: 600,
            color: 'var(--fg-subtle)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
          }}
        >
          {heading}
        </div>
      )}
      {children}
    </Command.Group>
  );
}

export interface CommandPaletteItemProps {
  value: string;
  children: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  onSelect?: () => void;
}

export function CommandPaletteItem({
  value,
  children,
  shortcut,
  disabled,
  onSelect,
}: CommandPaletteItemProps) {
  return (
    <Command.Item
      value={value}
      disabled={disabled}
      onSelect={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        height: 32,
        padding: '0 var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--fs-13)',
        color: 'var(--fg)',
        cursor: disabled === true ? 'not-allowed' : 'pointer',
        userSelect: 'none',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {shortcut !== undefined && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-12)',
            color: 'var(--fg-muted)',
          }}
        >
          {shortcut}
        </span>
      )}
    </Command.Item>
  );
}

/** Visual separator inside a Command palette list. */
export function CommandPaletteSeparator() {
  return (
    <Command.Separator
      style={{
        height: 1,
        margin: 'var(--space-1) var(--space-3)',
        background: 'var(--border)',
      }}
    />
  );
}

/**
 * useCommandPaletteHotkey — wires ⌘K / Ctrl+K to toggle the palette.
 * Returns `[open, setOpen]` for the controlling <Dialog open={…} onOpenChange={…}>.
 * Escape closes the palette.
 */
export function useCommandPaletteHotkey(): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [open, setOpen];
}