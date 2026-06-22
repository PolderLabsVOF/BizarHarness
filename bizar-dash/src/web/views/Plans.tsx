// src/views/Plans.tsx — v3.1.0 plan editor with fullscreen canvas + floating controls.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Map as MapIcon,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  MessageCircle,
  MessageSquare,
  Maximize2,
  Minimize2,
  X,
  Trash2,
  Pencil,
  Link2,
  Send,
  Check,
  Circle,
  StopCircle,
  AlertCircle,
  HelpCircle,
  CheckSquare,
  StickyNote,
  ChevronRight,
  Search,
  Activity,
  Filter,
  Archive,
  ArchiveRestore,
  Copy,
  ArrowUp,
  ArrowDown,
  Layers,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { CanvasContextMenu, type ContextMenuState } from '../components/CanvasContextMenu';
import { api } from '../lib/api';
import { cn, formatRelative, truncate } from '../lib/utils';
import type {
  Canvas,
  CanvasComment,
  CanvasConnection,
  CanvasElement,
  Plan,
  Settings,
  Snapshot,
} from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const ELEMENT_TYPES = [
  { id: 'task', label: 'Task', color: 'var(--info)', Icon: CheckSquare },
  { id: 'note', label: 'Note', color: 'var(--text-dim)', Icon: StickyNote },
  { id: 'decision', label: 'Decision', color: 'var(--accent)', Icon: Check },
  { id: 'question', label: 'Question', color: 'var(--warning)', Icon: HelpCircle },
];

const PLAN_STATUSES = ['draft', 'approved', 'in-progress', 'done', 'rejected', 'archived'];

function planStatusKind(status: string): 'success' | 'info' | 'error' | 'accent' | 'neutral' | 'warning' {
  switch (status) {
    case 'approved':
    case 'done':
      return 'success';
    case 'in-progress':
    case 'doing':
      return 'info';
    case 'rejected':
      return 'error';
    case 'archived':
      return 'warning';
    case 'draft':
    default:
      return 'neutral';
  }
}

function elementColor(type: string): string {
  return ELEMENT_TYPES.find((t) => t.id === type)?.color || 'var(--text-dim)';
}

function ElementIcon({ type, size = 12 }: { type: string; size?: number }) {
  const def = ELEMENT_TYPES.find((t) => t.id === type) || ELEMENT_TYPES[1];
  const Icon = def.Icon;
  return <Icon size={size} style={{ color: def.color }} />;
}

// ── List view ──────────────────────────────────────────────────────────

