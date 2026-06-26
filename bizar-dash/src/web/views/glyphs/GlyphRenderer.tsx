/**
 * GlyphRenderer.tsx — Renders a compiled glyph (from /api/artifacts/:slug/render)
 * with comment pin overlay + right-click to add comments.
 *
 * Uses the agent-native.com "Visual Plans" workflow (v3.22.0):
 * - Compiled glyph structure: { frontmatter, blocks: [{id, type, data, childrenMarkdown?}], errors }
 * - Each block renders via the components from ./components
 * - Comment pins from comments.json overlay on top, positioned absolutely
 * - Right-click anywhere → context menu with "Add comment" option
 * - Blocks are grouped into sections by id (overview, implementation, …)
 *
 * Layout (v3.22.0 — agent-native /visual-plan inspired, dark dashboard styling):
 *   .glyph-canvas                 ← outer, dotted background
 *     .glyph-toolbar-floating     ← sticky top-right pill (Send to agent, share, …)
 *     .glyph-canvas-content       ← centered blocks area
 *       .glyph-section            ← section card with optional heading
 *         .glyph-section-heading  ← "Overview" / "Implementation plan" / …
 *         .glyph-section-blocks   ← block stack inside the section
 *
 * v3.22.0 — section grouping + floating toolbar rewrite (kept all prior pin/ctx-menu logic).
 */

import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  MapPin,
  MessageSquare,
  Send,
  Share2,
  Undo2,
  Redo2,
  MoreHorizontal,
  Maximize2,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import {
  RichText,
  Callout,
  Checklist,
  Table,
  CodeTabs,
  Decision,
  OpenQuestions,
  FileTree,
  Diff,
  Stat,
  Workflow,
  Mockup,
} from './components';

// ---------------------------------------------------------------------------
// Types — match the server compiler output
// ---------------------------------------------------------------------------

type Block =
  | { id: string; type: 'RichText'; data: Record<string, unknown>; childrenMarkdown?: string }
  | { id: string; type: 'Callout'; data: { tone?: 'info' | 'warn' | 'success' | 'danger' }; childrenMarkdown?: string }
  | { id: string; type: 'Checklist'; data: { items: { id: string; label: string; checked: boolean }[] } }
  | { id: string; type: 'Table'; data: { columns: string[]; rows: string[][] } }
  | { id: string; type: 'CodeTabs'; data: { tabs: { id: string; label: string; language: string; code: string; caption?: string }[] } }
  | { id: string; type: 'Decision'; data: { title?: string; question?: string; options: { id: string; label: string; detail: string; recommended?: boolean }[] } }
  | { id: string; type: 'OpenQuestions'; data: { questions: { id: string; label: string; kind: 'choice' | 'text' | 'multi'; options?: string[] }[] } }
  | { id: string; type: 'FileTree'; data: { title?: string; entries: { path: string; change: 'added' | 'modified' | 'removed' | 'renamed'; note?: string }[] } }
  | { id: string; type: 'Diff'; data: { filename?: string; language?: string; mode?: 'split' | 'unified'; before: string; after: string } }
  | { id: string; type: 'Stat'; data: { label: string; value: string | number; trend?: 'up' | 'down' | 'flat'; hint?: string } }
  | { id: string; type: 'Workflow'; data: { steps: { id: string; label: string; type: 'task' | 'decision' | 'note' }[]; connections?: { from: string; to: string; label?: string }[] } }
  | { id: string; type: 'Mockup'; data: { title?: string; x?: number; y?: number; w?: number; h?: number; html: string } }
  | { id: string; type: 'Diagram'; data: { title?: string; dataHtml: string; dataCss?: string } };

interface CompiledGlyph {
  slug: string;
  frontmatter: Record<string, unknown>;
  blocks: Block[];
  errors: string[];
  compiledAt: string;
}

interface CommentPin {
  id: string;
  elementId?: string | null;
  x: number;
  y: number;
  text: string;
  author?: string;
  created?: string;
}

// ---------------------------------------------------------------------------
// Section grouping — block ids → section headings
// ---------------------------------------------------------------------------

