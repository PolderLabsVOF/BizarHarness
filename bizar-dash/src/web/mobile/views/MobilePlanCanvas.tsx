// src/mobile/views/MobilePlanCanvas.tsx — mobile plan canvas: read-only + edit mode.
import { useEffect, useState } from 'react';
import { Plus, MessageSquare, Pencil, Trash2, CheckSquare, StickyNote, HelpCircle, X } from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/utils';
import type { Canvas, CanvasElement } from '../../lib/types';
import { MobileBottomSheet } from '../components/MobileBottomSheet';
import { MobileModal } from '../components/MobileModal';

type Props = {
  slug: string;
  onBack: () => void;
};

const ELEMENT_TYPES = [
  { id: 'task', label: 'Task', color: 'var(--info)' },
  { id: 'note', label: 'Note', color: 'var(--text-dim)' },
  { id: 'decision', label: 'Decision', color: 'var(--accent)' },
  { id: 'question', label: 'Question', color: 'var(--warning)' },
];

function elementColor(type: string): string {
  return ELEMENT_TYPES.find((t) => t.id === type)?.color || 'var(--text-dim)';
}

function ElementIcon({ type, size = 12 }: { type: string; size?: number }) {
  switch (type) {
    case 'task': return <CheckSquare size={size} style={{ color: 'var(--info)' }} />;
    case 'note': return <StickyNote size={size} style={{ color: 'var(--text-dim)' }} />;
    case 'decision': return <CheckSquare size={size} style={{ color: 'var(--accent)' }} />;
    case 'question': return <HelpCircle size={size} style={{ color: 'var(--warning)' }} />;
    default: return <StickyNote size={size} />;
  }
}

