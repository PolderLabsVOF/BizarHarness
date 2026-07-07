// src/components/chat/ChatInfoPanel.tsx — right info panel (v4.2.5).
//
// v4.2.5 — overhauled: shows session metadata (id, agent, model,
// provider, message count), the current `activeSource`, the model
// in use, a section for usage/cost placeholders (filled in by the
// MiniMax usage module when present), and rename / delete / export
// actions wired to the parent.
//
// v5.0.0 — bug #4 fix: the panel now renders a structured error
// section when the cline session load fails. The chat-thread
// header (rendered by Chat.tsx) also shows the error inline; the
// info-panel error makes it impossible to miss when the right
// sidebar is in view, and exposes the server's `suggestion` and a
// Retry button so the operator can act without scrolling.

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  MessageSquare,
  Bot,
  Server,
  Terminal,
  Pencil,
  Trash2,
  Download,
  CircleDollarSign,
  RotateCw,
} from 'lucide-react';
import type { ChatMessage } from '../../lib/types';

interface Props {
  sessionId: string;
  messages: ChatMessage[];
  pinned: Set<number>;
  agent: string;
  model: string;
  agents: Array<{ name: string; model?: string; mode?: string }>;
  mcps: Array<{ id: string; command?: string; enabled?: boolean }>;
  allCommands: Array<{ cmd: string; desc: string; mod?: string }>;
  /** Which stream is currently displayed. */
  activeSource?: 'bizar' | 'cline' | null;
  /** Optional rename/delete/export handlers wired by Chat.tsx. */
  onRename?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  /** Per-action busy flags — disable buttons while pending. */
  busy?: { rename?: boolean; delete?: boolean };
  /**
   * v5.0.0 — bug #4: structured error envelope from `loadClineSession`.
   * When present, the panel renders an error section above the Session
   * section so the operator can see what went wrong without scrolling.
   */
  error?: {
    code: string;
    message: string;
    suggestion?: string | null;
    canRetry?: boolean;
  } | null;
  /**
   * v5.0.0 — bug #4: retry handler invoked when the operator clicks
   * the Retry button on the error section. Wired to
   * `chat.retryClineSession` by Chat.tsx.
   */
  onRetry?: () => void;
}

