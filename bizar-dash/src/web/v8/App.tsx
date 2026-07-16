import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
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
import { PageSkeleton } from './shell/PageSkeleton.js';
import { useFetch } from './data/useFetch.js';
import { useWsMessage } from './data/useWebSocket.js';
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
  CalendarClock,
  Briefcase,
  MessageSquareText,
  Folder,
  MessageCircle,
  History,
  Wrench,
  ShieldCheck,
  Variable,
  ServerCog,
  MessageSquare,
  Sparkles,
  Boxes,
  ArrowUpCircle,
  Archive,
  Database,
  Mic,
  ClipboardPaste,
  BookOpen,
  Search,
  Stethoscope,
  BarChart3,
  Bell,
  Terminal,
  FlaskConical,
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
    case 'schedules':
      return CalendarClock;
    case 'background':
      return Briefcase;
    case 'chat':
      return MessageSquareText;
    case 'projects-list':
      return Folder;
    case 'claude-sessions':
      return MessageCircle;
    case 'history':
      return History;
    case 'admin':
      return Wrench;
    case 'auth':
      return ShieldCheck;
    case 'env-vars':
      return Variable;
    case 'config':
      return ServerCog;
    case 'dialogs':
      return MessageSquare;
    case 'providers':
      return Sparkles;
    case 'mods':
      return Boxes;
    case 'update':
      return ArrowUpCircle;
    case 'artifacts':
      return Layers;
    case 'lightrag':
      return Database;
    case 'voice':
      return Mic;
    case 'clipboard':
      return ClipboardPaste;
    case 'obsidian':
      return BookOpen;
    case 'misc':
      return Search;
    case 'doctor':
      return Stethoscope;
    case 'usage':
      return BarChart3;
    case 'backup':
      return Archive;
    case 'notifications':
      return Bell;
    case 'diagnostics':
      return Terminal;
    case 'eval':
      return FlaskConical;
    default:
      return Layers;
  }
}

