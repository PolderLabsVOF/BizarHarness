import { useEffect, useRef, useState } from 'react';
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
  type LucideIcon,
} from 'lucide-react';
import { Grid } from '../../ui/primitives/Grid.js';
import { Stack } from '../../ui/primitives/Stack.js';
import { Switch } from '../../ui/controls/Switch.js';
import { Select } from '../../ui/controls/Select.js';
import { Slider } from '../../ui/controls/Slider.js';
import { Button } from '../../ui/controls/Button.js';
import { SettingsSection } from '../../ui/settings/SettingsSection.js';
import { SettingsRow } from '../../ui/settings/SettingsRow.js';
import { SettingsNav, type SettingsNavItem } from '../../ui/settings/SettingsNav.js';
import { useTheme } from '../../ui/theme/useTheme.js';
import { useDensity } from '../../ui/theme/useDensity.js';
import { useFetch } from '../../data/useFetch.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { fetchJson } from '../../data/fetcher.js';

/**
 * SettingsView — composes the 16 PLAN.md sections from SettingsSection
 * + SettingsRow primitives. Live state is wired to ThemeProvider /
 * DensityProvider where it makes sense (General, Theme, Density).
 *
 * Sprint S10 — counts for Plugins / MCPs / Skills / Hooks sections
 * are pulled live from `/api/skills` and `/api/agents` so the
 * numbers reflect what's actually installed. Other sections keep
 * stub controls pending S14.
 */

interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
}

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
  { id: 'privacy', title: 'Privacy', icon: ShieldCheck },
  { id: 'advanced', title: 'Advanced', icon: SettingsIcon },
];

function Count({ loading, value }: { loading: boolean; value: number | undefined }): JSX.Element {
  if (loading) return <Skeleton style={{ width: 32, height: 16 }} />;
  return <code style={{ fontFamily: 'var(--font-mono)' }}>{value ?? 0}</code>;
}

