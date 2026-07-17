import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Palette,
  Keyboard,
  Bell,
  Database,
  Plug,
  Library as LibraryIcon,
  Wrench,
  Activity,
  Brain,
  ShieldCheck,
  Sliders,
  Sparkles,
  Terminal,
  Settings as SettingsIcon,
  Cpu,
  Bot,
  CheckSquare,
  Plus,
  Trash2,
  RotateCw,
  type LucideIcon,
} from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { Switch } from '../../ui/controls/Switch.js';
import { Slider } from '../../ui/controls/Slider.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Textarea } from '../../ui/controls/Textarea.js';
import { Badge } from '../../ui/data/Badge.js';
import { SettingsSection } from '../../ui/settings/SettingsSection.js';
import { SettingsRow } from '../../ui/settings/SettingsRow.js';
import { SettingsNav, type SettingsNavItem } from '../../ui/settings/SettingsNav.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { useTheme } from '../../ui/theme/useTheme.js';
import { useDensity } from '../../ui/theme/useDensity.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

/**
 * SettingsView — Sprint S15 expansion. 19 sections (up from 16) with
 * real controls throughout. Every Switch / Select / Slider / Input is
 * either:
 *   - live-bound to a Provider (Theme / Density),
 *   - persisted via PATCH /api/settings (everything else), or
 *   - backed by a small per-section sub-endpoint when present.
 *
 * Sections:
 *   1.  General          workspace identity + default view
 *   2.  Theme            color mode + accent + font + radius
 *   3.  Density          comfortable/compact + base font
 *   4.  Density rules    per-surface overrides
 *   5.  Command palette  behaviour + history + fuzzy match + nav
 *   6.  Keyboard         hotkeys (read-only display + rebinds via /kb)
 *   7.  Notifications    agent / task / CI / budget / daily digest
 *   8.  Storage          paths + cache sizes + GC button
 *   9.  Plugins          mods list with enable toggles
 *   10. MCP servers      list + status + click for detail
 *   11. Skills           list with enable toggles
 *   12. Hooks            list with enable toggles
 *   13. Activity         retention + hide list + export
 *   14. Memory           scope + auto-commit + search defaults
 *   15. Task defaults    default priority / column / assignee
 *   16. Agent defaults   default model + spawn flags + max mistakes
 *   17. Privacy          telemetry + PII + crash reports
 *   18. Advanced         debug overlay + restart server + max mistakes
 */

type Section = { id: string; title: string; icon: LucideIcon };

const COMMON_TIMEZONES: readonly string[] = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Stockholm',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const SECTIONS: Section[] = [
  { id: 'general', title: 'General', icon: SettingsIcon },
  { id: 'theme', title: 'Theme', icon: Palette },
  { id: 'density', title: 'Density', icon: Sliders },
  { id: 'density-rules', title: 'Density rules', icon: Sparkles },
  { id: 'palette', title: 'Command palette', icon: Terminal },
  { id: 'keyboard', title: 'Keyboard', icon: Keyboard },
  { id: 'notifications', title: 'Notifications', icon: Bell },
  { id: 'storage', title: 'Storage', icon: Database },
  { id: 'plugins', title: 'Plugins', icon: Plug },
  { id: 'mcps', title: 'MCP servers', icon: Cpu },
  { id: 'skills', title: 'Skills', icon: LibraryIcon },
  { id: 'hooks', title: 'Hooks', icon: Wrench },
  { id: 'activity', title: 'Activity', icon: Activity },
  { id: 'memory', title: 'Memory', icon: Brain },
  { id: 'task-defaults', title: 'Task defaults', icon: CheckSquare },
  { id: 'agent-defaults', title: 'Agent defaults', icon: Bot },
  { id: 'privacy', title: 'Privacy', icon: ShieldCheck },
  { id: 'advanced', title: 'Advanced', icon: SettingsIcon },
];

interface SettingsState {
  workspaceName: string;
  workspaceTimezone: string;
  defaultView: 'overview' | 'tasks' | 'goals' | 'agents' | 'activity' | 'settings';
  themeAccent: string;
  densityBaseFont: number;
  tasksCompact: boolean;
  memoryCompact: boolean;
  activityCompact: boolean;
  paletteHistory: boolean;
  paletteFuzzy: boolean;
  notifyAgentFinished: boolean;
  notifyCiFailed: boolean;
  notifyTokenBudget: boolean;
  notifyDailyDigest: boolean;
  notifyChannel: 'toast' | 'system' | 'both' | 'silent';
  storagePath: string;
  cachePath: string;
  sessionsPath: string;
  cacheSizeMb: number;
  hookPreToolUse: boolean;
  hookPostToolUse: boolean;
  hookTaskStart: boolean;
  hookTaskResume: boolean;
  hookUserPromptSubmit: boolean;
  activityRetentionDays: number;
  memoryAutoCommit: boolean;
  memoryScopeDefault: 'project' | 'global' | 'all';
  defaultTaskPriority: 'low' | 'medium' | 'high' | 'urgent';
  defaultTaskColumn: 'queued' | 'doing' | 'blocked' | 'done';
  defaultAgentModel: string;
  defaultAgentMaxMistakes: number;
  analytics: boolean;
  crashReports: boolean;
  piiMode: 'off' | 'redact' | 'pseudonymize' | 'block';
  reducedMotion: boolean;
  debugOverlay: boolean;
}

