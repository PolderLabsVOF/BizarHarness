// src/views/Activity.tsx — v3.5.4: timeline-based activity view (replaces the v3.5.2 graph+strip hybrid).
// Layout: CSS grid with 3 sibling columns — left event stream, center timeline canvas, right detail panel.
// X axis is time; Y axis is lanes (BG instances + tasks). Active tasks pulse; queued tasks are translucent
// dashed; done tasks are faded. A red "now" line updates every 1s and re-anchors when it nears the right edge.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity as ActivityIcon,
  Bot,
  CheckSquare,
  Cpu,
  RefreshCw,
  Send,
  X,
  Plus,
  Trash2,
  MessageSquare,
  History,
  Pause,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  Layers,
  Target,
  FileText,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Settings, Snapshot, Task, Agent } from '../lib/types';
import { openArtifactViewer } from '../components/ArtifactViewer';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type BgInstance = {
  instanceId: string;
  agent?: string;
  status?: string;
  startedAt?: number;
  promptPreview?: string;
  resultPreview?: string;
  error?: string;
  parentAgent?: string;
  parentInstanceId?: string;
  tmuxSession?: string;
  tmuxActive?: boolean;
  taskId?: string; // v3.6.2 — linked task for artifact lookup
  _bgDir?: string;
};

type ActivityEvent = {
  ts: string;
  kind: string;
  nodeId?: string;
  text?: string;
  author?: string;
  taskId?: string;
  [k: string]: unknown;
};

// ─── Time / layout constants ──────────────────────────────────────────

const ZOOM_RANGES = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
} as const;
type ZoomKey = keyof typeof ZOOM_RANGES;

const LANE_HEIGHT = 56;
const TIME_AXIS_HEIGHT = 32;
const EVENTS_STRIP_HEIGHT = 22;
const MIN_BAR_WIDTH = 4;
const REANCHOR_RATIO = 0.9; // when now_x exceeds this fraction of canvas width, re-anchor viewStart

// ─── Status → color ───────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  working: 'var(--success)',
  running: 'var(--success)',
  doing: 'var(--info)',
  queued: 'var(--info)',
  done: 'var(--success)',
  success: 'var(--success)',
  blocked: 'var(--warning)',
  error: 'var(--error)',
  failed: 'var(--error)',
  stuck: 'var(--warning)',
  killed: 'var(--error)',
  idle: 'var(--text-dim)',
  pending: 'var(--info)',
  timed_out: 'var(--warning)',
};

function statusColor(s: string | null | undefined): string {
  if (!s) return STATUS_COLORS.idle;
  return STATUS_COLORS[s] || STATUS_COLORS.idle;
}

function shortLabel(s: string | null | undefined, n = 24): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

// ─── Time helpers ─────────────────────────────────────────────────────

