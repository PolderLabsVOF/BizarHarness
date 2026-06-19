// src/views/Activity.tsx — v3.2.0 graph canvas of agents/tasks/bg.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  ZoomIn,
  ZoomOut,
  Move,
  MessageSquare,
  Layers,
  Target,
  Clock,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Settings, Snapshot } from '../lib/types';

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

type GraphNode = {
  id: string;
  type: 'agent' | 'task' | 'bg';
  x: number;
  y: number;
  label: string;
  sub?: string;
  status: string;
  level?: number;
  // Mixed source: Agent | Task | BgInstance. `any` here is the
  // pragmatic call — narrowing every `data.role` / `data.model` etc.
  // in the JSX would balloon the file. The shape is documented at the
  // call sites (filter by `type`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
};

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: 'hierarchy' | 'assignment' | 'subtask';
};

const STATUS_COLORS = {
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
  idle: 'var(--text-muted)',
  pending: 'var(--info)',
  timed_out: 'var(--warning)',
};

const EDGE_COLORS = {
  hierarchy: 'var(--accent)',
  assignment: 'var(--info)',
  subtask: 'var(--text-muted)',
};

function statusColor(s: string | null | undefined): string {
  if (!s) return STATUS_COLORS.idle;
  return (STATUS_COLORS as Record<string, string>)[s] || STATUS_COLORS.idle;
}

function shortLabel(s: string | null | undefined, n = 16): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