const DEFAULTS: SettingsState = {
  workspaceName: 'Bizar Harness',
  workspaceTimezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
  defaultView: 'overview',
  themeAccent: '#5b8def',
  densityBaseFont: 13,
  tasksCompact: false,
  memoryCompact: true,
  activityCompact: false,
  paletteHistory: true,
  paletteFuzzy: true,
  notifyAgentFinished: true,
  notifyCiFailed: true,
  notifyTokenBudget: true,
  notifyDailyDigest: false,
  notifyChannel: 'toast',
  storagePath: '~/.bizar/store.db',
  cachePath: '~/.cache/bizar',
  sessionsPath: '~/.claude/sessions',
  cacheSizeMb: 256,
  hookPreToolUse: true,
  hookPostToolUse: true,
  hookTaskStart: true,
  hookTaskResume: true,
  hookUserPromptSubmit: true,
  activityRetentionDays: 30,
  memoryAutoCommit: true,
  memoryScopeDefault: 'all',
  defaultTaskPriority: 'medium',
  defaultTaskColumn: 'queued',
  defaultAgentModel: 'claude-sonnet-4-5',
  defaultAgentMaxMistakes: 10,
  analytics: true,
  crashReports: true,
  piiMode: 'redact',
  reducedMotion: false,
  debugOverlay: false,
};

const SELECT_STYLE: CSSProperties = {
  height: 28,
  padding: '0 var(--space-2)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface-0)',
  color: 'var(--fg)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-12)',
  cursor: 'pointer',
  outline: 'none',
};

function NativeSelect({
  value,
  defaultValue,
  onChange,
  children,
  id_attr,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  children: ReactNode;
  id_attr?: string;
}): JSX.Element {
  return (
    <select
      id={id_attr}
      value={value}
      defaultValue={defaultValue}
      onChange={(e) => onChange?.(e.target.value)}
      style={SELECT_STYLE}
    >
      {children}
    </select>
  );
}

function Count({ loading, value }: { loading: boolean; value: number | undefined }): JSX.Element {
  if (loading) return <Skeleton style={{ width: 32, height: 16 }} />;
  return <code style={{ fontFamily: 'var(--font-mono)' }}>{value ?? 0}</code>;
}

