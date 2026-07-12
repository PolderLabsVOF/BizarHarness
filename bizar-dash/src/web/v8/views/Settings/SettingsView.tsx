import { useState } from 'react';
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

/**
 * SettingsView — composes the 16 PLAN.md sections from SettingsSection
 * + SettingsRow primitives. Live state is wired to ThemeProvider /
 * DensityProvider where it makes sense (General, Theme, Density).
 *
 * Other sections render with stub controls so the surface is exercisable
 * end-to-end. Replacing stubs with real wiring is per-section work that
 * ships incrementally.
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

export function SettingsView(): JSX.Element {
  const [activeId, setActiveId] = useState<string>('general');
  const theme = useTheme();
  const density = useDensity();
  const [analytics, setAnalytics] = useState<boolean>(true);
  const [crashReports, setCrashReports] = useState<boolean>(true);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  const navItems: SettingsNavItem[] = SECTIONS.map((s) => ({ id: s.id, title: s.title, icon: <s.icon size={14} aria-hidden="true" /> }));

  return (
    <Grid cols={3} gap={5}>
      <aside style={{ position: 'sticky', top: 0, alignSelf: 'start' }}>
        <SettingsNav items={navItems} activeId={activeId} onSelect={setActiveId} />
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
            control={<Switch />}
          />
          <SettingsRow
            id="memory-compact"
            label="Memory page — compact by default"
            control={<Switch defaultChecked />}
          />
        </SettingsSection>

        <SettingsSection id="palette" title="Command palette" description="How the ⌘K palette behaves." icon={<Terminal size={14} aria-hidden="true" />}>
          <SettingsRow id="palette-history" label="Show recent commands" control={<Switch defaultChecked />} />
          <SettingsRow id="palette-fuzzy" label="Fuzzy match" control={<Switch defaultChecked />} />
        </SettingsSection>

        <SettingsSection id="keyboard" title="Keyboard" description="Per-action hotkey overrides." icon={<Keyboard size={14} aria-hidden="true" />}>
          <SettingsRow id="kb-palette" label="Open command palette" control={<code style={{ fontFamily: 'var(--font-mono)' }}>⌘K</code>} />
          <SettingsRow id="kb-search" label="Search tasks" control={<code style={{ fontFamily: 'var(--font-mono)' }}>⌘/</code>} />
        </SettingsSection>

        <SettingsSection id="notifications" title="Notifications" description="When the harness should ping you." icon={<Bell size={14} aria-hidden="true" />}>
          <SettingsRow id="n-agent-finished" label="Agent run finished" control={<Switch defaultChecked />} />
          <SettingsRow id="n-ci-failed" label="CI failed" control={<Switch defaultChecked />} />
          <SettingsRow id="n-token-budget" label="Token budget 80%" control={<Switch defaultChecked />} />
        </SettingsSection>

        <SettingsSection id="storage" title="Storage" description="Where local data lives." icon={<Database size={14} aria-hidden="true" />}>
          <SettingsRow id="store-path" label="Local store path" control={<code style={{ fontFamily: 'var(--font-mono)' }}>~/.bizar/store.db</code>} />
          <SettingsRow id="store-clear" label="Clear local store" control={<Button variant="danger">Clear…</Button>} />
        </SettingsSection>

        <SettingsSection id="plugins" title="Plugins" description="Plugin registrations under `.claude/`." icon={<Plug size={14} aria-hidden="true" />}>
          <SettingsRow id="plugins-count" label="Enabled plugins" control={<code style={{ fontFamily: 'var(--font-mono)' }}>1</code>} />
        </SettingsSection>

        <SettingsSection id="mcps" title="MCP servers" description="Model Context Protocol servers." icon={<Cpu size={14} aria-hidden="true" />}>
          <SettingsRow id="mcps-count" label="Registered MCPs" control={<code style={{ fontFamily: 'var(--font-mono)' }}>3</code>} />
        </SettingsSection>

        <SettingsSection id="skills" title="Skills" description="Bizar skill packs." icon={<LibraryIcon size={14} aria-hidden="true" />}>
          <SettingsRow id="skills-count" label="Loaded skills" control={<code style={{ fontFamily: 'var(--font-mono)' }}>18</code>} />
        </SettingsSection>

        <SettingsSection id="hooks" title="Hooks" description="Executable hook scripts." icon={<Wrench size={14} aria-hidden="true" />}>
          <SettingsRow id="hooks-count" label="Registered hooks" control={<code style={{ fontFamily: 'var(--font-mono)' }}>5</code>} />
        </SettingsSection>

        <SettingsSection id="activity" title="Activity" description="Stream retention and export." icon={<Activity size={14} aria-hidden="true" />}>
          <SettingsRow id="activity-retention" label="Retain last" control={<Select defaultValue="30d"><option>7 days</option><option>30 days</option><option>90 days</option></Select>} />
        </SettingsSection>

        <SettingsSection id="memory" title="Memory" description="Cross-session memo behavior." icon={<Brain size={14} aria-hidden="true" />}>
          <SettingsRow id="memory-auto-commit" label="Auto-commit project memos" control={<Switch defaultChecked />} />
        </SettingsSection>

        <SettingsSection id="privacy" title="Privacy" description="What the harness sends." icon={<ShieldCheck size={14} aria-hidden="true" />}>
          <SettingsRow
            id="privacy-analytics"
            label="Anonymous analytics"
            control={<Switch checked={analytics} onCheckedChange={setAnalytics} />}
          />
          <SettingsRow
            id="privacy-crash"
            label="Crash reports"
            control={<Switch checked={crashReports} onCheckedChange={setCrashReports} />}
          />
        </SettingsSection>

        <SettingsSection id="advanced" title="Advanced" description="Power-user toggles." icon={<SettingsIcon size={14} aria-hidden="true" />}>
          <SettingsRow
            id="advanced-reduced-motion"
            label="Reduce motion"
            description="Disable non-essential transitions."
            control={<Switch checked={reducedMotion} onCheckedChange={setReducedMotion} />}
          />
          <SettingsRow
            id="advanced-debug"
            label="Debug overlay"
            description="Show agent + tool call traces in the topbar."
            control={<Switch />}
          />
        </SettingsSection>
      </Stack>
    </Grid>
  );
}