function parseTs(ts: string | number | null | undefined): number {
  if (ts == null) return 0;
  if (typeof ts === 'number') return ts;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function taskStartMs(t: Task): number {
  // v3.5.4 — prefer _timerStart (set when work begins), fall back to createdAt.
  const ts = (t as { _timerStart?: number })._timerStart;
  if (typeof ts === 'number' && ts > 0) return ts;
  return parseTs(t.createdAt) || Date.now();
}

function taskEndMs(t: Task, now: number): number {
  if (t.status === 'done' || t.status === 'archived' || t.status === 'failed' || t.status === 'killed') {
    return parseTs(t.completedAt) || parseTs(t.updatedAt) || now;
  }
  // Active tasks: pin to now.
  return now;
}

function bgStartMs(b: BgInstance): number {
  return typeof b.startedAt === 'number' && b.startedAt > 0 ? b.startedAt : Date.now();
}

function bgEndMs(b: BgInstance, now: number): number {
  if (b.status === 'done' || b.status === 'killed' || b.status === 'failed' || b.status === 'error') return now;
  return now;
}

function chooseTickStep(rangeMs: number): number {
  if (rangeMs <= 60_000) return 10_000;
  if (rangeMs <= 300_000) return 30_000;
  if (rangeMs <= 1_800_000) return 300_000;
  return 600_000;
}

function formatTickLabel(t: number, rangeMs: number): string {
  const d = new Date(t);
  if (rangeMs <= 300_000) {
    return d.toLocaleTimeString('en-GB', { hour12: false });
  }
  return d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

// ─── Lane + tick types ────────────────────────────────────────────────

type Lane =
  | { kind: 'bg'; id: string; index: number; label: string; sub: string; start: number; end: number; data: BgInstance }
  | { kind: 'task'; id: string; index: number; label: string; sub: string; start: number; end: number; data: Task }
  | { kind: 'events'; id: string; index: number; label: string; sub: string; start: number; end: number };

type SelectedItem = {
  id: string;
  kind: 'task' | 'bg' | 'agent';
  label: string;
  status: string;
  data: Task | BgInstance | Agent;
};

type EventMarker = {
  id: string;
  x: number;
  y: number;
  kind: string;
  ts: number;
  text: string;
  author?: string;
};

type TaskBar = {
  id: string;
  laneIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  statusClass: 'doing' | 'done' | 'queued' | 'blocked' | 'failed';
  selected: boolean;
  data: Task | BgInstance;
  kind: 'task' | 'bg';
  start: number;
  end: number;
};

// ─── Component ────────────────────────────────────────────────────────

export function Activity({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  // View state
  const [mode, setMode] = useState<'live' | 'pause'>('live');
  const [zoom, setZoom] = useState<ZoomKey>('5m');
  const [streamOpen, setStreamOpen] = useState(true);

  // Data
  const [bgInstances, setBgInstances] = useState<BgInstance[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  // Time
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [viewStart, setViewStart] = useState<number>(() => Date.now() - ZOOM_RANGES['5m'] * 0.1);

  // Canvas size (observed)
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 800, height: 400 });

  // Selection / detail
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);

  // Detail panel local state
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<ActivityEvent[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('normal');
  const [bgMessage, setBgMessage] = useState('');
  const [bgOutput, setBgOutput] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  // v3.6.2 — artifact IDs fetched from the task linked to the selected bg instance.
  const [bgArtifactIds, setBgArtifactIds] = useState<string[]>([]);

  const modal = useModal();

  const agents = snapshot.agents || [];
  const tasks = snapshot.tasks || [];
  const rangeMs = ZOOM_RANGES[zoom];
  const rangeStart = viewStart;
  const rangeEnd = viewStart + rangeMs;

  // ─── Data polling ───────────────────────────────────────────────────
  const reloadAll = useCallback(async () => {
    try {
      const [bgRes, evRes] = await Promise.all([
        api.get<{ instances: BgInstance[] }>('/background').catch(() => ({ instances: [] })),
        api.get<{ events: ActivityEvent[] }>('/activity?limit=200').catch(() => ({ events: [] })),
      ]);
      setBgInstances(bgRes.instances || []);
      setEvents(evRes.events || []);
    } catch (err) {
      console.warn('activity reload failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadAll();
    const id = setInterval(reloadAll, 3000);
    return () => clearInterval(id);
  }, [reloadAll]);

  // Trigger a re-fetch when the snapshot's task/agent counts change.
  useEffect(() => {
    setRefreshTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length, agents.length]);

  // ─── Now tick (1s) — paused when mode === 'pause' ───────────────────
  useEffect(() => {
    if (mode === 'pause') return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mode, refreshTick]);

  // ─── Re-anchor viewStart when the now line nears the right edge ────
  useEffect(() => {
    if (mode === 'pause') return;
    const nowRatio = (nowTick - viewStart) / rangeMs;
    if (nowRatio > REANCHOR_RATIO) {
      setViewStart(nowTick - rangeMs * 0.1);
    }
  }, [nowTick, viewStart, rangeMs, mode]);

  // On zoom change, reset viewStart so now sits at 10% from the left.
  useEffect(() => {
    setViewStart(Date.now() - rangeMs * 0.1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // On resume from pause, re-anchor so the now line lands at 10%.
  useEffect(() => {
    if (mode === 'live') {
      setViewStart(Date.now() - rangeMs * 0.1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ─── Canvas size observer ───────────────────────────────────────────
  useLayoutEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize({
          width: Math.max(200, Math.floor(width)),
          height: Math.max(120, Math.floor(height)),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ─── Lane allocation ────────────────────────────────────────────────
  const lanes: Lane[] = useMemo(() => {
    const out: Lane[] = [];
    let idx = 0;

    // BG instances — one lane each, at the top.
    for (const bg of bgInstances) {
      out.push({
        kind: 'bg',
        id: `bg:${bg.instanceId}`,
        index: idx++,
        label: `BG ${shortLabel(bg.promptPreview, 20) || bg.instanceId.slice(0, 10)}`,
        sub: bg.status || 'pending',
        start: bgStartMs(bg),
        end: bgEndMs(bg, nowTick),
        data: bg,
      });
    }

    // Tasks — greedy lane assignment (fill first lane that has no overlap).
    const sorted = [...tasks].sort((a, b) => taskStartMs(a) - taskStartMs(b));
    const taskLaneEnds: number[] = []; // end-time of last task placed in each lane
    for (const t of sorted) {
      const s = taskStartMs(t);
      const e = taskEndMs(t, nowTick);
      let assigned = -1;
      for (let i = 0; i < taskLaneEnds.length; i++) {
        if (taskLaneEnds[i] <= s) {
          taskLaneEnds[i] = e;
          assigned = i;
          break;
        }
      }
      if (assigned === -1) {
        taskLaneEnds.push(e);
        assigned = taskLaneEnds.length - 1;
      }
      out.push({
        kind: 'task',
        id: `task:${t.id}`,
        index: idx + assigned,
        label: shortLabel(t.title, 32),
        sub: t.status,
        start: s,
        end: e,
        data: t,
      });
    }

    return out;
  }, [bgInstances, tasks, nowTick]);

  const laneById = useMemo(() => {
    const m = new Map<string, Lane>();
    for (const l of lanes) m.set(l.id, l);
    return m;
  }, [lanes]);

  // ─── Time → X coordinate ────────────────────────────────────────────
  const timeToX = useCallback(
    (t: number): number => {
      if (rangeMs <= 0) return 0;
      return ((t - rangeStart) / rangeMs) * canvasSize.width;
    },
    [rangeStart, rangeMs, canvasSize.width],
  );

  // ─── Tick marks for the time axis ───────────────────────────────────
  const ticks = useMemo(() => {
    const step = chooseTickStep(rangeMs);
    const result: { t: number; x: number; label: string }[] = [];
    // Align to step boundary.
    const startAligned = Math.floor(rangeStart / step) * step;
    for (let t = startAligned; t <= rangeEnd + step; t += step) {
      if (t < rangeStart - step) continue;
      if (t > rangeEnd) break;
      const x = timeToX(t);
      if (x < -40 || x > canvasSize.width + 40) continue;
      result.push({ t, x, label: formatTickLabel(t, rangeMs) });
    }
    return result;
  }, [rangeStart, rangeEnd, rangeMs, canvasSize.width, timeToX]);

  // ─── Build task/bg bars ─────────────────────────────────────────────
  const bars: TaskBar[] = useMemo(() => {
    const out: TaskBar[] = [];
    for (const lane of lanes) {
      if (lane.kind === 'events') continue;
      const x = timeToX(lane.start);
      const xEnd = timeToX(lane.end);
      const w = Math.max(MIN_BAR_WIDTH, xEnd - x);
      const y = TIME_AXIS_HEIGHT + EVENTS_STRIP_HEIGHT + lane.index * LANE_HEIGHT + 8;
      const h = LANE_HEIGHT - 16;

      let statusClass: TaskBar['statusClass'] = 'doing';
      if (lane.kind === 'bg') {
        const s = lane.data.status || 'pending';
        if (s === 'done' || s === 'success') statusClass = 'done';
        else if (s === 'failed' || s === 'killed' || s === 'error') statusClass = 'failed';
        else if (s === 'queued' || s === 'pending') statusClass = 'queued';
        else if (s === 'blocked' || s === 'stuck') statusClass = 'blocked';
        else statusClass = 'doing';
      } else {
        const s = lane.data.status;
        if (s === 'done' || s === 'archived') statusClass = 'done';
        else if (s === 'failed' || s === 'killed') statusClass = 'failed';
        else if (s === 'queued') statusClass = 'queued';
        else if (s === 'blocked') statusClass = 'blocked';
        else statusClass = 'doing';
      }

      const selected = selectedItem?.id === lane.id;

      out.push({
        id: lane.id,
        laneIndex: lane.index,
        x,
        y,
        w,
        h,
        label: lane.label,
        statusClass,
        selected,
        data: lane.data,
        kind: lane.kind,
        start: lane.start,
        end: lane.end,
      });
    }
    return out;
  }, [lanes, timeToX, selectedItem]);

  // ─── Build event markers (placed on the lane of their related entity) ─
  const eventMarkers: EventMarker[] = useMemo(() => {
    const out: EventMarker[] = [];
    for (const ev of events) {
      const ts = parseTs(ev.ts);
      if (ts < rangeStart - 5000 || ts > rangeEnd + 5000) continue;
      const x = timeToX(ts);

      // Try to find a related lane.
      let y = TIME_AXIS_HEIGHT + 12; // default: events strip
      if (ev.taskId) {
        const lane = laneById.get(`task:${ev.taskId}`);
        if (lane) y = TIME_AXIS_HEIGHT + EVENTS_STRIP_HEIGHT + lane.index * LANE_HEIGHT + LANE_HEIGHT / 2;
      } else if (ev.nodeId) {
        const id = String(ev.nodeId);
        const lane = laneById.get(id.startsWith('task:') || id.startsWith('bg:') ? id : `task:${id}`);
        if (lane) y = TIME_AXIS_HEIGHT + EVENTS_STRIP_HEIGHT + lane.index * LANE_HEIGHT + LANE_HEIGHT / 2;
      }

      out.push({
        id: `${ev.ts}-${ev.kind}-${ev.author ?? ''}-${ev.taskId ?? ''}`,
        x,
        y,
        kind: ev.kind || 'event',
        ts,
        text: String(ev.text || ev.kind || ''),
        author: ev.author as string | undefined,
      });
    }
    return out;
  }, [events, rangeStart, rangeEnd, timeToX, laneById]);

  // ─── Lane backgrounds (alternating) ─────────────────────────────────
  const laneRects = useMemo(() => {
    return lanes.map((lane) => ({
      id: lane.id,
      y: TIME_AXIS_HEIGHT + EVENTS_STRIP_HEIGHT + lane.index * LANE_HEIGHT,
      h: LANE_HEIGHT,
    }));
  }, [lanes]);

  // ─── Now line position ──────────────────────────────────────────────
  const nowX = useMemo(() => {
    const x = timeToX(nowTick);
    return Math.max(0, Math.min(canvasSize.width, x));
  }, [timeToX, nowTick, canvasSize.width]);

  // ─── Click on a bar → open detail panel ─────────────────────────────
  const onSelectBar = useCallback((bar: TaskBar) => {
    const id = bar.id; // 'task:xxx' or 'bg:xxx'
    const item: SelectedItem = {
      id,
      kind: bar.kind,
      label: bar.label,
      status: bar.statusClass,
      data: bar.data,
    };
    setSelectedItem(item);
  }, []);

  // ─── Detail panel: fetch related data when selection changes ────────
  useEffect(() => {
    if (!selectedItem) {
      setComments([]);
      setBgOutput('');
      setBgArtifactIds([]);
      return;
    }
    setCommentText('');
    setTaskTitle('');
    setBgMessage('');
    setBgArtifactIds([]);
    (async () => {
      try {
        const r = await api.get<{ events: ActivityEvent[] }>(
          `/activity?nodeId=${encodeURIComponent(selectedItem.id)}&limit=50`,
        );
        setComments(r.events || []);
      } catch {
        setComments([]);
      }
      if (selectedItem.kind === 'bg') {
        const bgData = selectedItem.data as BgInstance;
        try {
          const r = await api.get<{ output: string }>(
            `/background/${encodeURIComponent(bgData.instanceId)}/output?lines=80`,
          );
          setBgOutput(r.output || '');
        } catch {
          setBgOutput('');
        }
        // v3.6.2 — If the bg instance has a linked taskId, fetch its artifacts.
        if (bgData.taskId) {
          try {
            const artR = await api.get<{ artifacts: { id: string }[] }>(
              `/tasks/${encodeURIComponent(bgData.taskId)}/artifacts`,
            );
            setBgArtifactIds((artR.artifacts || []).map((a) => a.id));
          } catch {
            setBgArtifactIds([]);
          }
        }
      }
    })();
  }, [selectedItem]);

  // ─── Detail actions ─────────────────────────────────────────────────
  const onAddComment = async () => {
    if (!selectedItem || !commentText.trim()) return;
    setPostingComment(true);
    try {
      await api.post('/comments', { nodeId: selectedItem.id, text: commentText, author: 'user' });
      setCommentText('');
      const r = await api.get<{ events: ActivityEvent[] }>(
        `/activity?nodeId=${encodeURIComponent(selectedItem.id)}&limit=50`,
      );
      setComments(r.events || []);
      toast.success('Comment added.');
    } catch (err) {
      toast.error(`Comment failed: ${(err as Error).message}`);
    } finally {
      setPostingComment(false);
    }
  };

  const onCreateTaskFromNode = async () => {
    if (!selectedItem || !taskTitle.trim()) return;
    setCreatingTask(true);
    try {
      await api.post(`/nodes/${encodeURIComponent(selectedItem.id)}/tasks`, {
        title: taskTitle,
        description: `Created from timeline selection ${selectedItem.id}.`,
        priority: taskPriority,
      });
      setTaskTitle('');
      toast.success('Task created.');
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Task create failed: ${(err as Error).message}`);
    } finally {
      setCreatingTask(false);
    }
  };

  const onSendBgMessage = async () => {
    if (!selectedItem || selectedItem.kind !== 'bg' || !bgMessage.trim()) return;
    const bgData = selectedItem.data as BgInstance;
    try {
      const r = await api.post<{ ok: boolean; error?: string }>(
        `/background/${encodeURIComponent(bgData.instanceId)}/message`,
        { message: bgMessage },
      );
      if (r.ok) {
        toast.success('Message sent.');
        setBgMessage('');
      } else {
        toast.warning(r.error || 'Send failed');
      }
    } catch (err) {
      toast.error(`Send failed: ${(err as Error).message}`);
    }
  };

  const onKillBg = async () => {
    if (!selectedItem || selectedItem.kind !== 'bg') return;
    if (!confirm('Kill this bg instance session?')) return;
    const bgData = selectedItem.data as BgInstance;
    try {
      const r = await api.del<{ ok: boolean; error?: string }>(
        `/background/${encodeURIComponent(bgData.instanceId)}`,
      );
      if (r.ok) toast.success('Session killed.');
      else toast.warning(r.error || 'Kill failed');
      await reloadAll();
    } catch (err) {
      toast.error(`Kill failed: ${(err as Error).message}`);
    }
  };

  const refetchOutput = async () => {
    if (!selectedItem || selectedItem.kind !== 'bg') return;
    const bgData = selectedItem.data as BgInstance;
    try {
      const r = await api.get<{ output: string }>(
        `/background/${encodeURIComponent(bgData.instanceId)}/output?lines=80`,
      );
      setBgOutput(r.output || '');
    } catch {
      /* ignore */
    }
  };

  // ─── Keyboard helpers ───────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedItem(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Refresh handler ────────────────────────────────────────────────
  const refresh = () => {
    setRefreshTick((t) => t + 1);
    reloadAll();
  };

  // ─── Derived: total content height (for SVG sizing) ─────────────────
  const contentHeight = TIME_AXIS_HEIGHT + EVENTS_STRIP_HEIGHT + lanes.length * LANE_HEIGHT;

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className="view view-activity">
      {/* Top header bar — title + live/pause + zoom + refresh */}
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <ActivityIcon size={18} /> Activity
          </h2>
          <p className="view-subtitle">
            Live timeline of agents, tasks, and background sessions. Active tasks pulse; the red line marks &ldquo;now&rdquo;.
          </p>
        </div>
        <div className="view-actions">
          <div className="tl-mode-toggle">
            <Button
              variant={mode === 'live' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setMode(mode === 'live' ? 'pause' : 'live')}
              title={mode === 'live' ? 'Pause timeline' : 'Resume timeline'}
            >
              {mode === 'live' ? <Pause size={14} /> : <Play size={14} />}
              {mode === 'live' ? 'Live' : 'Paused'}
            </Button>
            <div className="tl-zoom-group">
              {(['1m', '5m', '30m', '1h'] as ZoomKey[]).map((z) => (
                <button
                  type="button"
                  key={z}
                  className={cn('tl-zoom-btn', zoom === z && 'tl-zoom-btn-active')}
                  onClick={() => setZoom(z)}
                  title={`Zoom to ${z}`}
                >
                  {z}
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={refresh} title="Refresh">
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
        </div>
      </header>

      {loading && (
        <div className="view-loading"><Spinner size="lg" /></div>
      )}

      {!loading && agents.length === 0 && tasks.length === 0 && bgInstances.length === 0 && events.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon size={32} />}
          title="No activity yet"
          message="Once agents, tasks, or background instances exist, they'll show up here on the timeline."
        />
      ) : (
        <div className={cn('tl-view', selectedItem && 'tl-view-detail-open')}>
          <div className="tl-body">
            {/* Left column — event stream (sibling, not overlay) */}
            <aside className={cn('tl-stream', !streamOpen && 'tl-stream-collapsed')}>
              <div className="tl-stream-head">
                <h3>
                  <History size={13} /> Live events
                </h3>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setStreamOpen(false)}
                  title="Hide event stream"
                  aria-label="Hide event stream"
                >
                  <PanelLeftClose size={14} />
                </button>
              </div>
              <div className="tl-stream-list">
                {events.length === 0 ? (
                  <div className="tl-stream-empty">
                    <p>No events yet.</p>
                  </div>
                ) : (
                  [...events].reverse().map((ev, i) => {
                    const Icon =
                      ev.author ? Bot : ev.kind === 'task' ? CheckSquare : ev.kind === 'bg' ? Cpu : ActivityIcon;
                    return (
                      <div
                        key={`${ev.ts}-${i}`}
                        className="tl-stream-event"
                        style={{ borderLeftColor: statusColor(ev.kind) }}
                      >
                        <span className="tl-stream-event-time">
                          {new Date(ev.ts).toLocaleTimeString('en-GB', { hour12: false })}
                        </span>
                        <span className="tl-stream-event-icon" style={{ color: statusColor(ev.kind) }}>
                          <Icon size={12} />
                        </span>
                        <span className="tl-stream-event-text">
                          {ev.author || ev.text || ev.kind}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </aside>

            {/* Center column — timeline canvas */}
            <div className="tl-canvas-wrap" ref={canvasWrapRef}>
              <div className="tl-canvas-toolbar">
                <div className="tl-canvas-toolbar-left">
                  {!streamOpen && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStreamOpen(true)}
                      title="Show event stream"
                    >
                      <PanelLeftOpen size={14} /> Events
                    </Button>
                  )}
                  <span className="tl-canvas-mode">
                    {mode === 'live' ? '● Live' : '⏸ Paused'}
                  </span>
                  <span className="tl-canvas-range">
                    {new Date(rangeStart).toLocaleTimeString('en-GB', { hour12: false })} →{' '}
                    {new Date(rangeEnd).toLocaleTimeString('en-GB', { hour12: false })}
                  </span>
                </div>
                <div className="tl-canvas-legend">
                  <span className="tl-legend-item"><span className="tl-legend-dot" style={{ background: 'var(--success)' }} /> active</span>
                  <span className="tl-legend-item"><span className="tl-legend-dot tl-legend-dot-dashed" style={{ borderColor: 'var(--info)' }} /> queued</span>
                  <span className="tl-legend-item"><span className="tl-legend-dot" style={{ background: 'var(--warning)' }} /> blocked</span>
                  <span className="tl-legend-item"><span className="tl-legend-dot" style={{ background: 'var(--error)' }} /> error</span>
                  <span className="tl-legend-sep" />
                  <span className="tl-legend-item"><Layers size={11} /> agent</span>
                  <span className="tl-legend-item"><Target size={11} /> task</span>
                  <span className="tl-legend-item"><Cpu size={11} /> bg</span>
                </div>
              </div>

              <div className="tl-canvas-scroll">
                <svg
                  className="tl-canvas"
                  width={canvasSize.width}
                  height={Math.max(canvasSize.height, contentHeight)}
                  role="application"
                  aria-label="Activity timeline"
                >
                  <defs>
                    <pattern
                      id="tl-canvas-grid"
                      width={canvasSize.width}
                      height={LANE_HEIGHT}
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d={`M 0 0 L 0 ${LANE_HEIGHT}`}
                        fill="none"
                        stroke="var(--border)"
                        strokeWidth={0.5}
                        opacity={0.35}
                      />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#tl-canvas-grid)" />

                  {/* Lane backgrounds (alternating) */}
                  {laneRects.map((lr) => (
                    <rect
                      key={`bg-${lr.id}`}
                      className="tl-lane-bg"
                      x={0}
                      y={lr.y}
                      width={canvasSize.width}
                      height={lr.h}
                      fill={lr.id.charCodeAt(lr.id.length - 1) % 2 === 0 ? 'var(--bg-elev-2)' : 'var(--bg-elev)'}
                      opacity={0.4}
                    />
                  ))}

                  {/* Time axis tick lines + labels */}
                  <g className="tl-time-axis">
                    {ticks.map((t) => (
                      <g key={`tick-${t.t}`}>
                        <line
                          x1={t.x}
                          y1={0}
                          x2={t.x}
                          y2={contentHeight}
                          stroke="var(--border)"
                          strokeWidth={0.5}
                          strokeDasharray="2,4"
                          opacity={0.5}
                        />
                        <text
                          x={t.x + 4}
                          y={TIME_AXIS_HEIGHT - 8}
                          fontSize={10}
                          fontFamily="var(--font-mono)"
                          fill="var(--text-dim)"
                        >
                          {t.label}
                        </text>
                      </g>
                    ))}
                  </g>

                  {/* Lane labels (rendered inside SVG, x=4) */}
                  {lanes.map((lane) => {
                    const y = TIME_AXIS_HEIGHT + EVENTS_STRIP_HEIGHT + lane.index * LANE_HEIGHT + LANE_HEIGHT / 2;
                    return (
                      <g key={`label-${lane.id}`} className="tl-lane-label-group">
                        <text
                          x={6}
                          y={y - 2}
                          className="tl-lane-label"
                          textAnchor="start"
                        >
                          {shortLabel(lane.label, 28)}
                        </text>
                        <text
                          x={6}
                          y={y + 10}
                          className="tl-lane-label-sub"
                          textAnchor="start"
                        >
                          {lane.sub}
                        </text>
                      </g>
                    );
                  })}

                  {/* Task / BG bars */}
                  {bars.map((bar) => {
                    const fillColor = statusColor(bar.statusClass);
                    const isSelected = bar.id === selectedItem?.id;
                    return (
                      <g
                        key={`bar-${bar.id}`}
                        className={cn('tl-task-bar', `tl-task-bar-${bar.statusClass}`, isSelected && 'tl-task-bar-selected')}
                        onClick={() => onSelectBar(bar)}
                      >
                        <rect
                          x={bar.x}
                          y={bar.y}
                          width={bar.w}
                          height={bar.h}
                          rx={6}
                          fill={fillColor}
                          fillOpacity={bar.statusClass === 'done' ? 0.35 : bar.statusClass === 'queued' ? 0.18 : 0.85}
                          stroke={fillColor}
                          strokeWidth={isSelected ? 2.5 : 1.5}
                          strokeOpacity={bar.statusClass === 'done' ? 0.5 : 1}
                          strokeDasharray={bar.statusClass === 'queued' ? '4 4' : undefined}
                          style={{ cursor: 'pointer' }}
                        />
                        {bar.w > 36 && (
                          <text
                            x={bar.x + 8}
                            y={bar.y + bar.h / 2 + 4}
                            fontSize={11}
                            fontFamily="var(--font-sans)"
                            fontWeight={500}
                            fill="var(--text-strong)"
                            style={{ pointerEvents: 'none' }}
                            opacity={bar.statusClass === 'done' ? 0.7 : 1}
                          >
                            {shortLabel(bar.label, Math.max(4, Math.floor(bar.w / 7)))}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* Event markers */}
                  {eventMarkers.map((m) => {
                    const color = statusColor(m.kind);
                    return (
                      <g key={`ev-${m.id}`} className="tl-event-marker-group">
                        <line
                          x1={m.x}
                          y1={m.y - 6}
                          x2={m.x}
                          y2={m.y + 6}
                          stroke={color}
                          strokeWidth={1.2}
                          opacity={0.7}
                        />
                        <circle
                          cx={m.x}
                          cy={m.y}
                          r={4}
                          fill={color}
                          opacity={0.9}
                        >
                          <title>
                            {`${m.kind}${m.author ? ` · ${m.author}` : ''} · ${new Date(m.ts).toLocaleTimeString('en-GB', { hour12: false })}`}
                          </title>
                        </circle>
                      </g>
                    );
                  })}

                  {/* Now line (red, vertical) */}
                  <line
                    className="tl-now-line"
                    x1={nowX}
                    y1={0}
                    x2={nowX}
                    y2={contentHeight}
                    stroke="var(--error)"
                    strokeWidth={1.5}
                    opacity={0.9}
                  />
                  <g className="tl-now-marker">
                    <circle cx={nowX} cy={TIME_AXIS_HEIGHT - 4} r={4} fill="var(--error)" />
                    <text
                      x={nowX + 6}
                      y={TIME_AXIS_HEIGHT - 4}
                      fontSize={10}
                      fontWeight={700}
                      fill="var(--error)"
                      fontFamily="var(--font-mono)"
                    >
                      now
                    </text>
                  </g>
                </svg>
              </div>
            </div>

            {/* Right column — detail panel */}
            {selectedItem && (
              <aside className="tl-detail tl-detail-enter" key={selectedItem.id}>
                <Card>
                  <CardTitle>
                    {selectedItem.kind === 'agent' && <Bot size={14} />}
                    {selectedItem.kind === 'task' && <CheckSquare size={14} />}
                    {selectedItem.kind === 'bg' && <Cpu size={14} />}
                    {selectedItem.label}
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setSelectedItem(null)}
                      title="Close"
                      style={{ marginLeft: 'auto' }}
                    >
                      <X size={14} />
                    </button>
                  </CardTitle>
                  <div className="tl-detail-meta">
                    <div><span className="muted">type</span> {selectedItem.kind}</div>
                    <div><span className="muted">status</span> <code>{selectedItem.status}</code></div>
                    {selectedItem.kind === 'agent' && (() => {
                      const a = selectedItem.data as Agent;
                      return (
                        <>
                          {a.role && <div><span className="muted">role</span> {a.role}</div>}
                          {a.model && <div><span className="muted">model</span> {a.model}</div>}
                        </>
                      );
                    })()}
                    {selectedItem.kind === 'task' && (() => {
                      const t = selectedItem.data as Task;
                      return (
                        <>
                          {t.assignee && <div><span className="muted">assignee</span> @{t.assignee}</div>}
                          {t.priority && <div><span className="muted">priority</span> {t.priority}</div>}
                          {t.createdAt && <div><span className="muted">created</span> {new Date(t.createdAt).toLocaleString()}</div>}
                        </>
                      );
                    })()}
                    {selectedItem.kind === 'bg' && (() => {
                      const b = selectedItem.data as BgInstance;
                      return (
                        <>
                          {b.startedAt && <div><span className="muted">started</span> {new Date(b.startedAt).toLocaleString()}</div>}
                          {b.tmuxSession && <div><span className="muted">tmux</span> <code>{b.tmuxSession}</code> {b.tmuxActive ? <span className="tag tag-success">active</span> : <span className="tag">inactive</span>}</div>}
                        </>
                      );
                    })()}
                  </div>
                  {selectedItem.kind === 'task' && (selectedItem.data as Task).description && (
                    <div className="tl-detail-desc">{(selectedItem.data as Task).description}</div>
                  )}
                  {selectedItem.kind === 'bg' && (selectedItem.data as BgInstance).promptPreview && (
                    <div className="tl-detail-desc">{(selectedItem.data as BgInstance).promptPreview}</div>
                  )}

                  {selectedItem.kind === 'bg' && (
                    <div className="tl-detail-bg">
                      <pre className="tl-bg-output">{bgOutput || '(no output — start the session via tmux attach)'}</pre>
                      <div className="tl-bg-output-actions">
                        <Button variant="ghost" size="sm" onClick={refetchOutput}>
                          <RefreshCw size={12} /> Refresh output
                        </Button>
                        {bgArtifactIds.length > 0 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openArtifactViewer(modal, bgArtifactIds[0])}
                          >
                            <FileText size={12} /> Open artifact
                          </Button>
                        )}
                        <Button variant="danger" size="sm" onClick={onKillBg}>
                          <Trash2 size={12} /> Kill session
                        </Button>
                      </div>
                      <div className="tl-form-row">
                        <input
                          className="input"
                          placeholder="Send a message to this bg session…"
                          value={bgMessage}
                          onChange={(e) => setBgMessage(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') onSendBgMessage();
                          }}
                        />
                        <Button variant="primary" size="sm" disabled={!bgMessage.trim()} onClick={onSendBgMessage}>
                          <Send size={12} /> Send
                        </Button>
                      </div>
                    </div>
                  )}

                  {selectedItem.kind !== 'bg' && (
                    <div className="tl-detail-create">
                      <div className="field-label">Create follow-up task</div>
                      <input
                        className="input"
                        placeholder="Task title"
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                      />
                      <div className="tl-form-row">
                        <select
                          className="select"
                          value={taskPriority}
                          onChange={(e) => setTaskPriority(e.target.value)}
                        >
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                        </select>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!taskTitle.trim() || creatingTask}
                          onClick={onCreateTaskFromNode}
                        >
                          <Plus size={12} /> Add task
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="tl-detail-comments">
                    <div className="field-label">
                      <MessageSquare size={12} /> Comments &amp; activity
                    </div>
                    <ul className="comment-list">
                      {comments.length === 0 && <li className="muted">No comments yet.</li>}
                      {comments.map((c, i) => (
                        <li key={`c-${i}`} className="comment-item">
                          <div className="comment-head">
                            <strong>{c.author || 'system'}</strong>
                            <span className="muted">
                              {c.kind} · {new Date(c.ts).toLocaleString()}
                            </span>
                          </div>
                          {c.text && <div className="comment-text">{c.text}</div>}
                          {c.taskId && (
                            <div className="muted">
                              → task <code>{String(c.taskId)}</code>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="comment-input-row">
                      <input
                        className="input"
                        placeholder="Add a comment…"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) onAddComment();
                        }}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!commentText.trim() || postingComment}
                        onClick={onAddComment}
                      >
                        <Send size={12} /> Post
                      </Button>
                    </div>
                  </div>
                </Card>
              </aside>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
