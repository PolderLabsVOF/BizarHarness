import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { Stack } from '../primitives/Stack.js';
import { Inline } from '../primitives/Inline.js';
import { Button } from '../controls/Button.js';

/**
 * AgentLiveOutput — Sprint S17. Live SSE tail of a CC agent's session
 * JSONL. Subscribes to `/api/agent-stream/live?sessionId=...` and
 * appends events as they arrive. Pause freezes the buffer (connection
 * stays open). Clear wipes the buffer.
 */

interface StreamEvent {
  type?: string;
  role?: string;
  content?: string;
  name?: string;
  input?: unknown;
  tool?: { name?: string; input?: unknown };
  result?: unknown;
  ts?: number;
  message?: string;
}

export interface AgentLiveOutputProps {
  sessionId: string;
  /** When true the parent wants us to stop connecting (e.g. agent was killed). */
  paused?: boolean;
}

const MAX_EVENTS = 500;

export function AgentLiveOutput(props: AgentLiveOutputProps): JSX.Element {
  const { sessionId, paused } = props;
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'paused' | 'error' | 'closed'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [pausedLocal, setPausedLocal] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (paused || pausedLocal) {
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
      setStatus('paused');
      return;
    }
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setStatus('error');
      setError('EventSource not available in this environment.');
      return;
    }
    setStatus('connecting');
    setError(null);
    const url = `/api/agent-stream/live?sessionId=${encodeURIComponent(sessionId)}`;
    const src = new EventSource(url);
    sourceRef.current = src;

    const onSnapshot = (ev: MessageEvent): void => {
      try {
        const data = JSON.parse(ev.data) as { events?: StreamEvent[] };
        if (Array.isArray(data.events)) setEvents(data.events.slice(-MAX_EVENTS));
        setStatus('live');
      } catch { /* malformed */ }
    };
    const onEvent = (ev: MessageEvent): void => {
      try {
        const data = JSON.parse(ev.data) as StreamEvent;
        setEvents((prev) => {
          const next = prev.length >= MAX_EVENTS ? prev.slice(prev.length - MAX_EVENTS + 1) : prev.slice();
          next.push(data);
          return next;
        });
        setStatus('live');
      } catch { /* malformed */ }
    };
    const onEnd = (ev: MessageEvent): void => {
      try {
        const data = JSON.parse(ev.data) as { reason?: string };
        setStatus('closed');
        setError(data.reason ? `Stream ended: ${data.reason}` : null);
      } catch { /* */ }
    };
    const onErrEv = (ev: MessageEvent): void => {
      try {
        const data = JSON.parse(ev.data) as { error?: string };
        setStatus('error');
        setError(data.error || 'stream error');
      } catch { /* */ }
    };
    src.addEventListener('snapshot', onSnapshot);
    src.addEventListener('event', onEvent);
    src.addEventListener('agent:event', onEvent);
    src.addEventListener('end', onEnd);
    src.addEventListener('error', onErrEv);
    src.onerror = () => {
      setStatus('error');
      setError('Connection dropped. Click Retry to reconnect.');
    };
    return () => {
      src.close();
      sourceRef.current = null;
    };
  }, [sessionId, paused, pausedLocal]);

  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    const el = containerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [events, autoScroll]);

  const renderEvent = (ev: StreamEvent, idx: number): JSX.Element => {
    const tone =
      ev.role === 'user' ? 'user' :
      ev.role === 'assistant' ? 'assistant' :
      ev.tool?.name ? 'tool' :
      'system';
    const label =
      ev.tool?.name ? `${ev.tool.name}` :
      ev.role ? ev.role : (ev.type || 'event');
    const text =
      typeof ev.content === 'string' ? ev.content :
      ev.tool?.input ? JSON.stringify(ev.tool.input).slice(0, 240) :
      typeof ev.message === 'string' ? ev.message :
      ev.result ? JSON.stringify(ev.result).slice(0, 240) :
      JSON.stringify(ev).slice(0, 240);
    return (
      <div
        key={idx}
        style={{
          padding: '4px 8px',
          borderRadius: 'var(--radius-sm)',
          background:
            tone === 'user' ? 'color-mix(in oklch, var(--accent) 8%, var(--surface-0))' :
            tone === 'tool' ? 'color-mix(in oklch, var(--warning) 8%, var(--surface-0))' :
            tone === 'system' ? 'var(--surface-1)' :
            'var(--surface-0)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-12)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        <span style={{ color: 'var(--fg-muted)' }}>{label}: </span>
        <span style={{ color: 'var(--fg)' }}>{text}</span>
      </div>
    );
  };

  return (
    <Stack gap={2}>
      <Inline align="center" justify="between">
        <Inline align="center" gap={2}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background:
                status === 'live' ? 'var(--success)' :
                status === 'connecting' ? 'var(--warning)' :
                status === 'paused' ? 'var(--fg-muted)' :
                status === 'closed' ? 'var(--fg-muted)' :
                'var(--danger)',
            }}
          />
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {status === 'live' ? 'Live' :
             status === 'connecting' ? 'Connecting…' :
             status === 'paused' ? 'Paused' :
             status === 'closed' ? 'Closed' :
             'Error'}
            {' · '}{events.length} events
          </span>
        </Inline>
        <Inline align="center" gap={1}>
          <Button
            variant="ghost"
            onClick={() => setPausedLocal((p) => !p)}
            title={pausedLocal ? 'Resume stream' : 'Pause stream'}
            aria-label={pausedLocal ? 'Resume stream' : 'Pause stream'}
          >
            {pausedLocal ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setEvents([])}
            title="Clear buffer"
            aria-label="Clear output"
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setEvents([]);
              setPausedLocal(false);
            }}
            title="Reconnect"
            aria-label="Reconnect stream"
          >
            <RefreshCw size={12} aria-hidden /> Retry
          </Button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            follow
          </label>
        </Inline>
      </Inline>
      {error !== null && (
        <div role="alert" style={{ fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>{error}</div>
      )}
      <div
        ref={containerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
          setAutoScroll(atBottom);
        }}
        style={{
          maxHeight: 280,
          minHeight: 120,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          background: 'var(--surface-1)',
        }}
        role="log"
        aria-live="polite"
        aria-label="Agent live output"
      >
        {events.length === 0 ? (
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {status === 'connecting' ? 'Connecting to agent stream…' : 'No events yet.'}
          </span>
        ) : (
          events.map(renderEvent)
        )}
      </div>
    </Stack>
  );
}