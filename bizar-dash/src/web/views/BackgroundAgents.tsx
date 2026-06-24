// src/views/BackgroundAgents.tsx — dashboard tab listing active background-agent
// instances (status === 'pending' | 'running'). Polls /api/background every 5s
// as a safety net and refreshes on `background:change` WS events for near-real-time
// updates. Per-instance actions: View live output (auto-refreshing modal), Open
// in tmux (shows attach command), Kill (with confirm dialog).
import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import {
  Activity as ActivityIcon,
  Copy,
  Eye,
  Loader2,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { BgStatusBadge } from '../components/BgStatusBadge';
import { openKillConfirmDialog } from '../components/KillConfirmDialog';
import { api } from '../lib/api';
import { Ws } from '../lib/ws';
import { cn, formatTime, truncate } from '../lib/utils';
import type {
  BackgroundListResponse,
  BackgroundOutputResponse,
  BackgroundTmuxResponse,
  BgInstance,
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

const POLL_INTERVAL_MS = 5_000;
const OUTPUT_REFRESH_MS = 2_000;
const PROMPT_TRUNCATE = 120;

function isActive(b: BgInstance): boolean {
  return b.status === 'pending' || b.status === 'running';
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function BackgroundAgents(_props: Props) {
  const toast = useToast();
  const modal = useModal();
  const [instances, setInstances] = useState<BgInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await api.get<BackgroundListResponse>('/background');
      setInstances(Array.isArray(res?.instances) ? res.instances : []);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load background agents.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + polling safety net.
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  // 1s tick to keep the duration strings fresh.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, []);

  // WS subscription — refetch on any background:change / cleanup event.
  // Matches the Settings.tsx pattern of opening a private WS instance.
  // Acceptable because background change volume is low and the dashboard
  // already creates parallel WS connections for other tabs.
  useEffect(() => {
    const ws = new Ws();
    const off = ws.on((msg) => {
      const t = (msg as { type?: string }).type;
      if (t === 'background:change' || t === 'background:cleanup') {
        load();
      }
    });
    return () => {
      off();
      ws.close();
    };
  }, [load]);

  const active = instances.filter(isActive);

  // ─── Handlers ─────────────────────────────────────────────────────────

  const onOpenOutput = (b: BgInstance) => {
    openOutputModal(modal, b);
  };

  const onOpenTmux = async (b: BgInstance) => {
    try {
      const info = await api.get<BackgroundTmuxResponse>(
        `/background/${encodeURIComponent(b.instanceId)}/tmux`,
      );
      openTmuxModal(modal, info);
    } catch (err) {
      toast.error(`Tmux info failed: ${(err as Error).message}`);
    }
  };

  const onKill = (b: BgInstance) => {
    openKillConfirmDialog(modal, toast, b.instanceId, b.agent || b.prompt, () => {
      // Optimistic remove — the WS broadcast + polling safety net will reconcile.
      setInstances((cur) => cur.filter((x) => x.instanceId !== b.instanceId));
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-active-view">
        <div className="bg-active-loading">
          <Spinner size="md" />
          <span>Loading background agents…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-active-view">
        <EmptyState
          icon={<ActivityIcon size={32} />}
          title="Couldn't load background agents"
          message={error}
          action={
            <Button variant="primary" onClick={load}>
              <RefreshCw size={14} /> Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="bg-active-view">
      <div className="bg-active-header">
        <div className="bg-active-header-text">
          <h2 className="bg-active-title">Active Background Agents</h2>
          <p className="bg-active-subtitle muted">
            {active.length} active · {instances.length} total in store
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} title="Refresh now">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon size={32} />}
          title="No active background agents"
          message="Spawn one from the Agents tab or via the bizar_spawn_background tool."
        />
      ) : (
        <div className="bg-active-list">
          {active.map((b) => (
            <BackgroundAgentCard
              key={b.instanceId}
              inst={b}
              onViewOutput={() => onOpenOutput(b)}
              onOpenTmux={() => onOpenTmux(b)}
              onKill={() => onKill(b)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Per-instance card ─────────────────────────────────────────────────────

function BackgroundAgentCard({
  inst,
  onViewOutput,
  onOpenTmux,
  onKill,
}: {
  inst: BgInstance;
  onViewOutput: () => void;
  onOpenTmux: () => void;
  onKill: () => void;
}) {
  const startedMs = typeof inst.startedAt === 'number' ? inst.startedAt : 0;
  const startedLabel = startedMs ? formatTime(startedMs) : '—';
  const durationMs = startedMs ? Date.now() - startedMs : 0;
  const prompt = truncate(inst.prompt, PROMPT_TRUNCATE);

  return (
    <Card className="bg-active-card" variant="elevated">
      <div className="bg-active-card-top">
        <div className="bg-active-card-id">
          <code className="mono">{inst.instanceId}</code>
          <BgStatusBadge status={inst.status || 'pending'} dot />
        </div>
        <div className="bg-active-card-agent">
          <span className="bg-active-card-agent-label">Agent</span>
          <span className="bg-active-card-agent-name">{inst.agent || 'unknown'}</span>
        </div>
      </div>

      {prompt && <div className="bg-active-prompt">{prompt}</div>}

      {inst.currentStep && (
        <div className="bg-active-step">
          <span className="bg-active-step-label">Step:</span>
          <span className="bg-active-step-value">{inst.currentStep}</span>
        </div>
      )}

      {typeof inst.progress === 'number' && (
        <div className="progress-bar" aria-label="Progress">
          <div
            className="progress-fill"
            style={{ width: `${Math.max(0, Math.min(100, inst.progress))}%` }}
          />
          <span className="progress-label">{Math.round(inst.progress)}%</span>
        </div>
      )}

      <div className="bg-active-meta">
        <span title={startedLabel}>
          <strong>Started:</strong> {startedLabel}
        </span>
        <span>
          <strong>Duration:</strong> {formatDuration(durationMs)}
        </span>
        <span>
          <strong>Tool calls:</strong> {inst.toolCallCount ?? 0}
        </span>
        {inst.tmuxSession && (
          <span className={cn(inst.tmuxActive && 'bg-active-meta-tmux-live')}>
            <strong>tmux:</strong> <code className="mono">{inst.tmuxSession}</code>
            {inst.tmuxActive ? ' · live' : ''}
          </span>
        )}
      </div>

      <div className="bg-active-actions">
        <Button variant="secondary" size="sm" onClick={onViewOutput}>
          <Eye size={14} /> View output
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenTmux}>
          <Terminal size={14} /> Open in tmux
        </Button>
        <Button variant="danger" size="sm" onClick={onKill}>
          <Trash2 size={14} /> Kill
        </Button>
      </div>
    </Card>
  );
}

// ─── Output modal (auto-refresh) ───────────────────────────────────────────

function openOutputModal(
  modal: ReturnType<typeof useModal>,
  inst: BgInstance,
) {
  modal.open({
    title: `Output — ${inst.agent || inst.instanceId}`,
    width: 720,
    children: <OutputModalBody instanceId={inst.instanceId} />,
  });
}

function OutputModalBody({ instanceId }: { instanceId: string }) {
  const toast = useToast();
  const [output, setOutput] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const refBottom = useRef<HTMLDivElement | null>(null);
  const refAutoscroll = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get<BackgroundOutputResponse>(
        `/background/${encodeURIComponent(instanceId)}/output?lines=200`,
      );
      setOutput(r?.output ?? '');
      setAvailable(r?.available !== false);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load output.');
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    load();
    const id = setInterval(load, OUTPUT_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Auto-scroll to bottom only if user is already near the bottom.
  useEffect(() => {
    if (!refAutoscroll.current) return;
    refBottom.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [output]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    refAutoscroll.current = atBottom;
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      toast.success('Output copied.');
    } catch {
      // ignore — clipboard may be unavailable in some contexts
    }
  };

  return (
    <div className="bg-output-modal">
      <div className="bg-output-toolbar">
        <span className="muted">
          {available ? `${output.length} chars · auto-refresh 2s` : 'Output unavailable'}
        </span>
        <div className="bg-output-toolbar-actions">
          <Button variant="ghost" size="sm" onClick={load} title="Refresh now">
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={copy} disabled={!output}>
            <Copy size={14} /> Copy
          </Button>
        </div>
      </div>
      {loading && !output ? (
        <div className="bg-output-loading">
          <Loader2 size={16} className="spin" /> Loading…
        </div>
      ) : error ? (
        <div className="bg-output-error">{error}</div>
      ) : !output ? (
        <div className="bg-output-empty muted">No output captured yet.</div>
      ) : (
        <div className="bg-output-scroll" onScroll={onScroll}>
          <pre className="bg-output-pre mono">
            <code>{output}</code>
          </pre>
          <div ref={refBottom} />
        </div>
      )}
    </div>
  );
}

// ─── Tmux attach modal ─────────────────────────────────────────────────────

function openTmuxModal(
  modal: ReturnType<typeof useModal>,
  info: BackgroundTmuxResponse,
) {
  const cmd = info.attachCommand || info.session || '';
  modal.open({
    title: 'Attach to tmux',
    width: 520,
    children: <TmuxModalBody info={info} cmd={cmd} />,
  });
}

function TmuxModalBody({ info, cmd }: { info: BackgroundTmuxResponse; cmd: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="bg-tmux-modal">
      {!cmd ? (
        <p className="muted">No tmux session attached to this instance.</p>
      ) : (
        <>
          <p className="bg-tmux-meta">
            {info.exists ? (
              <span className="badge badge-success">session live</span>
            ) : (
              <span className="badge badge-warning">
                session not running{info.reason ? ` — ${info.reason}` : ''}
              </span>
            )}
            {info.session && (
              <span className="bg-tmux-session muted">
                · session <code className="mono">{info.session}</code>
              </span>
            )}
          </p>
          <label className="field-label">Attach command</label>
          <div className="bg-tmux-command-row">
            <code className="bg-tmux-command mono">{cmd}</code>
            <Button variant="secondary" size="sm" onClick={onCopy}>
              <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="muted bg-tmux-hint">
            Paste this into a terminal on the host running the dashboard. The
            dashboard itself does not open terminals.
          </p>
        </>
      )}
    </div>
  );
}