export function Activity({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // View state
  const [transform, setTransform] = useState<{ x: number; y: number; scale: number }>({ x: 80, y: 80, scale: 1 });
  const [drag, setDrag] = useState<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [bgInstances, setBgInstances] = useState<BgInstance[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [activeActivityTab, setActiveActivityTab] = useState<'canvas' | 'timeline'>('canvas');

  // Detail-panel local state
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<ActivityEvent[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('normal');
  const [bgMessage, setBgMessage] = useState('');
  const [bgOutput, setBgOutput] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [postingComment, setPostingComment] = useState(false);

  const agents = snapshot.agents || [];
  const tasks = snapshot.tasks || [];

  // Load bg + events
  const reloadAll = async () => {
    try {
      const [bgRes, evRes] = await Promise.all([
        api.get<{ instances: BgInstance[] }>('/background').catch(() => ({ instances: [] })),
        api.get<{ events: ActivityEvent[] }>('/activity?limit=200').catch(() => ({ events: [] })),
      ]);
      setBgInstances(bgRes.instances || []);
      setEvents(evRes.events || []);
    } catch (err) {
      // soft-fail
      console.warn('activity reload failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadAll();
    const id = setInterval(reloadAll, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // Reload events when snapshot changes
  useEffect(() => {
    setRefreshTick((t) => t + 1);
  }, [snapshot.tasks?.length, snapshot.agents?.length]);

  // Build graph nodes/edges
  const { nodes, edges } = useMemo<{ nodes: GraphNode[]; edges: GraphEdge[] }>(() => {
    const result: GraphNode[] = [];
    const edgeList: GraphEdge[] = [];

    // Agents — grouped by level
    const byLevel = new Map<number, typeof agents>();
    for (const a of agents) {
      const lvl = a.level ?? 2;
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl)!.push(a);
    }
    const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);
    for (const lvl of levels) {
      const ags = byLevel.get(lvl)!;
      ags.forEach((a, j) => {
        result.push({
          id: `agent:${a.name}`,
          type: 'agent',
          x: 100 + lvl * 260,
          y: 100 + j * 100,
          label: a.name,
          sub: a.role || a.model || '',
          status: a.status || 'idle',
          level: lvl,
          data: a,
        });
      });
    }

    // Active tasks
    const activeTasks = tasks.filter(
      (t) => t.status === 'doing' || t.status === 'queued' || t.status === 'blocked',
    );
    activeTasks.forEach((t, i) => {
      result.push({
        id: `task:${t.id}`,
        type: 'task',
        x: 950 + (i % 4) * 230,
        y: 100 + Math.floor(i / 4) * 130,
        label: shortLabel(t.title, 18),
        sub: t.status,
        status: t.status,
        data: t,
      });
    });

    // BG instances
    bgInstances.forEach((b, i) => {
      result.push({
        id: `bg:${b.instanceId}`,
        type: 'bg',
        x: 1900,
        y: 100 + i * 100,
        label: shortLabel(b.promptPreview || b.instanceId, 18),
        sub: b.status || 'pending',
        status: b.status || 'pending',
        data: b,
      });
    });

    // Edges
    for (const a of agents) {
      if (a.parent) {
        edgeList.push({
          id: `h:${a.name}`,
          from: `agent:${a.parent}`,
          to: `agent:${a.name}`,
          kind: 'hierarchy',
        });
      }
    }
    for (const t of tasks) {
      if (t.assignee) {
        edgeList.push({
          id: `a:${t.id}`,
          from: `agent:${t.assignee}`,
          to: `task:${t.id}`,
          kind: 'assignment',
        });
      }
      if (t.parent) {
        edgeList.push({
          id: `s:${t.id}`,
          from: `task:${t.parent}`,
          to: `task:${t.id}`,
          kind: 'subtask',
        });
      }
    }

    return { nodes: result, edges: edgeList };
  }, [agents, tasks, bgInstances]);

  const nodeIndex = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Pan + zoom handlers
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDrag({ startX: e.clientX, startY: e.clientY, baseX: transform.x, baseY: transform.y });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    setTransform((t) => ({
      ...t,
      x: drag.baseX + (e.clientX - drag.startX),
      y: drag.baseY + (e.clientY - drag.startY),
    }));
  };

  const onMouseUp = () => setDrag(null);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setTransform((t) => {
      const next = Math.max(0.3, Math.min(2.5, t.scale + delta));
      return { ...t, scale: next };
    });
  };

  // Keyboard helpers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedNode(null);
      if (e.key === '0' && !e.metaKey && !e.ctrlKey) {
        setTransform({ x: 80, y: 80, scale: 1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // When a node is selected, fetch its events
  useEffect(() => {
    if (!selectedNode) {
      setComments([]);
      return;
    }
    setCommentText('');
    setTaskTitle('');
    setBgMessage('');
    setBgOutput('');
    (async () => {
      try {
        const r = await api.get<{ events: ActivityEvent[] }>(
          `/activity?nodeId=${encodeURIComponent(selectedNode.id)}&limit=50`,
        );
        setComments(r.events || []);
      } catch {
        setComments([]);
      }
      if (selectedNode.type === 'bg') {
        const bgData = selectedNode.data as BgInstance;
        try {
          const r = await api.get<{ output: string }>(
            `/background/${encodeURIComponent(bgData.instanceId)}/output?lines=80`,
          );
          setBgOutput(r.output || '');
        } catch {
          setBgOutput('');
        }
      }
    })();
  }, [selectedNode]);

  const onAddComment = async () => {
    if (!selectedNode || !commentText.trim()) return;
    setPostingComment(true);
    try {
      await api.post('/comments', { nodeId: selectedNode.id, text: commentText, author: 'user' });
      setCommentText('');
      const r = await api.get<{ events: ActivityEvent[] }>(
        `/activity?nodeId=${encodeURIComponent(selectedNode.id)}&limit=50`,
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
    if (!selectedNode || !taskTitle.trim()) return;
    setCreatingTask(true);
    try {
      await api.post(`/nodes/${encodeURIComponent(selectedNode.id)}/tasks`, {
        title: taskTitle,
        description: `Created from canvas node ${selectedNode.id}.`,
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
    if (!selectedNode || selectedNode.type !== 'bg' || !bgMessage.trim()) return;
    const bgData = selectedNode.data as BgInstance;
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
    if (!selectedNode || selectedNode.type !== 'bg') return;
    if (!confirm('Kill this bg instance session?')) return;
    const bgData = selectedNode.data as BgInstance;
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
    if (!selectedNode || selectedNode.type !== 'bg') return;
    const bgData = selectedNode.data as BgInstance;
    try {
      const r = await api.get<{ output: string }>(
        `/background/${encodeURIComponent(bgData.instanceId)}/output?lines=80`,
      );
      setBgOutput(r.output || '');
    } catch {
      /* ignore */
    }
  };

  // Render helpers
  const nodeRadius = (n: GraphNode): number => (n.type === 'agent' ? 36 : 28);

  const renderEdge = (e: GraphEdge) => {
    const a = nodeIndex.get(e.from);
    const b = nodeIndex.get(e.to);
    if (!a || !b) return null;
    const stroke = (EDGE_COLORS as Record<string, string>)[e.kind];
    return (
      <line
        key={e.id}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={stroke}
        strokeWidth={e.kind === 'hierarchy' ? 2.5 : 1.8}
        strokeDasharray={e.kind === 'subtask' ? '6,4' : undefined}
        opacity={0.65}
      />
    );
  };

  const renderNode = (n: GraphNode) => {
    const r = nodeRadius(n);
    const fill = 'var(--bg-elevated)';
    const stroke = statusColor(n.status);
    const selected = selectedNode?.id === n.id;
    const Icon = n.type === 'agent' ? Bot : n.type === 'task' ? CheckSquare : Cpu;
    return (
      <g
        key={n.id}
        transform={`translate(${n.x}, ${n.y})`}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedNode(n);
        }}
      >
        <circle r={r + 4} fill="transparent" stroke={selected ? 'var(--accent)' : 'transparent'} strokeWidth={2} />
        <circle r={r} fill={fill} stroke={stroke} strokeWidth={2.5} />
        <foreignObject x={-8} y={-8} width={16} height={16} style={{ overflow: 'visible' }}>
          <Icon size={16} style={{ color: stroke, marginLeft: 0 }} />
        </foreignObject>
        <text textAnchor="middle" y={r + 16} fontSize={12} fill="var(--text)" style={{ fontWeight: 600 }}>
          {n.label}
        </text>
        {n.sub && (
          <text textAnchor="middle" y={r + 30} fontSize={10} fill="var(--text-muted)">
            {n.sub}
          </text>
        )}
        {n.status && (
          <circle cx={r * 0.7} cy={-r * 0.7} r={5} fill={stroke}>
            <animate attributeName="opacity" values="1;0.3;1" dur={1.6} repeatCount="indefinite" />
          </circle>
        )}
      </g>
    );
  };

  return (
    <div className="view view-activity">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <ActivityIcon size={18} /> Activity
          </h2>
          <p className="view-subtitle">
            Live agent/task/background wiring. Drag to pan, scroll to zoom, click a node for details.
          </p>
        </div>
        <div className="view-actions">
          <div className="view-tabs" style={{ display: 'flex', gap: '4px', marginRight: '8px' }}>
            <button
              type="button"
              className={`icon-btn ${activeActivityTab === 'canvas' ? 'icon-btn-active' : ''}`}
              onClick={() => setActiveActivityTab('canvas')}
              title="Canvas view"
            >
              <Layers size={14} /> Canvas
            </button>
            <button
              type="button"
              className={`icon-btn ${activeActivityTab === 'timeline' ? 'icon-btn-active' : ''}`}
              onClick={() => setActiveActivityTab('timeline')}
              title="Timeline view"
            >
              <Clock size={14} /> Timeline
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setRefreshTick((t) => t + 1)}>
            <RefreshCw size={14} /> Refresh
          </Button>
          {activeActivityTab === 'canvas' && (
            <Button variant="ghost" size="sm" onClick={() => setTransform({ x: 80, y: 80, scale: 1 })} title="Reset view (0)">
              <Move size={14} /> Reset
            </Button>
          )}
        </div>
      </header>

      {loading && (
        <div className="view-loading"><Spinner size="lg" /></div>
      )}

      {!loading && agents.length === 0 && tasks.length === 0 && bgInstances.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon size={32} />}
          title="No activity yet"
          message="Once agents, tasks, or background instances exist, they'll show up here as nodes."
        />
      ) : (
        <>
          {/* v3.3.1 — Timeline tab */}
          {activeActivityTab === 'timeline' && (
            <div className="activity-timeline-panel">
              {events.length === 0 ? (
                <EmptyState
                  icon={<Clock size={28} />}
                  title="No events yet"
                  message="Activity events will appear here as agents and tasks run."
                />
              ) : (
                <div className="timeline-list">
                  {[...events].reverse().map((ev, i) => {
                    const AgentIcon = ev.author ? Bot : ev.kind === 'task' ? CheckSquare : ev.kind === 'bg' ? Cpu : ActivityIcon;
                    return (
                      <div key={i} className="timeline-event">
                        <div className="timeline-time">
                          {new Date(ev.ts).toLocaleString()}
                        </div>
                        <div className="timeline-icon" style={{ color: statusColor(ev.kind) }}>
                          <AgentIcon size={14} />
                        </div>
                        <div className="timeline-message">
                          {ev.author && <strong>{ev.author}</strong>}
                          {ev.text && <span> {ev.text}</span>}
                          {!ev.author && !ev.text && <span className="muted">{ev.kind}</span>}
                        </div>
                        {ev.nodeId && <div className="timeline-node muted mono">{ev.nodeId}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* v3.3.1 — Canvas tab */}
          {activeActivityTab === 'canvas' && (
            <div className="activity-layout" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <div
                ref={canvasRef}
                className="activity-canvas"
                style={{ flex: 1, minHeight: 0, cursor: drag ? 'grabbing' : 'grab' } as CSSProperties}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                onWheel={onWheel}
                role="application"
                aria-label="Activity graph"
              >
                <svg width="100%" height="100%">
                  <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity={0.3} />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />
                  <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
                    {edges.map(renderEdge)}
                    {nodes.map(renderNode)}
                  </g>
                </svg>

                {/* Canvas overlay controls */}
                <div className="activity-zoom-controls">
                  <button type="button" className="icon-btn" onClick={() => setTransform((t) => ({ ...t, scale: Math.min(2.5, t.scale + 0.15) }))} title="Zoom in">
                    <ZoomIn size={14} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => setTransform((t) => ({ ...t, scale: Math.max(0.3, t.scale - 0.15) }))} title="Zoom out">
                    <ZoomOut size={14} />
                  </button>
                  <span className="muted mono">{(transform.scale * 100).toFixed(0)}%</span>
                </div>

                <div className="activity-legend">
                  <div className="legend-item"><span className="legend-dot" style={{ background: STATUS_COLORS.working }} /> working</div>
                  <div className="legend-item"><span className="legend-dot" style={{ background: STATUS_COLORS.queued }} /> queued</div>
                  <div className="legend-item"><span className="legend-dot" style={{ background: STATUS_COLORS.blocked }} /> blocked</div>
                  <div className="legend-item"><span className="legend-dot" style={{ background: STATUS_COLORS.error }} /> error</div>
                  <div className="legend-item"><span className="legend-dot" style={{ background: STATUS_COLORS.stuck }} /> stuck</div>
                  <div className="legend-item"><span className="legend-dot" style={{ background: STATUS_COLORS.idle }} /> idle</div>
                  <div className="legend-sep" />
                  <div className="legend-item"><Layers size={12} /> agent · <Target size={12} /> task · <Cpu size={12} /> bg</div>
                </div>
              </div>

              {selectedNode && (
                <aside className="activity-detail">
                  <Card>
                    <CardTitle>
                      {selectedNode.type === 'agent' && <Bot size={14} />}
                      {selectedNode.type === 'task' && <CheckSquare size={14} />}
                      {selectedNode.type === 'bg' && <Cpu size={14} />}
                      {selectedNode.label}
                      <button type="button" className="icon-btn" onClick={() => setSelectedNode(null)} title="Close" style={{ marginLeft: 'auto' }}>
                        <X size={14} />
                      </button>
                    </CardTitle>
                    <div className="activity-detail-meta">
                      <div><span className="muted">type</span> {selectedNode.type}</div>
                      <div><span className="muted">status</span> <code>{selectedNode.status}</code></div>
                      {selectedNode.data?.role && <div><span className="muted">role</span> {selectedNode.data.role}</div>}
                      {selectedNode.data?.model && <div><span className="muted">model</span> {selectedNode.data.model}</div>}
                      {selectedNode.data?.assignee && <div><span className="muted">assignee</span> @{selectedNode.data.assignee}</div>}
                      {selectedNode.data?.priority && <div><span className="muted">priority</span> {selectedNode.data.priority}</div>}
                      {selectedNode.data?.startedAt && <div><span className="muted">started</span> {new Date(selectedNode.data.startedAt).toLocaleString()}</div>}
                    </div>
                    {selectedNode.data?.description && (
                      <div className="activity-detail-desc">{selectedNode.data.description}</div>
                    )}
                    {selectedNode.data?.promptPreview && (
                      <div className="activity-detail-desc">{selectedNode.data.promptPreview}</div>
                    )}

                    {selectedNode.type === 'bg' && (
                      <div className="activity-detail-bg">
                        <div className="field-label">tmux session: <code>{selectedNode.data.tmuxSession}</code> {selectedNode.data.tmuxActive ? <span className="tag tag-success">active</span> : <span className="tag">inactive</span>}</div>
                        <pre className="bg-output">{bgOutput || '(no output — start the session via tmux attach)'}</pre>
                        <div className="bg-output-actions">
                          <Button variant="ghost" size="sm" onClick={refetchOutput}><RefreshCw size={12} /> Refresh output</Button>
                          <Button variant="danger" size="sm" onClick={onKillBg}><Trash2 size={12} /> Kill session</Button>
                        </div>
                        <div className="task-form-row">
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

                    {selectedNode.type !== 'bg' && (
                      <div className="activity-detail-create">
                        <div className="field-label">Create follow-up task</div>
                        <input
                          className="input"
                          placeholder="Task title"
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.target.value)}
                        />
                        <div className="task-form-row">
                          <select className="select" value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)}>
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                          </select>
                          <Button variant="primary" size="sm" disabled={!taskTitle.trim() || creatingTask} onClick={onCreateTaskFromNode}>
                            <Plus size={12} /> Add task
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="activity-detail-comments">
                      <div className="field-label"><MessageSquare size={12} /> Comments &amp; activity</div>
                      <ul className="comment-list">
                        {comments.length === 0 && <li className="muted">No comments yet.</li>}
                        {comments.map((c, i) => (
                          <li key={i} className="comment-item">
                            <div className="comment-head">
                              <strong>{c.author || 'system'}</strong>
                              <span className="muted">{c.kind} · {new Date(c.ts).toLocaleString()}</span>
                            </div>
                            {c.text && <div className="comment-text">{c.text}</div>}
                            {c.taskId && <div className="muted">→ task <code>{String(c.taskId)}</code></div>}
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
                        <Button variant="secondary" size="sm" disabled={!commentText.trim() || postingComment} onClick={onAddComment}>
                          <Send size={12} /> Post
                        </Button>
                      </div>
                    </div>
                  </Card>
                </aside>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Use cn locally to avoid unused-import warnings when read by tsc strict.
export { cn };