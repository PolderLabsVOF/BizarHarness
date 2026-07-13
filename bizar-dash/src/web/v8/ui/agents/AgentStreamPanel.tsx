import { useEffect, useRef, useState } from 'react';
import { Terminal, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import { Box } from '../primitives/Box.js';
import { Inline } from '../primitives/Inline.js';
import { cx } from '../utils/cx.js';

/**
 * AgentStreamPanel — Sprint S15. Live CC agent output stream.
 *
 * Backed by:
 *   - GET  /api/agent-stream/recent — initial buffered last-N events.
 *   - GET  /api/agent-stream/live   — Server-Sent Events tail.
 *
 * Auto-reconnects with exponential backoff when the SSE stream drops.
 * Renders role-tinted text + tool calls. Auto-scrolls to the newest event
 * unless the user has scrolled up (then leaves them alone).
 */

export interface AgentStreamPanelProps {
  sessionId: string;
  /** Cap on how many events to keep in memory. Default 500. */
  maxEvents?: number;
  /** Optional className. */
  className?: string;
  /** Polished / verbose rendering (used by Drawer vs inline panel). */
  density?: 'compact' | 'detailed';
}

export interface StreamEvent {
  ts: number;
  kind: 'text' | 'tool' | 'tool-result' | 'system';
  role?: string;
  content?: string;
  toolName?: string;
  toolInput?: string;
  isError?: boolean;
}

const ROLE_TONE: Record<string, string> = {
  user: 'var(--accent)',
  assistant: 'var(--info)',
  system: 'var(--warning)',
};

function timeShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AgentStreamPanel({
  sessionId,
  maxEvents = 500,
  className,
  density = 'detailed',
}: AgentStreamPanelProps): JSX.Element {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'live' | 'error' | 'ended'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinnedBottomRef = useRef<boolean>(true);
  const esRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef<number>(0);

  // Track whether the user is scrolled away from the bottom; if so,
  // don't yank them back when new events arrive.
  const onScroll = (): void => {
    const el = bodyRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedBottomRef.current = distance < 24;
  };

  useEffect(() => {
    if (!sessionId) return undefined;

    let cancelled = false;
    setStatus('loading');
    setErrorMsg(null);

    // 1) Hydrate with the buffered snapshot so the UI is non-empty while
    //    the SSE connection negotiates.
    (async () => {
      try {
        const r = await fetchJson<{ events?: StreamEvent[] }>(
          `/api/agent-stream/recent?sessionId=${encodeURIComponent(sessionId)}&limit=100`,
        );
        if (cancelled) return;
        setEvents(Array.isArray(r.events) ? r.events : []);
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof FetchError ? err.message : (err as Error).message);
      }
    })();

    // 2) Open SSE stream. Auto-reconnect with backoff on disconnect.
    const openStream = (): void => {
      if (cancelled) return;
      const es = new EventSource(`/api/agent-stream/live?sessionId=${encodeURIComponent(sessionId)}`);
      esRef.current = es;

      es.addEventListener('snapshot', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as { events: StreamEvent[] };
          setEvents((prev) => mergeEvents(prev, data.events ?? [], maxEvents));
        } catch { /* ignore */ }
      });
      es.addEventListener('append', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as { events: StreamEvent[] };
          setEvents((prev) => mergeEvents(prev, data.events ?? [], maxEvents));
        } catch { /* ignore */ }
      });
      es.addEventListener('agent', () => {
        setStatus('live');
        reconnectAttemptRef.current = 0;
      });
      es.addEventListener('end', () => {
        setStatus('ended');
        es.close();
      });
      es.addEventListener('error', (e) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg((e as MessageEvent).data || 'stream error');
        es.close();
        const delay = Math.min(15_000, 500 * 2 ** reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        setTimeout(() => { if (!cancelled) openStream(); }, delay);
      });
    };

    openStream();

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [sessionId, maxEvents]);

  // Auto-scroll on new events if the user is pinned to the bottom.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (pinnedBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events.length]);

  const refresh = (): void => {
    setEvents([]);
    setStatus('loading');
    setErrorMsg(null);
    esRef.current?.close();
    reconnectAttemptRef.current = 0;
    // The effect dependency array won't pick this up; force re-mount via key
    // would be heavier. The open call inside the effect's reconnect handles it.
    const es = new EventSource(`/api/agent-stream/live?sessionId=${encodeURIComponent(sessionId)}`);
    esRef.current = es;
    es.addEventListener('snapshot', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { events: StreamEvent[] };
        setEvents((prev) => mergeEvents(prev, data.events ?? [], maxEvents));
      } catch { /* ignore */ }
    });
    es.addEventListener('append', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { events: StreamEvent[] };
        setEvents((prev) => mergeEvents(prev, data.events ?? [], maxEvents));
      } catch { /* ignore */ }
    });
    es.addEventListener('agent', () => setStatus('live'));
    es.addEventListener('error', () => setStatus('error'));
  };

  return (
    <Box
      className={cx('v8-agent-stream', className)}
      style={{
        background: 'var(--surface-0)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: density === 'compact' ? 220 : 360,
      }}
    >
      <Inline
        align="center"
        justify="between"
        style={{
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-1)',
          fontSize: 'var(--fs-12)',
          color: 'var(--fg-muted)',
        }}
      >
        <Inline align="center" gap={2}>
          <Terminal size={12} aria-hidden />
          <span style={{ fontFamily: 'var(--font-mono)' }}>{sessionId.slice(0, 12)}…</span>
          <StatusPill status={status} />
        </Inline>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh stream"
          title="Refresh"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={12} aria-hidden />
        </button>
      </Inline>
      <div
        ref={bodyRef}
        onScroll={onScroll}
        className="v8-agent-stream__body"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 'var(--space-2)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-12)',
          lineHeight: 'var(--lh-snug)',
        }}
      >
        {events.length === 0 && status === 'loading' && (
          <Inline align="center" gap={2} style={{ color: 'var(--fg-muted)', padding: 'var(--space-2)' }}>
            <Loader2 size={12} aria-hidden /> Loading stream…
          </Inline>
        )}
        {events.length === 0 && status !== 'loading' && (
          <Box style={{ padding: 'var(--space-3)', color: 'var(--fg-muted)' }}>
            No events yet for this session.
          </Box>
        )}
        {errorMsg !== null && (
          <Inline align="center" gap={2} style={{ color: 'var(--warning)', padding: 'var(--space-2)' }}>
            <AlertTriangle size={12} aria-hidden /> {errorMsg}
          </Inline>
        )}
        {events.map((ev, i) => (
          <StreamEventRow key={`${ev.ts}-${i}`} event={ev} density={density} />
        ))}
      </div>
    </Box>
  );
}

