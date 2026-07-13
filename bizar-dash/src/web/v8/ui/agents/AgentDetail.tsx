import { useEffect, useState } from 'react';
import { Send, RotateCw, Octagon, ClipboardCopy, Activity as ActivityIcon } from 'lucide-react';
import { Avatar } from '../data/Avatar.js';
import { Badge } from '../data/Badge.js';
import { Button } from '../controls/Button.js';
import { Sheet, SheetContent } from '../feedback/Sheet.js';
import { Stack } from '../primitives/Stack.js';
import { Inline } from '../primitives/Inline.js';
import { Textarea } from '../controls/Textarea.js';
import { Skeleton } from '../feedback/Skeleton.js';
import { fetchJson } from '../../data/fetcher.js';

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
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function parseId(agentId: string): { source: AgentSource; key: string } {
  if (agentId.startsWith('bizar:')) return { source: 'bizar', key: agentId.slice('bizar:'.length) };
  if (agentId.startsWith('cc:')) return { source: 'claude-code', key: agentId.slice('cc:'.length) };
  return { source: 'bizar', key: agentId };
}

export function AgentDetail(props: AgentDetailProps): JSX.Element {
  const { agentId, name, role, status, currentTask, open, onOpenChange } = props;
  const { source, key } = parseId(agentId);
  const [prompt, setPrompt] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setPrompt(''); setMessage(null); setError(null); }
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
        const extra = res.sessionId ? ` (session ${res.sessionId.slice(0, 8)})` : '';
        setMessage(`${label} succeeded${extra}`);
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
    if (source === 'claude-code') {
      // CC background agents don't have a server-side restart — the user
      // spawns a new one via the command palette. Surface that clearly.
      setMessage('Use the command palette to spawn a fresh agent.');
      return;
    }
    await runAction('Restart', 'POST', `/api/agents/${encodeURIComponent(key)}/restart`);
  };

  const kill = async (): Promise<void> => {
    if (source === 'claude-code') {
      await runAction('Kill', 'POST', `/api/cc-agents/${encodeURIComponent(key)}/kill`);
    } else {
      // No kill route for Bizar agents; restart is the closest analog.
      await runAction('Restart', 'POST', `/api/agents/${encodeURIComponent(key)}/restart`);
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
            <Inline gap={2} style={{ marginTop: 4 }}>
              <Badge tone={status === 'busy' ? 'info' : status === 'error' ? 'danger' : 'neutral'} dot>
                {status}
              </Badge>
              <Badge tone="accent">{source === 'bizar' ? 'Bizar agent' : 'Claude Code'}</Badge>
            </Inline>
          </div>
        </Inline>

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
            >
              <Octagon size={14} aria-hidden /> {source === 'claude-code' ? 'Kill' : 'Restart'}
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
      </Stack>
    </SheetContent>
    </Sheet>
  );
}