export function MobilePlanCanvas({ slug, onBack }: Props) {
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [meta, setMeta] = useState<{ title: string; status: string; tags: string[]; description?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [selectedEl, setSelectedEl] = useState<CanvasElement | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [addElementOpen, setAddElementOpen] = useState(false);
  const [addCommentOpen, setAddCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState('');

  const reload = async () => {
    setLoading(true);
    try {
      const plan = await api.get<{ meta: typeof meta; canvas: Canvas }>(
        `/plans/${encodeURIComponent(slug)}`,
      );
      setCanvas(plan.canvas);
      setMeta(plan.meta);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [slug]);

  const addElement = async (type: string, title: string, content: string) => {
    try {
      const maxX = (canvas?.elements || []).reduce((acc, el) => Math.max(acc, el.x || 0), 40);
      const maxY = (canvas?.elements || []).reduce((acc, el) => Math.max(acc, el.y || 0), 40);
      await api.post(`/plans/${encodeURIComponent(slug)}/elements`, {
        type,
        title,
        content,
        x: 20 + maxX,
        y: 20 + maxY,
        width: 240,
        height: 120,
      });
      await reload();
      setAddElementOpen(false);
    } catch {
      // best-effort
    }
  };

  const updateElement = async (id: string, body: Partial<CanvasElement>) => {
    try {
      await api.put(`/plans/${encodeURIComponent(slug)}/elements/${encodeURIComponent(id)}`, body);
      await reload();
      setSelectedEl(null);
    } catch {
      // best-effort
    }
  };

  const deleteElement = async (id: string) => {
    if (!confirm('Delete this element?')) return;
    try {
      await api.del(`/plans/${encodeURIComponent(slug)}/elements/${encodeURIComponent(id)}`);
      setSelectedEl(null);
      await reload();
    } catch {
      // best-effort
    }
  };

  const addComment = async (text: string, elementId: string | null) => {
    try {
      const path = elementId
        ? `/plans/${encodeURIComponent(slug)}/elements/${encodeURIComponent(elementId)}/comments`
        : `/plans/${encodeURIComponent(slug)}/comments`;
      await api.post(path, { text, elementId });
      await reload();
      setCommentText('');
      setAddCommentOpen(false);
    } catch {
      // best-effort
    }
  };

  if (loading || !canvas || !meta) {
    return (
      <div className="mobile-view">
        <div className="mobile-loading"><p>Loading canvas…</p></div>
      </div>
    );
  }

  return (
    <div className="mobile-view mobile-view-canvas">
      {/* Canvas top bar */}
      <div className="mobile-canvas-bar">
        <div className="mobile-canvas-meta">
          <span className="mobile-canvas-title">{meta.title || slug}</span>
          <span className="mobile-canvas-status" data-status={meta.status}>{meta.status}</span>
        </div>
        <div className="mobile-canvas-actions">
          <button
            type="button"
            className={`mobile-icon-btn ${editMode ? 'active' : ''}`}
            onClick={() => setEditMode((v) => !v)}
            aria-label={editMode ? 'Done editing' : 'Edit'}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="mobile-icon-btn"
            onClick={() => setShowComments((v) => !v)}
            aria-label="Comments"
          >
            <MessageSquare size={16} />
            {canvas.comments.length > 0 && (
              <span className="mobile-canvas-comment-count">{canvas.comments.length}</span>
            )}
          </button>
          {editMode && (
            <button
              type="button"
              className="mobile-icon-btn"
              onClick={() => setAddElementOpen(true)}
              aria-label="Add element"
            >
              <Plus size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Elements list */}
      <div className="mobile-canvas-elements">
        {canvas.elements.length === 0 && (
          <div className="mobile-empty">
            <p>No elements yet.</p>
            {editMode && (
              <button
                type="button"
                className="mobile-btn"
                onClick={() => setAddElementOpen(true)}
              >
                <Plus size={14} /> Add Element
              </button>
            )}
          </div>
        )}
          {canvas.elements.map((el) => (
          <button
            key={el.id}
            type="button"
            className={`mobile-canvas-element ${selectedEl?.id === el.id ? 'selected' : ''}`}
            style={{ borderColor: elementColor(el.type) }}
            onClick={() => {
              if (editMode) {
                setSelectedEl(el);
              }
            }}
            aria-pressed={selectedEl?.id === el.id}
          >
            <div className="mobile-canvas-el-header" style={{ background: `${elementColor(el.type)}18` }}>
              <ElementIcon type={el.type} size={12} />
              <span className="mobile-canvas-el-type" style={{ color: elementColor(el.type) }}>{el.type}</span>
              {el.status && el.status !== 'open' && (
                <span className="mobile-canvas-el-status">{el.status}</span>
              )}
            </div>
            <div className="mobile-canvas-el-title">{el.title || 'Untitled'}</div>
            {el.content && (
              <div className="mobile-canvas-el-content">
                {el.content.slice(0, 120)}{el.content.length > 120 ? '…' : ''}
              </div>
            )}
            <div className="mobile-canvas-el-comments">
              <MessageSquare size={10} />
              {canvas.comments.filter((c) => c.elementId === el.id).length}
            </div>
          </button>
        ))}
      </div>

      {/* Comments panel */}
      {showComments && (
        <div className="mobile-canvas-comments">
          <div className="mobile-canvas-comments-header">
            <h4>Comments ({canvas.comments.length})</h4>
            <button type="button" className="mobile-icon-btn" onClick={() => setShowComments(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="mobile-canvas-comment-list">
            {canvas.comments.length === 0 && (
              <p className="mobile-empty-inline">No comments yet.</p>
            )}
            {canvas.comments.map((c) => (
              <div key={c.id} className="mobile-canvas-comment">
                <div className="mobile-canvas-comment-head">
                  <span className="mono">{c.author}</span>
                  <span className="muted">{formatRelative(c.created)}</span>
                </div>
                <div className="mobile-canvas-comment-text">{c.text}</div>
              </div>
            ))}
          </div>
          <div className="mobile-canvas-comment-input">
            <textarea
              className="mobile-input"
              rows={2}
              placeholder="Add a comment…"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <button
              type="button"
              className="mobile-btn"
              disabled={!commentText.trim()}
              onClick={() => { addComment(commentText.trim(), null); }}
            >
              Post
            </button>
          </div>
        </div>
      )}

      {/* Element edit sheet */}
      {selectedEl && (
        <MobileBottomSheet
          open={true}
          onClose={() => setSelectedEl(null)}
          title={`Edit ${selectedEl.title || selectedEl.type}`}
          actions={
            <div className="mobile-task-detail-actions">
              <button
                type="button"
                className="mobile-btn mobile-btn-danger"
                onClick={() => deleteElement(selectedEl.id)}
              >
                <Trash2 size={14} /> Delete
              </button>
              <button
                type="button"
                className="mobile-btn"
                onClick={() => setAddCommentOpen(true)}
              >
                <MessageSquare size={14} /> Comment
              </button>
            </div>
          }
        >
          <ElementEditForm
            element={selectedEl}
            onSave={(body) => updateElement(selectedEl.id, body)}
            onClose={() => setSelectedEl(null)}
          />
        </MobileBottomSheet>
      )}

      {/* Add element modal */}
      <AddElementModal
        open={addElementOpen}
        onClose={() => setAddElementOpen(false)}
        onAdd={addElement}
      />

      {/* Add comment modal */}
      <MobileModal open={addCommentOpen} onClose={() => setAddCommentOpen(false)} title="Add Comment" actions={
        <button
          type="button"
          className="mobile-btn"
          style={{ width: '100%' }}
          disabled={!commentText.trim()}
          onClick={() => { addComment(commentText.trim(), selectedEl?.id || null); setAddCommentOpen(false); }}
        >
          <MessageSquare size={14} /> Post
        </button>
      }>
        <textarea
          className="mobile-input"
          rows={3}
          placeholder="Your comment…"
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          autoFocus
        />
      </MobileModal>
    </div>
  );
}

function ElementEditForm({
  element,
  onSave,
  onClose,
}: {
  element: CanvasElement;
  onSave: (body: Partial<CanvasElement>) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState(element.type);
  const [title, setTitle] = useState(element.title || '');
  const [content, setContent] = useState(element.content || '');
  const [status, setStatus] = useState(element.status || 'open');

  return (
    <form
      className="mobile-task-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ type, title, content, status });
        onClose();
      }}
    >
      <label className="mobile-field-label">Type</label>
      <select className="mobile-input" value={type} onChange={(e) => setType(e.target.value)}>
        {ELEMENT_TYPES.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      <label className="mobile-field-label">Title</label>
      <input
        className="mobile-input"
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="mobile-field-label">Status</label>
      <input
        className="mobile-input"
        type="text"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        placeholder="open / done / blocked"
      />
      <label className="mobile-field-label">Content (markdown)</label>
      <textarea
        className="mobile-input"
        rows={4}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <button type="submit" className="mobile-btn" style={{ width: '100%', marginTop: 8 }}>
        Save
      </button>
    </form>
  );
}

function AddElementModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (type: string, title: string, content: string) => void;
}) {
  const [type, setType] = useState('task');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(type, title.trim(), content.trim());
    setTitle('');
    setContent('');
  };

  return (
    <MobileModal open={open} onClose={onClose} title="Add Element" actions={
      <button type="submit" form="add-el-form" className="mobile-btn" style={{ width: '100%' }}>
        <Plus size={14} /> Add
      </button>
    }>
      <form id="add-el-form" onSubmit={handleSubmit} className="mobile-task-form">
        <label className="mobile-field-label">Type</label>
        <select className="mobile-input" value={type} onChange={(e) => setType(e.target.value)}>
          {ELEMENT_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <label className="mobile-field-label">Title *</label>
        <input
          className="mobile-input"
          type="text"
          placeholder="Element title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
        <label className="mobile-field-label">Content (markdown)</label>
        <textarea
          className="mobile-input"
          rows={3}
          placeholder="Description…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </form>
    </MobileModal>
  );
}
