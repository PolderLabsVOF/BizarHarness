/**
 * v8/views/Artifacts/ArtifactsView.tsx — Sprint S43, v9.3.0.
 *
 * Artifacts list (GET /api/artifacts) with per-row open-to-detail
 * (right-hand Sheet using GET /api/artifacts/:slug + /render) and
 * inline-confirm Delete (DELETE /api/artifacts/:slug). Add Sheet
 * posts a new artifact (POST /api/artifacts {slug, ...}).
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

interface Artifact {
  slug: string;
  title?: string;
  kind?: string;
  description?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  planMdx?: string;
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
        <SheetContent side="right" title="Add artifact" description="Slug + title + initial MDX.">
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
          {activeSlug !== null && <ArtifactDetail slug={activeSlug} />}
        </SheetContent>
      </Sheet>
    </Stack>
  );
}

function AddForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: { slug: string; title?: string; description?: string; planMdx?: string; frontmatter?: Record<string, unknown> }) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [slug, setSlug] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [planMdx, setPlanMdx] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Plan MDX</span>
        <Textarea value={planMdx} rows={6} onChange={(e) => setPlanMdx((e.target as HTMLTextAreaElement).value)} data-testid="artifact-form-mdx" />
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
              await onSubmit({ slug: slug.trim(), title: title.trim() || undefined, description: description.trim() || undefined, planMdx: planMdx || undefined });
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

function ArtifactDetail({ slug }: { slug: string }): JSX.Element {
  const payload = useFetch<Artifact>(`/api/artifacts/${slug}`);
  const renderPayload = useFetch<{ blocks?: unknown[]; frontmatter?: Record<string, unknown> }>(`/api/artifacts/${slug}/render`);
  return (
    <Stack gap={2} style={{ padding: 'var(--space-4)' }}>
      {payload.loading && !payload.data ? (
        <Skeleton style={{ height: 80 }} />
      ) : payload.data ? (
        <Stack gap={2}>
          <strong>{payload.data.title || payload.data.slug}</strong>
          {payload.data.description && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{payload.data.description}</span>}
          {payload.data.frontmatter && (
            <div data-testid={`artifact-frontmatter-${slug}`} style={{ padding: 'var(--space-2)', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)' }}>
              <pre style={{ margin: 0, fontSize: 'var(--fs-11)', fontFamily: 'var(--font-mono)' }}>{JSON.stringify(payload.data.frontmatter, null, 2)}</pre>
            </div>
          )}
          {payload.data.planMdx && (
            <pre data-testid={`artifact-mdx-${slug}`} style={{ padding: 'var(--space-2)', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-11)', maxHeight: 240, overflow: 'auto', fontFamily: 'var(--font-mono)' }}>{payload.data.planMdx}</pre>
          )}
          {renderPayload.data && (
            <span data-testid={`artifact-render-${slug}`} style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Render: {Array.isArray(renderPayload.data.blocks) ? `${renderPayload.data.blocks.length} blocks` : 'no blocks'}
            </span>
          )}
        </Stack>
      ) : (
        <span role="alert" style={{ color: 'var(--danger)' }}>Not found</span>
      )}
    </Stack>
  );
}