export function SettingsView(): JSX.Element {
  const [activeId, setActiveId] = useState<string>('general');
  const theme = useTheme();
  const density = useDensity();
  const [settings, setSettings] = useState<SettingsState>(DEFAULTS);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  // Run an admin endpoint with confirm + busy state + error surface.
  const runAdmin = async (label: string, method: 'POST' | 'DELETE', path: string, confirmMsg: string): Promise<void> => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(confirmMsg)) return;
    setBusy(label);
    setError(null);
    try {
      await fetchJson(path, { method });
      setLastAction(`${label} @ ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // GET that triggers a browser download (NDJSON for the activity log).
  const downloadFile = (path: string, filename: string): void => {
    if (typeof window === 'undefined') return;
    const a = document.createElement('a');
    a.href = path;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const skillsRes = useFetch<{ skills?: { name: string; source: string }[] }>('/api/skills?kind=skills');
  const mcpsRes = useFetch<{ skills?: { name: string }[] }>('/api/skills?kind=mcps');
  const hooksRes = useFetch<{ skills?: { name: string }[] }>('/api/skills?kind=hooks');
  const agentsRes = useFetch<{ agents?: { name: string }[] }>('/api/agents');

  // Hydrate from the server. The server returns the merged
  // (defaults + persisted overrides) shape, so we can spread it
  // directly over our DEFAULTS to pick up any keys we don't model.
  const settingsRes = useFetch<Partial<SettingsState>>('/api/settings');
  useEffect(() => {
    if (settingsRes.data) {
      setSettings((prev) => ({ ...prev, ...settingsRes.data }));
    }
  }, [settingsRes.data]);

  const update = <K extends keyof SettingsState>(key: K, value: SettingsState[K]): void => {
    setSettings((s) => ({ ...s, [key]: value }));
    void patch(key, value);
  };

  const patch = async (key: string, value: unknown): Promise<void> => {
    try {
      // The settings endpoint accepts a partial body and merges with
      // existing values on the server side — so PUT /api/settings
      // with { [key]: value } is the canonical "update one row" path.
      // We re-PUT the full merged shape so the server has the latest
      // copy of every key we know about.
      const merged = { ...settings, [key]: value };
      await fetchJson('/api/settings', { method: 'PUT', body: merged });
      setSavedAt(Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const navItems: SettingsNavItem[] = SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
    icon: <s.icon size={14} aria-hidden="true" />,
  }));

  const handleSelect = (id: string): void => {
    setActiveId(id);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const targets = SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.set(id, entry.intersectionRatio);
          else visible.delete(id);
        }
        if (visible.size === 0) return;
        let bestId: string | undefined;
        let bestRatio = -1;
        for (const [id, ratio] of visible) {
          if (ratio > bestRatio) { bestRatio = ratio; bestId = id; }
        }
        if (bestId) setActiveId(bestId);
      },
      { rootMargin: '-30% 0px -50% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const t of targets) observer.observe(t);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} data-testid="settings-view">
      <Grid cols={3} gap={5}>
        <aside style={{ position: 'sticky', top: 0, alignSelf: 'start' }}>
          <SettingsNav items={navItems} activeId={activeId} onSelect={handleSelect} />
        </aside>
        <Stack gap={5} style={{ gridColumn: 'span 2' }}>
          {error !== null && (
            <div role="alert" style={{ padding: 'var(--space-3)', background: 'color-mix(in oklch, var(--danger) 12%, var(--surface-0))', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-12)' }}>
              {error}
            </div>
          )}
          {savedAt !== null && (
            <Inline align="center" justify="end" gap={2} style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              <span>Settings saved</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </Inline>
          )}
          {lastAction !== null && (
            <Inline align="center" justify="end" gap={2} style={{ fontSize: 'var(--fs-12)', color: 'var(--success)' }}>
              <span>Last action:</span> <code style={{ fontFamily: 'var(--font-mono)' }}>{lastAction}</code>
            </Inline>
          )}

          {/* 1. General */}
          <SettingsSection id="general" title="General" description="Workspace identity + default landing page." icon={<SettingsIcon size={14} aria-hidden />}>
            <SettingsRow
              id="workspace-name"
              label="Workspace name"
              description="Shown in the topbar and command palette."
              control={
                <Input
                  value={settings.workspaceName}
                  onChange={(e) => update('workspaceName', e.target.value)}
                  style={{ width: 240 }}
                />
              }
            />
            <SettingsRow
              id="workspace-timezone"
              label="Timezone"
              description="Used for activity timestamps + digests."
              control={
                <NativeSelect value={settings.workspaceTimezone} onChange={(v) => update('workspaceTimezone', v)} id_attr="workspace-timezone-select">
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </NativeSelect>
              }
            />
            <SettingsRow
              id="default-view"
              label="Default view on launch"
              control={
                <NativeSelect value={settings.defaultView} onChange={(v) => update('defaultView', v as SettingsState['defaultView'])}>
                  <option value="overview">Overview</option>
                  <option value="tasks">Tasks</option>
                  <option value="goals">Goals</option>
                  <option value="agents">Agents</option>
                  <option value="activity">Activity</option>
                  <option value="settings">Settings</option>
                </NativeSelect>
              }
            />
          </SettingsSection>

          {/* 2. Theme */}
          <SettingsSection id="theme" title="Theme" description="Color mode + accent + typography." icon={<Palette size={14} aria-hidden />}>
            <SettingsRow
              id="theme-mode"
              label="Color mode"
              control={
                <NativeSelect value={theme.mode} onChange={(v) => theme.setMode(v as 'light' | 'dark' | 'system')}>
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </NativeSelect>
              }
            />
            <SettingsRow
              id="theme-accent"
              label="Accent color"
              description="Personalize the leading-edge accent stripe."
              control={
                <Inline align="center" gap={2}>
                  <input
                    type="color"
                    value={settings.themeAccent}
                    onChange={(e) => update('themeAccent', e.target.value)}
                    style={{ width: 40, height: 28, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', cursor: 'pointer' }}
                  />
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>{settings.themeAccent}</code>
                </Inline>
              }
            />
            <SettingsRow
              id="theme-font"
              label="Font family"
              description="Body type. System fonts reduce render time."
              control={
                <NativeSelect defaultValue="inter" onChange={(v) => void patch('themeFont', v)}>
                  <option value="inter">Inter</option>
                  <option value="system">System UI</option>
                  <option value="jetbrains">JetBrains Mono</option>
                </NativeSelect>
              }
            />
            <SettingsRow
              id="theme-radius"
              label="Border radius"
              description="0 = sharp; 16 = rounded."
              control={
                <Inline align="center" gap={2}>
                  <Slider
                    defaultValue={[8]}
                    min={0}
                    max={16}
                    step={1}
                    onValueChange={(v) => void patch('themeRadius', v[0] ?? 8)}
                  />
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{(settings as unknown as Record<string, unknown>).themeRadius as number ?? 8}px</code>
                </Inline>
              }
            />
          </SettingsSection>

          {/* 3. Density */}
          <SettingsSection id="density" title="Density" description="Comfortable by default. Compact fits more on screen." icon={<Sliders size={14} aria-hidden />}>
            <SettingsRow
              id="density-mode"
              label="Density"
              control={
                <NativeSelect value={density.density} onChange={(v) => density.setDensity(v as 'comfortable' | 'compact')}>
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </NativeSelect>
              }
            />
            <SettingsRow
              id="density-base-font"
              label="Base font size"
              description="Adjusts the `--fs-13` token globally."
              control={
                <Inline align="center" gap={2}>
                  <Slider
                    value={[settings.densityBaseFont]}
                    onValueChange={(v) => update('densityBaseFont', v[0] ?? 13)}
                    min={11} max={16} step={1}
                  />
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{settings.densityBaseFont}px</code>
                </Inline>
              }
            />
          </SettingsSection>

          {/* 4. Density rules */}
          <SettingsSection id="density-rules" title="Density rules" description="Override density per surface." icon={<Sparkles size={14} aria-hidden />}>
            <SettingsRow id="tasks-compact" label="Tasks page — compact by default" control={<Switch checked={settings.tasksCompact} onCheckedChange={(v) => update('tasksCompact', v)} />} />
            <SettingsRow id="memory-compact" label="Memory page — compact by default" control={<Switch checked={settings.memoryCompact} onCheckedChange={(v) => update('memoryCompact', v)} />} />
            <SettingsRow id="activity-compact" label="Activity page — compact by default" control={<Switch checked={settings.activityCompact} onCheckedChange={(v) => update('activityCompact', v)} />} />
          </SettingsSection>

          {/* 5. Command palette */}
          <SettingsSection id="palette" title="Command palette" description="How the ⌘K palette behaves." icon={<Terminal size={14} aria-hidden />}>
            <SettingsRow id="palette-history" label="Show recent commands" control={<Switch checked={settings.paletteHistory} onCheckedChange={(v) => update('paletteHistory', v)} />} />
            <SettingsRow id="palette-fuzzy" label="Fuzzy match" control={<Switch checked={settings.paletteFuzzy} onCheckedChange={(v) => update('paletteFuzzy', v)} />} />
            <SettingsRow id="palette-navigate" label="Show navigation group" control={<Switch defaultChecked onCheckedChange={(v) => patch('paletteNavigate', v)} />} />
            <SettingsRow id="palette-spawn" label="Show agent-spawn group" control={<Switch defaultChecked onCheckedChange={(v) => patch('paletteSpawn', v)} />} />
            <SettingsRow
              id="palette-scope"
              label="Default scope"
              description="Where palette actions apply when no context."
              control={
                <NativeSelect defaultValue="project" onChange={(v) => void patch('paletteScope', v)}>
                  <option value="project">Active project</option>
                  <option value="global">Global</option>
                </NativeSelect>
              }
            />
          </SettingsSection>

          {/* 6. Keyboard */}
          <SettingsSection id="keyboard" title="Keyboard" description="Hotkey bindings (read-only here; rebind in ~/.claude/keybindings.json)." icon={<Keyboard size={14} aria-hidden />}>
            <SettingsRow id="kb-palette" label="Open command palette" control={<code style={{ fontFamily: 'var(--font-mono)' }}>⌘K</code>} />
            <SettingsRow id="kb-search" label="Search tasks" control={<code style={{ fontFamily: 'var(--font-mono)' }}>⌘/</code>} />
            <SettingsRow id="kb-newtask" label="New task" control={<code style={{ fontFamily: 'var(--font-mono)' }}>⌘N</code>} />
            <SettingsRow id="kb-toggle-theme" label="Toggle theme" control={<code style={{ fontFamily: 'var(--font-mono)' }}>⌘⇧L</code>} />
            <SettingsRow id="kb-toggle-density" label="Toggle density" control={<code style={{ fontFamily: 'var(--font-mono)' }}>⌘⇧D</code>} />
            <SettingsRow id="kb-reload" label="Reload window" control={<code style={{ fontFamily: 'var(--font-mono)' }}>⌘R</code>} />
          </SettingsSection>

          {/* 7. Notifications */}
          <SettingsSection id="notifications" title="Notifications" description="When the harness should ping you." icon={<Bell size={14} aria-hidden />}>
            <SettingsRow id="n-agent-finished" label="Agent run finished" control={<Switch checked={settings.notifyAgentFinished} onCheckedChange={(v) => update('notifyAgentFinished', v)} />} />
            <SettingsRow id="n-task-moved" label="Task moved between columns" control={<Switch defaultChecked onCheckedChange={(v) => void patch('notifyTaskMoved', v)} />} />
            <SettingsRow id="n-ci-failed" label="CI failed" control={<Switch checked={settings.notifyCiFailed} onCheckedChange={(v) => update('notifyCiFailed', v)} />} />
            <SettingsRow id="n-token-budget" label="Token budget 80%" control={<Switch checked={settings.notifyTokenBudget} onCheckedChange={(v) => update('notifyTokenBudget', v)} />} />
            <SettingsRow id="n-daily-digest" label="Daily digest at 09:00" control={<Switch checked={settings.notifyDailyDigest} onCheckedChange={(v) => update('notifyDailyDigest', v)} />} />
            <SettingsRow
              id="n-channel"
              label="Channel"
              description="Where notifications render."
              control={
                <NativeSelect value={settings.notifyChannel} onChange={(v) => update('notifyChannel', v as SettingsState['notifyChannel'])}>
                  <option value="toast">In-app toast</option>
                  <option value="system">OS notification</option>
                  <option value="both">Both</option>
                  <option value="silent">Silent</option>
                </NativeSelect>
              }
            />
          </SettingsSection>

          {/* 8. Storage */}
          <SettingsSection id="storage" title="Storage" description="Where local data lives." icon={<Database size={14} aria-hidden />}>
            <SettingsRow
              id="store-path"
              label="Local store path"
              control={
                <Input
                  value={settings.storagePath}
                  onChange={(e) => update('storagePath', e.target.value)}
                  style={{ width: 280, fontFamily: 'var(--font-mono)' }}
                />
              }
            />
            <SettingsRow
              id="cache-path"
              label="Cache directory"
              control={
                <Input
                  value={settings.cachePath}
                  onChange={(e) => update('cachePath', e.target.value)}
                  style={{ width: 280, fontFamily: 'var(--font-mono)' }}
                />
              }
            />
            <SettingsRow
              id="sessions-path"
              label="Claude Code sessions"
              control={
                <Input
                  value={settings.sessionsPath}
                  onChange={(e) => update('sessionsPath', e.target.value)}
                  style={{ width: 280, fontFamily: 'var(--font-mono)' }}
                />
              }
            />
            <SettingsRow
              id="cache-size"
              label="Cache budget"
              description="Soft cap (MB) before LRU eviction."
              control={
                <Inline align="center" gap={2}>
                  <Slider
                    value={[settings.cacheSizeMb]}
                    onValueChange={(v) => update('cacheSizeMb', v[0] ?? 256)}
                    min={64}
                    max={4096}
                    step={32}
                  />
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{settings.cacheSizeMb} MB</code>
                </Inline>
              }
            />
            <SettingsRow
              id="store-gc"
              label="Garbage collect"
              description="Prune empty sessions and orphaned tasks."
              control={<Button variant="secondary" disabled={busy === 'gc'} onClick={() => void runAdmin('gc', 'POST', '/api/admin/gc', 'Run garbage collect?')}>{busy === 'gc' ? 'Running…' : 'Run GC'}</Button>}
            />
            <SettingsRow
              id="store-clear"
              label="Clear local cache"
              description="Destructive. Wipes the activity log and snapshots."
              control={<Button variant="danger" disabled={busy === 'clear'} onClick={() => void runAdmin('cache/clear', 'POST', '/api/admin/cache/clear', 'Clear dashboard cache? This is reversible but will log you out briefly.')}>{busy === 'clear' ? 'Clearing…' : 'Clear…'}</Button>}
            />
          </SettingsSection>

          {/* 9. Plugins */}
          <SettingsSection id="plugins" title="Plugins" description="Plugin registrations under `.claude/`." icon={<Plug size={14} aria-hidden />}>
            <SettingsRow
              id="plugins-count"
              label="Loaded plugins"
              control={<Count loading={agentsRes.loading} value={agentsRes.data?.agents?.length ?? 0} />}
            />
            <SettingsRow
              id="plugins-bizar"
              label="Bizar"
              description="Core plugin. Required — disable with care."
              control={<Switch defaultChecked disabled />}
            />
            {Array.isArray(agentsRes.data?.agents) && agentsRes.data.agents.length > 0 && (
              <SettingsRow
                id="plugins-list"
                label="Active agents"
                control={
                  <Stack gap={1} style={{ maxHeight: 200, overflowY: 'auto', width: 360 }}>
                    {agentsRes.data.agents.map((a) => (
                      <Inline key={a.name} align="center" justify="between" style={{ padding: 'var(--space-1) var(--space-2)', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)' }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>{a.name}</code>
                        <Badge tone="success">active</Badge>
                      </Inline>
                    ))}
                  </Stack>
                }
              />
            )}
          </SettingsSection>

          {/* 10. MCPs */}
          <SettingsSection id="mcps" title="MCP servers" description="Model Context Protocol servers." icon={<Cpu size={14} aria-hidden />}>
            <SettingsRow id="mcps-count" label="Registered MCPs" control={<Count loading={mcpsRes.loading} value={mcpsRes.data?.skills?.length ?? 0} />} />
            {Array.isArray(mcpsRes.data?.skills) && mcpsRes.data.skills.length > 0 && (
              <SettingsRow
                id="mcps-list"
                label="Servers"
                control={
                  <Stack gap={1} style={{ maxHeight: 220, overflowY: 'auto', width: 360 }}>
                    {mcpsRes.data.skills.map((m) => (
                      <Inline key={m.name} align="center" justify="between" style={{ padding: 'var(--space-1) var(--space-2)', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)' }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>{m.name}</code>
                        <Switch defaultChecked onCheckedChange={(v) => void patch(`mcp:${m.name}`, v)} />
                      </Inline>
                    ))}
                  </Stack>
                }
              />
            )}
          </SettingsSection>

          {/* 11. Skills */}
          <SettingsSection id="skills" title="Skills" description="Bizar skill packs." icon={<LibraryIcon size={14} aria-hidden />}>
            <SettingsRow id="skills-count" label="Loaded skills" control={<Count loading={skillsRes.loading} value={skillsRes.data?.skills?.length ?? 0} />} />
            {Array.isArray(skillsRes.data?.skills) && skillsRes.data.skills.length > 0 && (
              <SettingsRow
                id="skills-list"
                label="Skill packs"
                control={
                  <Stack gap={1} style={{ maxHeight: 260, overflowY: 'auto', width: 360 }}>
                    {skillsRes.data.skills.map((s) => (
                      <Inline key={s.name} align="center" justify="between" style={{ padding: 'var(--space-1) var(--space-2)', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)' }}>
                        <Inline align="center" gap={2}>
                          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>{s.name}</code>
                          <Badge tone="neutral">{s.source}</Badge>
                        </Inline>
                        <Switch defaultChecked onCheckedChange={(v) => void patch(`skill:${s.name}`, v)} />
                      </Inline>
                    ))}
                  </Stack>
                }
              />
            )}
          </SettingsSection>

          {/* 12. Hooks */}
          <SettingsSection id="hooks" title="Hooks" description="Executable hook scripts." icon={<Wrench size={14} aria-hidden />}>
            <SettingsRow id="hooks-count" label="Registered hooks" control={<Count loading={hooksRes.loading} value={hooksRes.data?.skills?.length ?? 0} />} />
            <SettingsRow id="hooks-pretool" label="PreToolUse" description="Block writes to .env / secrets / node_modules." control={<Switch checked={settings.hookPreToolUse} onCheckedChange={(v) => update('hookPreToolUse', v)} />} />
            <SettingsRow id="hooks-posttool" label="PostToolUse" description="Log tool latency to ~/.config/bizar/hook-logs/." control={<Switch checked={settings.hookPostToolUse} onCheckedChange={(v) => update('hookPostToolUse', v)} />} />
            <SettingsRow id="hooks-taskstart" label="TaskStart" description="Prime AI with project context." control={<Switch checked={settings.hookTaskStart} onCheckedChange={(v) => update('hookTaskStart', v)} />} />
            <SettingsRow id="hooks-taskresume" label="TaskResume" description="Re-read state + check git log." control={<Switch checked={settings.hookTaskResume} onCheckedChange={(v) => update('hookTaskResume', v)} />} />
            <SettingsRow id="hooks-prompt" label="UserPromptSubmit" description="Tag prompts for routing." control={<Switch checked={settings.hookUserPromptSubmit} onCheckedChange={(v) => update('hookUserPromptSubmit', v)} />} />
          </SettingsSection>

          {/* 13. Activity */}
          <SettingsSection id="activity" title="Activity" description="Stream retention + export." icon={<Activity size={14} aria-hidden />}>
            <SettingsRow
              id="activity-retention"
              label="Retain last"
              control={
                <Inline align="center" gap={2}>
                  <Slider value={[settings.activityRetentionDays]} onValueChange={(v) => update('activityRetentionDays', v[0] ?? 30)} min={7} max={365} step={1} />
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{settings.activityRetentionDays} days</code>
                </Inline>
              }
            />
            <SettingsRow
              id="activity-hide"
              label="Hide noisy event types"
              description="Comma-separated kinds. E.g. 'heartbeat,ping'."
              control={<Input
                placeholder="heartbeat, ping, system"
                defaultValue={String((settings as unknown as Record<string, unknown>).activityHide ?? '')}
                onBlur={(e) => void patch('activityHide', e.target.value)}
                style={{ width: 280 }}
              />}
            />
            <SettingsRow
              id="activity-export"
              label="Export"
              description="Download the full activity log as NDJSON."
              control={<Button variant="secondary" onClick={() => downloadFile('/api/admin/activity/export', 'activity.ndjson')}>Export…</Button>}
            />
          </SettingsSection>

          {/* 14. Memory */}
          <SettingsSection id="memory" title="Memory" description="Cross-session memo behavior." icon={<Brain size={14} aria-hidden />}>
            <SettingsRow id="memory-auto-commit" label="Auto-commit project memos" control={<Switch checked={settings.memoryAutoCommit} onCheckedChange={(v) => update('memoryAutoCommit', v)} />} />
            <SettingsRow
              id="memory-scope"
              label="Default scope filter"
              control={
                <NativeSelect value={settings.memoryScopeDefault} onChange={(v) => update('memoryScopeDefault', v as SettingsState['memoryScopeDefault'])}>
                  <option value="project">Project</option>
                  <option value="global">Global</option>
                  <option value="all">All</option>
                </NativeSelect>
              }
            />
            <SettingsRow id="memory-index" label="Re-index vault" description="Rebuild search index. May take a moment." control={<Button variant="secondary" disabled={busy === 'reindex'} onClick={() => void runAdmin('memory/reindex', 'POST', '/api/admin/memory/reindex', 'Rebuild the memory vault search index?')}>{busy === 'reindex' ? 'Re-indexing…' : 'Re-index'}</Button>} />
          </SettingsSection>

          {/* 15. Task defaults */}
          <SettingsSection id="task-defaults" title="Task defaults" description="Defaults applied to new tasks." icon={<CheckSquare size={14} aria-hidden />}>
            <SettingsRow
              id="task-priority"
              label="Default priority"
              control={
                <NativeSelect value={settings.defaultTaskPriority} onChange={(v) => update('defaultTaskPriority', v as SettingsState['defaultTaskPriority'])}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </NativeSelect>
              }
            />
            <SettingsRow
              id="task-column"
              label="Default column"
              control={
                <NativeSelect value={settings.defaultTaskColumn} onChange={(v) => update('defaultTaskColumn', v as SettingsState['defaultTaskColumn'])}>
                  <option value="queued">Backlog</option>
                  <option value="doing">In progress</option>
                  <option value="blocked">In review</option>
                  <option value="done">Done</option>
                </NativeSelect>
              }
            />
            <SettingsRow
              id="task-assignee"
              label="Default assignee"
              description="Auto-assigns new tasks to this agent (empty = unassigned)."
              control={<Input placeholder="odin" defaultValue={String((settings as unknown as Record<string, unknown>).defaultTaskAssignee ?? '')} onBlur={(e) => void patch('defaultTaskAssignee', e.target.value)} style={{ width: 240 }} />}
            />
          </SettingsSection>

          {/* 16. Agent defaults */}
          <SettingsSection id="agent-defaults" title="Agent defaults" description="Defaults applied when spawning agents." icon={<Bot size={14} aria-hidden />}>
            <SettingsRow
              id="agent-model"
              label="Default model"
              control={
                <Input value={settings.defaultAgentModel} onChange={(e) => update('defaultAgentModel', e.target.value)} style={{ width: 240 }} />
              }
            />
            <SettingsRow
              id="agent-mistakes"
              label="Max consecutive mistakes"
              description="Higher = more forgiving. Default 10."
              control={
                <Inline align="center" gap={2}>
                  <Slider
                    value={[settings.defaultAgentMaxMistakes]}
                    onValueChange={(v) => update('defaultAgentMaxMistakes', v[0] ?? 10)}
                    min={3} max={20} step={1}
                  />
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{settings.defaultAgentMaxMistakes}</code>
                </Inline>
              }
            />
            <SettingsRow id="agent-bg" label="Spawn as background by default" control={<Switch defaultChecked={Boolean((settings as unknown as Record<string, unknown>).agentBackgroundDefault)} onCheckedChange={(v) => void patch('agentBackgroundDefault', v)} />} />
            <SettingsRow id="agent-worktree" label="Always create a worktree" control={<Switch defaultChecked={Boolean((settings as unknown as Record<string, unknown>).agentWorktree ?? true)} onCheckedChange={(v) => void patch('agentWorktree', v)} />} />
            <SettingsRow
              id="agent-system-prompt"
              label="Extra system prompt"
              description="Appended to every agent's system prompt."
              control={<Textarea
                rows={3}
                placeholder="You are a careful, methodical engineer…"
                defaultValue={String((settings as unknown as Record<string, unknown>).agentSystemPrompt ?? '')}
                onBlur={(e) => void patch('agentSystemPrompt', e.target.value)}
              />}
            />
          </SettingsSection>

          {/* 17. Privacy */}
          <SettingsSection id="privacy" title="Privacy" description="What the harness sends and stores." icon={<ShieldCheck size={14} aria-hidden />}>
            <SettingsRow
              id="privacy-analytics"
              label="Anonymous analytics"
              control={<Switch checked={settings.analytics} onCheckedChange={(v) => update('analytics', v)} />}
            />
            <SettingsRow
              id="privacy-crash"
              label="Crash reports"
              control={<Switch checked={settings.crashReports} onCheckedChange={(v) => update('crashReports', v)} />}
            />
            <SettingsRow
              id="privacy-pii"
              label="PII handling"
              description="How personal data is treated before persistence."
              control={
                <NativeSelect value={settings.piiMode} onChange={(v) => update('piiMode', v as SettingsState['piiMode'])}>
                  <option value="off">Off</option>
                  <option value="redact">Redact</option>
                  <option value="pseudonymize">Pseudonymize</option>
                  <option value="block">Block</option>
                </NativeSelect>
              }
            />
            <SettingsRow
              id="privacy-telemetry"
              label="Send token usage telemetry"
              control={<Switch defaultChecked={Boolean((settings as unknown as Record<string, unknown>).telemetryTokens)} onCheckedChange={(v) => void patch('telemetryTokens', v)} />}
            />
          </SettingsSection>

          {/* 18. Advanced */}
          <SettingsSection id="advanced" title="Advanced" description="Power-user toggles. Touch with care." icon={<SettingsIcon size={14} aria-hidden />}>
            <SettingsRow
              id="advanced-reduced-motion"
              label="Reduce motion"
              control={<Switch checked={settings.reducedMotion} onCheckedChange={(v) => update('reducedMotion', v)} />}
            />
            <SettingsRow
              id="advanced-debug"
              label="Debug overlay"
              description="Show agent + tool call traces in the topbar."
              control={<Switch checked={settings.debugOverlay} onCheckedChange={(v) => update('debugOverlay', v)} />}
            />
            <SettingsRow
              id="advanced-restart"
              label="Restart dashboard backend"
              description="Stop and relaunch the local server. Unsaved tasks are safe on disk."
              control={
                <Inline align="center" gap={2}>
                  <Button variant="danger" disabled={busy === 'restart'} onClick={() => void runAdmin('restart', 'POST', '/api/admin/restart', 'Restart the dashboard backend? You may need to relaunch the CLI if it does not come back.')}><RotateCw size={12} aria-hidden /> {busy === 'restart' ? 'Restarting…' : 'Restart…'}</Button>
                  <Button variant="ghost" disabled={busy === 'rebuild'} onClick={() => void runAdmin('rebuild', 'POST', '/api/admin/rebuild', 'Rebuild the dashboard package? This runs `npm run build`.')}><Plus size={12} aria-hidden /> {busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild'}</Button>
                </Inline>
              }
            />
            <SettingsRow
              id="advanced-logs"
              label="Open logs folder"
              control={<Button variant="secondary" disabled={busy === 'purge-logs'} onClick={() => void runAdmin('logs/purge', 'POST', '/api/admin/logs/purge', 'Delete log files older than 14 days?') }><Trash2 size={12} aria-hidden /> {busy === 'purge-logs' ? 'Purging…' : 'Purge logs'}</Button>}
            />
          </SettingsSection>

          {/* 19. Configuration — Reset + Plugin options (v10.0.4) */}
          <SettingsSection
            id="configuration"
            title="Configuration"
            description="Reset to defaults, and edit the plugin-options sidecar."
            icon={<SettingsIcon size={14} aria-hidden />}
          >
            <SettingsRow
              id="config-reset"
              label="Reset settings to defaults"
              description="Calls POST /api/settings/reset. Restores every key to its DEFAULT_SETTINGS value."
              control={
                <Inline align="center" gap={2}>
                  <Button
                    variant="danger"
                    disabled={busy === 'settings-reset'}
                    data-testid="settings-reset"
                    onClick={() => {
                      if (typeof window !== 'undefined' && typeof window.confirm === 'function'
                          && !window.confirm('Reset every settings key to its default?')) return;
                      setBusy('settings-reset');
                      setError(null);
                      (async () => {
                        try {
                          const next = await fetchJson<{ data?: Partial<SettingsState> }>('/api/settings/reset', { method: 'POST' });
                          if (next?.data) setSettings({ ...DEFAULTS, ...next.data });
                          setLastAction(`reset @ ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
                        } catch (err) {
                          setError(err instanceof FetchError ? err.message : (err as Error).message);
                        } finally {
                          setBusy(null);
                        }
                      })();
                    }}
                  >
                    <RotateCw size={12} aria-hidden /> {busy === 'settings-reset' ? 'Resetting…' : 'Reset to defaults'}
                  </Button>
                </Inline>
              }
            />
            <SettingsRow
              id="config-plugin-options"
              label="Plugin options"
              description="JSON sidecar at ~/.config/bizar/plugin-options.json. Persisted via PUT /api/settings/plugin-options."
              control={
                <PluginOptionsEditor />
              }
            />
          </SettingsSection>
        </Stack>
      </Grid>
    </div>
  );
}

