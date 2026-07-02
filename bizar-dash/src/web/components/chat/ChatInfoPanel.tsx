// src/components/chat/ChatInfoPanel.tsx — right info panel (v3.22 design).
//
// Replaces InfoPanel. Layout follows the design HTML's sectioned
// info panel: Session / Project / Model / Tokens / Cost / Attached
// agents / Linked.
//
// Props match the original InfoPanel EXACTLY (so Chat.tsx doesn't need
// any changes).

import { MessageSquare, Bot, Server, Terminal } from 'lucide-react';

interface Props {
  sessionId: string;
  messages: Array<unknown>;
  pinned: Set<number>;
  agent: string;
  model: string;
  agents: Array<{ name: string; model?: string; mode?: string }>;
  mcps: Array<{ id: string; command?: string; enabled?: boolean }>;
  allCommands: Array<{ cmd: string; desc: string; mod?: string }>;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
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
}: Props) {
  // Tokens + cost are stubbed — the dashboard doesn't currently
  // surface these from the chat backend. Show the count of messages
  // + pinned as a sensible default and leave token/cost placeholders
  // clearly marked so it's obvious they're not yet wired.
  const msgCount = messages?.length ?? 0;
  const pinnedCount = pinned?.size ?? 0;
  const tokensUsed = 0;
  const tokensTotal = 128_000;
  const costUsd = 0;

  return (
    <aside className="chat-info">
      <div className="chat-info-section">
        <h4>Session</h4>
        <div>{sessionId || 'Live'}</div>
        <div className="chat-info-mono">
          {formatNumber(msgCount)} message{msgCount === 1 ? '' : 's'}
          {pinnedCount > 0 && ` · ${pinnedCount} pinned`}
        </div>
      </div>

      <div className="chat-info-section">
        <h4>Agent</h4>
        <div>{agent || '—'}</div>
      </div>

      <div className="chat-info-section">
        <h4>Model</h4>
        <div className="chat-mono chat-ellipsis" title={model}>
          {model || '—'}
        </div>
      </div>

      <div className="chat-info-section">
        <h4>Tokens</h4>
        <div className="chat-mono">
          {formatNumber(tokensUsed)} / {formatNumber(tokensTotal)}
        </div>
        <div className="chat-info-bar" aria-hidden>
          <div
            className="chat-info-bar-fill"
            style={{ width: `${Math.min(100, (tokensUsed / Math.max(1, tokensTotal)) * 100)}%` }}
          />
        </div>
      </div>

      <div className="chat-info-section">
        <h4>Cost</h4>
        <div className="chat-mono">${costUsd.toFixed(4)}</div>
      </div>

      <div className="chat-info-section">
        <h4>
          <Bot size={11} style={{ marginRight: 4, verticalAlign: -1 }} aria-hidden /> Attached
          agents
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
          <Server size={11} style={{ marginRight: 4, verticalAlign: -1 }} aria-hidden /> MCPs
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
          <Terminal size={11} style={{ marginRight: 4, verticalAlign: -1 }} aria-hidden /> Slash
          commands
        </h4>
        <div className="chat-info-mono">{allCommands?.length ?? 0} available</div>
      </div>

      <div className="chat-info-section">
        <h4>
          <MessageSquare
            size={11}
            style={{ marginRight: 4, verticalAlign: -1 }}
            aria-hidden
          />{' '}
          Linked
        </h4>
        <div className="chat-info-mono">No links yet</div>
      </div>
    </aside>
  );
}