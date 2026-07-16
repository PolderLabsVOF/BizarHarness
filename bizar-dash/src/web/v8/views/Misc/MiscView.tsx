/**
 * v8/views/Misc/MiscView.tsx — Sprint S43, v9.3.0.
 *
 * The "doesn't fit anywhere else" surface: global fuzzy search
 * (GET /api/search) + Tailscale card (GET /api/tailscale/status,
 * POST /api/tailscale/{enable,disable}).
 */

import { useCallback, useMemo, useState } from 'react';
import { Search, Network, Power, PowerOff, RefreshCcw, FileText, CheckSquare, Bot, Folder } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface SearchResult {
  kind?: string;
  id?: string;
  title?: string;
  projectId?: string;
  score?: number;
  snippet?: string;
}

interface SearchResponse {
  query?: string;
  results?: SearchResult[];
  total?: number;
}

interface TailscaleStatus {
  enabled?: boolean;
  running?: boolean;
  hostname?: string;
  url?: string;
  error?: string;
}

export function MiscView(): JSX.Element {
  return (
    <Stack gap={4} data-testid="misc-view">
      <ViewHeader title="Misc" description="Global fuzzy search across projects, tasks, and agents — plus Tailscale VPN control." />
      <SearchPanel />
      <TailscalePanel />
    </Stack>
  );
}

function SearchPanel(): JSX.Element {
  const [q, setQ] = useState<string>('');
  const payload = useFetch<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`);

  return (
    <Card variant="default">
      <CardBody>
        <strong style={{ fontSize: 'var(--fs-13)' }}>Search</strong>
        <Inline gap={2} align="center" style={{ marginTop: 'var(--space-2)' }}>
          <Search size={14} aria-hidden style={{ color: 'var(--fg-muted)' }} />
          <Input value={q} onChange={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Search projects / tasks / artifacts / agents…" data-testid="misc-search-input" />
        </Inline>
        {q.trim() === '' ? (
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)' }}>Type a query to search.</span>
        ) : payload.loading && !payload.data ? (
          <Stack gap={1} style={{ marginTop: 'var(--space-2)' }}>
            <Skeleton style={{ height: 24 }} />
            <Skeleton style={{ height: 24 }} />
          </Stack>
        ) : (payload.data?.results?.length ?? 0) === 0 ? (
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)' }}>No results.</span>
        ) : (
          <Stack gap={1} style={{ marginTop: 'var(--space-2)' }}>
            {(payload.data?.results ?? []).slice(0, 30).map((r, i) => (
              <div key={i} data-testid={`misc-search-result-${i}`} style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                <Inline align="center" gap={2}>
                  <KindIcon kind={r.kind} />
                  <strong style={{ fontSize: 'var(--fs-13)' }}>{r.title || r.id}</strong>
                  <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{r.kind}</code>
                  {r.projectId && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>· {r.projectId}</span>}
                </Inline>
                {r.snippet && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{r.snippet}</span>}
              </div>
            ))}
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}

function KindIcon({ kind }: { kind?: string }): JSX.Element {
  const Icon = (kind === 'task' ? CheckSquare : kind === 'agent' ? Bot : kind === 'project' ? Folder : FileText) as typeof Folder;
  return <Icon size={12} aria-hidden style={{ color: 'var(--fg-muted)' }} />;
}

function TailscalePanel(): JSX.Element {
  const payload = useFetch<TailscaleStatus>('/api/tailscale/status');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);

  const toggle = async (enable: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(enable ? '/api/tailscale/enable' : '/api/tailscale/disable', { method: 'POST' });
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="default">
      <CardBody>
        <Inline align="center" justify="between" gap={2}>
          <Inline align="center" gap={2}>
            <Network size={16} aria-hidden style={{ color: 'var(--accent)' }} />
            <strong style={{ fontSize: 'var(--fs-13)' }}>Tailscale</strong>
            {payload.data && (
              <span data-testid="misc-tailscale-state" style={{ fontSize: 'var(--fs-12)', color: payload.data.running ? 'var(--success)' : 'var(--fg-muted)' }}>
                {payload.data.running ? `running · ${payload.data.hostname ?? '?'}` : 'stopped'}
              </span>
            )}
          </Inline>
          <Inline gap={1}>
            {error !== null && (
              <span role="alert" data-testid="misc-tailscale-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
            )}
            <Button variant="ghost" onClick={() => void refresh()} data-testid="misc-tailscale-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="ghost" onClick={() => void toggle(true)} disabled={busy} data-testid="misc-tailscale-enable">
              <Power size={14} aria-hidden /> Enable
            </Button>
            <Button variant="ghost" onClick={() => void toggle(false)} disabled={busy} data-testid="misc-tailscale-disable">
              <PowerOff size={14} aria-hidden /> Disable
            </Button>
          </Inline>
        </Inline>
        {payload.data?.url && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <a href={payload.data.url} target="_blank" rel="noreferrer" style={{ fontSize: 'var(--fs-12)', color: 'var(--accent)' }}>{payload.data.url}</a>
          </div>
        )}
        {payload.data?.error && (
          <span role="alert" style={{ fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>{payload.data.error}</span>
        )}
      </CardBody>
    </Card>
  );
}