export function Plans({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>(snapshot.plans || []);
  const [loading, setLoading] = useState(!snapshot.plans);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (snapshot.plans) {
      setPlans(snapshot.plans);
      setLoading(false);
    }
  }, [snapshot.plans]);

  const reload = async () => {
    try {
      const d = await api.get<{ plans: Plan[] }>('/plans');
      setPlans(d.plans || []);
      setLoading(false);
    } catch (err) {
      toast.error(`Plans load failed: ${(err as Error).message}`);
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    let out = plans;
    if (filter) {
      const q = filter.toLowerCase();
      out = out.filter(
        (p) =>
          (p.slug || '').toLowerCase().includes(q) ||
          (p.title || '').toLowerCase().includes(q),
      );
    }
    if (!showArchived) {
      out = out.filter((p) => p.status !== 'archived');
    }
    return out;
  }, [plans, filter, showArchived]);

  const onCreate = async (slug: string, title?: string) => {
    try {
      const plan = await api.post<{ slug: string }>('/plans', { slug, title });
      toast.success(`Plan "${plan.slug}" created.`);
      setActiveSlug(plan.slug);
      await reload();
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
    }
  };

  const onDelete = async (slug: string) => {
    if (!confirm(`Delete plan "${slug}"? This removes the directory permanently.`)) return;
    try {
      await api.del(`/plans/${encodeURIComponent(slug)}`);
      toast.success('Plan deleted.');
      if (activeSlug === slug) setActiveSlug(null);
      await reload();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  if (activeSlug) {
    return (
      <PlanEditor
        slug={activeSlug}
        onBack={() => {
          setActiveSlug(null);
          reload();
        }}
        onDelete={() => onDelete(activeSlug)}
      />
    );
  }

  return (
    <div className="view view-plans">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <MapIcon size={18} /> Plans ({plans.length})
          </h2>
          <p className="view-subtitle">
            Visual plans with elements, connections, and threaded comments.
          </p>
        </div>
        <div className="view-actions">
          <div className="search-input">
            <Search size={14} />
            <input
              className="input"
              type="text"
              placeholder="Search…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? 'Hide archived' : 'Show archived'}
          >
            {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Button>
          <Button variant="secondary" size="sm" onClick={reload}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </header>

      <NewPlanCard onCreate={onCreate} />

      {loading ? (
        <div className="view-loading">
          <Spinner size="lg" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<MapIcon size={32} />}
          title={showArchived ? 'No plans' : 'No plans yet'}
          message={
            showArchived
              ? 'No plans match your filter (try Show archived off).'
              : 'Create one above to get started.'
          }
        />
      ) : (
        <div className="plans-grid">
          {filtered.map((p) => (
            <PlanCard
              key={p.slug}
              plan={p}
              onOpen={() => setActiveSlug(p.slug)}
              onDelete={() => onDelete(p.slug)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NewPlanCard({ onCreate }: { onCreate: (slug: string, title?: string) => void }) {
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  return (
    <Card className="new-plan">
      <CardTitle>
        <Plus size={14} /> New plan
      </CardTitle>
      <CardMeta>Slug must be lowercase, may contain hyphens, 1–64 chars.</CardMeta>
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
          placeholder="slug (e.g. dashboard-v3.1)"
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
  onOpen,
  onDelete,
}: {
  plan: Plan;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const kind = planStatusKind(plan.status || 'draft');
  return (
    <Card
      variant="elevated"
      interactive
      className="plan-card"
      onClick={onOpen}
    >
      <div className="plan-card-head">
        <div className="plan-card-title">{plan.title || plan.slug}</div>
        <StatusBadge kind={kind}>{plan.status || 'draft'}</StatusBadge>
      </div>
      <div className="plan-card-slug mono">{plan.slug} · {plan.source}</div>
      <div className="plan-card-meta">
        {plan.elementCount != null && <span>{plan.elementCount} elements</span>}
        {plan.commentCount != null && <span> · {plan.commentCount} comments</span>}
        <span> · edited {formatRelative(plan.mtime)}</span>
      </div>
      <div className="plan-card-actions">
        <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          Open
          <ChevronRight size={12} />
        </Button>
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 size={12} /> Delete
        </Button>
      </div>
    </Card>
  );
}

// ── Plan editor (fullscreen) ──────────────────────────────────────────

function PlanEditor({
  slug,
  onBack,
  onDelete,
}: {
  slug: string;
  onBack: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const modal = useModal();
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [meta, setMeta] = useState<{ title: string; status: string; tags: string[]; description?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showComments, setShowComments] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [contextMenuWorldPos, setContextMenuWorldPos] = useState<{ x: number; y: number } | null>(null);
  // v3.7.0 — Element-specific right-click context menu
  const [elementContextMenu, setElementContextMenu] = useState<ContextMenuState>(null);

  const moveElementLocally = (id: string, x: number, y: number) => {
    setCanvas((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        elements: cur.elements.map((el) => (el.id === id ? { ...el, x, y } : el)),
      };
    });
  };

  const reload = async () => {
    setLoading(true);
    try {
      const plan = await api.get<{ meta: { title: string; status: string; tags: string[]; description?: string }; canvas: Canvas }>(
        `/plans/${encodeURIComponent(slug)}`,
      );
      setCanvas(plan.canvas);
      setMeta(plan.meta);
    } catch (err) {
      toast.error(`Could not load plan: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedElId(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Issue 3 fix — wire fullscreen state to browser Fullscreen API
  useEffect(() => {
    if (!fullscreen) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      return;
    }
    // Sync state when user exits via ESC key — before entering, so we don't
    // double-set on the way in
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    // Attempt to enter fullscreen (fails silently if unsupported or blocked)
    document.documentElement.requestFullscreen().catch(() => {});
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  const totalComments = canvas?.comments.length ?? 0;

  const addElement = async (body: { type: string; title: string; content: string; x: number; y: number }, position?: { x: number; y: number }) => {
    try {
      const payload = position ? { ...body, x: position.x, y: position.y } : body;
      await api.post(`/plans/${encodeURIComponent(slug)}/elements`, payload);
      await reload();
      toast.success('Element added.');
    } catch (err) {
      toast.error(`Add element failed: ${(err as Error).message}`);
    }
  };

  const updateElement = async (id: string, body: Partial<CanvasElement>) => {
    try {
      await api.put(`/plans/${encodeURIComponent(slug)}/elements/${encodeURIComponent(id)}`, body);
      await reload();
    } catch (err) {
      toast.error(`Update failed: ${(err as Error).message}`);
    }
  };

  const deleteElement = async (id: string) => {
    try {
      await api.del(`/plans/${encodeURIComponent(slug)}/elements/${encodeURIComponent(id)}`);
      if (selectedElId === id) setSelectedElId(null);
      await reload();
      toast.success('Element deleted.');
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  // v3.7.0 — Duplicate an element with a small position offset
  const duplicateElement = async (id: string) => {
    const el = canvas?.elements.find((e) => e.id === id);
    if (!el) return;
    try {
      await api.post(`/plans/${encodeURIComponent(slug)}/elements`, {
        type: el.type,
        title: el.title ? `${el.title} (copy)` : 'Untitled',
        content: el.content || '',
        x: (el.x || 0) + 24,
        y: (el.y || 0) + 24,
      });
      await reload();
      toast.success('Element duplicated.');
    } catch (err) {
      toast.error(`Duplicate failed: ${(err as Error).message}`);
    }
  };

  // v3.7.0 — Change element type
  const changeElementType = async (id: string, newType: string) => {
    try {
      await api.put(`/plans/${encodeURIComponent(slug)}/elements/${encodeURIComponent(id)}`, { type: newType });
      await reload();
      toast.success(`Type changed to ${newType}.`);
    } catch (err) {
      toast.error(`Change type failed: ${(err as Error).message}`);
    }
  };

  const addConnection = async (from: string, to: string, label?: string) => {
    try {
      await api.post(`/plans/${encodeURIComponent(slug)}/connections`, { from, to, label });
      await reload();
      toast.success('Connection added.');
    } catch (err) {
      toast.error(`Connection failed: ${(err as Error).message}`);
    }
  };

  const deleteConnection = async (id: string) => {
    try {
      await api.del(`/plans/${encodeURIComponent(slug)}/connections/${encodeURIComponent(id)}`);
      await reload();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const addComment = async (text: string, elementId: string | null, worldPos?: { x: number; y: number }) => {
    try {
      const path = elementId
        ? `/plans/${encodeURIComponent(slug)}/elements/${encodeURIComponent(elementId)}/comments`
        : `/plans/${encodeURIComponent(slug)}/comments`;
      const body: { text: string; elementId: string | null; x?: number; y?: number } = { text, elementId };
      if (worldPos) { body.x = worldPos.x; body.y = worldPos.y; }
      await api.post(path, body);
      await reload();
      toast.success('Comment added.');
    } catch (err) {
      toast.error(`Comment failed: ${(err as Error).message}`);
    }
  };

  const deleteComment = async (cid: string) => {
    try {
      await api.del(`/plans/${encodeURIComponent(slug)}/comments/${encodeURIComponent(cid)}`);
      await reload();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const updatePositions = async (positions: { id: string; x: number; y: number }[]) => {
    try {
      await api.put(`/plans/${encodeURIComponent(slug)}/position`, { positions });
    } catch (err) {
      // non-fatal
      console.warn('Position update failed', err);
    }
  };

  const onConfigure = () => {
    if (!meta) return;
    let titleEl: HTMLInputElement | null = null;
    let descEl: HTMLTextAreaElement | null = null;
    let tagsEl: HTMLInputElement | null = null;
    let statusEl: HTMLSelectElement | null = null;
    modal.open({
      title: 'Configure plan',
      width: 560,
      children: (
        <div className="plan-config-form">
          <label className="field-label">Title</label>
          <input ref={(el) => { titleEl = el; }} className="input" type="text" defaultValue={meta.title} />
          <label className="field-label">Description (markdown)</label>
          <textarea ref={(el) => { descEl = el; }} className="textarea" rows={3} defaultValue={meta.description || ''} />
          <label className="field-label">Tags (comma-separated)</label>
          <input ref={(el) => { tagsEl = el; }} className="input" type="text" defaultValue={(meta.tags || []).join(', ')} />
          <label className="field-label">Status</label>
          <select ref={(el) => { statusEl = el; }} className="select" defaultValue={meta.status}>
            {PLAN_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                const tags = (tagsEl?.value || '').split(',').map((t) => t.trim()).filter(Boolean);
                await api.put(`/plans/${encodeURIComponent(slug)}`, {
                  title: (titleEl?.value || '').trim() || meta.title,
                  description: descEl?.value || '',
                  tags,
                  status: statusEl?.value || meta.status,
                });
                await reload();
                toast.success('Plan updated.');
                modal.close();
              } catch (err) {
                toast.error(`Save failed: ${(err as Error).message}`);
              }
            }}
          >
            Save
          </Button>
        </div>
      ),
    });
  };

  const onAddElement = (worldPos?: { x: number; y: number }) => {
    let typeEl: HTMLSelectElement | null = null;
    let titleEl: HTMLInputElement | null = null;
    let contentEl: HTMLTextAreaElement | null = null;
    modal.open({
      title: 'Add element',
      width: 520,
      children: (
        <div className="plan-element-form">
          <label className="field-label">Type</label>
          <select ref={(el) => { typeEl = el; }} className="select" defaultValue="task">
            {ELEMENT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <label className="field-label">Title</label>
          <input ref={(el) => { titleEl = el; }} className="input" type="text" placeholder="Element title" autoFocus />
          <label className="field-label">Content (markdown)</label>
          <textarea ref={(el) => { contentEl = el; }} className="textarea" rows={4} placeholder="Description…" />
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (worldPos) {
                await addElement({
                  type: typeEl?.value || 'note',
                  title: (titleEl?.value || 'Untitled').trim(),
                  content: contentEl?.value || '',
                  x: worldPos.x,
                  y: worldPos.y,
                });
              } else {
                const maxX = (canvas?.elements || []).reduce((acc, el) => Math.max(acc, el.x || 0), 0);
                const maxY = (canvas?.elements || []).reduce((acc, el) => Math.max(acc, el.y || 0), 0);
                await addElement({
                  type: typeEl?.value || 'note',
                  title: (titleEl?.value || 'Untitled').trim(),
                  content: contentEl?.value || '',
                  x: 80 + Math.min(maxX + 40, 200),
                  y: 80 + Math.min(maxY + 40, 200),
                });
              }
              modal.close();
            }}
          >
            <Plus size={12} /> Add
          </Button>
        </div>
      ),
    });
  };

  const onCanvasComment = (worldPos?: { x: number; y: number }) => {
    let textEl: HTMLTextAreaElement | null = null;
    modal.open({
      title: 'Add canvas comment',
      width: 480,
      children: (
        <div>
          <label className="field-label">Comment</label>
          <textarea ref={(el) => { textEl = el; }} className="textarea" rows={4} placeholder="Comment for the whole plan…" autoFocus />
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const text = (textEl?.value || '').trim();
              if (!text) return;
              await addComment(text, null, worldPos);
              modal.close();
            }}
          >
            <Send size={12} /> Post
          </Button>
        </div>
      ),
    });
  };

  if (loading || !canvas || !meta) {
    return (
      <div className="view view-plans view-plans-fullscreen">
        <PlanEditorHeader
          slug={slug}
          meta={meta || { title: slug, status: 'draft', tags: [] }}
          counts={{ elements: 0, comments: 0 }}
          onBack={onBack}
          onConfigure={() => undefined}
          onAddElement={() => undefined}
          onCanvasComment={() => undefined}
          onRefresh={reload}
          onDelete={onDelete}
          fullscreen={fullscreen}
          setFullscreen={setFullscreen}
        />
        <div className="view-loading" style={{ flex: 1 }}>
          <Spinner size="lg" />
          <p>Loading canvas…</p>
        </div>
      </div>
    );
  }

  const visibleComments = selectedElId
    ? canvas.comments.filter((c) => c.elementId === selectedElId)
    : canvas.comments;

  return (
    <div className={cn('view view-plans view-plans-fullscreen', !fullscreen && 'view-plans-embedded')}>
      {!fullscreen && (
        <PlanEditorHeader
          slug={slug}
          meta={meta}
          counts={{ elements: canvas.elements.length, comments: totalComments }}
          onBack={onBack}
          onConfigure={onConfigure}
          onAddElement={onAddElement}
          onCanvasComment={onCanvasComment}
          onRefresh={reload}
          onDelete={onDelete}
          fullscreen={fullscreen}
          setFullscreen={setFullscreen}
        />
      )}

        <div className="plans-body">
          {/* Canvas wrapper with floating controls */}
          <div className="plan-canvas-wrapper">
            {fullscreen && (
            <div className="plan-canvas-floating-controls">
            <Button variant="ghost" size="sm" onClick={onBack} title="Back to plans list">
              <ArrowLeft size={14} /> Back
            </Button>
            <h3>{meta?.title || slug}</h3>
            {meta && <StatusBadge kind={planStatusKind(meta.status)}>{meta.status}</StatusBadge>}
            <Button variant="secondary" size="sm" onClick={() => onAddElement()}>
              <Plus size={14} /> Element
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onCanvasComment()}>
              <MessageCircle size={14} /> Comment
            </Button>
            <Button variant="ghost" size="sm" onClick={onConfigure} title="Configure plan" aria-label="Configure plan">
              <SettingsIcon size={14} />
            </Button>
            </div>
            )}

          <CanvasViewport
            canvas={canvas}
            selectedElId={selectedElId}
            onSelect={setSelectedElId}
            onMoveElement={moveElementLocally}
            onMoveEnd={updatePositions}
            onDeleteElement={deleteElement}
            onConnect={(from, to) => addConnection(from, to)}
            onDeleteConnection={deleteConnection}
            onEditElement={(el) => editElementInline(modal, slug, el, updateElement, toast)}
            onContextMenu={(e, worldPos) => {
              e.preventDefault();
              setElementContextMenu(null);
              setContextMenuWorldPos(worldPos);
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  { label: 'Add element', icon: Plus, onClick: () => onAddElement(worldPos) },
                  { label: 'Add comment', icon: MessageSquare, onClick: () => onCanvasComment(worldPos) },
                  { type: 'separator' },
                  { label: 'Configure plan', icon: SettingsIcon, onClick: onConfigure },
                  { label: 'Delete plan', icon: Trash2, onClick: onDelete },
                ],
              });
            }}
            onElementContextMenu={(e, elementId, _worldPos) => {
              const el = canvas?.elements.find((x) => x.id === elementId);
              if (!el) return;
              setContextMenu(null);
              setElementContextMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  { label: 'Edit', icon: Pencil, onClick: () => { editElementInline(modal, slug, el, updateElement, toast); } },
                  { label: 'Duplicate', icon: Copy, onClick: () => duplicateElement(elementId) },
                  { type: 'separator' },
                  { label: 'Change type', icon: Layers, onClick: () => {
                    // Cycle through types: task -> note -> decision -> question -> task
                    const types = ['task', 'note', 'decision', 'question'];
                    const currentIdx = types.indexOf(el.type);
                    const nextType = types[(currentIdx + 1) % types.length];
                    changeElementType(elementId, nextType);
                  }},
                  { type: 'separator' },
                  { label: `Delete`, icon: Trash2, onClick: () => { if (confirm(`Delete "${el.title || el.type}"?`)) deleteElement(elementId); } },
                ],
              });
            }}
          />

          {/* Canvas-level context menu */}
          <CanvasContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
          {/* Element-level context menu */}
          <CanvasContextMenu menu={elementContextMenu} onClose={() => setElementContextMenu(null)} />
        </div>

        {showComments && (
          <CommentsPanel
            slug={slug}
            comments={visibleComments}
            selectedElId={selectedElId}
            onAdd={(text) => addComment(text, selectedElId)}
            onDelete={deleteComment}
            onClose={() => {
              setShowComments(false);
              setSelectedElId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function PlanEditorHeader({
  slug,
  meta,
  counts,
  onBack,
  onConfigure,
  onAddElement,
  onCanvasComment,
  onRefresh,
  onDelete,
  fullscreen,
  setFullscreen,
}: {
  slug: string;
  meta: { title: string; status: string; tags: string[] };
  counts: { elements: number; comments: number };
  onBack: () => void;
  onConfigure: () => void;
  onAddElement: () => void;
  onCanvasComment: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  fullscreen: boolean;
  setFullscreen: (v: boolean) => void;
}) {
  const kind = planStatusKind(meta.status);
  return (
    <header className="plans-editor-bar">
      <div className="plans-editor-bar-left">
        <Button variant="ghost" size="sm" onClick={onBack} title="Back to plans list">
          <ArrowLeft size={14} /> Back
        </Button>
        <div className="plans-editor-meta">
          <span className="plans-editor-title">{meta.title || slug}</span>
          <span className="plans-editor-slug mono">{slug}</span>
          <StatusBadge kind={kind}>{meta.status}</StatusBadge>
        </div>
      </div>
      <div className="plans-editor-bar-right">
        <span className="muted text-sm">
          {counts.elements} element{counts.elements === 1 ? '' : 's'} · {counts.comments} comment{counts.comments === 1 ? '' : 's'}
        </span>
        <Button variant="secondary" size="sm" onClick={onAddElement}>
          <Plus size={14} /> Element
        </Button>
        <Button variant="secondary" size="sm" onClick={onCanvasComment}>
          <MessageCircle size={14} /> Comment
        </Button>
        <Button variant="ghost" size="sm" onClick={onConfigure} title="Configure plan" aria-label="Configure plan">
          <SettingsIcon size={14} />
        </Button>
        <Button variant="ghost" size="sm" onClick={onRefresh} title="Refresh canvas" aria-label="Refresh canvas">
          <RefreshCw size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFullscreen(!fullscreen)}
          title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} title="Delete plan" aria-label="Delete plan">
          <Trash2 size={14} />
        </Button>
      </div>
    </header>
  );
}

function editElementInline(
  modal: ReturnType<typeof useModal>,
  slug: string,
  el: CanvasElement,
  updateElement: (id: string, body: Partial<CanvasElement>) => Promise<void>,
  toast: ReturnType<typeof useToast>,
) {
  let typeEl: HTMLSelectElement | null = null;
  let titleEl: HTMLInputElement | null = null;
  let contentEl: HTMLTextAreaElement | null = null;
  let statusEl: HTMLInputElement | null = null;
  modal.open({
    title: `Edit ${el.title || el.type}`,
    width: 520,
    children: (
      <div className="plan-element-form">
        <label className="field-label">Type</label>
        <select ref={(el2) => { typeEl = el2; }} className="select" defaultValue={el.type}>
          {ELEMENT_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <label className="field-label">Title</label>
        <input ref={(el2) => { titleEl = el2; }} className="input" type="text" defaultValue={el.title} />
        <label className="field-label">Status</label>
        <input ref={(el2) => { statusEl = el2; }} className="input" type="text" defaultValue={el.status} placeholder="open / done / blocked …" />
        <label className="field-label">Content (markdown)</label>
        <textarea ref={(el2) => { contentEl = el2; }} className="textarea" rows={5} defaultValue={el.content} />
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await updateElement(el.id, {
                type: typeEl?.value || el.type,
                title: titleEl?.value ?? el.title,
                content: contentEl?.value ?? el.content,
                status: statusEl?.value || el.status,
              });
              toast.success('Element saved.');
              modal.close();
            } catch (err) {
              toast.error(`Save failed: ${(err as Error).message}`);
            }
          }}
        >
          Save
        </Button>
      </div>
    ),
  });
}

// ── Canvas viewport ───────────────────────────────────────────────────

type ViewportProps = {
  canvas: Canvas;
  selectedElId: string | null;
  onSelect: (id: string | null) => void;
  onMoveElement: (id: string, x: number, y: number) => void;
  onMoveEnd: (positions: { id: string; x: number; y: number }[]) => void;
  onDeleteElement: (id: string) => void;
  onConnect: (from: string, to: string) => void;
  onDeleteConnection: (id: string) => void;
  onEditElement: (el: CanvasElement) => void;
  onContextMenu?: (e: React.MouseEvent, worldPos: { x: number; y: number }) => void;
  // v3.7.0 — Element-specific context menu (right-click on an element)
  onElementContextMenu?: (e: React.MouseEvent, elementId: string, worldPos: { x: number; y: number }) => void;
  fitToView?: () => void;
};

function CanvasViewport({
  canvas,
  selectedElId,
  onSelect,
  onMoveElement,
  onMoveEnd,
  onDeleteElement,
  onConnect,
  onDeleteConnection,
  onEditElement,
  onContextMenu,
  onElementContextMenu,
}: ViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef(canvas.elements);
  const stateRef = useRef({
    panning: false,
    startX: 0,
    startY: 0,
    ox: canvas.viewport.x || 0,
    oy: canvas.viewport.y || 0,
    scale: canvas.viewport.zoom || 1,
    dragging: null as null | { id: string; offsetX: number; offsetY: number; moved: boolean; origX: number; origY: number },
    connecting: null as null | { fromId: string; x: number; y: number },
  });

  useEffect(() => {
    elementsRef.current = canvas.elements;
  }, [canvas.elements]);

  useEffect(() => {
    const root = rootRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return undefined;
    const apply = () => {
      const s = stateRef.current;
      inner.style.transform = `translate(${s.ox}px, ${s.oy}px) scale(${s.scale})`;
    };
    apply();

    const screenToWorld = (clientX: number, clientY: number) => {
      const rect = inner.getBoundingClientRect();
      const s = stateRef.current;
      // rect.left/rect.top is the *post-transform* top-left; account for scale
      const x = (clientX - rect.left) / s.scale;
      const y = (clientY - rect.top) / s.scale;
      return { x, y };
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) return;
      const t = e.target as HTMLElement;
      if (
        t === root ||
        t.classList.contains('canvas-grid-bg') ||
        t.classList.contains('canvas-inner')
      ) {
        stateRef.current.panning = true;
        stateRef.current.startX = e.clientX - stateRef.current.ox;
        stateRef.current.startY = e.clientY - stateRef.current.oy;
        root.style.cursor = 'grabbing';
        return;
      }
      const elCard = t.closest('.canvas-element') as HTMLElement | null;
      if (elCard) {
        const id = elCard.dataset.elementId;
        if (!id) return;
        const headerHit = !!t.closest('.canvas-element-head');
        const handleHit = !!t.closest('.canvas-element-handle');
        if (headerHit || handleHit) {
          const world = screenToWorld(e.clientX, e.clientY);
          const el = elementsRef.current.find((x) => x.id === id);
          if (!el) return;
          stateRef.current.dragging = {
            id,
            offsetX: world.x - (el.x || 0),
            offsetY: world.y - (el.y || 0),
            moved: false,
            origX: el.x || 0,
            origY: el.y || 0,
          };
          onSelect(id);
          e.preventDefault();
        }
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      const s = stateRef.current;
      if (s.panning) {
        s.ox = e.clientX - s.startX;
        s.oy = e.clientY - s.startY;
        apply();
        return;
      }
      if (s.dragging) {
        const world = screenToWorld(e.clientX, e.clientY);
        const newX = Math.max(0, world.x - s.dragging.offsetX);
        const newY = Math.max(0, world.y - s.dragging.offsetY);
        if (!s.dragging.moved) {
          const dx = Math.abs(newX - s.dragging.origX);
          const dy = Math.abs(newY - s.dragging.origY);
          if (dx < 2 && dy < 2) return;
        }
        s.dragging.moved = true;
        onMoveElement(s.dragging.id, newX, newY);
        return;
      }
      if (s.connecting) {
        const inner2 = innerRef.current;
        if (!inner2) return;
        const world = screenToWorld(e.clientX, e.clientY);
        s.connecting.x = world.x;
        s.connecting.y = world.y;
        // Trigger a custom event so the connecting SVG re-renders.
        inner2.dispatchEvent(new CustomEvent('canvas-move', { detail: { x: world.x, y: world.y } }));
      }
    };
    const onMouseUp = () => {
      const s = stateRef.current;
      if (s.panning) {
        s.panning = false;
        root.style.cursor = '';
      }
      if (s.dragging) {
        if (s.dragging.moved) {
          const el = elementsRef.current.find((x) => x.id === s.dragging?.id);
          if (el) {
            onMoveEnd([{ id: el.id, x: el.x || 0, y: el.y || 0 }]);
          }
        }
        s.dragging = null;
      }
      if (s.connecting) {
        s.connecting = null;
        innerRef.current?.dispatchEvent(new CustomEvent('canvas-move', { detail: { x: 0, y: 0 } }));
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const next = Math.min(
        Math.max(stateRef.current.scale * delta, 0.25),
        2.5,
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
  }, [onMoveElement, onMoveEnd, onSelect]);

  const fitToView = () => {
    if (!rootRef.current || canvas.elements.length === 0) {
      stateRef.current.ox = 0;
      stateRef.current.oy = 0;
      stateRef.current.scale = 1;
      const inner = innerRef.current;
      if (inner) {
        inner.style.transform = `translate(0px, 0px) scale(1)`;
      }
      return;
    }
    const bbox = canvas.elements.reduce(
      (acc, el) => {
        const ex = el.x || 0;
        const ey = el.y || 0;
        const ex2 = ex + (el.width || 240);
        const ey2 = ey + (el.height || 120);
        return {
          minX: Math.min(acc.minX, ex),
          minY: Math.min(acc.minY, ey),
          maxX: Math.max(acc.maxX, ex2),
          maxY: Math.max(acc.maxY, ey2),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const pad = 80;
    const root = rootRef.current;
    const w = root.clientWidth - pad * 2;
    const h = root.clientHeight - pad * 2;
    const bw = bbox.maxX - bbox.minX;
    const bh = bbox.maxY - bbox.minY;
    const scale = Math.min(w / Math.max(bw, 1), h / Math.max(bh, 1), 1.5);
    const ox = -bbox.minX * scale + pad;
    const oy = -bbox.minY * scale + pad;
    stateRef.current.ox = ox;
    stateRef.current.oy = oy;
    stateRef.current.scale = scale;
    const inner = innerRef.current;
    if (inner) {
      inner.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
    }
  };

  return (
    <div className="plans-canvas-wrap">
      <div className="canvas-toolbar">
        <button type="button" className="icon-btn" title="Fit to view" aria-label="Fit canvas to view" onClick={fitToView}>
          <Maximize2 size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Reset zoom"
          aria-label="Reset canvas zoom"
          onClick={() => {
            stateRef.current.ox = 0;
            stateRef.current.oy = 0;
            stateRef.current.scale = 1;
            const inner = innerRef.current;
            if (inner) inner.style.transform = 'translate(0px, 0px) scale(1)';
          }}
        >
          <Circle size={14} />
        </button>
        <span className="muted text-sm" style={{ marginLeft: 'auto' }}>
          Pan: drag empty · Zoom: scroll · Drag element header to move · Double-click to edit · Right-click element for actions
        </span>
      </div>
      <div className="canvas-root" ref={rootRef} onContextMenu={(e) => {
        e.preventDefault();
        const rect = innerRef.current?.getBoundingClientRect();
        const s = stateRef.current;
        if (!rect) return;
        const worldPos = { x: (e.clientX - rect.left) / s.scale, y: (e.clientY - rect.top) / s.scale };
        onContextMenu?.(e, worldPos);
      }}>
        <div className="canvas-grid-bg" />
        <div className="canvas-inner" ref={innerRef}>
          {canvas.elements.length === 0 ? (
            <div className="canvas-empty">
              <EmptyState
                icon={<MapIcon size={32} />}
                title="No elements yet"
                message="Add an element from the toolbar above to get started."
              />
            </div>
          ) : (
            <>
              <ConnectionsLayer
                canvas={canvas}
                onDeleteConnection={onDeleteConnection}
              />
              {canvas.elements.map((el) => (
                <CanvasElementView
                  key={el.id}
                  element={el}
                  selected={selectedElId === el.id}
                  commentCount={canvas.comments.filter((c) => c.elementId === el.id).length}
                  onSelect={() => onSelect(el.id)}
                  onEdit={() => onEditElement(el)}
                  onDelete={() => onDeleteElement(el.id)}
                   onContextMenu={onElementContextMenu ? (e) => {
                     e.preventDefault();
                     e.stopPropagation();
                     const rect = innerRef.current?.getBoundingClientRect();
                     if (!rect) return;
                    const s = stateRef.current;
                    const worldPos = { x: (e.clientX - rect.left) / s.scale, y: (e.clientY - rect.top) / s.scale };
                    onElementContextMenu(e, el.id, worldPos);
                  } : undefined}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CanvasElementView({
  element,
  selected,
  commentCount,
  onSelect,
  onEdit,
  onDelete,
  onContextMenu,
}: {
  element: CanvasElement;
  selected: boolean;
  commentCount: number;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const x = element.x || 0;
  const y = element.y || 0;
  const w = element.width || 240;
  const h = element.height || 120;
  const color = elementColor(element.type);
  return (
    <div
      className={cn('canvas-element', selected && 'canvas-element-selected')}
      data-element-id={element.id}
      style={{
        left: x,
        top: y,
        width: w,
        minHeight: h,
        borderColor: color,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.stopPropagation();
          onContextMenu(e);
        } else {
          e.preventDefault();
          if (confirm(`Delete element "${element.title || element.type}"?`)) {
            onDelete();
          }
        }
      }}
    >
      <div className="canvas-element-head" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
        <div className="canvas-element-type">
          <ElementIcon type={element.type} size={12} />
          <span style={{ color }}>{element.type}</span>
        </div>
        <div className="canvas-element-actions">
          {commentCount > 0 && (
            <span className="canvas-element-badge" title={`${commentCount} comments`}>
              <MessageCircle size={10} />
              {commentCount}
            </span>
          )}
          <button type="button" className="canvas-element-handle" title="Drag to move" aria-label="Drag">
            ⋮⋮
          </button>
        </div>
      </div>
      <div className="canvas-element-title">{element.title || 'Untitled'}</div>
      {element.content && (
        <div className="canvas-element-content">{truncate(element.content, 240)}</div>
      )}
      {element.status && element.status !== 'open' && (
        <div className="canvas-element-status">
          <StatusBadge kind={element.status === 'done' ? 'success' : element.status === 'blocked' ? 'error' : 'info'}>
            {element.status}
          </StatusBadge>
        </div>
      )}
    </div>
  );
}

function ConnectionsLayer({
  canvas,
  onDeleteConnection,
}: {
  canvas: Canvas;
  onDeleteConnection: (id: string) => void;
}) {
  if (canvas.connections.length === 0) return null;
  const els = canvas.elements;
  // Compute bounding box
  const bbox = els.reduce(
    (acc, el) => {
      const ex = el.x || 0;
      const ey = el.y || 0;
      const ex2 = ex + (el.width || 240);
      const ey2 = ey + (el.height || 120);
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
      style={{ left: bbox.minX - pad, top: bbox.minY - pad }}
    >
      <defs>
        <marker id="plan-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
        </marker>
      </defs>
      {canvas.connections.map((c) => {
        const from = els.find((e) => e.id === c.from || e.id === c.fromElementId);
        const to = els.find((e) => e.id === c.to || e.id === c.toElementId);
        if (!from || !to) return null;
        const x1 = ox + (from.x || 0) + (from.width || 240) / 2;
        const y1 = oy + (from.y || 0) + (from.height || 120);
        const x2 = ox + (to.x || 0) + (to.width || 240) / 2;
        const y2 = oy + (to.y || 0);
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        return (
          <g key={c.id} className="canvas-connection" onClick={() => onDeleteConnection(c.id)}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={1.5} markerEnd="url(#plan-arrow)" />
            {c.label && (
              <text x={midX} y={midY} className="canvas-connection-label" textAnchor="middle">
                {c.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Comments panel ────────────────────────────────────────────────────

function CommentsPanel({
  slug,
  comments,
  selectedElId,
  onAdd,
  onDelete,
  onClose,
}: {
  slug: string;
  comments: CanvasComment[];
  selectedElId: string | null;
  onAdd: (text: string) => void;
  onDelete: (cid: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <aside className="plans-comments-panel">
      <header className="plans-comments-panel-head">
        <h3 className="card-title">
          <MessageCircle size={14} />
          {selectedElId ? 'Element comments' : 'Canvas comments'}
        </h3>
        <button type="button" className="icon-btn" onClick={onClose} title="Close panel" aria-label="Close">
          <X size={14} />
        </button>
      </header>
      <div className="plans-comments-panel-list">
        {comments.length === 0 ? (
          <p className="muted text-sm" style={{ padding: 'var(--space-4)' }}>
            {selectedElId ? 'No comments on this element yet.' : 'No comments on this plan yet.'}
          </p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="plan-comment">
              <div className="plan-comment-head">
                <span className="plan-comment-author mono">{c.author}</span>
                <span className="plan-comment-time tabular-nums muted">{formatRelative(c.created)}</span>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  aria-label="Delete comment"
                  onClick={() => onDelete(c.id)}
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              </div>
              <div className="plan-comment-text">{c.text}</div>
            </div>
          ))
        )}
      </div>
      <form
        className="plans-comments-panel-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onAdd(text.trim());
          setText('');
        }}
      >
        <textarea
          className="textarea"
          rows={2}
          placeholder={selectedElId ? 'Add a comment to this element…' : 'Add a canvas comment…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button variant="primary" size="sm" type="submit" disabled={!text.trim()}>
          <Send size={12} /> Post
        </Button>
      </form>
    </aside>
  );
}
