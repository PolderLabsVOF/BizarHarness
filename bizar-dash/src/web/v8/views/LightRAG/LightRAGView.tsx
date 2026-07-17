/**
 * v8/views/LightRAG/LightRAGView.tsx — Sprint S43, v9.3.0.
 *
 * Defaults override form (GET/PUT /api/lightrag/defaults), runtime
 * status (GET /api/lightrag/status: running, pid, host:port, log
 * tail), and an Autostart trigger (POST /api/lightrag/autostart).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, RefreshCcw, Save, PlayCircle, Circle } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { ErrorState } from '../../ui/feedback/ErrorState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface Defaults {
  llm: string;
  embedding: string;
  source?: string;
  llmSource?: string;
  embeddingSource?: string;
  builtin?: { llm: string; embedding: string };
  envVars?: { BIZAR_LIGHTRAG_LLM: string | null; BIZAR_LIGHTRAG_EMBEDDING: string | null };
}

interface Status {
  running: boolean;
  pid: number | null;
  host?: string;
  port?: number;
  llmBinding?: string;
  embeddingBinding?: string;
  llmModel?: string;
  embeddingModel?: string;
  logSize?: number;
  logTail?: string[];
}

export function LightRAGView(): JSX.Element {
  const defaultsPayload = useFetch<Defaults>('/api/lightrag/defaults');
  const statusPayload = useFetch<Status>('/api/lightrag/status');
  const [llm, setLlm] = useState<string>('');
  const [embedding, setEmbedding] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [autostarting, setAutostarting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultsPayload.data) {
      setLlm(defaultsPayload.data.llm ?? '');
      setEmbedding(defaultsPayload.data.embedding ?? '');
    }
  }, [defaultsPayload.data]);

  const refresh = useCallback(() => { void defaultsPayload.refetch(); void statusPayload.refetch(); }, [defaultsPayload, statusPayload]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fetchJson('/api/lightrag/defaults', { method: 'PUT', body: { llm, embedding } });
      setSaved(true);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const autostart = async (): Promise<void> => {
    setAutostarting(true);
    setError(null);
    try {
      await fetchJson('/api/lightrag/autostart', { method: 'POST' });
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setAutostarting(false);
    }
  };

  const status = statusPayload.data;
  const fetchError = defaultsPayload.error ?? statusPayload.error;

  return (
    <Stack gap={4} data-testid="lightrag-view">
      <ViewHeader
        title="LightRAG"
        description="LightRAG defaults + runtime status + autostart."
        actions={
          <Inline align="center" gap={2}>
            {error !== null && (
              <span role="alert" data-testid="lightrag-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
            )}
            <Button variant="ghost" onClick={() => void refresh()} data-testid="lightrag-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy} data-testid="lightrag-save">
              <Save size={14} aria-hidden /> {busy ? 'Saving…' : 'Save'}
            </Button>
          </Inline>
        }
      />

      {fetchError && (
        <ErrorState
          title="LightRAG unavailable"
          description={fetchError.message || String(fetchError)}
          onRetry={() => void refresh()}
          data-testid="lightrag-fetch-error"
        />
      )}

      <Card variant="default">
        <CardBody>
          <strong style={{ fontSize: 'var(--fs-13)' }}>Defaults</strong>
          {defaultsPayload.loading && defaultsPayload.data === null ? (
            <Skeleton style={{ height: 100, marginTop: 'var(--space-2)' }} />
          ) : (
            <Stack gap={2} style={{ marginTop: 'var(--space-2)' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>LLM binding</span>
                <Input value={llm} onChange={(e) => setLlm((e.target as HTMLInputElement).value)} data-testid="lightrag-llm" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Embedding binding</span>
                <Input value={embedding} onChange={(e) => setEmbedding((e.target as HTMLInputElement).value)} data-testid="lightrag-embedding" />
              </label>
              {defaultsPayload.data?.builtin && (
                <Inline gap={2} style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>
                  <span>built-in:</span>
                  <code>{defaultsPayload.data.builtin.llm}</code> /
                  <code>{defaultsPayload.data.builtin.embedding}</code>
                </Inline>
              )}
              {saved && <span data-testid="lightrag-saved" style={{ color: 'var(--success)', fontSize: 'var(--fs-12)' }}>Saved</span>}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Card variant="default">
        <CardBody>
          <Inline align="center" justify="between" gap={2}>
            <strong style={{ fontSize: 'var(--fs-13)' }}>Status</strong>
            <Inline align="center" gap={2}>
              {status === null || status === undefined ? (
                <Skeleton style={{ width: 80, height: 14 }} />
              ) : status.running ? (
                <Inline align="center" gap={1} data-testid="lightrag-running">
                  <Circle size={10} aria-hidden style={{ color: 'var(--success)', fill: 'var(--success)' }} />
                  <span style={{ fontSize: 'var(--fs-12)', color: 'var(--success)' }}>running · pid {status.pid}</span>
                </Inline>
              ) : (
                <Inline align="center" gap={1} data-testid="lightrag-stopped">
                  <Circle size={10} aria-hidden style={{ color: 'var(--fg-muted)', fill: 'var(--fg-muted)' }} />
                  <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>stopped</span>
                </Inline>
              )}
              <Button variant="ghost" onClick={() => void autostart()} disabled={autostarting} data-testid="lightrag-autostart">
                <PlayCircle size={14} aria-hidden /> {autostarting ? 'Starting…' : 'Autostart'}
              </Button>
            </Inline>
          </Inline>
          {status && (
            <Stack gap={1} style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-12)' }}>
              <Inline gap={2}>
                <Database size={12} aria-hidden style={{ color: 'var(--fg-muted)' }} />
                <code>{status.host}:{status.port}</code>
                {status.llmBinding && <span style={{ color: 'var(--fg-muted)' }}>· llm: <code>{status.llmBinding}</code></span>}
                {status.embeddingBinding && <span style={{ color: 'var(--fg-muted)' }}>· embedding: <code>{status.embeddingBinding}</code></span>}
              </Inline>
              {status.logTail && status.logTail.length > 0 ? (
                <div data-testid="lightrag-log" style={{ background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-11)', maxHeight: 160, overflow: 'auto' }}>
                  {status.logTail.filter(Boolean).slice(-10).map((l, i) => (<div key={i}>{l}</div>))}
                </div>
              ) : (
                <EmptyState
                  icon={<Database size={20} aria-hidden />}
                  title="No log output yet"
                  description="LightRAG has not emitted any log lines. Autostart a run to populate."
                  data-testid="lightrag-log-empty"
                />
              )}
            </Stack>
          )}
        </CardBody>
      </Card>
    </Stack>
  );
}