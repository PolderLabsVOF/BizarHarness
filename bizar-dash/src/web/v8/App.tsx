import { useState } from 'react';
import { AppShell } from './shell/AppShell.js';
import { Topbar } from './shell/Topbar.js';
import { Sidebar, type SidebarSection } from './shell/Sidebar.js';
import { Box } from './ui/primitives/Box.js';
import { Inline } from './ui/primitives/Inline.js';
import { useViewForId } from './views/Router.js';
import { AppCommandPalette } from './views/CommandPalette/AppCommandPalette.js';
import { useCommandPaletteHotkey } from './ui/navigation/CommandPalette.js';
import { useTheme } from './ui/theme/useTheme.js';
import { useDensity } from './ui/theme/useDensity.js';
import {
  Activity,
  Bot,
  CheckSquare,
  Cpu,
  type LucideIcon,
  Layers,
  Library,
  Settings,
  Target,
  Goal,
} from 'lucide-react';

/**
 * v8 root App component.
 *
 * Wires the providers (Theme + Density), the shell (Topbar + Sidebar),
 * the view router (state-based, see Router.tsx), and the app-level
 * ⌘K command palette.
 */

function iconFor(id: string): LucideIcon {
  switch (id) {
    case 'overview':
      return Layers;
    case 'tasks':
      return CheckSquare;
    case 'goals':
      return Target;
    case 'agents':
      return Bot;
    case 'activity':
      return Activity;
    case 'memory':
      return Cpu;
    case 'skills':
      return Goal;
    case 'mcps':
      return Library;
    case 'hooks':
      return Layers;
    case 'settings':
      return Settings;
    default:
      return Layers;
  }
}

export function App(): JSX.Element {
  const [activeId, setActiveId] = useState<string>('overview');
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const theme = useTheme();
  const density = useDensity();

  const [hotkeyOpen, setHotkeyOpen] = useCommandPaletteHotkey();
  const effectivePaletteOpen = paletteOpen || hotkeyOpen;
  const setEffectivePaletteOpen = (v: boolean): void => {
    setPaletteOpen(v);
    setHotkeyOpen(v);
  };

  const sections: SidebarSection[] = [
    {
      id: 'workspace',
      label: 'Workspace',
      items: [
        { id: 'overview', label: 'Overview', icon: iconFor('overview') },
        { id: 'tasks', label: 'Tasks', icon: iconFor('tasks'), count: 47 },
        { id: 'goals', label: 'Goals', icon: iconFor('goals'), count: 3 },
      ],
    },
    {
      id: 'operations',
      label: 'Operations',
      items: [
        { id: 'agents', label: 'Agents', icon: iconFor('agents'), count: '8/16' },
        { id: 'activity', label: 'Activity', icon: iconFor('activity'), live: true },
        { id: 'memory', label: 'Memory', icon: iconFor('memory') },
      ],
    },
    {
      id: 'libraries',
      label: 'Libraries',
      items: [
        { id: 'skills', label: 'Skills', icon: iconFor('skills'), count: 18 },
        { id: 'mcps', label: 'MCPs', icon: iconFor('mcps'), count: 3 },
        { id: 'hooks', label: 'Hooks', icon: iconFor('hooks'), count: 5 },
      ],
    },
    {
      id: 'system',
      label: 'System',
      items: [{ id: 'settings', label: 'Settings', icon: iconFor('settings') }],
    },
  ];

  for (const section of sections) {
    for (const item of section.items) {
      item.active = item.id === activeId;
      item.href = `#${item.id}`;
    }
  }

  const handleNavigate = (id: string): void => {
    if (id === '__theme') {
      const next = theme.mode === 'dark' ? 'light' : 'dark';
      theme.setMode(next);
      return;
    }
    if (id === '__density') {
      const next = density.density === 'comfortable' ? 'compact' : 'comfortable';
      density.setDensity(next);
      return;
    }
    setActiveId(id);
  };

  const view = useViewForId(activeId);

  return (
    <AppShell
      topbar={
        <Topbar
          center={
            <Inline align="center" gap={2}>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: '6px var(--space-3)',
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--fg-muted)',
                  fontSize: 'var(--fs-13)',
                  width: 360,
                  maxWidth: '100%',
                  justifyContent: 'space-between',
                }}
                aria-label="Open command palette"
              >
                <span>Type a command, page, or setting…</span>
                <Box
                  as="kbd"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-12)',
                    color: 'var(--fg-muted)',
                  }}
                >
                  ⌘K
                </Box>
              </button>
            </Inline>
          }
        />
      }
      sidebar={<Sidebar sections={sections} defaultSections={false} />}
    >
      {view}
      <AppCommandPalette
        open={effectivePaletteOpen}
        onOpenChange={setEffectivePaletteOpen}
        onNavigate={handleNavigate}
      />
    </AppShell>
  );
}