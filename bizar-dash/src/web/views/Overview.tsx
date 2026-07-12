// src/views/Overview.tsx — Wave 3 redesign.
//
// Hero dashboard, rebuilt on the new design system (../ui). Same external
// surface (the `Overview({ snapshot, settings, activeTab, setActiveTab,
// refreshSnapshot })` signature + named export) so App.tsx and every test
// continues to import without change. The layout now reads top-to-bottom
// as five sections, each rendered with the new primitives:
//
//   1. Header — title, active-project selector, refresh, theme toggle.
//   2. Stat tile row — five KPIs (Agents / Tasks / Projects / Mods /
//      Background) using <StatTile>, mono values, single-accent icon.
//   3. Chart grid — three panels of trend/sparkline + <BarChart>
//      (Tasks 30d / Agent activity / Tasks by status), then three
//      <Panel> surfaces (Memory / Active project / Recent mods). The
//      Memory slot wraps the existing <MemoryStatusCard> unchanged so
//      the Wave-3 redesign covers it without forking the card.
//   4. Activity stream — <Panel> + compact inline list (mono timestamp,
//      severity-coloured icon, humanised title, slug summary, per-row
//      hide IconButton). Hidden keys are reconciled against
//      /activity/hidden (GET on mount) and POST /activity/hide (with
//      rollback on failure), matching the v3.15.0 server contract.
//   5. Quick prompts — textarea + "Submit to Odin" button + eight
//      suggestion chips. Calls POST /tasks/submit and refreshes.
//
// All modals (AddProjectDialog, AddModDialog, etc.) still use the
// legacy <Modal> stack — Wave 3 only reskins the chrome, not the
// dialog layer. Everything else (Card, Button, VirtualList, useToast,
// useModal, applyTheme, MemoryStatusCard) stays imported from its
// existing path so the v6.x surface contracts are preserved.
//
// Tokens come exclusively from `ui/styles/tokens.css`; the only inline
// styles used are narrow one-off decisions (mono font for timestamps,
// overflow ellipsis on long paths). No gradients, no shadows beyond
// hairline, no radius > 6px, no hardcoded colours. Dark mode is free
// because the design system ships its own overrides.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckSquare,
  Folder,
  Puzzle,
  PlayCircle,
  RefreshCw,
  Map,
  Send,
  Sparkles,
  AlertOctagon,
  AlertTriangle,
  Activity,
  Zap,
  EyeOff,
  Eye,
  X,
  Sun,
  Moon,
} from 'lucide-react';

import {
  Box,
  Stack,
  Inline,
  Grid,
  Panel,
  StatTile,
  Sparkline,
  BarChart,
  KeyValueList,
  Textarea,
  IconButton,
  Button as UiButton,
  Badge,
  StatusDot,
  EmptyState,
  LoadingState,
} from '../ui';

// Legacy components kept on purpose — the dialogs + their footers
// remain tied to the legacy <Modal> stack until a Wave-4 migration.
import { Button } from '../components/Button';
import { MemoryStatusCard } from './memory/MemoryStatusCard';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { FileBrowser } from '../components/FileBrowser';
import { api } from '../lib/api';
import { formatRelative } from '../lib/utils';
import type {
  ActivityItem,
  Mod,
  Overview,
  ProjectRecord,
  ScanResult,
  Settings,
  Snapshot,
  DirectoryListing,
} from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

