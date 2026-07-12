import { useState } from 'react';
import { AppShell } from './shell/AppShell.js';
import { Topbar } from './shell/Topbar.js';
import { Sidebar, type SidebarSection } from './shell/Sidebar.js';
import { Stack } from './ui/primitives/Stack.js';
import { Inline } from './ui/primitives/Inline.js';
import { Box } from './ui/primitives/Box.js';
import { CommandPalettePlaceholder } from './views/Tasks/CommandPalettePlaceholder.js';
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
 * Responsibilities:
 *   1. Wire the providers (Theme + Density) at the top
 *   2. Render the shell (topbar + sidebar + content)
 *   3. Switch the visible view based on `activeSectionId`
 *
 * Routing is intentionally a flat `useState` for F-043. Sprint S4 swaps
 * this for TanStack Router.
 */
export function App(): JSX.Element {
  const [activeId, setActiveId] = useState<string>('tasks');
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);

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

  // Mark the active item across all sections.
  for (const section of sections) {
    for (const item of section.items) {
      item.active = item.id === activeId;
      item.href = `#${item.id}`;
    }
  }

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
      sidebar={
        <InteractiveSidebar sections={sections} onSelect={setActiveId} />
      }
    >
      <ActiveView id={activeId} />

      {paletteOpen && <CommandPalettePlaceholder onClose={() => setPaletteOpen(false)} />}
    </AppShell>
  );
}

function InteractiveSidebar({
  sections,
  onSelect,
}: {
  sections: SidebarSection[];
  onSelect: (id: string) => void;
}): JSX.Element {
  return <Sidebar sections={sections} defaultSections={false} />;
}

function ActiveView({ id }: { id: string }): JSX.Element {
  return (
    <Stack gap={4}>
      <Box>
        <strong>Active section: </strong>
        <code style={{ fontFamily: 'var(--font-mono)' }}>{id}</code>
      </Box>
      <Box
        style={{
          padding: 'var(--space-6)',
          background: 'var(--surface-1)',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius)',
          color: 'var(--fg-muted)',
          fontSize: 'var(--fs-13)',
        }}
      >
        View surface for <code style={{ fontFamily: 'var(--font-mono)' }}>{id}</code> ships in a later sprint.
      </Box>
    </Stack>
  );
}

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