/**
 * PluginOptionsEditor — small JSON textarea bound to the
 * `~/.config/bizar/plugin-options.json` sidecar. Separate component
 * because the rest of SettingsView is one-shot-on-mount and we want
 * the editor to survive parent re-renders without clobbering the
 * in-flight edit buffer. v10.0.4 — adds UI wiring for the previously
 * unwired PUT /api/settings/plugin-options endpoint.
 */
function PluginOptionsEditor(): JSX.Element {
  const [text, setText] = useState<string>('{}');
  const [busy, setBusy] = useState<boolean>(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opts = await fetchJson<Record<string, unknown>>('/api/settings/plugin-options');
        if (!cancelled) setText(JSON.stringify(opts ?? {}, null, 2));
      } catch (err) {
        if (!cancelled) setError(err instanceof FetchError ? err.message : (err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async (): Promise<void> => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (err) {
      setError(`Invalid JSON: ${(err as Error).message}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fetchJson('/api/settings/plugin-options', { method: 'PUT', body: parsed as Record<string, unknown> });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={2} style={{ width: '100%' }}>
      <textarea
        data-testid="plugin-options-form"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        spellCheck={false}
        style={{
          width: '100%',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          padding: '8px',
          background: 'var(--surface-1)',
          color: 'var(--text-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-1)',
        }}
      />
      <Inline align="center" gap={2}>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save plugin options'}
        </Button>
        {savedAt !== null && (
          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
            saved {new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
        {error && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{error}</span>}
      </Inline>
    </Stack>
  );
}