const SECTION_MAP: Record<string, string> = {
  overview: 'Overview',
  implementation: 'Implementation plan',
  'implementation-plan': 'Implementation plan',
  questions: 'Open questions',
  'open-questions': 'Open questions',
  'open-questions-for-you': 'Open questions',
  comments: 'Comments',
  handoff: 'Handoff',
};

interface Section {
  heading: string | null;
  blocks: Block[];
}

function groupBlocksIntoSections(blocks: Block[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: null, blocks: [] };

  for (const b of blocks) {
    const heading = SECTION_MAP[b.id] ?? null;
    if (heading) {
      // Push any unheading prelude into a no-heading section so we don't lose it
      if (current.blocks.length > 0 || current.heading !== null) {
        sections.push(current);
      }
      current = { heading, blocks: [b] };
    } else {
      current.blocks.push(b);
    }
  }
  if (current.blocks.length > 0 || current.heading !== null) {
    sections.push(current);
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  slug: string;
  onClose?: () => void;
  /** Called after a comment is added so the parent can refresh. */
  onCommentAdded?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GlyphRenderer({ slug, onClose, onCommentAdded }: Props) {
  const toast = useToast();
  const [compiled, setCompiled] = useState<CompiledGlyph | null>(null);
  const [comments, setComments] = useState<CommentPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Context-menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  const [addingComment, setAddingComment] = useState<{ worldX: number; worldY: number } | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  // Active pin (expanded thread view)
  const [activePin, setActivePin] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Section grouping — memoized so we don't re-walk the block array on every render
  const sections = useMemo(
    () => (compiled ? groupBlocksIntoSections(compiled.blocks) : []),
    [compiled],
  );

  // Load compiled glyph + comments
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [renderData, artifactData] = await Promise.all([
          api.get<CompiledGlyph>(`/artifacts/${encodeURIComponent(slug)}/render`),
          api.get<{ comments?: CommentPin[]; commentsJson?: { comments?: CommentPin[] } }>(
            `/artifacts/${encodeURIComponent(slug)}`
          ),
        ]);
        if (cancelled) return;
        setCompiled(renderData);
        const fromFile = (artifactData as any)?.comments ?? [];
        setComments(Array.isArray(fromFile) ? fromFile : []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Right-click context menu
  function onContainerContextMenu(e: React.MouseEvent) {
    if (!canvasRef.current) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      worldX: e.clientX - rect.left,
      worldY: e.clientY - rect.top,
    });
  }

  async function submitComment() {
    if (!addingComment || !commentDraft.trim()) return;
    try {
      const created = await api.post<{ id?: string }>(
        `/artifacts/${encodeURIComponent(slug)}/comments`,
        {
          x: addingComment.worldX,
          y: addingComment.worldY,
          text: commentDraft.trim(),
          author: 'drb0rk',
        }
      );
      setComments((prev) => [
        ...prev,
        {
          id: created.id ?? `cmt_${Date.now()}`,
          x: addingComment.worldX,
          y: addingComment.worldY,
          text: commentDraft.trim(),
          author: 'drb0rk',
          created: new Date().toISOString(),
        },
      ]);
      setAddingComment(null);
      setCommentDraft('');
      setCtxMenu(null);
      onCommentAdded?.();
      toast.success('Comment added');
    } catch (err) {
      toast.error(`Failed to add comment: ${(err as Error).message}`);
    }
  }

  // "Send to agent" — collects free-placed comments and any answers to
  // OpenQuestions, writes `feedback.md` on disk, and marks the artifact
  // `status: review` so the agent picks it up.
  async function submitFeedback() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await api.post<{ ok: boolean; commentCount?: number; questionCount?: number }>(
        `/artifacts/${encodeURIComponent(slug)}/submit`,
        { answers: [], submitter: 'drb0rk' },
      );
      if (result?.ok) {
        toast.success('Sent to agent — feedback.md written, status=review');
        onCommentAdded?.();
      } else {
        toast.error('Submit failed: server did not return ok=true');
      }
    } catch (err) {
      toast.error(`Submit failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleFullscreen() {
    setFullscreen((v) => !v);
  }

  // Render a single block
  const renderBlock = (b: Block) => {
    const id = b.id;
    const data = (b.data ?? {}) as Record<string, unknown>;
    switch (b.type) {
      case 'RichText':
        return <RichText key={id} id={id}>{b.childrenMarkdown ?? ''}</RichText>;
      case 'Callout':
        return (
          <Callout key={id} id={id} tone={(data.tone as 'info' | 'warn' | 'success' | 'danger' | undefined) ?? 'info'}>
            {b.childrenMarkdown ?? ''}
          </Callout>
        );
      case 'Checklist':
        return (
          <Checklist key={id} id={id} items={(data.items as any) ?? []} />
        );
      case 'Table':
        return (
          <Table key={id} id={id} columns={(data.columns as string[]) ?? []} rows={(data.rows as string[][]) ?? []} />
        );
      case 'CodeTabs':
        return (
          <CodeTabs key={id} id={id} tabs={(data.tabs as any) ?? []} />
        );
      case 'Decision':
        return (
          <Decision
            key={id}
            id={id}
            title={data.title as string | undefined}
            question={data.question as string | undefined}
            options={(data.options as any) ?? []}
          />
        );
      case 'OpenQuestions':
        return (
          <OpenQuestions
            key={id}
            id={id}
            questions={(data.questions as any) ?? []}
          />
        );
      case 'FileTree':
        return (
          <FileTree
            key={id}
            id={id}
            title={data.title as string | undefined}
            entries={(data.entries as any) ?? []}
          />
        );
      case 'Diff':
        return (
          <Diff
            key={id}
            id={id}
            filename={data.filename as string | undefined}
            language={data.language as string | undefined}
            mode={(data.mode as 'split' | 'unified' | undefined) ?? 'unified'}
            before={(data.before as string) ?? ''}
            after={(data.after as string) ?? ''}
          />
        );
      case 'Stat':
        return (
          <Stat
            key={id}
            id={id}
            label={(data.label as string) ?? ''}
            value={data.value as string | number}
            trend={data.trend as 'up' | 'down' | 'flat' | undefined}
            hint={data.hint as string | undefined}
          />
        );
      case 'Workflow':
        return (
          <Workflow
            key={id}
            id={id}
            steps={(data.steps as any) ?? []}
            connections={data.connections as any}
          />
        );
      case 'Mockup':
        return (
          <Mockup
            key={id}
            id={id}
            title={data.title as string | undefined}
            x={data.x as number | undefined}
            y={data.y as number | undefined}
            w={data.w as number | undefined}
            h={data.h as number | undefined}
            html={(data.html as string) ?? ''}
          />
        );
      case 'Diagram':
        return (
          <div key={id} id={id} className="glyph-block-placeholder">
            <em>[Diagram] {id}</em>
          </div>
        );
    }
  };

  if (loading) {
    return (
      <div className="glyph-renderer glyph-renderer--loading">
        <Spinner /> Loading glyph…
      </div>
    );
  }

  if (error || !compiled) {
    return (
      <div className="glyph-renderer glyph-renderer--error">
        <strong>Failed to load glyph.</strong>
        <pre>{error ?? 'unknown error'}</pre>
      </div>
    );
  }

  const title = (compiled.frontmatter?.title as string) ?? slug;
  const status = (compiled.frontmatter?.status as string) ?? 'draft';
  const commentCount = comments.length;

  return (
    <div
      className={`glyph-canvas ${fullscreen ? 'glyph-canvas--fullscreen' : ''}`}
      ref={canvasRef}
      onContextMenu={onContainerContextMenu}
    >
      {/* Floating toolbar (sticky top-right pill) */}
      <div className="glyph-toolbar-floating">
        <button
          className="glyph-btn glyph-btn--primary glyph-btn--send"
          onClick={submitFeedback}
          disabled={submitting}
          title="Send comments + question answers to the agent — writes feedback.md, status=review"
        >
          <Send size={14} />
          <span>Send to agent</span>
          <span className="glyph-btn-badge">{commentCount}</span>
        </button>

        <span className="glyph-toolbar-divider" />

        <button
          className="glyph-icon-btn"
          title="Share"
          onClick={() => {
            if (typeof window !== 'undefined' && navigator.clipboard) {
              navigator.clipboard.writeText(window.location.href).catch(() => {});
              toast.success('Link copied');
            }
          }}
        >
          <Share2 size={15} />
        </button>
        <button className="glyph-icon-btn" title="Undo" disabled>
          <Undo2 size={15} />
        </button>
        <button className="glyph-icon-btn" title="Redo" disabled>
          <Redo2 size={15} />
        </button>
        <button
          className="glyph-icon-btn"
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          onClick={toggleFullscreen}
        >
          <Maximize2 size={15} />
        </button>
        <button className="glyph-icon-btn" title="More">
          <MoreHorizontal size={15} />
        </button>
        <span className="glyph-toolbar-divider" />
        <button
          className="glyph-icon-btn"
          title="Comment count"
          aria-label="Comment count"
        >
          <MessageSquare size={15} />
          <span className="glyph-icon-btn-count">{commentCount}</span>
        </button>
        {onClose && (
          <button
            className="glyph-icon-btn glyph-icon-btn--close"
            title="Close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Canvas content — centered column of section cards */}
      <div className="glyph-canvas-content">
        {/* Title strip (inside canvas, above sections) */}
        <header className="glyph-canvas-title">
          <h1 className="glyph-title">{title}</h1>
          <div className="glyph-meta">
            <span className={`glyph-status glyph-status--${status}`}>{status}</span>
            <span className="glyph-slug">{slug}</span>
          </div>
        </header>

        {/* Compiler warnings */}
        {compiled.errors?.length > 0 && (
          <div className="glyph-errors">
            <strong>Compiler warnings:</strong>
            <ul>
              {compiled.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Sections */}
        <div className="glyph-sections">
          {sections.map((section, i) => (
            <section
              key={`sec-${i}-${section.heading ?? 'ungrouped'}`}
              className={`glyph-section ${section.heading ? 'glyph-section--headed' : 'glyph-section--plain'}`}
            >
              {section.heading && (
                <h2 className="glyph-section-heading">{section.heading}</h2>
              )}
              <div className="glyph-section-blocks">
                {section.blocks.map(renderBlock)}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* Comment pin overlay */}
      {comments.map((c) => (
        <button
          key={c.id}
          className={`glyph-pin ${activePin === c.id ? 'glyph-pin--active' : ''}`}
          style={{ left: c.x, top: c.y }}
          onClick={(e) => {
            e.stopPropagation();
            setActivePin(activePin === c.id ? null : c.id);
          }}
          title={c.text}
        >
          <MapPin size={14} />
          {activePin === c.id && (
            <div className="glyph-pin-thread">
              <div className="glyph-pin-text">{c.text}</div>
              <div className="glyph-pin-meta">
                {c.author ?? 'anonymous'} · {c.created ? new Date(c.created).toLocaleString() : ''}
              </div>
            </div>
          )}
        </button>
      ))}

      {/* Context menu (right-click) */}
      {ctxMenu && (
        <div
          className="glyph-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="glyph-ctx-item"
            onClick={() => {
              setAddingComment({ worldX: ctxMenu.worldX, worldY: ctxMenu.worldY });
              setCtxMenu(null);
            }}
          >
            <MapPin size={14} /> Add comment here
          </button>
        </div>
      )}

      {/* Add-comment modal */}
      {addingComment && (
        <div className="glyph-modal-overlay" onClick={() => setAddingComment(null)}>
          <div className="glyph-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add comment at ({Math.round(addingComment.worldX)}, {Math.round(addingComment.worldY)})</h3>
            <textarea
              autoFocus
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              placeholder="What should the agent know about this area?"
              rows={4}
              className="glyph-modal-textarea"
            />
            <div className="glyph-modal-actions">
              <button className="glyph-btn glyph-btn--ghost" onClick={() => setAddingComment(null)}>
                Cancel
              </button>
              <button className="glyph-btn glyph-btn--primary" onClick={submitComment} disabled={!commentDraft.trim()}>
                Add comment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tiny inline spinner (no extra dep)
function Spinner() {
  return <span className="glyph-spinner" aria-label="loading">…</span>;
}