export function App(): JSX.Element {
  const [activeId, setActiveId] = useState<string>('overview');
  const theme = useTheme();
  const density = useDensity();

  // Single source of truth for palette open/close. Both the hotkey hook
  // and the topbar button drive the same setter — no race between them.
  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey();

  // When the route changes, move focus to <main> so screen-reader users
  // hear the new view announced and keyboard users land somewhere
  // predictable (the new view header is now tabIndex=0 inside main).
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [activeId]);

  // Live counts for the sidebar. Polled on mount + WS refresh.
  const tasksRes = useFetch<{ tasks?: { id: string; status: string }[]; count?: number }>('/api/tasks');
  const goalsRes = useFetch<{ goals?: { id: string }[]; count?: number }>('/api/goals');
  const bizarAgentsRes = useFetch<{ agents?: { id: string; status: string }[] }>('/api/agents');
  const ccAgentsRes = useFetch<{ agents?: { id: string; status: string }[] }>('/api/cc-agents');
  const skillsRes = useFetch<{ skills?: { name: string }[]; count?: number }>('/api/skills?kind=skills');
  const mcpsRes = useFetch<{ skills?: { name: string }[]; count?: number }>('/api/skills?kind=mcps');
  const hooksRes = useFetch<{ skills?: { name: string }[]; count?: number }>('/api/skills?kind=hooks');

  // Bump on any relevant WS event so counts refresh.
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const inc = (): void => setBump((n) => n + 1);
    window.addEventListener('focus', inc);
    return () => { window.removeEventListener('focus', inc); };
  }, []);
  useWsMessage('tasks:change', () => setBump((n) => n + 1));
  useWsMessage('goals:change', () => setBump((n) => n + 1));
  useWsMessage('agents:change', () => setBump((n) => n + 1));

  // Listen for cross-tree view navigation (e.g. ActivityLane row click).
  useEffect(() => {
    const onNav = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ id: string }>).detail;
      if (!detail || typeof detail.id !== 'string') return;
      setActiveId(detail.id);
    };
    window.addEventListener('bizar:navigate', onNav as EventListener);
    return () => window.removeEventListener('bizar:navigate', onNav as EventListener);
  }, []);

  const counts = useMemo(() => {
    const tasks = tasksRes.data?.tasks || [];
    const tasksTotal = tasks.length || tasksRes.data?.count || 0;
    const goals = (goalsRes.data?.goals || []).length || goalsRes.data?.count || 0;
    const bAgents = bizarAgentsRes.data?.agents || [];
    const cAgents = ccAgentsRes.data?.agents || [];
    const runningBizar = bAgents.filter((a) => a.status === 'busy' || a.status === 'working').length;
    const totalAgents = bAgents.length + cAgents.length;
    return {
      tasksTotal,
      goals,
      agentsRunning: `${runningBizar + cAgents.length}/${totalAgents || 0}`,
      skills: skillsRes.data?.count ?? skillsRes.data?.skills?.length,
      mcps: mcpsRes.data?.count ?? mcpsRes.data?.skills?.length,
      hooks: hooksRes.data?.count ?? hooksRes.data?.skills?.length,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksRes.data, goalsRes.data, bizarAgentsRes.data, ccAgentsRes.data, skillsRes.data, mcpsRes.data, hooksRes.data, bump]);

  const sections: SidebarSection[] = [
    {
      id: 'workspace',
      label: 'Workspace',
      items: [
        { id: 'overview', label: 'Overview', icon: iconFor('overview') },
        { id: 'tasks', label: 'Tasks', icon: iconFor('tasks'), count: counts.tasksTotal },
        { id: 'goals', label: 'Goals', icon: iconFor('goals'), count: counts.goals },
        { id: 'chat', label: 'Chat', icon: iconFor('chat'), live: true },
        { id: 'projects-list', label: 'Projects', icon: iconFor('projects-list') },
        { id: 'claude-sessions', label: 'Claude sessions', icon: iconFor('claude-sessions') },
      ],
    },
    {
      id: 'operations',
      label: 'Operations',
      items: [
        { id: 'agents', label: 'Agents', icon: iconFor('agents'), count: counts.agentsRunning },
        { id: 'activity', label: 'Activity', icon: iconFor('activity'), live: true },
        { id: 'memory', label: 'Memory', icon: iconFor('memory') },
        { id: 'schedules', label: 'Schedules', icon: iconFor('schedules') },
        { id: 'background', label: 'Background', icon: iconFor('background') },
      ],
    },
    {
      id: 'libraries',
      label: 'Libraries',
      items: [
        { id: 'skills', label: 'Skills', icon: iconFor('skills'), count: counts.skills ?? 0 },
        { id: 'mcps', label: 'MCPs', icon: iconFor('mcps'), count: counts.mcps ?? 0 },
        { id: 'hooks', label: 'Hooks', icon: iconFor('hooks'), count: counts.hooks ?? 0 },
      ],
    },
    {
      id: 'system',
      label: 'System',
      items: [
        { id: 'history', label: 'History', icon: iconFor('history') },
        { id: 'admin', label: 'Admin', icon: iconFor('admin') },
        { id: 'auth', label: 'Auth', icon: iconFor('auth') },
        { id: 'env-vars', label: 'Env vars', icon: iconFor('env-vars') },
        { id: 'config', label: 'Config', icon: iconFor('config') },
        { id: 'dialogs', label: 'Dialogs', icon: iconFor('dialogs') },
        { id: 'providers', label: 'Providers', icon: iconFor('providers') },
        { id: 'mods', label: 'Mods', icon: iconFor('mods') },
        { id: 'update', label: 'Update', icon: iconFor('update') },
        { id: 'artifacts', label: 'Artifacts', icon: iconFor('artifacts') },
        { id: 'lightrag', label: 'LightRAG', icon: iconFor('lightrag') },
        { id: 'voice', label: 'Voice', icon: iconFor('voice') },
        { id: 'clipboard', label: 'Clipboard', icon: iconFor('clipboard') },
        { id: 'obsidian', label: 'Obsidian', icon: iconFor('obsidian') },
        { id: 'misc', label: 'Misc', icon: iconFor('misc') },
        { id: 'doctor', label: 'Doctor', icon: iconFor('doctor') },
        { id: 'usage', label: 'Usage', icon: iconFor('usage') },
        { id: 'backup', label: 'Backups', icon: iconFor('backup') },
        { id: 'notifications', label: 'Notifications', icon: iconFor('notifications') },
        { id: 'diagnostics', label: 'Diagnostics', icon: iconFor('diagnostics') },
        { id: 'eval', label: 'Eval', icon: iconFor('eval') },
        { id: 'settings', label: 'Settings', icon: iconFor('settings') },
      ],
    },
  ];

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
      ref={mainRef}
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
        <Sidebar
          sections={sections}
          defaultSections={false}
          activeId={activeId}
          onItemSelect={handleNavigate}
        />
      }
    >
      <Suspense fallback={<PageSkeleton />}>{view}</Suspense>
      <AppCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={handleNavigate}
      />
    </AppShell>
  );
}