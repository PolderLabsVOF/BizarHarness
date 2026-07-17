import { useCallback, useMemo, useState } from 'react';
import { Play, Pause, RotateCw, Trash2, Terminal, Cpu, Bot, AlertTriangle, CheckCircle2, type LucideIcon } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Badge } from '../../ui/data/Badge.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { ErrorState } from '../../ui/feedback/ErrorState.js';
import { Button } from '../../ui/controls/Button.js';
import { Textarea } from '../../ui/controls/Textarea.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import type { WsMessage } from '../../data/types.js';

/**
 * BackgroundJobsView — live background agent instances.
 *
 * Renders `/api/background` (list + status counts), shows per-instance
 * output panels, and exposes pause / resume / retry / kill controls.
 */

type BgStatus = 'pending' | 'running' | 'paused' | 'done' | 'error' | 'killed' | 'unknown';

interface BgAction {
  type: string;
  prompt?: string;
  agent?: string;
  command?: string;
}

interface BgInstance {
  instanceId: string;
  agent?: string;
  status: BgStatus;
  worktree?: string;
  createdAt?: number;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number;
  error?: string;
  tags?: string[];
  action?: BgAction;
  sessionId?: string;
  pid?: number;
  messageCount?: number;
  lastMessageAt?: number;
  lastError?: { ts: number; message: string };
  toolCalls?: unknown[];
}

interface BackgroundResponse {
  instances: BgInstance[];
  status?: { running: number; paused: number; done: number; error: number };
}

function statusIcon(s: BgStatus): LucideIcon {
  switch (s) {
    case 'running': return Play;
    case 'paused': return Pause;
    case 'done': return CheckCircle2;
    case 'error': return AlertTriangle;
    case 'killed': return Trash2;
    default: return Cpu;
  }
}

function statusTone(s: BgStatus): 'neutral' | 'info' | 'success' | 'danger' | 'warning' {
  switch (s) {
    case 'running': return 'info';
    case 'paused': return 'warning';
    case 'done': return 'success';
    case 'error': return 'danger';
    case 'killed': return 'neutral';
    default: return 'neutral';
  }
}

