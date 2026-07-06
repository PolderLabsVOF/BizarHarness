// src/views/BackgroundAgents.tsx — dashboard tab listing active background-agent
// instances.
//
// v5.x — full UI redesign for the 7 background-agent integration gaps:
//   - "+ Spawn" button + `SpawnAgentModal` for direct dashboard spawns
//   - Pause / Resume / Steer actions per instance
//   - WebSocket-driven streaming output (`bg:output` events)
//   - Tool-call history collapsible list per instance
//   - Polling 5s safety net preserved
import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';
import {
  Activity as ActivityIcon,
  Copy,
  Eye,
  Loader2,
  Pause,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  Send,
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
import { TmuxAttachCard } from '../components/background/TmuxAttachCard';
import { SpawnAgentModal } from './SpawnAgentModal';
import { api } from '../lib/api';
import { Ws } from '../lib/ws';
import { cn, formatTime, truncate } from '../lib/utils';
import type {
  BackgroundListResponse,
  BackgroundOutputResponse,
  BackgroundTmuxResponse,
  BgInstance,
  BgToolCall,
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
const OUTPUT_REFRESH_MS = 3_000; // fallback poll (used if WS is unavailable)
const PROMPT_TRUNCATE = 120;
const STREAM_BUFFER_LIMIT = 32_000; // chars

function isActive(b: BgInstance): boolean {
  return b.status === 'pending' || b.status === 'running' || b.status === 'paused';
}

function isPaused(b: BgInstance): boolean {
  return b.status === 'paused';
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
  const [showSpawn, setShowSpawn] = useState(false);

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

  // WS subscription — refetch on any background:* event.
  useEffect(() => {
    const ws = new Ws();
    const off = ws.on((msg) => {
      const t = (msg as { type?: string }).type;
      if (
        t === 'background:change' ||
        t === 'background:cleanup' ||
        t === 'bg:progress' ||
        t === 'bg:tool-call'
      ) {
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
      setInstances((cur) => cur.filter((x) => x.instanceId !== b.instanceId));
    });
  };

  const onPause = async (b: BgInstance) => {
    try {
      const r = await api.post<{ ok: boolean; error?: string }>(
        `/background/${encodeURIComponent(b.instanceId)}/pause`,
        {},
      );
      if (!r?.ok) toast.error(r?.error || 'Pause failed.');
      else toast.info(`Paused ${b.instanceId.slice(0, 14)}…`);
    } catch (err) {
      toast.error(`Pause failed: ${(err as Error).message}`);
    }
  };

  const onResume = async (b: BgInstance) => {
    try {
      const r = await api.post<{ ok: boolean; error?: string }>(
        `/background/${encodeURIComponent(b.instanceId)}/resume`,
        {},
      );
      if (!r?.ok) toast.error(r?.error || 'Resume failed.');
      else toast.info(`Resumed ${b.instanceId.slice(0, 14)}…`);
    } catch (err) {
      toast.error(`Resume failed: ${(err as Error).message}`);
    }
  };

  const onSteer = (b: BgInstance) => {
    openSteerModal(modal, toast, b, load);
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
        <div className="bg-active-header-actions">
          <Button variant="primary" size="sm" onClick={() => setShowSpawn(true)}>
            <Plus size={14} /> Spawn
          </Button>
          <Button variant="ghost" size="sm" onClick={load} title="Refresh now">
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </div>

      <SpawnAgentModal
        open={showSpawn}
        onClose={() => setShowSpawn(false)}
        onCreated={() => {
          load();
        }}
      />

      {active.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon size={32} />}
          title="No active background agents"
          message="Use the Spawn button above or call bizar_spawn_background from an agent."
          action={
            <Button variant="primary" onClick={() => setShowSpawn(true)}>
              <Plus size={14} /> Spawn your first agent
            </Button>
          }
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
              onPause={isPaused(b) ? undefined : () => onPause(b)}
              onResume={isPaused(b) ? () => onResume(b) : undefined}
              onSteer={() => onSteer(b)}
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
  onPause,
  onResume,
  onSteer,
}: {
  inst: BgInstance;
  onViewOutput: () => void;
  onOpenTmux: () => void;
  onKill: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onSteer: () => void;
}) {
  const startedMs = typeof inst.startedAt === 'number' ? inst.startedAt : 0;
  const startedLabel = startedMs ? formatTime(startedMs) : '—';
  const durationMs = startedMs ? Date.now() - startedMs : 0;
  const prompt = truncate(inst.prompt, PROMPT_TRUNCATE);
  const progress = typeof inst.progress === 'number' ? inst.progress : null;

  return (
    <Card className="bg-active-card" variant="elevated">
      <div className="bg-active-card-top">
        <div className="bg-active-card-id">
          <code className="mono">{inst.instanceId}</code>
          <BgStatusBadge status={inst.status || 'pending'} dot />
          {isPaused(inst) && (
            <span className="bg-active-card-paused-tag">
              <PauseCircle size={12} /> paused
            </span>
          )}
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

      {progress !== null && (
        <div className="progress-bar" aria-label="Progress">
          <div
            className="progress-fill"
            style={{
              width: `${
                progress < 0
                  ? 100
                  : Math.max(0, Math.min(100, progress))
              }%`,
            }}
          />
          <span className="progress-label">
            {progress < 0
              ? '…'
              : `${Math.round(progress)}%`}
            {inst.progressMessage ? ` · ${inst.progressMessage}` : ''}
          </span>
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
        {inst.processId && (
          <span>
            <strong>PID:</strong> <code className="mono">{inst.processId}</code>
          </span>
        )}
        {Array.isArray(inst.tags) && inst.tags.length > 0 && (
          <span>
            <strong>Tags:</strong>{' '}
            {inst.tags.map((t, i) => (
              <span key={t} className="tag-pill">
                {t}
                {i < inst.tags!.length - 1 ? ' ' : ''}
              </span>
            ))}
          </span>
        )}
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
        {onPause && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onPause}
            title="Pause subprocess (POSIX)"
          >
            <Pause size={14} /> Pause
          </Button>
        )}
        {onResume && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onResume}
            title="Resume subprocess (POSIX)"
          >
            <Play size={14} /> Resume
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onSteer} title="Steer with new instructions">
          <Send size={14} /> Steer
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenTmux}>
          <Terminal size={14} /> Open in tmux
        </Button>
        <Button variant="danger" size="sm" onClick={onKill}>
          <Trash2 size={14} /> Kill
        </Button>
      </div>

      <TmuxAttachCard instance={inst} />
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
  // Buffer of recent lines for streaming output.
  const bufRef = useRef<string[]>([]);
  const [output, setOutput] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [streamingActive, setStreamingActive] = useState(true);
  const [toolCalls, setToolCalls] = useState<BgToolCall[]>([]);
  const [showToolCalls, setShowToolCalls] = useState(true);
  const refBottom = useRef<HTMLDivElement | null>(null);
  const refAutoscroll = useRef(true);

  const recomputeOutput = useCallback(() => {
    setOutput(bufRef.current.join('\n'));
  }, []);

  // Seed from /output, then optionally from disk. The endpoint is the
  // tmux `capture-pane` for legacy instances; for dashboard-spawned
  // ones it gracefully returns `available: false` and we rely on WS.
  const load = useCallback(async () => {
    try {
      const r = await api.get<BackgroundOutputResponse>(
        `/background/${encodeURIComponent(instanceId)}/output?lines=300`,
      );
      setAvailable(r?.available !== false);
      if (r?.output && bufRef.current.length === 0) {
        // Seed the buffer exactly once. Subsequent loads are no-ops
        // for the buffer (WS appends will keep it current).
        const lines = r.output.split(/\r?\n/);
        bufRef.current = lines.slice(-300);
        recomputeOutput();
      }
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load output.');
    } finally {
      setLoading(false);
    }
  }, [instanceId, recomputeOutput]);

  useEffect(() => {
    load();
    const id = setInterval(load, OUTPUT_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Subscribe to bg:output events for true streaming. Falls back to
  // polling if the WS never connects (we still render the seeded
  // text). The OutputModalBody owns its own WS so streams survive
  // modal re-opens and don't share state with the list WS.
  useEffect(() => {
    const ws = new Ws();
    let isOpen = false;
    const offStatus = ws.onStatus((s) => {
      isOpen = s === 'connected';
      setStreamingActive(isOpen);
    });
    const offMsg = ws.on((msg) => {
      const m = msg as { type?: string; instanceId?: string; line?: string };
      if (m.type === 'bg:output' && m.instanceId === instanceId && typeof m.line === 'string') {
        bufRef.current.push(m.line);
        // Cap buffer length; keep most recent N chars.
        let total = 0;
        for (let i = bufRef.current.length - 1; i >= 0; i--) {
          total += (bufRef.current[i]?.length ?? 0) + 1;
          if (total > STREAM_BUFFER_LIMIT) {
            bufRef.current = bufRef.current.slice(i + 1);
            break;
          }
        }
        setOutput(bufRef.current.join('\n'));
      }
    });
    return () => {
      offStatus();
      offMsg();
      ws.close();
    };
  }, [instanceId]);

  // Fetch tool-call history once (and refresh on bg:tool-call events).
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const r = await api.get<{ toolCalls: BgToolCall[] }>(
          `/background/${encodeURIComponent(instanceId)}/tool-calls`,
        );
        if (!cancelled && Array.isArray(r?.toolCalls)) {
          setToolCalls(r.toolCalls);
        }
      } catch {
        /* fall through; the list is optional */
      }
    };
    refresh();
    const ws = new Ws();
    const off = ws.on((msg) => {
      const m = msg as { type?: string; instanceId?: string };
      if (m.type === 'bg:tool-call' && m.instanceId === instanceId) refresh();
    });
    return () => {
      cancelled = true;
      off();
      ws.close();
    };
  }, [instanceId]);

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
          {streamingActive
            ? `streaming · ${output.length} chars`
            : available
              ? `${output.length} chars · auto-refresh ${OUTPUT_REFRESH_MS / 1000}s (WS idle)`
              : 'Output unavailable (no tmux session)'}
        </span>
        <div className="bg-output-toolbar-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowToolCalls((v) => !v)}
            title="Toggle tool-call history"
          >
            {showToolCalls ? 'Hide tools' : 'Show tools'}
          </Button>
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
      ) : (
        <div className="bg-output-body">
          <div className="bg-output-scroll" onScroll={onScroll}>
            <pre className="bg-output-pre mono">
              <code>
                {output || (
                  <span className="muted">No output captured yet — waiting for the agent to start…</span>
                )}
              </code>
            </pre>
            <div ref={refBottom} />
          </div>
          {showToolCalls && (
            <ToolCallHistory calls={toolCalls} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tool-call history panel ───────────────────────────────────────────────

function ToolCallHistory({ calls }: { calls: BgToolCall[] }) {
  return (
    <aside className="bg-tool-calls" aria-label="Tool call history">
      <h4 className="bg-tool-calls-title">Tool calls ({calls.length})</h4>
      {calls.length === 0 ? (
        <p className="muted bg-tool-calls-empty">No tool calls recorded yet.</p>
      ) : (
        <ol className="bg-tool-calls-list">
          {calls.slice().reverse().map((c) => {
            const dur =
              c.endedAt && c.startedAt
                ? `${Math.max(0, c.endedAt - c.startedAt)}ms`
                : '…';
            return (
              <li key={c.id} className={`bg-tool-call bg-tool-call-${c.status}`}>
                <div className="bg-tool-call-head">
                  <code className="mono bg-tool-call-name">{c.name}</code>
                  <span className={`badge badge-${c.status === 'error' ? 'danger' : c.status === 'ok' ? 'success' : 'neutral'}`}>
                    {c.status}
                  </span>
                  <span className="bg-tool-call-dur muted">{dur}</span>
                </div>
                {c.args && (
                  <pre className="bg-tool-call-args mono">{c.args}</pre>
                )}
                {c.result && (
                  <pre className="bg-tool-call-result mono">{c.result.slice(0, 240)}</pre>
                )}
                {c.error && (
                  <pre className="bg-tool-call-error mono">{c.error}</pre>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
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

// ─── Steer modal ──────────────────────────────────────────────────────────

function openSteerModal(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  inst: BgInstance,
  refresh: () => void,
) {
  modal.open({
    title: `Steer ${inst.agent || inst.instanceId}`,
    width: 600,
    children: (
      <SteerModalBody
        instanceId={inst.instanceId}
        toast={toast}
        onCreated={refresh}
        onClose={() => modal.close()}
      />
    ),
  });
}

function SteerModalBody({
  instanceId,
  toast,
  onCreated,
  onClose,
}: {
  instanceId: string;
  toast: ReturnType<typeof useToast>;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!message.trim()) {
      setError('Message is required.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.post<{
        ok: boolean;
        newInstanceId?: string;
        error?: string;
      }>(`/background/${encodeURIComponent(instanceId)}/steer`, { message });
      if (!r?.ok) {
        setError(r?.error || 'Steer failed.');
        return;
      }
      toast.success(
        `Steered → new instance ${(r.newInstanceId ?? '').slice(0, 14)}…`,
      );
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-steer-modal">
      <p className="muted">
        Steer kills the current subprocess and spawns a new one with the
        original prompt + your message appended. The new instance is
        linked to this one as <code>parentInstanceId</code>.
      </p>
      <textarea
        className="field-input bg-steer-textarea"
        rows={6}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What do you want the agent to do differently?"
      />
      {error && <div className="bg-steer-error">{error}</div>}
      <div className="bg-steer-actions">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={submitting || !message.trim()}
        >
          {submitting ? 'Steering…' : 'Steer'}
        </Button>
      </div>
    </div>
  );
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