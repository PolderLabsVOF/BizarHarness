/**
 * v8/views/Artifacts/ArtifactsView.tsx — Sprint S43, v9.3.0 → v10.1.0
 * (Claude Artifacts swap).
 *
 * Artifacts list (GET /api/artifacts) with per-row open-to-detail
 * (right-hand Sheet using GET /api/artifacts/:slug + /render) and
 * inline-confirm Delete (DELETE /api/artifacts/:slug). Add Sheet
 * posts a new artifact (POST /api/artifacts {slug, kind, source, ...}).
 *
 * v10.1.0 — Detail panel dispatches by `kind`:
 *   - claude-html / claude-svg / claude-react → sandboxed iframe
 *     via <ClaudeArtifactView>
 *   - mdx → legacy block-renderer fallback
 *
 * The AddForm gains a `kind` dropdown + a textarea bound to `source`;
 * the textarea defaults to the kind-specific starting template.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Plus, Trash2, RefreshCcw, FileCode, ExternalLink } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Textarea } from '../../ui/controls/Textarea.js';
import { Sheet, SheetContent } from '../../ui/feedback/Sheet.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import { ClaudeArtifactView, type ClaudeRenderPayload } from './ClaudeArtifactView.js';

interface Artifact {
  slug: string;
  title?: string;
  kind?: 'mdx' | 'claude-html' | 'claude-svg' | 'claude-react';
  description?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  planMdx?: string;
  source?: string;
  frontmatter?: Record<string, unknown>;
}

export function ArtifactsView(): JSX.Element {
  const payload = useFetch<{ artifacts: Artifact[] }>('/api/artifacts');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [adding, setAdding] = useState<boolean>(false);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const artifacts = useMemo<Artifact[]>(() => payload.data?.artifacts ?? [], [payload.data]);
  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);

  const drop = async (slug: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/artifacts/${slug}`, { method: 'DELETE' });
      setConfirmDelete(null);
      if (activeSlug === slug) setActiveSlug(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  return (
    <Stack gap={4} data-testid="artifacts-view">
      <ViewHeader
        title="Artifacts"
        description="Generated artifacts (plans, diagrams, canvases)."
        actions={
          <Inline align="center" gap={2}>
            {error !== null && (
              <span role="alert" data-testid="artifacts-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
            )}
            <Button variant="ghost" onClick={() => void refresh()} data-testid="artifacts-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="primary" onClick={() => setAdding(true)} data-testid="artifacts-add">
              <Plus size={14} aria-hidden /> Add
            </Button>
          </Inline>
        }
      />

      <Card variant="default">
        <CardBody>
          {payload.loading && artifacts.length === 0 ? (
            <Stack gap={1}>
              <Skeleton style={{ height: 48 }} />
              <Skeleton style={{ height: 48 }} />
            </Stack>
          ) : artifacts.length === 0 ? (
            <EmptyState icon={<Layers size={28} aria-hidden />} title="No artifacts" description="Create one to get started." />
          ) : (
            <Stack gap={1}>
              {artifacts.map((a) => {
                const isConfirming = confirmDelete === a.slug;
                return (
                  <div
                    key={a.slug}
                    data-testid={`artifact-row-${a.slug}`}
                    style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                  >
                    <Inline align="center" justify="between" gap={2}>
                      <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                        <Inline align="center" gap={2}>
                          <FileCode size={12} aria-hidden style={{ color: 'var(--fg-muted)' }} />
                          <strong style={{ fontSize: 'var(--fs-13)' }}>{a.title || a.slug}</strong>
                          <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{a.slug}</code>
                          {a.kind && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>· {a.kind}</span>}
                        </Inline>
                        {a.description && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{a.description}</span>}
                      </Stack>
                      <Inline gap={1}>
                        <Button variant="ghost" onClick={() => setActiveSlug((cur) => (cur === a.slug ? null : a.slug))} data-testid={`artifact-open-${a.slug}`} aria-label={`Open ${a.slug}`}>
                          <ExternalLink size={14} aria-hidden /> Open
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete((cur) => (cur === a.slug ? null : a.slug))} data-testid={`artifact-delete-${a.slug}`} aria-label={`Delete ${a.slug}`}>
                          <Trash2 size={14} aria-hidden />
                        </Button>
                      </Inline>
                    </Inline>
                    {isConfirming && (
                      <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                        <Button variant="danger" onClick={() => void drop(a.slug)} data-testid={`artifact-confirm-delete-${a.slug}`}>
                          Confirm delete
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                      </Inline>
                    )}
                  </div>
                );
              })}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent side="right" title="Add artifact" description="Slug + kind + initial source.">
          <AddForm
            onSubmit={async (body) => {
              await fetchJson('/api/artifacts', { method: 'POST', body });
              setAdding(false);
              refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={activeSlug !== null} onOpenChange={(open) => { if (!open) setActiveSlug(null); }}>
        <SheetContent side="right" title={activeSlug ?? ''} description="Artifact detail">
          {activeSlug !== null && <ArtifactDetail slug={activeSlug} refresh={refresh} />}
        </SheetContent>
      </Sheet>
    </Stack>
  );
}

function AddForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: { slug: string; title?: string; description?: string; kind?: string; source?: string; planMdx?: string }) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [slug, setSlug] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [kind, setKind] = useState<'mdx' | 'claude-html' | 'claude-svg' | 'claude-react'>('claude-html');
  const [source, setSource] = useState<string>(KIND_TEMPLATES['claude-html']);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // When the user changes kind, swap the textarea content to a starter
  // template for that kind. They can still edit further.
  const onKindChange = (next: 'mdx' | 'claude-html' | 'claude-svg' | 'claude-react'): void => {
    setKind(next);
    setSource(KIND_TEMPLATES[next]);
  };

  return (
    <Stack gap={3} style={{ padding: 'var(--space-4)' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Slug</span>
        <Input value={slug} onChange={(e) => setSlug((e.target as HTMLInputElement).value)} data-testid="artifact-form-slug" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Title</span>
        <Input value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} data-testid="artifact-form-title" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Description</span>
        <Input value={description} onChange={(e) => setDescription((e.target as HTMLInputElement).value)} data-testid="artifact-form-description" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Kind</span>
        <select
          value={kind}
          onChange={(e) => onKindChange(e.target.value as typeof kind)}
          data-testid="artifact-form-kind"
          style={{
            fontFamily: 'inherit',
            fontSize: 'var(--fs-12)',
            padding: 'var(--space-2)',
            background: 'var(--surface-0)',
            color: 'var(--fg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <option value="claude-html">Claude HTML</option>
          <option value="claude-svg">Claude SVG</option>
          <option value="claude-react">Claude React (JSX)</option>
          <option value="mdx">Legacy MDX (glyphs)</option>
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          {kind === 'mdx' ? 'Plan MDX' : 'Source'}
        </span>
        <Textarea
          value={source}
          rows={kind === 'claude-react' ? 10 : 6}
          onChange={(e) => setSource((e.target as HTMLTextAreaElement).value)}
          data-testid={kind === 'mdx' ? 'artifact-form-mdx' : 'artifact-form-source'}
        />
      </label>
      {error !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>}
      <Inline justify="end" gap={2}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || !slug.trim()}
          data-testid="artifact-form-submit"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const body: { slug: string; title?: string; description?: string; kind: typeof kind; source?: string; planMdx?: string } = {
                slug: slug.trim(),
                title: title.trim() || undefined,
                description: description.trim() || undefined,
                kind,
              };
              if (source) {
                if (kind === 'mdx') body.planMdx = source; else body.source = source;
              }
              await onSubmit(body);
            } catch (err) {
              setError(err instanceof FetchError ? err.message : (err as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </Inline>
    </Stack>
  );
}

const KIND_TEMPLATES: Record<'mdx' | 'claude-html' | 'claude-svg' | 'claude-react', string> = {
  mdx: '# Hello\n\nAdd some MDX here.',
  'claude-html': '<!doctype html>\n<h1 style="font-family:system-ui">Hello artifact</h1>\n<p>Edit me — click <em>Open</em> to preview.</p>',
  'claude-svg': '<svg viewBox="0 0 100 100" width="200" height="200">\n  <circle cx="50" cy="50" r="40" fill="#0b66c3"/>\n  <text x="50" y="55" text-anchor="middle" fill="white" font-size="14">SVG</text>\n</svg>',
  'claude-react': 'export default function App() {\n  const [n, setN] = React.useState(0);\n  return (\n    <div style={{ fontFamily: "system-ui", padding: 16 }}>\n      <h1>Hello</h1>\n      <button onClick={() => setN(n + 1)}>clicked {n}</button>\n    </div>\n  );\n}',
};

function ArtifactDetail({ slug, refresh }: { slug: string; refresh: () => void }): JSX.Element {
  const payload = useFetch<Artifact>(`/api/artifacts/${slug}`);
  const renderPayload = useFetch<ClaudeRenderPayload>(`/api/artifacts/${slug}/render`);
  const kind = payload.data?.kind || 'mdx';
  const isClaude = kind === 'claude-html' || kind === 'claude-svg' || kind === 'claude-react';

  return (
    <Stack gap={2} style={{ padding: 'var(--space-4)' }}>
      {payload.loading && !payload.data ? (
        <Skeleton style={{ height: 80 }} />
      ) : payload.data ? (
        <Stack gap={2}>
          <Inline align="center" gap={2}>
            <strong>{payload.data.title || payload.data.slug}</strong>
            <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{payload.data.slug}</code>
            <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>· {kind}</span>
          </Inline>
          {payload.data.description && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{payload.data.description}</span>}

          {/* Claude-* kinds render in a sandboxed iframe via the new
              <ClaudeArtifactView>. The server compiles the source on
              demand and returns iframe-ready HTML (srcdoc). */}
          {isClaude && (
            renderPayload.data ? (
              <ClaudeArtifactView payload={renderPayload.data} slug={slug} />
            ) : (
              <Skeleton style={{ height: 200 }} />
            )
          )}

          {/* Legacy MDX path keeps the original block-count summary. */}
          {!isClaude && renderPayload.data && (
            <span data-testid={`artifact-render-${slug}`} style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Render: {Array.isArray(renderPayload.data.blocks) ? `${renderPayload.data.blocks.length} blocks` : 'no blocks'}
            </span>
          )}

          {/* Inline editor — kind switch + textarea + save. */}
          <Editor payload={payload.data} slug={slug} onSaved={() => { void payload.refetch(); void renderPayload.refetch(); refresh(); }} />
        </Stack>
      ) : (
        <span role="alert" style={{ color: 'var(--danger)' }}>Not found</span>
      )}
    </Stack>
  );
}