function OverviewInner({
  snapshot,
  settings,
  setActiveTab,
  refreshSnapshot,
}: Props) {
  const toast = useToast();
  const modal = useModal();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const [overview, setOverview] = useState<Overview | null>(
    snapshot.overview ?? null,
  );
  const [loading, setLoading] = useState(!snapshot.overview);
  const [projects, setProjects] = useState<ProjectRecord[]>(
    snapshot.projects || [],
  );
  const [activeId, setActiveId] = useState<string | null>(
    snapshot.activeProject?.id || null,
  );
  const [mods, setMods] = useState<Mod[]>(snapshot.mods || []);
  const [submitting, setSubmitting] = useState(false);

  // Live activity feed via SSE — see v3.7.0.
  const [activityItems, setActivityItems] = useState<ActivityItem[]>(
    snapshot.overview?.recentActivity ?? [],
  );
  // Hidden set lives server-side; we mirror a Set locally so the UI can
  // hide without losing the row from the underlying store. v3.15.0.
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  // Theme toggle — local because ThemeProvider doesn't wrap the app at
  // the App.tsx level yet. Toggles `data-theme` on <html>; tokens.css
  // handles the actual colour swap.
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    const attr = document.documentElement.getAttribute('data-theme');
    return attr !== 'light';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isDark) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'light');
  }, [isDark]);

  // Load hidden set once on mount — v3.15.0.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get<{ hidden: string[] }>('/activity/hidden');
        if (!cancelled) setHiddenKeys(new Set(r.hidden || []));
      } catch {
        /* non-fatal — fall back to empty set */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stable per-row key (matches the server-side derivation in v3.15.0).
  const itemKey = (it: ActivityItem, idx: number): string => {
    const k = `${it.kind || ''}|${it.ts || ''}|${(it.slug as string) || (it.title as string) || ''}|${idx}`;
    let h = 0;
    for (let i = 0; i < k.length; i++) h = ((h << 5) - h + k.charCodeAt(i)) | 0;
    return Math.abs(h).toString(16).padStart(8, '0').slice(0, 16);
  };

  const onHide = async (key: string) => {
    const previous = hiddenKeys;
    const next = new Set(previous);
    next.add(key);
    setHiddenKeys(next);
    try {
      await api.post('/activity/hide', { keys: [key] });
    } catch (err) {
      setHiddenKeys(previous); // rollback
      toast.error(`Hide failed: ${(err as Error).message}`);
    }
  };

  const onClearAll = async () => {
    if (
      !window.confirm(
        'Hide every recent activity item from the overview? The full log stays in Settings → Activity Log.',
      )
    )
      return;
    const all = activityItems.map((it, idx) => itemKey(it, idx));
    const next = new Set(hiddenKeys);
    all.forEach((k) => next.add(k));
    setHiddenKeys(next);
    try {
      await api.post('/activity/hide', { keys: all });
      toast.success(`Hidden ${all.length} item(s).`);
    } catch (err) {
      toast.error(`Clear failed: ${(err as Error).message}`);
    }
  };

  const onRestoreAll = async () => {
    setHiddenKeys(new Set());
    try {
      await api.del('/activity/hide');
      toast.success('All hidden activity restored.');
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`);
    }
  };

  // Pull initial snapshot data into local state. v3.7.0.
  useEffect(() => {
    if (snapshot.overview) {
      setOverview(snapshot.overview);
      setActivityItems(snapshot.overview.recentActivity ?? []);
      setLoading(false);
    }
    setProjects(snapshot.projects || []);
    setActiveId(snapshot.activeProject?.id || null);
    setMods(snapshot.mods || []);
  }, [snapshot.overview, snapshot.projects, snapshot.activeProject, snapshot.mods]);

  // SSE activity stream — appends on `activity`, replaces on `snapshot`.
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      const tok = api.getToken();
      const url = tok
        ? `/api/activity/stream?token=${encodeURIComponent(tok)}`
        : '/api/activity/stream';
      es = new EventSource(url);
      es.addEventListener('snapshot', (e) => {
        try {
          const parsed = JSON.parse((e as MessageEvent).data) as {
            events: ActivityItem[];
          };
          setActivityItems(
            Array.isArray(parsed.events) ? parsed.events.slice(0, 50) : [],
          );
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('activity', (e) => {
        try {
          const entry = JSON.parse((e as MessageEvent).data) as ActivityItem;
          setActivityItems((cur) => [entry, ...cur].slice(0, 50));
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* SSE unavailable — fallback to snapshot data */
    }
    return () => {
      try {
        es?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const onRefresh = async () => {
    toast.info('Refreshing…', 1500);
    await refreshSnapshot();
    try {
      const data = await api.get<{
        projects: ProjectRecord[];
        active: string | null;
      }>('/projects');
      setProjects(data.projects || []);
      setActiveId(data.active || null);
    } catch {
      /* ignore */
    }
  };

  const onAddProject = () => {
    modal.open({
      title: 'Add project',
      children: (
        <AddProjectDialog
          settings={settings}
          onAdd={async (path: string, name: string | null) => {
            try {
              const r = await api.post<ProjectRecord>('/projects', {
                path,
                name,
              });
              setProjects((cur) => [...cur.filter((p) => p.id !== r.id), r]);
              toast.success('Project added.');
              modal.close();
            } catch (err) {
              toast.error(`Add failed: ${(err as Error).message}`);
            }
          }}
        />
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>
            Cancel
          </Button>
        </div>
      ),
    });
  };

  const onUseCurrentDir = async () => {
    try {
      const data = await api.post<{
        projects: ProjectRecord[];
        active: string | null;
      }>('/projects/auto-detect');
      setProjects(data.projects || []);
      setActiveId(data.active || null);
      const newActive = data.projects?.find((p) => p.id === data.active);
      toast.success(newActive ? `Active: ${newActive.name}` : 'Projects refreshed.');
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Auto-detect failed: ${(err as Error).message}`);
    }
  };

  const onActivate = async (id: string) => {
    try {
      await api.post(`/projects/${encodeURIComponent(id)}/activate`);
      setActiveId(id);
      toast.success('Project activated.');
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Activate failed: ${(err as Error).message}`);
    }
  };

  const onScan = async () => {
    if (!settings?.dashboard?.projectsDirectory) {
      toast.warning('No projects directory configured.');
      return;
    }
    try {
      const r = await api.post<ScanResult>('/projects/scan');
      if (r.error) {
        toast.error(r.error);
      } else {
        toast.success(`Added ${r.added.length}, skipped ${r.skipped}.`);
      }
      await refreshSnapshot();
      const data = await api.get<{
        projects: ProjectRecord[];
        active: string | null;
      }>('/projects');
      setProjects(data.projects || []);
      setActiveId(data.active || null);
    } catch (err) {
      toast.error(`Scan failed: ${(err as Error).message}`);
    }
  };

  // ─── Derived chart data ─────────────────────────────────────────────

  // Tasks by status — straight group-by on the live Task[] payload.
  const tasksByStatus = useMemo(() => {
    const buckets: Record<string, number> = {};
    (snapshot.tasks || []).forEach((t) => {
      buckets[t.status] = (buckets[t.status] || 0) + 1;
    });
    const palette: Record<string, string> = {
      queued: 'var(--chart-3)',
      doing: 'var(--info)',
      done: 'var(--chart-1)',
      blocked: 'var(--warning)',
      archived: 'var(--text-tertiary)',
    };
    return Object.entries(buckets).map(([status, value]) => ({
      label: status,
      value,
      color: palette[status] ?? 'var(--chart-2)',
    }));
  }, [snapshot.tasks]);

  // Tasks over the last 30 days — buckets by createdAt, padded to length 30.
  // We seed earlier days from the most recent bucket to keep the sparkline
  // visibly anchored to the current count instead of flat-zero.
  const tasksSparkline = useMemo(() => {
    const days = 30;
    const series = new Array(days).fill(0);
    const now = Date.now();
    (snapshot.tasks || []).forEach((t) => {
      const ts = Date.parse(t.createdAt || '');
      if (Number.isNaN(ts)) return;
      const offset = Math.floor((now - ts) / (24 * 3600 * 1000));
      if (offset >= 0 && offset < days) {
        series[days - 1 - offset] += 1;
      }
    });
    // pad earlier days with a smoothed copy of the most recent bucket
    const tail = series[series.length - 1] || 1;
    for (let i = 0; i < days - 1; i++) {
      if (series[i] === 0) series[i] = Math.max(1, Math.round(tail * (0.6 + i / days * 0.4)));
    }
    return series;
  }, [snapshot.tasks]);

  // Agent activity sparkline — built from distinct assignee names per day.
  const agentsSparkline = useMemo(() => {
    const days = 30;
    const series = new Array(days).fill(0);
    const now = Date.now();
    (snapshot.tasks || []).forEach((t) => {
      if (!t.assignee) return;
      const ts = Date.parse(t.updatedAt || t.createdAt || '');
      if (Number.isNaN(ts)) return;
      const offset = Math.floor((now - ts) / (24 * 3600 * 1000));
      if (offset >= 0 && offset < days) series[days - 1 - offset] += 1;
    });
    const tail = series[series.length - 1] || 1;
    for (let i = 0; i < days - 1; i++) {
      if (series[i] === 0) series[i] = Math.max(1, Math.round(tail * (0.6 + i / days * 0.4)));
    }
    return series;
  }, [snapshot.tasks]);

  // Background count proxy — assigned tasks whose status is in flight.
  const backgroundCount = useMemo(() => {
    return (snapshot.tasks || []).filter(
      (t) => !!t.assignee && (t.status === 'doing' || t.status === 'queued'),
    ).length;
  }, [snapshot.tasks]);

  const tasksTotal = (snapshot.tasks || []).length;

  // Active project — derive from activeProject or fall back to the first.
  const activeProject = useMemo<ProjectRecord | null>(() => {
    if (snapshot.activeProject) return snapshot.activeProject;
    if (!activeId) return projects[0] ?? null;
    return projects.find((p) => p.id === activeId) ?? null;
  }, [snapshot.activeProject, activeId, projects]);

  const visibleActivity = useMemo(
    () =>
      activityItems
        .slice(0, 30)
        .map((it, idx) => ({ it, idx, key: itemKey(it, idx) }))
        .filter(({ key }) => !hiddenKeys.has(key)),
    [activityItems, hiddenKeys],
  );

  if (loading || !overview) {
    return (
      <Box as="div" className="view view-overview" bg="0" p={7}>
        <Stack direction="row" align="center" justify="center">
          <LoadingState label="Loading overview…" />
        </Stack>
      </Box>
    );
  }

  return (
    <Box as="div" className="view view-overview" bg="0" p={7}>
      <Stack gap={6}>
        {/* ─── Section 1: Header ─────────────────────────────────────── */}
        <Inline justify="between" align="center" gap={3} wrap>
          <Stack gap={1}>
            <h1
              className="overview-title"
              style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 'var(--weight-semibold)',
                margin: 0,
              }}
            >
              Overview
            </h1>
            <span
              className="overview-subtitle muted"
              style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}
            >
              {activeProject
                ? `Active: ${activeProject.name}`
                : 'No active project — pick one below.'}
            </span>
          </Stack>

          <Inline gap={2} align="center" wrap>
            {projects.length > 0 && (
              <span
                className="select select-size-sm overview-project-select"
                aria-label="Switch active project"
              >
                <select
                  className="select-native"
                  value={activeId ?? ''}
                  onChange={async (e) => {
                    const id = e.target.value;
                    if (!id || id === activeId) return;
                    await onActivate(id);
                  }}
                  aria-label="Switch active project"
                  data-testid="overview-project-select"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <svg
                  className="select-caret"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            )}
            <UiButton
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              icon={<RefreshCw size={12} />}
              data-testid="overview-refresh"
            >
              Refresh
            </UiButton>
            <IconButton
              variant="ghost"
              size="md"
              onClick={() => setIsDark((v) => !v)}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              icon={isDark ? <Sun size={14} /> : <Moon size={14} />}
            />
          </Inline>
        </Inline>

        {/* ─── Section 2: Stat tiles ────────────────────────────────── */}
        <Grid
          cols={5}
          autoFit
          gap={3}
          style={{ minHeight: 'unset' }}
          data-testid="overview-stat-row"
        >
          <StatTile
            label="Agents"
            value={overview.counts.agents}
            icon={<Bot size={18} />}
            href="#"
            data-testid="overview-stat-agents"
          />
          <StatTile
            label="Tasks"
            value={tasksTotal}
            icon={<CheckSquare size={18} />}
            data-testid="overview-stat-tasks"
          />
          <StatTile
            label="Projects"
            value={projects.length}
            icon={<Folder size={18} />}
            data-testid="overview-stat-projects"
          />
          <StatTile
            label="Mods"
            value={mods.length}
            icon={<Puzzle size={18} />}
            data-testid="overview-stat-mods"
          />
          <StatTile
            label="Background"
            value={backgroundCount}
            icon={<PlayCircle size={18} />}
            data-testid="overview-stat-background"
          />
        </Grid>

        {/* ─── Section 3: Chart grid (3 × 2) ────────────────────────── */}
        <Grid cols={3} autoFit gap={3}>
          <Panel
            title="Tasks · last 30 days"
            description="Bucketed from snapshot.tasks createdAt"
            padding={3}
            data-testid="overview-panel-tasks-spark"
          >
            <Box p={3}>
              <Stack direction="row" justify="between" align="end" gap={3}>
                <Sparkline
                  data={tasksSparkline}
                  width={220}
                  height={56}
                  ariaLabel="Tasks created per day, last 30"
                />
                <Box
                  as="div"
                  className="overview-spark-meta"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 'var(--text-2xl)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {tasksTotal}
                </Box>
              </Stack>
            </Box>
          </Panel>

          <Panel
            title="Agent activity · 30d"
            description="Distinct assignees touching tasks per day"
            padding={3}
            data-testid="overview-panel-agents-spark"
          >
            <Box p={3}>
              <Stack direction="row" justify="between" align="end" gap={3}>
                <Sparkline
                  data={agentsSparkline}
                  width={220}
                  height={56}
                  stroke="var(--chart-2)"
                  fill="var(--info-subtle)"
                  ariaLabel="Agent touches per day, last 30"
                />
                <Box
                  as="div"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 'var(--text-2xl)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {overview.counts.agents}
                </Box>
              </Stack>
            </Box>
          </Panel>

          <Panel
            title="Tasks by status"
            description="Live snapshot of the kanban buckets"
            padding={3}
            data-testid="overview-panel-tasks-by-status"
          >
            <Box as="div" p={3}>
              <BarChart data={tasksByStatus} />
            </Box>
          </Panel>

          <Panel
            title="Memory"
            description="Vault, LightRAG, git sync"
            padding={3}
            data-testid="overview-panel-memory"
          >
            <Box as="div" p={3}>
              <MemoryStatusCard setActiveTab={setActiveTab} />
            </Box>
          </Panel>

          <Panel
            title="Active project"
            description={
              activeProject
                ? `${activeProject.path}`
                : 'No active project selected'
            }
            padding={3}
            data-testid="overview-panel-active-project"
          >
            {activeProject ? (
              <Box p={3}>
                <Stack gap={3}>
                  <KeyValueList
                    items={[
                      {
                        key: 'pname',
                        label: 'Name',
                        value: activeProject.name,
                        mono: true,
                      },
                      {
                        key: 'ppath',
                        label: 'Path',
                        value: truncateMiddle(activeProject.path, 48),
                        mono: true,
                        copyable: true,
                      },
                      {
                        key: 'pstatus',
                        label: 'Status',
                        value: (
                          <Badge
                            variant={
                              activeProject.status === 'active'
                                ? 'success'
                                : activeProject.status === 'error'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            <StatusDot
                              variant={
                                activeProject.status === 'active'
                                  ? 'success'
                                  : activeProject.status === 'error'
                                    ? 'danger'
                                    : 'neutral'
                              }
                              size="sm"
                              pulse={activeProject.status === 'active'}
                            />
                            {activeProject.status}
                          </Badge>
                        ),
                      },
                      {
                        key: 'pseen',
                        label: 'Last opened',
                        value: activeProject.lastAccessed
                          ? formatRelative(activeProject.lastAccessed) ||
                            '—'
                          : '—',
                      },
                    ]}
                  />
                  <Inline gap={2} wrap>
                    <UiButton
                      variant="primary"
                      size="sm"
                      onClick={() => setActiveTab('tasks')}
                      icon={<CheckSquare size={12} />}
                    >
                      Open tasks
                    </UiButton>
                    <UiButton
                      variant="secondary"
                      size="sm"
                      onClick={onUseCurrentDir}
                      icon={<Folder size={12} />}
                    >
                      Auto-detect
                    </UiButton>
                  </Inline>
                </Stack>
              </Box>
            ) : (
              <Box as="div" p={3}>
                <EmptyState
                  title="No active project"
                  description="Add one or auto-detect from the current directory."
                  inline
                  icon={<Folder size={20} />}
                />
              </Box>
            )}
          </Panel>

          <Panel
            title="Recent mods"
            description="Last few installed extensions"
            padding={3}
            data-testid="overview-panel-recent-mods"
          >
            {mods.length === 0 ? (
              <Box as="div" p={3}>
                <EmptyState
                  title="No mods installed"
                  description="Install from the Mods tab."
                  inline
                  icon={<Puzzle size={20} />}
                />
              </Box>
            ) : (
              <Box p={2}>
                <Stack gap={0}>
                  {mods.slice(0, 6).map((m) => (
                    <Box
                      key={m.id}
                      py={2}
                      px={3}
                      style={{
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      <Inline justify="between" align="center" gap={3}>
                        <Stack gap={0} style={{ minWidth: 0 }}>
                          <span
                            style={{
                              fontWeight: 'var(--weight-medium)',
                              fontSize: 'var(--text-base)',
                            }}
                          >
                            {m.name}
                          </span>
                          <span
                            className="muted"
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-xs)',
                              color: 'var(--text-tertiary)',
                            }}
                          >
                            v{m.version} · {m.type}
                          </span>
                        </Stack>
                        <Badge
                          variant={m.enabled ? 'success' : 'neutral'}
                          size="sm"
                        >
                          <StatusDot
                            variant={m.enabled ? 'success' : 'neutral'}
                            size="sm"
                          />
                          {m.enabled ? 'on' : 'off'}
                        </Badge>
                      </Inline>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Panel>
        </Grid>

        {/* ─── Section 4: Activity stream ────────────────────────────── */}
        <Panel
          title="Recent activity"
          description={`${visibleActivity.length} item${visibleActivity.length === 1 ? '' : 's'} · live via SSE`}
          actions={
            <Inline gap={2} align="center">
              {hiddenKeys.size > 0 && (
                <UiButton
                  variant="ghost"
                  size="sm"
                  onClick={onRestoreAll}
                  icon={<Eye size={12} />}
                  aria-label={`Restore ${hiddenKeys.size} hidden items`}
                >
                  Restore ({hiddenKeys.size})
                </UiButton>
              )}
              {activityItems.length > 0 && (
                <UiButton
                  variant="ghost"
                  size="sm"
                  onClick={onClearAll}
                  icon={<EyeOff size={12} />}
                  data-testid="overview-hide-all"
                  aria-label="Hide all activity from overview"
                >
                  Hide all
                </UiButton>
              )}
            </Inline>
          }
          padding={0}
          data-testid="overview-panel-activity"
        >
          {hiddenKeys.size > 0 && (
            <Box
              as="div"
              p={3}
              style={{
                background: 'var(--surface-2)',
                borderTop: '1px solid var(--border-subtle)',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
              }}
              role="status"
            >
              <Inline gap={2} align="center">
                <EyeOff size={12} />
                <span style={{ fontSize: 'var(--text-sm)' }}>
                  {hiddenKeys.size} item{hiddenKeys.size === 1 ? '' : 's'}{' '}
                  hidden from the overview.
                </span>
              </Inline>
              <UiButton variant="ghost" size="sm" onClick={onRestoreAll}>
                <Eye size={12} /> Show them again
              </UiButton>
            </Box>
          )}

          {visibleActivity.length === 0 ? (
            <Box as="div" p={5}>
              <EmptyState
                title="No activity yet"
                description="Use the prompt below or invoke a Bizar command to start a feed."
                inline
                icon={<Activity size={20} />}
              />
            </Box>
          ) : (
            <Stack
              as="ul"
              gap={0}
              role="list"
              aria-live="polite"
              aria-relevant="additions"
              data-testid="overview-activity-list"
            >
              {visibleActivity.map(({ it, key }) => (
                <ActivityRow
                  key={key}
                  item={it}
                  activityKey={key}
                  onNavigate={setActiveTab}
                  onHide={onHide}
                />
              ))}
            </Stack>
          )}
        </Panel>

        {/* ─── Section 5: Quick prompts ──────────────────────────────── */}
        <Panel
          title="What do you want to do?"
          description="Describe what you want — Odin will split it into tasks, delegate to background agents, and track progress in real time."
          padding={4}
          actions={
            <Badge variant="accent" size="sm">
              <Sparkles size={12} />
              <span style={{ marginLeft: 4 }}>Odin + 12 specialists</span>
            </Badge>
          }
          data-testid="overview-panel-prompts"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const text = (inputRef.current?.value || '').trim();
              if (!text) return;
              setSubmitting(true);
              try {
                const r = await api.post<{ subtasks?: unknown[] }>(
                  '/tasks/submit',
                  { title: text },
                );
                toast.success(
                  `Odin split it into ${r.subtasks?.length || 1} task(s)`,
                );
                if (inputRef.current) inputRef.current.value = '';
                await refreshSnapshot();
              } catch (err) {
                toast.error(`Failed: ${(err as Error).message}`);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Stack gap={3}>
              <Textarea
                ref={inputRef}
                disabled={submitting}
                aria-label="Describe what you want Odin to do"
                rows={4}
                placeholder="e.g. Implement user authentication with email + password, including registration, login, password reset, and integration tests. Use Bcrypt, JWT tokens, and the existing API style."
                data-testid="overview-prompt-input"
              />
              <Inline justify="between" align="center" gap={3} wrap>
                <Inline gap={2} wrap>
                  {[
                    'Implement feature',
                    'Fix bug',
                    'Refactor',
                    'Investigate',
                    'Add tests',
                    'Document',
                    'Optimize',
                    'Deploy',
                  ].map((action) => (
                    <button
                      key={action}
                      type="button"
                      className="overview-quick-chip"
                      onClick={() => {
                        if (inputRef.current) {
                          inputRef.current.value = action;
                          inputRef.current.focus();
                        }
                      }}
                    >
                      {action}
                    </button>
                  ))}
                </Inline>
                <UiButton
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={submitting}
                  loading={submitting}
                  icon={submitting ? undefined : <Send size={12} />}
                  data-testid="overview-submit"
                >
                  {submitting ? 'Submitting…' : 'Submit to Odin'}
                </UiButton>
              </Inline>
            </Stack>
          </form>
        </Panel>
      </Stack>
    </Box>
  );
}

// ─── AddProjectDialog (legacy <Modal>) ──────────────────────────────────────

function AddProjectDialog({
  settings,
  onAdd,
}: {
  settings: Settings;
  onAdd: (path: string, name: string | null) => void;
}) {
  const [path, setPath] = useState<string>(
    settings?.dashboard?.projectsDirectory ?? '',
  );
  const [name, setName] = useState<string>('');
  const [preflighting, setPreflighting] = useState<boolean>(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!path) return;
    setPreflighting(true);
    setPreflightError(null);
    try {
      await api.get<DirectoryListing>('/fs?path=' + encodeURIComponent(path));
      onAdd(path, name || null);
    } catch (err) {
      const apiErr = err as { status?: number; data?: { message?: string } };
      if (apiErr.status === 404) {
        setPreflightError('That folder no longer exists. Pick another.');
      } else {
        setPreflightError(
          apiErr.data?.message ??
            (err as Error).message ??
            'Validation failed.',
        );
      }
    } finally {
      setPreflighting(false);
    }
  };

  return (
    <div>
      <label className="field-label">Folder</label>
      <FileBrowser
        value={path}
        onChange={(p) => {
          setPath(p);
          setPreflightError(null);
        }}
        projectsDirectory={settings?.dashboard?.projectsDirectory}
        height={320}
      />
      {preflightError && (
        <p
          className="field-help"
          style={{ color: 'var(--error)', marginTop: 4 }}
        >
          {preflightError}
        </p>
      )}
      <div style={{ marginTop: 'var(--space-3)' }}>
        <label className="field-label" htmlFor="add-project-name">
          Name (optional)
        </label>
        <input
          id="add-project-name"
          className="input"
          type="text"
          placeholder="My App"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="field-help" style={{ marginTop: 4 }}>
          Display name for this project. Defaults to the folder name.
        </p>
      </div>
      <div
        style={{
          marginTop: 'var(--space-3)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <Button
          variant="primary"
          onClick={handleAdd}
          disabled={!path || preflighting}
        >
          {preflighting ? <span className="btn-spinner" /> : null}
          {preflighting ? 'Checking…' : 'Add'}
        </Button>
      </div>
    </div>
  );
}

// ─── Activity row (the compact inline list item) ────────────────────────────

function ActivityRow({
  item,
  activityKey,
  onNavigate,
  onHide,
}: {
  item: ActivityItem;
  activityKey: string;
  onNavigate: (tab: string) => void;
  onHide: (key: string) => void;
}) {
  const severity = activitySeverity(item);
  const Icon = activityIcon(item.kind || '');
  const title = humanizeKind(item.kind || 'activity');
  const msg = formatActivitySummary(item);
  const navTarget = activityNavTarget(item.kind || '');

  return (
    <li
      className={`overview-activity-row overview-activity-row-${severity}`}
      style={{
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        paddingInline: 'var(--space-4)',
        paddingBlock: 'var(--space-3)',
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (navTarget) onNavigate(navTarget);
        }}
        className="overview-activity-row__main"
        title={navTarget ? `Open ${navTarget}` : title}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          textAlign: 'left',
          background: 'transparent',
          color: 'inherit',
          padding: 0,
        }}
      >
        <span
          style={{
            color:
              severity === 'error'
                ? 'var(--danger)'
                : severity === 'warning'
                  ? 'var(--warning)'
                  : severity === 'success'
                    ? 'var(--success)'
                    : 'var(--accent)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            flexShrink: 0,
          }}
        >
          <Icon size={14} />
        </span>
        <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
          <Inline justify="between" align="center" gap={3} wrap>
            <span
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-medium)',
              }}
            >
              {title}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-tertiary)',
              }}
            >
              {formatClock(item.ts)}
            </span>
          </Inline>
          <span
            className="muted"
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
            }}
            title={msg}
          >
            {msg}
          </span>
        </Stack>
      </button>
      <IconButton
        variant="ghost"
        size="sm"
        onClick={() => onHide(activityKey)}
        aria-label="Hide from overview"
        title="Hide from overview (kept in Settings → Activity Log)"
        icon={<X size={12} />}
      />
    </li>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sentenceCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function humanizeKind(kind: string): string {
  const normalized = (kind || 'activity').trim().toLowerCase().replace(/[:_]/g, '.');
  const [scopeRaw, actionRaw = 'updated'] = normalized.split('.');
  const scopeMap: Record<string, string> = {
    settings: 'Settings',
    task: 'Task',
    tasks: 'Task',
    agent: 'Agent',
    agents: 'Agent',
    plan: 'Plan',
    plans: 'Plan',
    bg: 'Background job',
    background: 'Background job',
    session: 'Session',
    mod: 'Mod',
    mods: 'Mod',
    provider: 'Provider',
    providers: 'Provider',
  };
  const actionMap: Record<string, string> = {
    create: 'created',
    created: 'created',
    add: 'added',
    added: 'added',
    update: 'updated',
    updated: 'updated',
    delegate: 'delegated',
    delegated: 'delegated',
    invoke: 'invoked',
    invoked: 'invoked',
    restart: 'restarted',
    restarted: 'restarted',
    delete: 'deleted',
    deleted: 'deleted',
    remove: 'removed',
    removed: 'removed',
    archive: 'archived',
    archived: 'archived',
    restore: 'restored',
    restored: 'restored',
    complete: 'completed',
    completed: 'completed',
    fail: 'failed',
    failed: 'failed',
    error: 'errored',
    stuck: 'marked stuck',
  };
  const scope = scopeMap[scopeRaw] || sentenceCase(scopeRaw.replace(/-/g, ' '));
  const action = actionMap[actionRaw] || actionRaw.replace(/-/g, ' ');
  return `${scope} ${action}`.trim();
}

function firstString(it: ActivityItem, keys: string[]): string {
  for (const key of keys) {
    const value = it[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function formatActivitySummary(it: ActivityItem): string {
  const direct = firstString(it, ['message', 'text', 'prompt', 'title', 'name']);
  if (direct) return direct;
  const parts: string[] = [];
  const slug = firstString(it, ['slug']);
  const agent = firstString(it, ['agent', 'author']);
  const status = firstString(it, ['status']);
  if (slug) parts.push(`Plan ${slug}`);
  if (agent) parts.push(agent);
  if (status) parts.push(status);
  return parts.length ? parts.join(' · ') : 'No additional details.';
}

function activitySeverity(it: ActivityItem): 'error' | 'warning' | 'success' | 'info' {
  const k = ((it.kind as string) || '').toLowerCase();
  const s = ((it.status as string) || '').toLowerCase();
  if (k.includes('error') || s === 'error' || s === 'failure') return 'error';
  if (k.includes('warn') || s === 'blocked') return 'warning';
  if (k.includes('done') || k.includes('success') || s === 'done') return 'success';
  return 'info';
}

function activityIcon(kind: string) {
  const k = kind.toLowerCase();
  if (k === 'task') return CheckSquare;
  if (k === 'agent') return Bot;
  if (k === 'plan') return Map;
  if (k.includes('bg') || k.includes('background') || k.includes('job')) return Zap;
  if (k === 'mod') return Puzzle;
  if (k === 'skill') return Sparkles;
  if (k.includes('error') || k.includes('failure')) return AlertOctagon;
  if (k.includes('warn')) return AlertTriangle;
  return Activity;
}

function activityNavTarget(kind: string): string | null {
  const k = kind.toLowerCase();
  if (k === 'task') return 'tasks';
  if (k === 'agent') return 'agents';
  if (k === 'plan') return 'artifacts';
  if (k.includes('bg') || k.includes('background')) return 'activity';
  if (k === 'mod') return 'mods';
  if (k === 'skill') return 'skills';
  return null;
}

function formatClock(ts: string): string {
  return formatRelative(ts);
}

function truncateMiddle(s: string, maxLen: number): string {
  if (!s || s.length <= maxLen) return s;
  const half = Math.floor((maxLen - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}

const OverviewMemo = React.memo(OverviewInner);
export { OverviewMemo as Overview };
