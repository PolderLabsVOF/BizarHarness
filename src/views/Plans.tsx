// src/views/Plans.tsx — list + new plan + canvas (pan/zoom).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Map,
  RefreshCw,
  Plus,
  ExternalLink,
  MessageCircle,
  Maximize2,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import {
  cn,
  formatRelative,
  truncate,
} from '../lib/utils';
import type {
  Canvas,
  CanvasComment,
  CanvasConnection,
  CanvasElement,
  Plan,
  Settings,
  Snapshot,
} from '../lib/types';

function planStatusKind(status: string): 'success' | 'info' | 'error' | 'accent' | 'neutral' {
  switch (status) {
    case 'approved':
    case 'done':
      return 'success';
    case 'in-progress':
    case 'doing':
      return 'info';
    case 'rejected':
      return 'error';
    case 'draft':
    case 'queued':
    default:
      return 'neutral';
  }
}

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

export function Plans({ snapshot }: Props) {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>(snapshot.plans || []);
  const [loading, setLoading] = useState(!snapshot.plans);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');

  useEffect(() => {
    if (snapshot.plans?.length) {
      setPlans(snapshot.plans);
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .get<{ plans: Plan[] }>('/plans')
      .then((d) => {
        if (!cancelled) {
          setPlans(d.plans || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoading(false);
          toast.error(`Could not load plans: ${(err as Error).message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.plans, toast]);

  const filtered = useMemo(
    () =>
      filter
        ? plans.filter((p) =>
            (p.status || '').toLowerCase().includes(filter.toLowerCase()),
          )
        : plans,
    [plans, filter],
  );

  const refresh = async () => {
    try {
      const d = await api.get<{ plans: Plan[] }>('/plans');
      setPlans(d.plans || []);
      toast.info('Plans refreshed.', 1500);
    } catch (err) {
      toast.error(`Refresh failed: ${(err as Error).message}`);
    }
  };

  const onCreate = async (slug: string, title?: string) => {
    try {
      await api.post('/plans', { slug, title });
      toast.success(`Plan "${slug}" created.`);
      setSelectedSlug(slug);
      await refresh();
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
    }
  };

  const statuses = useMemo(
    () => Array.from(new Set(plans.map((p) => p.status || 'draft'))),
    [plans],
  );

  return (
    <div className="view view-plans">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Map size={18} /> Plans ({plans.length})
          </h2>
          <p className="view-subtitle">
            Visual plans with elements, connections, and threaded comments.
          </p>
        </div>
        <div className="view-actions">
          <select
            className="select select-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={refresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </header>

      <NewPlanForm onCreate={onCreate} />

      {loading ? (
        <div className="view-loading">
          <Spinner size="lg" />
        </div>
      ) : plans.length === 0 ? (
        <EmptyState
          icon={<Map size={32} />}
          title="No plans yet"
          message="Create one above to get started."
        />
      ) : (
        <div className="plans-layout">
          <div className="plans-list-col">
            {filtered.map((p) => (
              <PlanCard
                key={p.slug}
                plan={p}
                selected={p.slug === selectedSlug}
                onSelect={() => setSelectedSlug(p.slug)}
              />
            ))}
            {filtered.length === 0 && (
              <p className="muted text-sm">No plans match that filter.</p>
            )}
          </div>
          <div className="plans-canvas-col">
            {selectedSlug ? (
              <PlanCanvas slug={selectedSlug} />
            ) : (
              <EmptyState
                icon={<Map size={28} />}
                title="Select a plan"
                message="Pick a plan on the left to view its canvas."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NewPlanForm({
  onCreate,
}: {
  onCreate: (slug: string, title?: string) => Promise<void> | void;
}) {
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  return (
    <Card className="new-plan">
      <CardTitle>
        <Plus size={14} /> New plan
      </CardTitle>
      <CardMeta>
        Slug must be lowercase, may contain hyphens, 1–64 chars.
      </CardMeta>
      <form
        className="new-plan-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!slug.trim()) return;
          onCreate(slug.trim(), title.trim() || undefined);
          setSlug('');
          setTitle('');
        }}
      >
        <input
          className="input"
          type="text"
          placeholder="slug (e.g. dashboard-v2.6)"
          pattern="[a-z0-9][a-z0-9-]{0,63}"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <input
          className="input"
          type="text"
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Button variant="primary" type="submit">
          Create
        </Button>
      </form>
    </Card>
  );
}

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
}) {
  const kind = planStatusKind(plan.status || 'draft');
  return (
    <Card
      variant={selected ? 'filled' : 'elevated'}
      interactive
      className={cn('plan-card', selected && 'plan-card-selected')}
      onClick={onSelect}
    >
      <div className="plan-card-head">
        <div className="plan-card-title">{plan.title || plan.slug}</div>
        <StatusBadge kind={kind}>{plan.status || 'draft'}</StatusBadge>
      </div>
      <div className="plan-card-slug mono">
        {plan.slug} · {plan.source}
      </div>
      <div className="plan-card-meta">
        {plan.elementCount != null && (
          <span>{plan.elementCount} elements</span>
        )}
        {plan.commentCount != null && (
          <span> · {plan.commentCount} comments</span>
        )}
        <span> · edited {formatRelative(plan.mtime)}</span>
      </div>
      <div className="plan-card-actions">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          View
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            // We don't have a CLI bridge here; just nudge the user.
            // eslint-disable-next-line no-alert
            alert(
              `Open this plan in the CLI:\n\nbizar plan open ${plan.slug}\n\nThe CLI launches the full visual editor with pan, zoom, and edit capabilities.`,
            );
          }}
        >
          <ExternalLink size={12} /> Open
        </Button>
      </div>
    </Card>
  );
}

function PlanCanvas({ slug }: { slug: string }) {
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get<{ canvas: Canvas }>(
        `/plans/${encodeURIComponent(slug)}/canvas`,
      );
      setCanvas(d.canvas);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('canvas load failed', err);
      setCanvas({
        title: slug,
        elements: [],
        connections: [],
        comments: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedElId(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (loading || !canvas) {
    return (
      <div className="view-loading">
        <Spinner size="lg" />
        <p>Loading canvas…</p>
      </div>
    );
  }

  const visibleComments = selectedElId
    ? canvas.comments.filter(
        (c) => c.elementId === selectedElId || c.id === selectedElId,
      )
    : canvas.comments;

  return (
    <div className="plan-canvas">
      <header className="plan-canvas-header">
        <div>
          <div className="plan-canvas-title">{canvas.title || slug}</div>
          <div className="plan-canvas-meta">
            {canvas.elements.length} element
            {canvas.elements.length !== 1 ? 's' : ''} ·{' '}
            {canvas.comments.length} comment
            {canvas.comments.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="plan-canvas-actions">
          <Button variant="ghost" size="sm" onClick={load} title="Refresh canvas">
            <RefreshCw size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Reset zoom"
            onClick={() => {
              // Force remount via key trick
              setCanvas({ ...canvas, viewport: { x: 0, y: 0, zoom: 1 } });
            }}
          >
            <Maximize2 size={14} />
          </Button>
        </div>
      </header>

      <div className="plan-canvas-area">
        {canvas.elements.length === 0 ? (
          <div className="plan-canvas-empty">
            No elements yet. Add one via the CLI: <code>/plan add {slug} &lt;type&gt;</code>
          </div>
        ) : (
          <CanvasViewport canvas={canvas}>
            {canvas.elements.map((el) => (
              <CanvasElementView
                key={el.id}
                element={el}
                selected={selectedElId === el.id}
                onClick={() =>
                  setSelectedElId(selectedElId === el.id ? null : el.id)
                }
              />
            ))}
            <Connections
              elements={canvas.elements}
              connections={canvas.connections}
            />
          </CanvasViewport>
        )}
      </div>

      <footer className="plan-canvas-comments">
        <h4 className="plan-canvas-comments-title">
          <MessageCircle size={14} /> Comments ({visibleComments.length}
          {selectedElId ? ' for selected' : ''})
        </h4>
        {visibleComments.length === 0 ? (
          <p className="muted text-sm">
            {selectedElId
              ? 'No comments on this element yet.'
              : 'No comments yet.'}
          </p>
        ) : (
          <ul className="comment-list">
            {visibleComments.map((c) => (
              <CommentItem key={c.id} comment={c} />
            ))}
          </ul>
        )}
      </footer>
    </div>
  );
}

function CanvasViewport({
  canvas,
  children,
}: {
  canvas: Canvas;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    panning: false,
    startX: 0,
    startY: 0,
    ox: canvas.viewport.x || 0,
    oy: canvas.viewport.y || 0,
    scale: canvas.viewport.zoom || 1,
  });

  useEffect(() => {
    const root = rootRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return;
    const apply = () => {
      const s = stateRef.current;
      inner.style.transform = `translate(${s.ox}px, ${s.oy}px) scale(${s.scale})`;
    };
    apply();

    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (
        t !== root &&
        !t.classList.contains('canvas-grid-bg') &&
        !t.classList.contains('canvas-inner')
      )
        return;
      stateRef.current.panning = true;
      stateRef.current.startX = e.clientX - stateRef.current.ox;
      stateRef.current.startY = e.clientY - stateRef.current.oy;
      root.style.cursor = 'grabbing';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!stateRef.current.panning) return;
      stateRef.current.ox = e.clientX - stateRef.current.startX;
      stateRef.current.oy = e.clientY - stateRef.current.startY;
      apply();
    };
    const onMouseUp = () => {
      if (!stateRef.current.panning) return;
      stateRef.current.panning = false;
      root.style.cursor = '';
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const next = Math.min(
        Math.max(stateRef.current.scale * delta, 0.2),
        3,
      );
      stateRef.current.scale = next;
      apply();
    };
    root.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      root.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      root.removeEventListener('wheel', onWheel);
    };
  }, [canvas.elements.length, canvas.connections.length]);

  return (
    <div className="canvas-root" ref={rootRef}>
      <div className="canvas-grid-bg" />
      <div className="canvas-inner" ref={innerRef}>
        {children}
      </div>
      <div className="canvas-hint">
        Pan: drag · Zoom: scroll
      </div>
    </div>
  );
}

function CanvasElementView({
  element,
  selected,
  onClick,
}: {
  element: CanvasElement;
  selected: boolean;
  onClick: () => void;
}) {
  const x = element.x || 0;
  const y = element.y || 0;
  const w = element.width || 240;
  const h = element.height || 160;
  return (
    <div
      className={cn('canvas-element', selected && 'canvas-element-selected')}
      style={{
        left: x,
        top: y,
        width: w,
        minHeight: h,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <div className="canvas-element-type">{element.type || 'text'}</div>
      <div className="canvas-element-title">{element.title || 'Untitled'}</div>
      {element.content && (
        <div className="canvas-element-content">
          {truncate(element.content, 200)}
        </div>
      )}
    </div>
  );
}

function Connections({
  elements,
  connections,
}: {
  elements: CanvasElement[];
  connections: CanvasConnection[];
}) {
  if (!connections.length) return null;
  // Compute world bounding box so the SVG covers all elements regardless of pan/zoom.
  const bbox = elements.reduce(
    (acc, el) => {
      const ex = el.x || 0;
      const ey = el.y || 0;
      const ex2 = ex + (el.width || 240);
      const ey2 = ey + (el.height || 160);
      return {
        minX: Math.min(acc.minX, ex),
        minY: Math.min(acc.minY, ey),
        maxX: Math.max(acc.maxX, ex2),
        maxY: Math.max(acc.maxY, ey2),
      };
    },
    { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  );
  const pad = 80;
  const w = bbox.maxX - bbox.minX + pad * 2;
  const h = bbox.maxY - bbox.minY + pad * 2;
  const ox = -bbox.minX + pad;
  const oy = -bbox.minY + pad;
  return (
    <svg
      className="canvas-connections"
      width={w}
      height={h}
      style={{
        left: bbox.minX - pad,
        top: bbox.minY - pad,
      }}
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
        </marker>
      </defs>
      {connections.map((c) => {
        const from = elements.find(
          (e) => e.id === c.fromElementId || e.id === c.from,
        );
        const to = elements.find(
          (e) => e.id === c.toElementId || e.id === c.to,
        );
        if (!from || !to) return null;
        const x1 = ox + (from.x || 0) + (from.width || 240) / 2;
        const y1 = oy + (from.y || 0) + (from.height || 160);
        const x2 = ox + (to.x || 0) + (to.width || 240) / 2;
        const y2 = oy + (to.y || 0);
        return (
          <line
            key={c.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--accent)"
            strokeWidth={1.5}
            markerEnd="url(#arrow)"
          />
        );
      })}
    </svg>
  );
}

function CommentItem({ comment }: { comment: CanvasComment }) {
  return (
    <li className="comment-item">
      <div className="comment-head">
        <span className="comment-author mono">{comment.author}</span>
        <span className="comment-time tabular-nums muted">
          {formatRelative(comment.created)}
        </span>
      </div>
      <div className="comment-text">{comment.text}</div>
      {comment.thread && comment.thread.length > 0 && (
        <div className="comment-thread">
          {comment.thread.map((r, i) => (
            <div key={i} className="comment-reply">
              <span className="comment-author mono">{r.author}</span>
              <span className="comment-reply-text">{r.text}</span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
