import { Dialog, DialogContent } from '../../ui/feedback/Dialog.js';
import {
  CommandPalette,
  CommandPaletteGroup,
  CommandPaletteItem,
} from '../../ui/navigation/CommandPalette.js';
import { Kbd } from '../../ui/data/Kbd.js';

/**
 * AppCommandPalette — the ⌘K palette wired with the v8 navigation map.
 *
 * Each item's `onSelect` calls `onNavigate(id)` and closes the palette.
 */

export interface AppCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (id: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  shortcut?: string;
}

const NAV: NavItem[] = [
  { id: 'overview', label: 'Go to Overview' },
  { id: 'tasks', label: 'Go to Tasks' },
  { id: 'goals', label: 'Go to Goals' },
  { id: 'agents', label: 'Go to Agents' },
  { id: 'activity', label: 'Go to Activity' },
  { id: 'memory', label: 'Go to Memory' },
  { id: 'skills', label: 'Go to Skills' },
  { id: 'mcps', label: 'Go to MCPs' },
  { id: 'hooks', label: 'Go to Hooks' },
  { id: 'settings', label: 'Go to Settings', shortcut: '⌘,' },
];

const ACTIONS: NavItem[] = [
  { id: '__theme', label: 'Toggle theme' },
  { id: '__density', label: 'Toggle density' },
];

export function AppCommandPalette(props: AppCommandPaletteProps): JSX.Element {
  const { open, onOpenChange, onNavigate } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Command palette" size="md">
        <CommandPalette placeholder="Type a command, page, or setting…">
          <CommandPaletteGroup heading="Navigation">
            {NAV.map((item) => (
              <CommandPaletteItem
                key={item.id}
                value={item.label}
                onSelect={() => {
                  onNavigate(item.id);
                  onOpenChange(false);
                }}
              >
                <span>{item.label}</span>
                {item.shortcut !== undefined && <Kbd>{item.shortcut}</Kbd>}
              </CommandPaletteItem>
            ))}
          </CommandPaletteGroup>
          <CommandPaletteGroup heading="Actions">
            {ACTIONS.map((item) => (
              <CommandPaletteItem
                key={item.id}
                value={item.label}
                onSelect={() => {
                  onNavigate(item.id);
                  onOpenChange(false);
                }}
              >
                <span>{item.label}</span>
              </CommandPaletteItem>
            ))}
          </CommandPaletteGroup>
        </CommandPalette>
      </DialogContent>
    </Dialog>
  );
}