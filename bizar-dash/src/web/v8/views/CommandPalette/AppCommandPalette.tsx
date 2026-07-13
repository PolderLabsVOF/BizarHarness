import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '../../ui/feedback/Dialog.js';
import {
  CommandPalette,
  CommandPaletteGroup,
  CommandPaletteItem,
} from '../../ui/navigation/CommandPalette.js';
import { Kbd } from '../../ui/data/Kbd.js';
import { fetchJson } from '../../data/fetcher.js';
import type { BizarAgent } from '../../data/types.js';

/**
 * AppCommandPalette — Sprint S10/S13. ⌘K palette wired with the v8
 * navigation map plus the control plane.
 *
 * Scopes per DESIGN.md §9.4 + S13:
 *   - Navigation  — top-level views
 *   - Actions     — quick toggles (theme, density)
 *   - Settings    — drill into a Settings section
 *   - Agents      — spawn common agent types (calls POST /api/agents)
 *   - Tasks       — dispatch a new task (calls POST /api/tasks/submit)
 *   - Projects    — switch active project (calls POST /api/projects/active)
 *   - System      — reuse theme/density/settings shortcuts
 */

export interface AppCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (id: string) => void;
  onToast?: (msg: { kind: 'success' | 'error'; text: string }) => void;
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

const SPAWN: NavItem[] = [
  { id: 'spawn:coder', label: 'Spawn · Coder agent' },
  { id: 'spawn:researcher', label: 'Spawn · Researcher agent' },
  { id: 'spawn:planner', label: 'Spawn · Planner agent' },
  { id: 'spawn:reviewer', label: 'Spawn · Reviewer agent' },
];

const TASK_OPS: NavItem[] = [
  { id: 'task:new', label: 'New task…' },
  { id: 'tasks:open', label: 'Go to tasks board' },
];

function useSettingsNavigation(
  onNavigate: (id: string) => void,
  onOpenChange: (open: boolean) => void,
): (id: string) => void {
  return (id: string): void => {
    if (id.startsWith('section:')) {
      const sectionId = id.slice('section:'.length);
      onNavigate('settings');
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

interface Project {
  id: string;
  name?: string;
  cwd?: string;
}

async function spawnAgent(kind: string, onToast?: AppCommandPaletteProps['onToast']): Promise<void> {
  try {
    const res = await fetchJson<{ agent?: BizarAgent; ok?: boolean; error?: string }>(`/api/agents`, {
      method: 'POST',
      body: { kind, prompt: 'Spawned via command palette' },
    });
    if (res.error) onToast?.({ kind: 'error', text: res.error });
    else onToast?.({ kind: 'success', text: `Spawned ${kind} agent` });
  } catch (err) {
    onToast?.({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
  }
}

async function switchProject(id: string, onToast?: AppCommandPaletteProps['onToast']): Promise<void> {
  try {
    await fetchJson<{ ok?: boolean }>(`/api/projects/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    onToast?.({ kind: 'success', text: `Switched to ${id}` });
  } catch (err) {
    onToast?.({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
  }
}

async function newTask(title: string, onToast?: AppCommandPaletteProps['onToast']): Promise<void> {
  try {
    await fetchJson<{ ok?: boolean; task?: { id: string }; error?: string }>(`/api/tasks/submit`, {
      method: 'POST',
      body: { title, priority: 'medium' },
    });
    onToast?.({ kind: 'success', text: `Dispatched task "${title.slice(0, 30)}"` });
  } catch (err) {
    onToast?.({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
  }
}

export function AppCommandPalette(props: AppCommandPaletteProps): JSX.Element {
  const { open, onOpenChange, onNavigate, onToast } = props;
  const handleSelect = useSettingsNavigation(onNavigate, onOpenChange);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      try {
        const res = await fetchJson<{ projects?: Project[] }>(`/api/projects`);
        if (!cancel && res.projects) setProjects(res.projects);
      } catch {
        // ignore — group just won't appear.
      }
    })();
    return () => { cancel = true; };
  }, [open]);

  const onSpawn = (id: string): void => {
    const kind = id.slice('spawn:'.length);
    onOpenChange(false);
    void spawnAgent(kind, onToast);
  };

  const onSwitchProject = (id: string): void => {
    const pid = id.slice('project:'.length);
    onOpenChange(false);
    void switchProject(pid, onToast);
  };

  const onTaskNew = (): void => {
    const title = window.prompt('New task title') || '';
    if (!title.trim()) return;
    onOpenChange(false);
    void newTask(title, onToast);
  };

  const projectItems: NavItem[] = projects.map((p) => ({
    id: `project:${p.id}`,
    label: `Switch to ${p.name || p.id}`,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Command palette" size="md">
        <CommandPalette placeholder="Type a command, page, or setting…">
          <CommandPaletteGroup heading="Navigation">
            {NAV.map((item) => (
              <CommandPaletteItem key={item.id} value={item.label} onSelect={() => handleSelect(item.id)}>
                <span>{item.label}</span>
                {item.shortcut !== undefined && <Kbd>{item.shortcut}</Kbd>}
              </CommandPaletteItem>
            ))}
          </CommandPaletteGroup>
          <CommandPaletteGroup heading="Actions">
            {ACTIONS.map((item) => (
              <CommandPaletteItem key={item.id} value={item.label} onSelect={() => handleSelect(item.id)}>
                <span>{item.label}</span>
              </CommandPaletteItem>
            ))}
          </CommandPaletteGroup>
          <CommandPaletteGroup heading="Agents">
            {SPAWN.map((item) => (
              <CommandPaletteItem key={item.id} value={item.label} onSelect={() => onSpawn(item.id)}>
                <span>{item.label}</span>
              </CommandPaletteItem>
            ))}
          </CommandPaletteGroup>
          <CommandPaletteGroup heading="Tasks">
            {TASK_OPS.map((item) => (
              <CommandPaletteItem
                key={item.id}
                value={item.label}
                onSelect={() => (item.id === 'task:new' ? onTaskNew() : handleSelect('tasks'))}
              >
                <span>{item.label}</span>
              </CommandPaletteItem>
            ))}
          </CommandPaletteGroup>
          {projectItems.length > 0 && (
            <CommandPaletteGroup heading="Projects">
              {projectItems.map((item) => (
                <CommandPaletteItem key={item.id} value={item.label} onSelect={() => onSwitchProject(item.id)}>
                  <span>{item.label}</span>
                </CommandPaletteItem>
              ))}
            </CommandPaletteGroup>
          )}
          <CommandPaletteGroup heading="Settings">
            {SETTINGS.map((item) => (
              <CommandPaletteItem key={item.id} value={item.label} onSelect={() => handleSelect(item.id)}>
                <span>{item.label}</span>
              </CommandPaletteItem>
            ))}
          </CommandPaletteGroup>
        </CommandPalette>
      </DialogContent>
    </Dialog>
  );
}