/**
 * Inline editor: lets the user change the kind, edit the body, and
 * save via PUT /api/artifacts/:slug. After save we re-fetch both the
 * artifact + the compiled render so the iframe updates with the new
 * source on the next paint.
 */
function Editor({
  payload,
  slug,
  onSaved,
}: {
  payload: Artifact;
  slug: string;
  onSaved: () => void;
}): JSX.Element {
  const initial = payload.source ?? payload.planMdx ?? '';
  const [editKind, setEditKind] = useState<typeof payload.kind>(payload.kind || 'mdx');
  const [editSource, setEditSource] = useState<string>(initial);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<boolean>(false);

  // Sync the textarea when the underlying artifact changes (e.g. when
  // the user opens a different slug in the same Sheet).
  useEffect(() => {
    setEditKind(payload.kind || 'mdx');
    setEditSource(payload.source ?? payload.planMdx ?? '');
  }, [payload.slug, payload.source, payload.planMdx, payload.kind]);

  const dirty =
    editKind !== (payload.kind || 'mdx') || editSource !== (payload.source ?? payload.planMdx ?? '');

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/artifacts/${slug}`, {
        method: 'PUT',
        body: {
          kind: editKind,
          source: editKind === 'mdx' ? undefined : editSource,
          planMdx: editKind === 'mdx' ? editSource : undefined,
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={1} data-testid={`artifact-editor-${slug}`}>
      <Inline align="center" justify="between" gap={2}>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)} data-testid={`artifact-edit-toggle-${slug}`}>
          {open ? 'Close editor' : 'Edit'}
        </Button>
        {dirty && (
          <span style={{ fontSize: 'var(--fs-11)', color: 'var(--callout-warning-fg, #b58900)' }}>
            Unsaved changes
          </span>
        )}
      </Inline>
      {open && (
        <Stack gap={2}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Kind</span>
            <select
              value={editKind}
              onChange={(e) => setEditKind(e.target.value as typeof editKind)}
              data-testid={`artifact-edit-kind-${slug}`}
              style={{
                fontFamily: 'inherit',
                fontSize: 'var(--fs-12)',
                padding: 'var(--space-2)',
                background: 'var(--surface-0)',
                color: 'var(--fg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <option value="claude-html">Claude HTML</option>
              <option value="claude-svg">Claude SVG</option>
              <option value="claude-react">Claude React (JSX)</option>
              <option value="mdx">Legacy MDX</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              {editKind === 'mdx' ? 'Plan MDX' : 'Source'}
            </span>
            <Textarea
              value={editSource}
              rows={editKind === 'claude-react' ? 12 : 8}
              onChange={(e) => setEditSource((e.target as HTMLTextAreaElement).value)}
              data-testid={`artifact-edit-source-${slug}`}
            />
          </label>
          {error !== null && (
            <span role="alert" data-testid={`artifact-edit-error-${slug}`} style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
              {error}
            </span>
          )}
          <Inline gap={1}>
            <Button
              variant="primary"
              disabled={busy || !dirty}
              onClick={() => void save()}
              data-testid={`artifact-edit-save-${slug}`}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !dirty}
              onClick={() => {
                setEditKind(payload.kind || 'mdx');
                setEditSource(payload.source ?? payload.planMdx ?? '');
                setError(null);
              }}
              data-testid={`artifact-edit-revert-${slug}`}
            >
              Revert
            </Button>
          </Inline>
        </Stack>
      )}
    </Stack>
  );
}