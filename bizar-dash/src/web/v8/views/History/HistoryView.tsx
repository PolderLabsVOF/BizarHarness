/**
 * v8/views/History/HistoryView.tsx — Sprint S40, v9.3.0.
 *
 * Cross-project timeline surface. Pulls from /api/history and shows
 * a list of recent events grouped per project. Filter chips along
 * the top let the user narrow by kind. Live updates on the
 * `history:new` WS event the server broadcasts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCcw } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { Badge } from '../../ui/data/Badge.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';

interface HistoryProject {
  id: string;
  name?: string;
  path?: string;
  active?: boolean;
  tasks?: { total: number; done: number; doing: number; blocked: number; queued: number };
  plans?: number;
}

interface HistoryEventRow {
  id?: string;
  ts?: string;
  kind?: string;
  project?: string;
  agent?: string;
  title?: string;
  description?: string;
}

interface HistoryPayload {
  events: HistoryEventRow[];
  projects: HistoryProject[];
  stats?: Record<string, unknown>;
  generatedAt?: string;
}

function fmtRel(ts: string | undefined): string {
  if (!ts) return '';
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return '';
  const delta = Math.max(0, Date.now() - t);
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(t).toLocaleString();
}

export function HistoryView(): JSX.Element {
  const payload = useFetch<HistoryPayload>('/api/history');
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);
  useWsMessage('history:new', refresh);

  const events = useMemo(() => payload.data?.events ?? [], [payload.data]);
  const projects = useMemo(() => payload.data?.projects ?? [], [payload.data]);
  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.kind) set.add(e.kind);
    return Array.from(set).sort();
  }, [events]);

  useEffect(() => {
    if (kindFilter !== null && !kinds.includes(kindFilter)) setKindFilter(null);
  }, [kinds, kindFilter]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (kindFilter !== null && e.kind !== kindFilter) return false;
      if (projectFilter !== null && e.project !== projectFilter) return false;
      return true;
    });
  }, [events, kindFilter, projectFilter]);

  return (
    <Stack gap={4} data-testid="history-view">
      <ViewHeader
        title="History"
        description="Cross-project activity timeline. Filter by kind or project. Live updates on new events."
        actions={
          <Button variant="ghost" onClick={() => void refresh()} data-testid="history-refresh">
            <RefreshCcw size={14} aria-hidden /> Refresh
          </Button>
        }
      />

      <Inline gap={2} wrap>
        <FilterChip
          label="All kinds"
          active={kindFilter === null}
          onClick={() => setKindFilter(null)}
          testid="history-filter-kind-all"
        />
        {kinds.map((k) => (
          <FilterChip
            key={k}
            label={k}
            active={kindFilter === k}
            onClick={() => setKindFilter((cur) => (cur === k ? null : k))}
            testid={`history-filter-kind-${k}`}
          />
        ))}
        {projects.length > 0 && (
          <>
            <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} aria-hidden />
            <FilterChip
              label="All projects"
              active={projectFilter === null}
              onClick={() => setProjectFilter(null)}
              testid="history-filter-project-all"
            />
            {projects.map((p) => (
              <FilterChip
                key={p.id}
                label={p.name || p.id}
                active={projectFilter === p.id}
                onClick={() => setProjectFilter((cur) => (cur === p.id ? null : p.id))}
                testid={`history-filter-project-${p.id}`}
              />
            ))}
          </>
        )}
      </Inline>

      <Card variant="default">
        <CardBody>
          {payload.loading && events.length === 0 ? (
            <Stack gap={2}>
              <Skeleton style={{ height: 36 }} />
              <Skeleton style={{ height: 36 }} />
              <Skeleton style={{ height: 36 }} />
            </Stack>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<History size={28} aria-hidden />}
              title="No events"
              description={kindFilter || projectFilter ? 'No events match the current filter.' : 'No activity yet.'}
            />
          ) : (
            <Stack gap={1}>
              {filtered.map((e, idx) => (
                <div
                  key={e.id ?? `${e.ts}-${idx}`}
                  data-testid={`history-row-${idx}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-2)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                    {fmtRel(e.ts)}
                  </span>
                  <Inline align="center" gap={2} wrap>
                    {e.kind && <Badge tone="info" size="sm">{e.kind}</Badge>}
                    <span>{e.title || e.description || e.id || 'event'}</span>
                    {e.project && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                        · {e.project}
                      </span>
                    )}
                  </Inline>
                </div>
              ))}
            </Stack>
          )}
        </CardBody>
      </Card>
    </Stack>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  testid,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testid: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      style={{
        padding: 'var(--space-1) var(--space-3)',
        borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--border)',
        background: active ? 'color-mix(in oklch, var(--accent) 18%, transparent)' : 'var(--surface-0)',
        color: active ? 'var(--accent)' : 'var(--fg-muted)',
        fontSize: 'var(--fs-12)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}