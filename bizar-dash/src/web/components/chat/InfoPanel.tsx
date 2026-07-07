// src/components/chat/InfoPanel.tsx — mobile-compact info sidebar.
//
// v4.2.5 — overhauled: shows activeSource badge, message count,
// session metadata, model/provider, and rename/delete actions for
// the active session.

import { useState } from 'react';
import {
  MessageSquare,
  Bot,
  Server,
  Terminal,
  ChevronDown,
  Trash2,
  Pencil,
} from 'lucide-react';

interface Props {
  sessionId: string;
  messages: Array<unknown>;
  pinned: Set<number>;
  agent: string;
  model: string;
  agents: Array<{ name: string; model?: string; mode?: string }>;
  mcps: Array<{ id: string; command?: string; enabled?: boolean }>;
  allCommands: Array<{ cmd: string; desc: string; mod?: string }>;
  activeSource?: 'bizar' | 'cline' | null;
  /** Optional rename handler — when omitted the rename button is hidden. */
  onRename?: () => void;
  /** Optional delete handler — when omitted the delete button is hidden. */
  onDelete?: () => void;
}

export function InfoPanel({
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
}: Props) {
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [showCommands, setShowCommands] = useState(false);

  const visibleAgents = showAllAgents ? agents : agents.slice(0, 4);
  const visibleCommands = showCommands ? allCommands : allCommands.slice(0, 4);

  // Derive a friendly provider from the model id (e.g.
  // "cline/deepseek-v4-flash-free" → provider "cline").
  const provider = model.includes('/') ? model.split('/')[0] : '';

  return (
    <div className="chat-info">
      <div className="chat-info-card">
        <div className="chat-info-card-title">
          <MessageSquare size={14} /> Session
          <span
            className={`chat-source-badge chat-source-${activeSource ?? 'none'}`}
            style={{ marginLeft: 'auto' }}
          >
            {activeSource === 'cline' ? 'cline' : 'bizar chat'}
          </span>
        </div>
        <dl className="env-table">
          <dt>id</dt>
          <dd className="mono">{sessionId || 'Live'}</dd>
          <dt>Messages</dt>
          <dd className="mono">{messages.length}</dd>
          <dt>Pinned</dt>
          <dd className="mono">{pinned.size}</dd>
          <dt>Agent</dt>
          <dd className="mono">{agent || '—'}</dd>
          <dt>Model</dt>
          <dd className="mono ellipsis" title={model}>
            {model || '—'}
          </dd>
          {provider && (
            <>
              <dt>Provider</dt>
              <dd className="mono">{provider}</dd>
            </>
          )}
        </dl>
        {(onRename || onDelete) && (
          <div className="chat-info-actions">
            {onRename && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onRename}
              >
                <Pencil size={12} aria-hidden /> Rename
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="btn btn-ghost btn-danger btn-sm"
                onClick={onDelete}
              >
                <Trash2 size={12} aria-hidden /> Delete
              </button>
            )}
          </div>
        )}
      </div>

      <div className="chat-info-card">
        <div className="chat-info-card-title">
          <Bot size={14} /> Agents
          <span className="chat-info-card-count">{agents.length}</span>
        </div>
        <ul className="mod-mini-list">
          {visibleAgents.map((a) => (
            <li key={a.name} className="mod-mini">
              <span className="mod-mini-name">@{a.name}</span>
              <span className="mod-mini-meta">{a.model || a.mode || ''}</span>
            </li>
          ))}
        </ul>
        {agents.length > 4 && (
          <button
            type="button"
            className="chat-info-card-toggle"
            onClick={() => setShowAllAgents((v) => !v)}
          >
            {showAllAgents ? '− Show fewer' : `+ ${agents.length - 4} more`}
          </button>
        )}
      </div>

      <div className="chat-info-card">
        <div className="chat-info-card-title">
          <Server size={14} /> MCPs
          <span className="chat-info-card-count">{mcps.length}</span>
        </div>
        <ul className="mod-mini-list">
          {mcps.length === 0 ? (
            <li className="muted">No MCPs configured.</li>
          ) : null}
          {mcps.map((m) => (
            <li key={m.id} className="mod-mini">
              <span className="mod-mini-name">{m.id}</span>
              <span className={`mod-mini-pill ${m.enabled ? 'on' : 'off'}`}>
                {m.enabled ? 'on' : 'off'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="chat-info-card">
        <button
          type="button"
          className="chat-info-card-title chat-info-card-title-button"
          onClick={() => setShowCommands((v) => !v)}
          aria-expanded={showCommands}
        >
          <Terminal size={14} /> Slash commands
          <span className="chat-info-card-count">{allCommands.length}</span>
          <ChevronDown
            size={12}
            className={`chat-info-card-chevron ${showCommands ? 'open' : ''}`}
          />
        </button>
        {showCommands && (
          <ul className="mod-mini-list">
            {visibleCommands.map((c) => (
              <li key={c.cmd}>
                <code>{c.cmd}</code>
                <span className="muted">{c.desc}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
