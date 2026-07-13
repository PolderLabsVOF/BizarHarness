import { useEffect, useMemo, useState } from 'react';
import { Send, RotateCw, Octagon, ClipboardCopy, Activity as ActivityIcon } from 'lucide-react';
import { Avatar } from '../data/Avatar.js';
import { Badge } from '../data/Badge.js';
import { Button } from '../controls/Button.js';
import { Sheet, SheetContent } from '../feedback/Sheet.js';
import { Stack } from '../primitives/Stack.js';
import { Inline } from '../primitives/Inline.js';
import { Textarea } from '../controls/Textarea.js';
import { Skeleton } from '../feedback/Skeleton.js';
import { Card, CardBody } from '../data/Card.js';
import { AgentStreamPanel } from './AgentStreamPanel.js';
import { AgentLiveOutput } from './AgentLiveOutput.js';
import { fetchJson } from '../../data/fetcher.js';
import { useFetch } from '../../data/useFetch.js';
import type { Task } from '../../data/types.js';

/**
 * AgentDetail — Sprint S11. Right-side Drawer with live agent
 * detail and the control plane (Send prompt / Restart / Kill).
 *
 * Two flavors per `source`:
 *  - `bizar:<name>` — hits `/api/agents/:name/invoke` and `/restart`.
 *  - `cc:<sessionId>` — hits `/api/cc-agents/:id/send` and `/kill`.
 */

export type AgentSource = 'bizar' | 'claude-code';

export interface AgentDetailProps {
  /** Composite id from AgentsView (`bizar:<name>` or `cc:<sessionId>`). */
  agentId: string;
  name: string;
  role: string;
  status: 'idle' | 'busy' | 'error' | 'paused';
  currentTask?: string;
  startedAt?: number;
  messageCount?: number;
  lastMessageSnippet?: string;
  successRate?: number;
  tasksTotal?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function parseId(agentId: string): { source: AgentSource; key: string } {
  if (agentId.startsWith('bizar:')) return { source: 'bizar', key: agentId.slice('bizar:'.length) };
  if (agentId.startsWith('cc:')) return { source: 'claude-code', key: agentId.slice('cc:'.length) };
  return { source: 'bizar', key: agentId };
}

export function AgentDetail(props: AgentDetailProps): JSX.Element {
  const {
    agentId, name, role, status, currentTask, open, onOpenChange,
    startedAt, messageCount, lastMessageSnippet, successRate, tasksTotal,
  } = props;
  const { source, key } = parseId(agentId);
  const [prompt, setPrompt] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastProcessId, setLastProcessId] = useState<string | null>(null);

  // v9.5.0 S49 — agent↔task drilldown. `useFetch` is gated on `open` so
  // we don't burn a request every time the Sheet is mounted-hidden. We
  // client-filter for the current agent's name across both `workedBy`
  // (Bizar task-store) and `metadata.agent` (task-store progress events).
  const tasksQuery = useFetch<{ tasks?: Task[] }>(open ? '/api/tasks' : null);
  const myTasks = useMemo<Task[]>(() => {
    if (!open) return [];
    const all = tasksQuery.data?.tasks ?? [];
    return all.filter((t) => {
      const md = (t.metadata ?? {}) as { agent?: unknown };
      return (
        (typeof (t as unknown as { workedBy?: unknown }).workedBy === 'string'
          && (t as unknown as { workedBy: string }).workedBy === key)
        || md.agent === key
      );
    });
  }, [open, tasksQuery.data, key]);

  useEffect(() => {
    if (open) { setPrompt(''); setMessage(null); setError(null); setLastProcessId(null); }
  }, [open, agentId]);

