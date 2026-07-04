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
// BlockErrorBoundary — v4.4.8
//
// A single broken block (e.g. a FileTree whose `data.entries` ended up
// not being an array because the parser silently produced a phantom
// bareword entry) used to throw inside React, which propagated up and
// blanked the whole canvas. The boundary catches throws per-block and
// renders an inline error card instead. The boundary also exposes its
// errors via a callback so we can surface them in the top-of-page
// "render errors" banner.
// ---------------------------------------------------------------------------

interface BlockErrorBoundaryProps {
  blockId: string;
  blockType: string;
  children: React.ReactNode;
  onError: (blockId: string, blockType: string, err: Error, info: React.ErrorInfo) => void;
}

interface BlockErrorBoundaryState {
  err: Error | null;
}

class BlockErrorBoundary extends React.Component<BlockErrorBoundaryProps, BlockErrorBoundaryState> {
  state: BlockErrorBoundaryState = { err: null };
  static getDerivedStateFromError(err: Error): BlockErrorBoundaryState {
    return { err };
  }
  componentDidCatch(err: Error, info: React.ErrorInfo): void {
    try {
      this.props.onError(this.props.blockId, this.props.blockType, err, info);
    } catch {
      /* ignore — the boundary itself must not throw */
    }
  }
  render(): React.ReactNode {
    if (this.state.err) {
      return (
        <div
          className="glyph-block-error"
          role="alert"
          style={{
            border: '1px solid var(--error, #f85149)',
            background: 'rgba(248, 81, 73, 0.06)',
            borderRadius: 8,
            padding: '12px 14px',
            margin: '12px 0',
            color: 'var(--text)',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: 'var(--error, #f85149)', fontFamily: 'var(--font-sans, system-ui, sans-serif)', display: 'block', marginBottom: 4 }}>
            {this.props.blockType} block crashed
          </strong>
          <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
            block id: <code>{this.props.blockId}</code>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text)' }}>
            {this.state.err.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Block validation — v4.4.8
//
// Before handing block data to the component switch, verify that the
// shape matches the prop contract. Returns `{ ok: true }` when the
// block can be rendered, or `{ ok: false, error }` when a field is
// missing or wrong type. The renderer uses the error to skip the
// component and surface an inline message instead of throwing.
// ---------------------------------------------------------------------------

function validateBlock(b: Block): { ok: true } | { ok: false; error: string } {
  const data = (b.data ?? {}) as Record<string, unknown>;
  switch (b.type) {
    case 'RichText':
      return { ok: true };
    case 'Callout':
      return { ok: true };
    case 'Checklist':
      if (!Array.isArray(data.items)) return { ok: false, error: 'Checklist requires data.items to be an array' };
      return { ok: true };
    case 'Table':
      if (!Array.isArray(data.columns)) return { ok: false, error: 'Table requires data.columns to be an array' };
      if (!Array.isArray(data.rows)) return { ok: false, error: 'Table requires data.rows to be an array' };
      if (data.rows.length > 0 && !Array.isArray(data.rows[0])) return { ok: false, error: 'Table.data.rows[0] must be an array (cell array)' };
      return { ok: true };
    case 'CodeTabs':
      if (!Array.isArray(data.tabs)) return { ok: false, error: 'CodeTabs requires data.tabs to be an array' };
      return { ok: true };
    case 'Decision':
      if (!Array.isArray(data.options)) return { ok: false, error: 'Decision requires data.options to be an array' };
      return { ok: true };
    case 'OpenQuestions':
      if (!Array.isArray(data.questions)) return { ok: false, error: 'OpenQuestions requires data.questions to be an array' };
      return { ok: true };
    case 'FileTree':
      if (!Array.isArray(data.entries)) return { ok: false, error: 'FileTree requires data.entries to be an array' };
      // v4.4.8 — also catch the phantom bareword entry the parser used
      // to emit (the v3-to-v4-consolidation glyph crash). An entry that
      // is not an object means the parser miscounted braces.
      for (const e of data.entries) {
        if (e === null || typeof e !== 'object' || Array.isArray(e)) {
          return { ok: false, error: `FileTree contains a malformed entry: ${JSON.stringify(e)}` };
        }
      }
      return { ok: true };
    case 'Diff':
      if (typeof data.before !== 'string') return { ok: false, error: 'Diff requires data.before to be a string' };
      if (typeof data.after !== 'string') return { ok: false, error: 'Diff requires data.after to be a string' };
      return { ok: true };
    case 'Stat':
      if (data.label === undefined || data.label === null) return { ok: false, error: 'Stat requires data.label' };
      if (data.value === undefined || data.value === null) return { ok: false, error: 'Stat requires data.value' };
      return { ok: true };
    case 'Workflow':
      if (!Array.isArray(data.steps)) return { ok: false, error: 'Workflow requires data.steps to be an array' };
      return { ok: true };
    case 'Mockup':
      if (typeof data.html !== 'string') return { ok: false, error: 'Mockup requires data.html to be a string' };
      return { ok: true };
    case 'Diagram':
      if (typeof data.dataHtml !== 'string') return { ok: false, error: 'Diagram requires data.dataHtml to be a string' };
      return { ok: true };
    default:
      return { ok: false, error: `Unknown block type: ${(b as { type: string }).type}` };
  }
}

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
  errors: Array<{ line?: number; message: string }>;
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
  /** Error caught during the loading phase — shown inline so the user knows why. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Context-menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  const [addingComment, setAddingComment] = useState<{ worldX: number; worldY: number } | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  // Active pin (expanded thread view)
  const [activePin, setActivePin] = useState<string | null>(null);

  // v4.4.8 — Per-block render errors caught by BlockErrorBoundary. The
  // boundary calls onError(err) which pushes into this array. We render
  // the array at the top of the canvas in a prominent red banner so the
  // user isn't left staring at a blank screen wondering what happened.
  const [blockErrors, setBlockErrors] = useState<
    Array<{ blockId: string; blockType: string; message: string }>
  >([]);
  const reportBlockError = React.useCallback(
    (blockId: string, blockType: string, err: Error) => {
      setBlockErrors((prev) => {
        // dedupe by blockId so the same block crashing twice doesn't
        // duplicate the entry
        if (prev.some((e) => e.blockId === blockId)) return prev;
        return [...prev, { blockId, blockType, message: err.message || String(err) }];
      });
    },
    [],
  );

  const canvasRef = useRef<HTMLDivElement>(null);

  // Section grouping — memoized so we don't re-walk the block array on every render
  const sections = useMemo(
    () => (compiled ? groupBlocksIntoSections(compiled.blocks) : []),
    [compiled],
  );

  // Load compiled glyph + comments
  useEffect(() => {
    let cancelled = false;
    const TIMEOUT_MS = 5000;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Race the API calls against a 5-second timeout so the user
        // sees an error rather than a perpetual spinner if the server
        // hangs or the network drops.
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timed out after 5s')), TIMEOUT_MS)
        );

        const [renderData, artifactData] = await Promise.race([
          Promise.all([
            api.get<CompiledGlyph>(`/artifacts/${encodeURIComponent(slug)}/render`),
            api.get<{ comments?: CommentPin[]; commentsJson?: { comments?: CommentPin[] } }>(
              `/artifacts/${encodeURIComponent(slug)}`
            ),
          ]),
          timeoutPromise,
        ]) as [CompiledGlyph, { comments?: CommentPin[]; commentsJson?: { comments?: CommentPin[] } }];

        if (cancelled) return;
        setCompiled(renderData);
        const fromFile = (artifactData as any)?.comments ?? [];
        setComments(Array.isArray(fromFile) ? fromFile : []);
      } catch (err) {
        if (!cancelled) {
          const msg = (err as Error).message;
          setError(msg);
          setLoadError(msg);
        }
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

  // Render a single block — wrapped in a BlockErrorBoundary so a single
// broken block (e.g. wrong data shape from a parser bug) shows an inline
// error card instead of blanking the whole canvas.
  const renderBlock = (b: Block) => {
    const id = b.id;
    const data = (b.data ?? {}) as Record<string, unknown>;
    // Validate data shape BEFORE handing to the component switch. A
    // validation failure shows an inline error card immediately, no
    // need for the boundary to catch it.
    const validation = validateBlock(b);
    if (!validation.ok) {
      return (
        <div
          key={id}
          id={id}
          className="glyph-block-error"
          role="alert"
          style={{
            border: '1px solid var(--error, #f85149)',
            background: 'rgba(248, 81, 73, 0.06)',
            borderRadius: 8,
            padding: '12px 14px',
            margin: '12px 0',
            color: 'var(--text)',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: 'var(--error, #f85149)', fontFamily: 'var(--font-sans, system-ui, sans-serif)', display: 'block', marginBottom: 4 }}>
            {b.type} block invalid
          </strong>
          <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
            block id: <code>{id}</code>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{validation.error}</pre>
        </div>
      );
    }
    // Wrap the actual render in an error boundary so even runtime
    // errors (bad component props, undefined data, etc.) don't crash
    // the whole canvas.
    return (
      <BlockErrorBoundary key={id} blockId={id} blockType={b.type} onError={reportBlockError}>
        {renderBlockInner(b, id, data)}
      </BlockErrorBoundary>
    );
  };

  // Inner renderer — split out so the outer renderBlock can validate +
  // wrap in an error boundary without nesting the switch in the JSX tree.
  const renderBlockInner = (b: Block, id: string, data: Record<string, unknown>) => {
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
        {loadError ? (
          <>
            <strong>Failed to load glyph.</strong>
            <pre>{loadError}</pre>
          </>
        ) : (
          <>
            <Spinner /> Loading glyph…
          </>
        )}
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

        {/* v4.4.8 — Render errors banner. Two layers:
              1. Compiler warnings from the MDX parser (e.g. unknown
                 tag, unclosed block). Lightweight, yellow border.
              2. Block render errors caught by BlockErrorBoundary. These
                 are the "one block crashed but the rest still rendered"
                 cases. Red border, prominent, listed first so the user
                 sees them before scrolling. */}
        {(blockErrors.length > 0 || compiled.errors?.length > 0) && (
          <div
            className="glyph-render-errors"
            role="alert"
            style={{
              border: '1px solid var(--error, #f85149)',
              background: 'rgba(248, 81, 73, 0.08)',
              borderRadius: 8,
              padding: '12px 16px',
              margin: '0 0 16px 0',
              color: 'var(--text)',
            }}
          >
            <strong style={{ color: 'var(--error, #f85149)', display: 'block', marginBottom: 8 }}>
              {blockErrors.length > 0
                ? `${blockErrors.length} block${blockErrors.length === 1 ? '' : 's'} failed to render`
                : 'Compiler warnings'}
            </strong>
            <ul style={{ margin: 0, paddingLeft: 20, fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12, lineHeight: 1.6 }}>
              {blockErrors.map((e, i) => (
                <li key={`be-${i}`}>
                  <strong>{e.blockType}</strong> (<code>{e.blockId}</code>): {e.message}
                </li>
              ))}
              {compiled.errors?.map((e, i) => (
                <li key={`ce-${i}`}>
                  {e.line ? `line ${e.line}: ` : ''}{e.message}
                </li>
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