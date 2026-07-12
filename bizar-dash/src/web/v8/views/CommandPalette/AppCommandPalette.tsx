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
 * Three scopes per DESIGN.md §9.4:
 *   - Navigation — top-level views
 *   - Actions    — quick toggles (theme, density)
 *   - Settings   — drill into a specific Settings section
 *
 * Each item's `onSelect` calls `onNavigate(id)` and closes the palette.
 * Settings items use a synthetic `section:{sectionId}` id parsed by
 * `useSettingsNavigation` to switch to the Settings view and scroll the
 * requested section into view via `requestAnimationFrame`.
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

const SETTINGS: NavItem[] = [
  { id: 'section:general', label: 'Settings · General' },
  { id: 'section:theme', label: 'Settings · Theme' },
  { id: 'section:density', label: 'Settings · Density' },
  { id: 'section:density-rules', label: 'Settings · Density rules' },
  { id: 'section:palette', label: 'Settings · Command palette' },
  { id: 'section:keyboard', label: 'Settings · Keyboard' },
  { id: 'section:notifications', label: 'Settings · Notifications' },
  { id: 'section:storage', label: 'Settings · Storage' },
  { id: 'section:plugins', label: 'Settings · Plugins' },
  { id: 'section:mcps', label: 'Settings · MCP servers' },
  { id: 'section:skills', label: 'Settings · Skills' },
  { id: 'section:hooks', label: 'Settings · Hooks' },
  { id: 'section:activity', label: 'Settings · Activity' },
  { id: 'section:memory', label: 'Settings · Memory' },
  { id: 'section:privacy', label: 'Settings · Privacy' },
  { id: 'section:advanced', label: 'Settings · Advanced' },
];

/**
 * Internal hook that recognises `section:{id}` palette items and
 * navigates to Settings + scrolls-to-section. Mounted inside the
 * component so the hook tracks palette lifecycle (no SSR concerns).
 */
function useSettingsNavigation(
  onNavigate: (id: string) => void,
  onOpenChange: (open: boolean) => void,
): (id: string) => void {
  return (id: string): void => {
    if (id.startsWith('section:')) {
      const sectionId = id.slice('section:'.length);
      // Switch to the settings view, then scroll to the section.
      onNavigate('settings');
      // Wait a frame for the view to mount before scrolling.
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      onOpenChange(false);
      return;
    }
    onNavigate(id);
    onOpenChange(false);
  };
}

export function AppCommandPalette(props: AppCommandPaletteProps): JSX.Element {
  const { open, onOpenChange, onNavigate } = props;
  const handleSelect = useSettingsNavigation(onNavigate, onOpenChange);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Command palette" size="md">
        <CommandPalette placeholder="Type a command, page, or setting…">
          <CommandPaletteGroup heading="Navigation">
            {NAV.map((item) => (
              <CommandPaletteItem
                key={item.id}
                value={item.label}
                onSelect={() => handleSelect(item.id)}
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
                onSelect={() => handleSelect(item.id)}
              >
                <span>{item.label}</span>
              </CommandPaletteItem>
            ))}
          </CommandPaletteGroup>
          <CommandPaletteGroup heading="Settings">
            {SETTINGS.map((item) => (
              <CommandPaletteItem
                key={item.id}
                value={item.label}
                onSelect={() => handleSelect(item.id)}
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