interface UsageRow {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

/** Map a model id like "cline/deepseek-v4-flash-free" → "cline". */
function providerFromModel(model: string): string {
  if (!model) return '';
  if (!model.includes('/')) return '';
  return model.split('/')[0];
}

/** Map a model id to a cost (USD/M-token) — placeholder rates; the
 *  MiniMax usage module supplies real numbers where available.  */
function approxCostPer1M(model: string): number {
  if (!model) return 0;
  const m = model.toLowerCase();
  if (m.includes('opus')) return 15;
  if (m.includes('sonnet')) return 3;
  if (m.includes('haiku')) return 0.8;
  if (m.includes('gpt-4o')) return 5;
  if (m.includes('gpt-4')) return 10;
  if (m.includes('deepseek')) return 0.27;
  if (m.includes('minimax')) return 0.3;
  if (m.includes('llama-3.3-70b')) return 0.59;
  return 1;
}

export function ChatInfoPanel({
  sessionId,
  messages,
  pinned,
  agent,
  model,
  agents,
  mcps,
  allCommands,
  activeSource = 'bizar',
  onRename,
  onDelete,
  onExport,
  busy,
  error,
  onRetry,
}: Props) {
  // Best-effort: pull usage summary from the MiniMax usage endpoint
  // when the session is cline. Falls back silently if the module
  // isn't installed yet.
  const [usage, setUsage] = useState<UsageRow | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/usage?range=24h', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const body = (await res.json()) as UsageRow;
        if (!cancelled) setUsage(body);
      } catch {
        /* ignore — usage is non-essential */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const msgCount = messages?.length ?? 0;
  const pinnedCount = pinned?.size ?? 0;

  // Estimate tokens / cost from message length when no real usage
  // data is available. Real numbers come from the MiniMax module.
  const totalChars = messages.reduce(
    (n, m) => n + ((m.content || m.message || '') as string).length,
    0,
  );
  const approxTokens = Math.round(totalChars / 4);
  const rate = approxCostPer1M(model);
  const approxCostUsd = (approxTokens / 1_000_000) * rate;
  const tokensUsed = usage?.totalTokens ?? approxTokens;
  const costUsd = usage?.costUsd ?? approxCostUsd;
  const tokensTotal = 128_000;
  const provider = providerFromModel(model);

  return (
    <aside className="chat-info">
      {error && (
        <div
          className="chat-info-section chat-info-error"
          role="alert"
          aria-live="polite"
        >
          <h4>
            <AlertTriangle
              size={11}
              style={{ marginRight: 4, verticalAlign: -1 }}
              aria-hidden
            />{' '}
            Couldn't load session
          </h4>
          <p className="chat-info-value chat-ellipsis" title={error.message}>
            {error.message}
          </p>
          <div className="chat-info-mono">
            code · {error.code}
          </div>
          {error.suggestion ? (
            <p className="chat-info-suggestion">{error.suggestion}</p>
          ) : null}
          {error.canRetry !== false && onRetry ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm chat-info-retry"
              onClick={onRetry}
              title="Retry loading the session"
            >
              <RotateCw size={12} aria-hidden /> Retry
            </button>
          ) : null}
        </div>
      )}

      <div className="chat-info-section">
        <div className="chat-info-section-head">
          <h4>
            <MessageSquare
              size={11}
              style={{ marginRight: 4, verticalAlign: -1 }}
              aria-hidden
            />{' '}
            Session
          </h4>
          <span
            className={`chat-source-badge chat-source-${activeSource ?? 'none'}`}
            style={{ marginLeft: 'auto' }}
          >
            {activeSource === 'cline' ? 'cline' : 'bizar chat'}
          </span>
        </div>
        <div className="chat-info-mono chat-ellipsis" title={sessionId}>
          {sessionId || 'Live'}
        </div>
        <div className="chat-info-mono">
          {formatNumber(msgCount)} message{msgCount === 1 ? '' : 's'}
          {pinnedCount > 0 && ` · ${pinnedCount} pinned`}
        </div>
      </div>

      <div className="chat-info-section">
        <h4>
          <Bot size={11} style={{ marginRight: 4, verticalAlign: -1 }} aria-hidden />{' '}
          Agent
        </h4>
        <div className="chat-info-value">{agent || '—'}</div>
      </div>

      <div className="chat-info-section">
        <h4>
          <Server size={11} style={{ marginRight: 4, verticalAlign: -1 }} aria-hidden />{' '}
          Model
        </h4>
        <div className="chat-mono chat-ellipsis" title={model}>
          {model || '—'}
        </div>
        {provider && (
          <div className="chat-info-mono">provider · {provider}</div>
        )}
      </div>

      <div className="chat-info-section">
        <h4>Tokens</h4>
        <div className="chat-mono">
          {formatNumber(tokensUsed)} / {formatNumber(tokensTotal)}
        </div>
        <div className="chat-info-bar" aria-hidden>
          <div
            className="chat-info-bar-fill"
            style={{
              width: `${Math.min(100, (tokensUsed / Math.max(1, tokensTotal)) * 100)}%`,
            }}
          />
        </div>
      </div>

      <div className="chat-info-section">
        <h4>
          <CircleDollarSign
            size={11}
            style={{ marginRight: 4, verticalAlign: -1 }}
            aria-hidden
          />{' '}
          Cost
        </h4>
        <div className="chat-mono">${costUsd.toFixed(4)}</div>
        {!usage && (
          <div className="chat-info-mono">approx · live from MiniMax</div>
        )}
      </div>

      <div className="chat-info-section">
        <h4>
          <Bot
            size={11}
            style={{ marginRight: 4, verticalAlign: -1 }}
            aria-hidden
          />{' '}
          Attached agents
        </h4>
        {agents?.length ? (
          <div className="chat-info-agents">
            {agents.map((a) => (
              <span key={a.name} className="chat-info-agent">
                {a.name}
              </span>
            ))}
          </div>
        ) : (
          <div className="chat-info-mono">None attached</div>
        )}
      </div>

      <div className="chat-info-section">
        <h4>
          <Server
            size={11}
            style={{ marginRight: 4, verticalAlign: -1 }}
            aria-hidden
          />{' '}
          MCPs
        </h4>
        {mcps?.length ? (
          <div className="chat-info-agents">
            {mcps.map((m) => (
              <span key={m.id} className="chat-info-agent">
                {m.id}
              </span>
            ))}
          </div>
        ) : (
          <div className="chat-info-mono">No MCPs configured</div>
        )}
      </div>

      <div className="chat-info-section">
        <h4>
          <Terminal
            size={11}
            style={{ marginRight: 4, verticalAlign: -1 }}
            aria-hidden
          />{' '}
          Slash commands
        </h4>
        <div className="chat-info-mono">{allCommands?.length ?? 0} available</div>
      </div>

      {(onRename || onDelete || onExport) && (
        <div className="chat-info-section">
          <h4>Actions</h4>
          <div className="chat-info-actions">
            {onRename && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onRename}
                disabled={busy?.rename}
                title="Rename session"
              >
                <Pencil size={12} aria-hidden /> Rename
              </button>
            )}
            {onExport && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onExport}
                title="Export transcript"
              >
                <Download size={12} aria-hidden /> Export
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                onClick={onDelete}
                disabled={busy?.delete}
                title="Delete session"
              >
                <Trash2 size={12} aria-hidden /> Delete
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