  const runAction = async (
    label: string,
    method: 'POST',
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<void> => {
    setBusy(label);
    setMessage(null);
    setError(null);
    try {
      const res = await fetchJson<{ ok?: boolean; sessionId?: string; processId?: string; error?: string }>(
        endpoint,
        { method, body },
      );
      if (res.ok) {
        const sessionExtra = res.sessionId ? ` (session ${res.sessionId.slice(0, 8)})` : '';
        if (res.processId) setLastProcessId(res.processId);
        setMessage(`${label} succeeded${sessionExtra}`);
      } else {
        setError(res.error || `${label} failed`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const sendPrompt = async (): Promise<void> => {
    if (!prompt.trim()) return;
    const trimmed = prompt.trim();
    setPrompt('');
    if (source === 'claude-code') {
      await runAction('Send prompt', 'POST', `/api/cc-agents/${encodeURIComponent(key)}/send`, { prompt: trimmed });
    } else {
      await runAction('Invoke agent', 'POST', `/api/agents/${encodeURIComponent(key)}/invoke`, { prompt: trimmed });
    }
  };

  const restart = async (): Promise<void> => {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`Restart ${name}? The current session will be killed and a fresh one spawned.`)
      : true;
    if (!ok) return;
    if (source === 'claude-code') {
      // v9.0.5 — server now does kill+spawn in one shot, using the current
      // prompt as the new session's seed (fallback to "continue").
      const seed = prompt.trim() || 'continue from the last checkpoint';
      await runAction('Restart', 'POST', `/api/cc-agents/${encodeURIComponent(key)}/restart`, { prompt: seed });
      return;
    }
    await runAction('Restart', 'POST', `/api/agents/${encodeURIComponent(key)}/restart`);
  };

  const kill = async (): Promise<void> => {
    if (source === 'claude-code') {
      await runAction('Kill', 'POST', `/api/cc-agents/${encodeURIComponent(key)}/kill`);
      return;
    }
    // Confirm before destroying — DELETE is irreversible.
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`Delete Bizar agent "${key}"? This is irreversible.`)
      : true;
    if (!ok) return;
    setBusy('Kill');
    setMessage(null);
    setError(null);
    try {
      await fetchJson<{ ok?: boolean; error?: string }>(
        `/api/agents/${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      setMessage(`Killed ${name}`);
      // Server broadcasts agents:change; close the drawer so the user
      // sees the agent disappear from the grid.
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const copyId = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(key);
      setMessage(`Copied "${key}"`);
    } catch {
      setError('Clipboard unavailable');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" title={name}>
      <Stack gap={4} style={{ padding: 'var(--space-4)' }}>
        <Inline gap={3} align="center">
          <Avatar name={name} status={status === 'busy' ? 'busy' : status === 'error' ? 'busy' : 'online'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>{role}</div>
            <Inline gap={2} style={{ marginTop: 4 }} wrap>
              <Badge tone={status === 'busy' ? 'info' : status === 'error' ? 'danger' : 'neutral'} dot>
                {status}
              </Badge>
              <Badge tone="accent">{source === 'bizar' ? 'Bizar agent' : 'Claude Code'}</Badge>
              {startedAt !== undefined && (
                <Badge tone="neutral" title={new Date(startedAt).toLocaleString()}>
                  up {formatDuration(Date.now() - startedAt)}
                </Badge>
              )}
              {typeof messageCount === 'number' && (
                <Badge tone="neutral">{messageCount} msg</Badge>
              )}
              {typeof tasksTotal === 'number' && (
                <Badge tone="neutral">{tasksTotal} tasks</Badge>
              )}
              {typeof successRate === 'number' && (
                <Badge tone={successRate >= 0.8 ? 'success' : successRate >= 0.5 ? 'warning' : 'danger'}>
                  {Math.round(successRate * 100)}% success
                </Badge>
              )}
            </Inline>
          </div>
        </Inline>

        {typeof lastMessageSnippet === 'string' && lastMessageSnippet.length > 0 && (
          <div
            style={{
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-muted)',
              fontStyle: 'italic',
            }}
            title={lastMessageSnippet}
          >
            “{lastMessageSnippet.length > 240 ? `${lastMessageSnippet.slice(0, 240)}…` : lastMessageSnippet}”
          </div>
        )}

        {currentTask !== undefined && (
          <div
            style={{
              padding: 'var(--space-3)',
              background: 'var(--surface-0)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-13)',
            }}
          >
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 4 }}>
              <ActivityIcon size={12} aria-hidden style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Current task
            </div>
            {currentTask}
          </div>
        )}

        <Stack gap={2}>
          <label
            htmlFor={`agent-prompt-${agentId}`}
            style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}
          >
            Send a prompt
          </label>
          <Textarea
            id={`agent-prompt-${agentId}`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={source === 'claude-code' ? 'Type a follow-up for this background agent…' : 'Invoke this Bizar agent with…'}
            rows={3}
            disabled={busy !== null}
          />
          <Inline gap={2}>
            <Button
              variant="primary"
              onClick={() => { void sendPrompt(); }}
              disabled={!prompt.trim() || busy !== null}
            >
              <Send size={14} aria-hidden /> {busy === 'Send prompt' || busy === 'Invoke agent' ? <Skeleton style={{ width: 60, height: 14 }} /> : 'Send'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => { void restart(); }}
              disabled={busy !== null || source === 'claude-code'}
              title={source === 'claude-code' ? 'Use command palette to spawn a fresh agent' : undefined}
            >
              <RotateCw size={14} aria-hidden /> Restart
            </Button>
            <Button
              variant="danger"
              onClick={() => { void kill(); }}
              disabled={busy !== null}
              title={source === 'claude-code' ? 'Kill the CC background session' : `Delete Bizar agent "${key}"`}
            >
              <Octagon size={14} aria-hidden /> Kill
            </Button>
            <Button variant="ghost" onClick={() => { void copyId(); }}>
              <ClipboardCopy size={14} aria-hidden /> Copy id
            </Button>
          </Inline>
        </Stack>

        {message !== null && (
          <div
            role="status"
            style={{
              padding: 'var(--space-2) var(--space-3)',
              background: 'color-mix(in oklch, var(--success) 12%, var(--surface-0))',
              border: '1px solid color-mix(in oklch, var(--success) 40%, var(--border))',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-12)',
              color: 'var(--success)',
            }}
          >
            {message}
          </div>
        )}
        {lastProcessId !== null && (
          <div
            style={{
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--surface-0)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>PID</span>
            <code
              data-testid="agent-process-id"
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--fg)',
                background: 'var(--surface-1)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {lastProcessId}
            </code>
          </div>
        )}
        {error !== null && (
          <div
            role="alert"
            style={{
              padding: 'var(--space-2) var(--space-3)',
              background: 'color-mix(in oklch, var(--danger) 12%, var(--surface-0))',
              border: '1px solid color-mix(in oklch, var(--danger) 40%, var(--border))',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-12)',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}

        {/* Live stream — only meaningful for Claude Code sessions (they have
            a backing JSONL log). Bizar agents have no equivalent surface. */}
        {/* v9.5.0 S49 — agent↔task drilldown. Renders the tasks this agent
            is currently working on (filtered by workedBy / metadata.agent),
            so the user can see "what is my orchestrator doing right now"
            without bouncing between this Sheet and the Tasks board. */}
        <Stack gap={2}>
          <div
            style={{
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Assigned tasks ({myTasks.length})
          </div>
          {tasksQuery.loading && myTasks.length === 0 ? (
            <Skeleton style={{ height: 48 }} />
          ) : myTasks.length === 0 ? (
            <Card variant="outlined">
              <CardBody>
                <span data-testid="agent-tasks-empty" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                  No tasks assigned to this agent.
                </span>
              </CardBody>
            </Card>
          ) : (
            <Stack gap={1}>
              {myTasks.map((t) => (
                <div
                  key={t.id}
                  data-testid={`agent-tasks-${t.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'var(--surface-0)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--fs-13)',
                  }}
                >
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{t.id}</code>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </span>
                  <Badge tone={t.status === 'doing' ? 'info' : t.status === 'blocked' ? 'danger' : 'neutral'}>
                    {t.status ?? 'queued'}
                  </Badge>
                </div>
              ))}
            </Stack>
          )}
        </Stack>
        {source === 'claude-code' && (
          <Stack gap={2}>
            <div
              style={{
                fontSize: 'var(--fs-12)',
                color: 'var(--fg-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <ActivityIcon size={12} aria-hidden style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Live output
            </div>
            <AgentLiveOutput sessionId={key} paused={busy === 'Kill'} />
          </Stack>
        )}
      </Stack>
    </SheetContent>
    </Sheet>
  );
}

/** formatDuration — human-readable "3m 12s" / "1h 4m" / "2d 5h". */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const day = Math.floor(hr / 24);
  return `${day}d ${hr % 24}h`;
}