export function SettingsView(): JSX.Element {
  const [activeId, setActiveId] = useState<string>('general');
  const theme = useTheme();
  const density = useDensity();
  const [analytics, setAnalytics] = useState<boolean>(true);
  const [crashReports, setCrashReports] = useState<boolean>(true);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  // Live counts surfaced by Settings — pulled from the same endpoints the
  // sidebar lists use. Cheap, and keeps settings in sync with the library.
  const skillsRes = useFetch<{ skills?: unknown[]; count?: number }>('/api/skills');
  const mcpsRes = useFetch<{ skills?: unknown[]; count?: number }>('/api/skills?kind=mcps');
  const hooksRes = useFetch<{ skills?: unknown[]; count?: number }>('/api/skills?kind=hooks');
  const agentsRes = useFetch<{ agents?: unknown[] }>('/api/agents');

  // Persist toggles back to the server. Best-effort; falls back to local
  // state silently when the route isn't mounted.
  const patchSetting = async (key: string, value: unknown): Promise<void> => {
    try {
      await fetchJson('/api/settings', { method: 'PATCH', body: { [key]: value } });
    } catch {
      // offline / no API yet — keep local state, server will catch up.
    }
  };

  const navItems: SettingsNavItem[] = SECTIONS.map((s) => ({ id: s.id, title: s.title, icon: <s.icon size={14} aria-hidden="true" /> }));

  // Click on a left-rail nav entry → set active + scroll the section into view.
  const handleSelect = (id: string): void => {
    setActiveId(id);
    // Use a rAF so the active highlight paints before the scroll begins —
    // some browsers queue both as separate compositor passes otherwise.
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // Sync active section with what's actually on screen as the user scrolls.
  // Without this, the rail highlight lags behind the scroll position.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const root = rootRef.current;
    if (!root) return;
    const targets = SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) {
            visible.set(id, entry.intersectionRatio);
          } else {
            visible.delete(id);
          }
        }
        if (visible.size === 0) return;
        let bestId: string | undefined;
        let bestRatio = -1;
        for (const [id, ratio] of visible) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId) setActiveId(bestId);
      },
      { rootMargin: '-30% 0px -50% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const t of targets) observer.observe(t);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={rootRef}>
    <Grid cols={3} gap={5}>
      <aside style={{ position: 'sticky', top: 0, alignSelf: 'start' }}>
        <SettingsNav items={navItems} activeId={activeId} onSelect={handleSelect} />
      </aside>
      <Stack gap={5} style={{ gridColumn: 'span 2' }}>
        <SettingsSection
          id="general"
          title="General"
          description="Workspace-level defaults."
          icon={<SettingsIcon size={14} aria-hidden="true" />}
        >
          <SettingsRow
            id="workspace-name"
            label="Workspace name"
            description="Shown in the topbar and command palette."
            control={<input type="text" defaultValue="Bizar Harness" style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-0)', color: 'var(--fg)', fontSize: 'var(--fs-13)' }} />}
          />
          <SettingsRow
            id="default-view"
            label="Default view on launch"
            control={
              <Select defaultValue="overview">
                <option value="overview">Overview</option>
                <option value="tasks">Tasks</option>
                <option value="goals">Goals</option>
              </Select>
            }
          />
        </SettingsSection>

        <SettingsSection
          id="theme"
          title="Theme"
          description="Color mode. System follows your OS preference."
          icon={<Palette size={14} aria-hidden="true" />}
        >
          <SettingsRow
            id="theme-mode"
            label="Color mode"
            control={
              <Select value={theme.mode} onValueChange={theme.setMode}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            }
          />
          <SettingsRow
            id="theme-accent"
            label="Accent color"
            description="Personalize the leading-edge accent stripe."
            control={<input type="color" defaultValue="#5b8def" style={{ width: 40, height: 28, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }} />}
          />
        </SettingsSection>

        <SettingsSection
          id="density"
          title="Density"
          description="Comfortable by default. Compact fits more rows on screen."
          icon={<Sliders size={14} aria-hidden="true" />}
        >
          <SettingsRow
            id="density-mode"
            label="Density"
            control={
              <Select value={density.density} onValueChange={(v) => density.setDensity(v as 'comfortable' | 'compact')}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </Select>
            }
          />
          <SettingsRow
            id="density-base-font"
            label="Base font size"
            description="Adjusts the `--fs-13` token globally."
            control={<Slider defaultValue={[13]} min={11} max={16} step={1} />}
          />
        </SettingsSection>

        <SettingsSection
          id="density-rules"
          title="Density rules"
          description="Override density per surface."
          icon={<Sparkles size={14} aria-hidden="true" />}
        >
          <SettingsRow
            id="tasks-compact"
            label="Tasks page — compact by default"
            control={<Switch onCheckedChange={(v) => patchSetting('tasksCompact', v)} />}
          />
          <SettingsRow
            id="memory-compact"
            label="Memory page — compact by default"
            control={<Switch defaultChecked onCheckedChange={(v) => patchSetting('memoryCompact', v)} />}
          />
        </SettingsSection>

        <SettingsSection id="palette" title="Command palette" description="How the ⌘K palette behaves." icon={<Terminal size={14} aria-hidden="true" />}>
          <SettingsRow id="palette-history" label="Show recent commands" control={<Switch defaultChecked onCheckedChange={(v) => patchSetting('paletteHistory', v)} />} />
          <SettingsRow id="palette-fuzzy" label="Fuzzy match" control={<Switch defaultChecked onCheckedChange={(v) => patchSetting('paletteFuzzy', v)} />} />
        </SettingsSection>

        <SettingsSection id="keyboard" title="Keyboard" description="Per-action hotkey overrides." icon={<Keyboard size={14} aria-hidden="true" />}>
          <SettingsRow id="kb-palette" label="Open command palette" control={<code style={{ fontFamily: 'var(--font-mono)' }}>⌘K</code>} />
          <SettingsRow id="kb-search" label="Search tasks" control={<code style={{ fontFamily: 'var(--font-mono)' }}>⌘/</code>} />
        </SettingsSection>

        <SettingsSection id="notifications" title="Notifications" description="When the harness should ping you." icon={<Bell size={14} aria-hidden="true" />}>
          <SettingsRow id="n-agent-finished" label="Agent run finished" control={<Switch defaultChecked onCheckedChange={(v) => patchSetting('notifyAgentFinished', v)} />} />
          <SettingsRow id="n-ci-failed" label="CI failed" control={<Switch defaultChecked onCheckedChange={(v) => patchSetting('notifyCiFailed', v)} />} />
          <SettingsRow id="n-token-budget" label="Token budget 80%" control={<Switch defaultChecked onCheckedChange={(v) => patchSetting('notifyTokenBudget', v)} />} />
        </SettingsSection>

        <SettingsSection id="storage" title="Storage" description="Where local data lives." icon={<Database size={14} aria-hidden="true" />}>
          <SettingsRow id="store-path" label="Local store path" control={<code style={{ fontFamily: 'var(--font-mono)' }}>~/.bizar/store.db</code>} />
          <SettingsRow id="store-clear" label="Clear local store" control={<Button variant="danger">Clear…</Button>} />
        </SettingsSection>

        <SettingsSection id="plugins" title="Plugins" description="Plugin registrations under `.claude/`." icon={<Plug size={14} aria-hidden="true" />}>
          <SettingsRow id="plugins-count" label="Loaded plugins" control={<Count loading={agentsRes.loading} value={agentsRes.data?.agents?.length ?? 0} />} />
        </SettingsSection>

        <SettingsSection id="mcps" title="MCP servers" description="Model Context Protocol servers." icon={<Cpu size={14} aria-hidden="true" />}>
          <SettingsRow id="mcps-count" label="Registered MCPs" control={<Count loading={mcpsRes.loading} value={mcpsRes.data?.skills?.length ?? mcpsRes.data?.count ?? 0} />} />
        </SettingsSection>

        <SettingsSection id="skills" title="Skills" description="Bizar skill packs." icon={<LibraryIcon size={14} aria-hidden="true" />}>
          <SettingsRow id="skills-count" label="Loaded skills" control={<Count loading={skillsRes.loading} value={skillsRes.data?.skills?.length ?? skillsRes.data?.count ?? 0} />} />
        </SettingsSection>

        <SettingsSection id="hooks" title="Hooks" description="Executable hook scripts." icon={<Wrench size={14} aria-hidden="true" />}>
          <SettingsRow id="hooks-count" label="Registered hooks" control={<Count loading={hooksRes.loading} value={hooksRes.data?.skills?.length ?? hooksRes.data?.count ?? 0} />} />
        </SettingsSection>

        <SettingsSection id="activity" title="Activity" description="Stream retention and export." icon={<Activity size={14} aria-hidden="true" />}>
          <SettingsRow id="activity-retention" label="Retain last" control={<Select defaultValue="30d"><option>7 days</option><option>30 days</option><option>90 days</option></Select>} />
        </SettingsSection>

        <SettingsSection id="memory" title="Memory" description="Cross-session memo behavior." icon={<Brain size={14} aria-hidden="true" />}>
          <SettingsRow id="memory-auto-commit" label="Auto-commit project memos" control={<Switch defaultChecked onCheckedChange={(v) => patchSetting('memoryAutoCommit', v)} />} />
        </SettingsSection>

        <SettingsSection id="privacy" title="Privacy" description="What the harness sends." icon={<ShieldCheck size={14} aria-hidden="true" />}>
          <SettingsRow
            id="privacy-analytics"
            label="Anonymous analytics"
            control={<Switch checked={analytics} onCheckedChange={(v) => { setAnalytics(v); patchSetting('analytics', v); }} />}
          />
          <SettingsRow
            id="privacy-crash"
            label="Crash reports"
            control={<Switch checked={crashReports} onCheckedChange={(v) => { setCrashReports(v); patchSetting('crashReports', v); }} />}
          />
        </SettingsSection>

        <SettingsSection id="advanced" title="Advanced" description="Power-user toggles." icon={<SettingsIcon size={14} aria-hidden="true" />}>
          <SettingsRow
            id="advanced-reduced-motion"
            label="Reduce motion"
            description="Disable non-essential transitions."
            control={<Switch checked={reducedMotion} onCheckedChange={(v) => { setReducedMotion(v); patchSetting('reducedMotion', v); }} />}
          />
          <SettingsRow
            id="advanced-debug"
            label="Debug overlay"
            description="Show agent + tool call traces in the topbar."
            control={<Switch onCheckedChange={(v) => patchSetting('debugOverlay', v)} />}
          />
        </SettingsSection>
      </Stack>
    </Grid>
    </div>
  );
}