function elapsed(ms?: number): string {
  if (!ms) return '—';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function BackgroundJobsView(): JSX.Element {
  const res = useFetch<BackgroundResponse>('/api/background');
  const [live, setLive] = useState<BgInstance[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [outputLoading, setOutputLoading] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [killConfirm, setKillConfirm] = useState<string | null>(null);

  useWsMessage('background:change', useCallback((msg: WsMessage) => {
    const m = msg as { id?: string; status?: string };
    void res.refetch();
    if (m.id && m.id === selectedId) loadOutput(m.id);
  }, [res, selectedId]));

  const instances = useMemo<BgInstance[]>(() => [...live, ...(res.data?.instances || [])], [live, res.data]);

  const selected = useMemo<BgInstance | null>(() => {
    if (!selectedId) return null;
    return instances.find((i) => i.instanceId === selectedId) ?? null;
  }, [selectedId, instances]);

  const loadOutput = async (id: string): Promise<void> => {
    setOutputLoading(true);
    try {
      const data = await fetchJson<{ lines?: string[] }>(`/api/background/${encodeURIComponent(id)}/output?lines=100`);
      setOutputLines(data.lines ?? []);
    } catch {
      setOutputLines([]);
    } finally {
      setOutputLoading(false);
    }
  };

  const selectInstance = async (inst: BgInstance): Promise<void> => {
    setSelectedId(inst.instanceId);
    await loadOutput(inst.instanceId);
  };

  const refresh = (): void => { void res.refetch(); };

  const pauseInstance = async (id: string): Promise<void> => {
    setActionError(null);
    try {
      await fetchJson(`/api/background/${encodeURIComponent(id)}/pause`, { method: 'POST' });
      refresh();
    } catch (err) {
      setActionError(err instanceof FetchError ? err.message : String(err));
    }
  };

  const resumeInstance = async (id: string): Promise<void> => {
    setActionError(null);
    try {
      await fetchJson(`/api/background/${encodeURIComponent(id)}/resume`, { method: 'POST' });
      refresh();
    } catch (err) {
      setActionError(err instanceof FetchError ? err.message : String(err));
    }
  };

  const retryInstance = async (id: string): Promise<void> => {
    setActionError(null);
    try {
      await fetchJson(`/api/background/${encodeURIComponent(id)}/retry`, { method: 'POST' });
      refresh();
    } catch (err) {
      setActionError(err instanceof FetchError ? err.message : String(err));
    }
  };

  const killInstance = async (id: string): Promise<void> => {
    setActionError(null);
    setBusy(true);
    try {
      await fetchJson(`/api/background/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setKillConfirm(null);
      if (selectedId === id) setSelectedId(null);
      refresh();
    } catch (err) {
      setActionError(err instanceof FetchError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const statusCounts = useMemo(() => {
    const counts: Record<BgStatus, number> = { pending: 0, running: 0, paused: 0, done: 0, error: 0, killed: 0, unknown: 0 };
    for (const i of instances) {
      const s: BgStatus = i.status || 'unknown';
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [instances]);

  return (
    <Stack gap={5} data-testid="background-view">
      <ViewHeader
        title="Background Jobs"
        description="Live background agent sessions. Pause, resume, retry, or kill."
      />

      {actionError !== null && (
        <div role="alert" style={{ padding: 'var(--space-2) var(--space-3)', background: 'color-mix(in oklch, var(--danger) 12%, var(--surface-0))', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>
          {actionError}
        </div>
      )}

      {/* Status summary bar */}
      {instances.length > 0 && (
        <Inline gap={3} wrap>
          {(['running', 'paused', 'pending', 'done', 'error'] as BgStatus[]).map((s) => {
            const count = statusCounts[s];
            if (count === 0) return null;
            const Icon = statusIcon(s);
            return (
              <Inline key={s} align="center" gap={2} style={{ padding: '4px 10px', background: 'var(--surface-1)', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)' }}>
                <Icon size={12} aria-hidden style={{ color: `var(--${statusTone(s) === 'neutral' ? 'fg-muted' : statusTone(s)})` }} />
                <span style={{ fontSize: 'var(--fs-12)' }}>{s}</span>
                <Badge tone={statusTone(s)}>{count}</Badge>
              </Inline>
            );
          })}
        </Inline>
      )}

      {res.loading && instances.length === 0 ? (
        <Stack gap={2}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 64, borderRadius: 'var(--radius-md)' }} />
          ))}
        </Stack>
      ) : res.error ? (
        <ErrorState
          block
          title="Failed to load background jobs"
          description="Could not reach the background jobs endpoint."
          error={res.error}
          onRetry={refresh}
        />
      ) : instances.length === 0 ? (
        <EmptyState
          icon={<Cpu size={28} aria-hidden />}
          title="No background jobs"
          description="Background agents appear here when spawned."
        />
      ) : (
        <Box style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 'var(--space-4)' }}>
          {/* Instance list */}
          <Stack gap={2}>
            {instances.map((inst) => {
              const s: BgStatus = inst.status || 'unknown';
              const Icon = statusIcon(s);
              const isSelected = inst.instanceId === selectedId;
              return (
                <Card
                  key={inst.instanceId}
                  data-testid={`bg-instance-${inst.instanceId}`}
                  style={{
                    cursor: 'pointer',
                    outline: isSelected ? '2px solid var(--accent)' : undefined,
                    outlineOffset: -2,
                  }}
                  onClick={() => { void selectInstance(inst); }}
                >
                  <CardBody>
                    <Inline align="center" gap={3}>
                      <Icon
                        size={16}
                        aria-hidden
                        style={{ color: `var(--${statusTone(s) === 'neutral' ? 'fg-muted' : statusTone(s)})` }}
                      />
                      <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                        <Inline align="center" gap={2}>
                          <strong style={{ fontSize: 'var(--fs-14)' }}>
                            {inst.agent ?? inst.instanceId.slice(0, 8)}
                          </strong>
                          <Badge tone={statusTone(s)}>{s}</Badge>
                          {inst.tags?.map((t) => (
                            <Badge key={t} tone="neutral">{t}</Badge>
                          ))}
                        </Inline>
                        <Inline gap={3}>
                          {inst.worktree && (
                            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                              {inst.worktree}
                            </span>
                          )}
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                            {elapsed(inst.startedAt ?? inst.createdAt)}
                          </span>
                          {inst.pid && (
                            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                              pid {inst.pid}
                            </span>
                          )}
                        </Inline>
                      </Stack>
                      {/* Action buttons — stop propagation so clicking doesn't navigate away */}
                      <Inline
                        gap={1}
                        align="center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {s === 'running' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { void pauseInstance(inst.instanceId); }}
                            data-testid={`bg-pause-${inst.instanceId}`}
                            aria-label={`Pause ${inst.agent ?? inst.instanceId}`}
                            title="Pause"
                          >
                            <Pause size={12} aria-hidden />
                          </Button>
                        )}
                        {s === 'paused' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { void resumeInstance(inst.instanceId); }}
                            data-testid={`bg-resume-${inst.instanceId}`}
                            aria-label={`Resume ${inst.agent ?? inst.instanceId}`}
                            title="Resume"
                          >
                            <Play size={12} aria-hidden />
                          </Button>
                        )}
                        {(s === 'error' || s === 'killed') && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { void retryInstance(inst.instanceId); }}
                            data-testid={`bg-retry-${inst.instanceId}`}
                            aria-label={`Retry ${inst.agent ?? inst.instanceId}`}
                            title="Retry"
                          >
                            <RotateCw size={12} aria-hidden />
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setKillConfirm(inst.instanceId)}
                          data-testid={`bg-kill-${inst.instanceId}`}
                          aria-label={`Kill ${inst.agent ?? inst.instanceId}`}
                          title="Kill"
                        >
                          <Trash2 size={12} aria-hidden />
                        </Button>
                      </Inline>
                    </Inline>
                  </CardBody>
                </Card>
              );
            })}
          </Stack>

          {/* Output panel */}
          {selected && (
            <Card>
              <CardBody>
                <Stack gap={3}>
                  <Inline align="center" justify="between">
                    <Inline align="center" gap={2}>
                      <Terminal size={12} aria-hidden />
                      <span style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>Output</span>
                    </Inline>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { if (selected) void loadOutput(selected.instanceId); }}
                      aria-label="Refresh output"
                    >
                      <RotateCw size={12} aria-hidden />
                    </Button>
                  </Inline>

                  {outputLoading ? (
                    <Skeleton style={{ height: 160 }} />
                  ) : outputLines.length === 0 ? (
                    <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>No output captured yet.</span>
                  ) : (
                    <Box
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-12)',
                        background: 'var(--surface-0)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: 'var(--space-3)',
                        maxHeight: 320,
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: 1.6,
                      }}
                    >
                      {outputLines.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </Box>
                  )}
                </Stack>
              </CardBody>
            </Card>
          )}
        </Box>
      )}

      {/* Kill confirmation inline dialog */}
      {killConfirm && (
        <div
          role="dialog"
          aria-modal
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
            zIndex: 100,
          }}
          data-testid="bg-kill-confirm"
        >
          <Card style={{ maxWidth: 400 }}>
            <CardBody>
              <Stack gap={4}>
                <Inline align="center" gap={2}>
                  <AlertTriangle size={16} aria-hidden style={{ color: 'var(--danger)' }} />
                  <strong>Kill this background job?</strong>
                </Inline>
                <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>
                  This sends SIGTERM to the process. The instance will transition to &ldquo;killed&rdquo; status.
                </span>
                <Inline gap={2}>
                  <Button
                    variant="danger"
                    onClick={() => { void killInstance(killConfirm); }}
                    disabled={busy}
                  >
                    Kill
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setKillConfirm(null)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </Inline>
              </Stack>
            </CardBody>
          </Card>
        </div>
      )}
    </Stack>
  );
}

function Box(props: { children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return <div style={props.style}>{props.children}</div>;
}