function StatusPill({ status }: { status: 'idle' | 'loading' | 'live' | 'error' | 'ended' }): JSX.Element {
  const cfg = {
    idle: { label: 'idle', tone: 'var(--fg-subtle)' },
    loading: { label: 'connecting', tone: 'var(--info)' },
    live: { label: 'live', tone: 'var(--success)' },
    error: { label: 'reconnecting', tone: 'var(--warning)' },
    ended: { label: 'ended', tone: 'var(--fg-muted)' },
  }[status];
  return (
    <Inline align="center" gap={2} style={{ color: cfg.tone }}>
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 'var(--radius-pill)',
          background: cfg.tone,
          boxShadow: status === 'live' ? `0 0 0 0 ${cfg.tone}` : 'none',
          animation: status === 'live' ? 'v8-pulse 1.5s ease-out infinite' : 'none',
        }}
      />
      {cfg.label}
    </Inline>
  );
}

function StreamEventRow({
  event,
  density,
}: {
  event: StreamEvent;
  density: 'compact' | 'detailed';
}): JSX.Element {
  const roleColor = ROLE_TONE[event.role ?? 'system'] ?? 'var(--fg-muted)';
  const ts = timeShort(event.ts);
  if (event.kind === 'tool') {
    return (
      <Box style={{ padding: '4px 8px', borderLeft: `2px solid ${roleColor}` }}>
        <Inline align="center" gap={2}>
          <span style={{ color: 'var(--fg-subtle)' }}>{ts}</span>
          <span style={{ color: roleColor, fontWeight: 600 }}>tool</span>
          <span style={{ color: 'var(--accent)' }}>{event.toolName}</span>
        </Inline>
        {density === 'detailed' && event.toolInput && (
          <Box style={{ color: 'var(--fg-muted)', marginTop: 2, paddingLeft: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {truncate(event.toolInput, 400)}
          </Box>
        )}
      </Box>
    );
  }
  if (event.kind === 'tool-result') {
    return (
      <Box style={{ padding: '4px 8px', borderLeft: `2px solid ${event.isError ? 'var(--danger)' : 'var(--success)'}` }}>
        <Inline align="center" gap={2}>
          <span style={{ color: 'var(--fg-subtle)' }}>{ts}</span>
          <span style={{ color: event.isError ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
            {event.isError ? 'tool-error' : 'result'}
          </span>
        </Inline>
        {density === 'detailed' && event.content && (
          <Box style={{ color: 'var(--fg-muted)', marginTop: 2, paddingLeft: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {truncate(event.content, 400)}
          </Box>
        )}
      </Box>
    );
  }
  if (event.kind === 'system') {
    return (
      <Box style={{ padding: '4px 8px', borderLeft: '2px solid var(--warning)' }}>
        <Inline align="center" gap={2}>
          <span style={{ color: 'var(--fg-subtle)' }}>{ts}</span>
          <span style={{ color: 'var(--warning)', fontWeight: 600 }}>system</span>
        </Inline>
        {event.content && (
          <Box style={{ color: 'var(--fg-muted)', marginTop: 2, paddingLeft: 12, whiteSpace: 'pre-wrap' }}>
            {truncate(event.content, 200)}
          </Box>
        )}
      </Box>
    );
  }
  return (
    <Box style={{ padding: '4px 8px', borderLeft: `2px solid ${roleColor}` }}>
      <Inline align="center" gap={2}>
        <span style={{ color: 'var(--fg-subtle)' }}>{ts}</span>
        <span style={{ color: roleColor, fontWeight: 600 }}>{event.role ?? 'msg'}</span>
      </Inline>
      {event.content && (
        <Box style={{ color: 'var(--fg)', marginTop: 2, paddingLeft: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {truncate(event.content, 800)}
        </Box>
      )}
    </Box>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function mergeEvents(prev: StreamEvent[], next: StreamEvent[], max: number): StreamEvent[] {
  if (next.length === 0) return prev;
  const out = prev.concat(next);
  if (out.length <= max) return out;
  return out.slice(out.length - max);
}