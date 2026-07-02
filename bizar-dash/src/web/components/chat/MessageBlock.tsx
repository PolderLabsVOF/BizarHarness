// src/components/chat/MessageBlock.tsx — single chat bubble with hover actions
// + phased halo animation while streaming.
//
// Mirrors the design HTML's MessageBlock component (lines 2266–2390 of
// the source design). Each message has:
//   - avatar (initial letter + halo pulse for phase think/stream/commit)
//   - meta row (author + phase indicator + timestamp)
//   - bubble (user or assistant styling)
//   - hover action bar (copy / edit / regenerate / speak / thumbs-up / thumbs-down)
//
// Streaming flow (when `streaming: true` on the message):
//   think (0–900ms)   → dots, halo pulse phase=think
//   stream (900–5400ms) → cursor blinks, halo pulse phase=stream
//   commit (5400–5800ms) → green halo pulse, bubble flashes ring
//   idle (5800ms+)    → all animations stop, action bar fully visible

import { useEffect, useState } from 'react';
import {
  Copy,
  Edit,
  RefreshCw,
  Volume2,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { StreamingIndicator } from './StreamingIndicator';

export type StreamingPhase = 'idle' | 'think' | 'stream' | 'commit';

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageContentBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'code'; code: string }
  | { type: 'text'; text: string };

export interface MessageBlockProps {
  id?: string;
  role: MessageRole;
  content: MessageContentBlock[] | string;
  agent?: string;
  ts?: string;
  streaming?: boolean;
  feedback?: 'up' | 'down' | null;
  onCopy?: (text: string) => void;
  onEdit?: (msg: MessageBlockProps) => void;
  onRegenerate?: (msg: MessageBlockProps) => void;
  onSpeak?: (msg: MessageBlockProps) => void;
  onFeedback?: (msg: MessageBlockProps, value: 'up' | 'down' | null) => void;
  onReady?: (msg: MessageBlockProps) => void;
}

function getInitial(agent?: string): string {
  if (!agent) return 'A';
  return agent.replace(/^@/, '').charAt(0).toUpperCase();
}

function flattenText(content: MessageContentBlock[] | string): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) =>
      b.type === 'p' || b.type === 'text'
        ? b.text
        : b.type === 'ul'
          ? (b.items ?? []).join('\n')
          : b.type === 'code'
            ? b.code
            : '',
    )
    .join('\n\n');
}

export function MessageBlock(props: MessageBlockProps) {
  const {
    role,
    content,
    agent,
    ts,
    streaming = false,
    feedback: feedbackProp = null,
    onCopy,
    onEdit,
    onRegenerate,
    onSpeak,
    onFeedback,
    onReady,
  } = props;

  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(feedbackProp);
  const [phase, setPhase] = useState<StreamingPhase>(streaming ? 'think' : 'idle');

  useEffect(() => {
    if (!streaming) {
      setPhase('idle');
      return;
    }
    const timers = [
      window.setTimeout(() => setPhase('stream'), 900),
      window.setTimeout(() => setPhase('commit'), 5400),
      window.setTimeout(() => {
        setPhase('idle');
        onReady?.(props);
      }, 5800),
    ];
    return () => timers.forEach(window.clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  const handleCopy = () => {
    const text = flattenText(content);
    onCopy?.(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const handleFeedback = (kind: 'up' | 'down') => {
    const next = feedback === kind ? null : kind;
    setFeedback(next);
    onFeedback?.(props, next);
  };

  if (role === 'system') {
    return (
      <div className="msg msg-system">
        <span className="msg-system-dot" />
        <span>{typeof content === 'string' ? content : flattenText(content)}</span>
        {ts && <span className="msg-ts chat-muted">{ts}</span>}
      </div>
    );
  }

  const isStreaming = phase !== 'idle';
  const text = flattenText(content);

  if (role === 'user') {
    return (
      <div className="msg msg-user msg-enter">
        <div className="msg-bubble-user-wrap">
          <div className="msg-actions msg-actions-user">
            <button
              type="button"
              className="msg-action-btn"
              title="Copy"
              onClick={handleCopy}
            >
              <Copy size={13} aria-hidden />
              <span className="msg-action-label">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              className="msg-action-btn"
              title="Edit"
              onClick={() => onEdit?.(props)}
            >
              <Edit size={13} aria-hidden />
              <span className="msg-action-label">Edit</span>
            </button>
          </div>
          <div className="msg-bubble msg-bubble-user">{text}</div>
        </div>
        <div className="msg-avatar msg-avatar-user">U</div>
      </div>
    );
  }

  return (
    <div className={`msg msg-assistant msg-enter msg-phase-${phase}`}>
      <div className="msg-avatar msg-avatar-assistant">
        <span className="msg-avatar-letter">{getInitial(agent)}</span>
        {isStreaming && <span className={`msg-avatar-pulse phase-${phase}`} aria-hidden />}
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          {agent && <span className="msg-author">{agent}</span>}
          {isStreaming && <StreamingIndicator phase={phase} />}
          {ts && <span className="msg-ts chat-muted">{ts}</span>}
        </div>
        <div className="msg-bubble-wrap">
          <div className="msg-actions msg-actions-assistant">
            <button
              type="button"
              className="msg-action-btn"
              title="Copy"
              onClick={handleCopy}
            >
              <Copy size={13} aria-hidden />
              <span className="msg-action-label">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            {phase === 'idle' && (
              <button
                type="button"
                className="msg-action-btn"
                title="Regenerate"
                onClick={() => onRegenerate?.(props)}
              >
                <RefreshCw size={13} aria-hidden />
                <span className="msg-action-label">Regenerate</span>
              </button>
            )}
            <button
              type="button"
              className="msg-action-btn"
              title="Read aloud"
              onClick={() => onSpeak?.(props)}
            >
              <Volume2 size={13} aria-hidden />
              <span className="msg-action-label">Speak</span>
            </button>
            <div className="msg-action-sep" />
            <button
              type="button"
              className={`msg-action-btn msg-action-feedback${feedback === 'up' ? ' active' : ''}`}
              title="Helpful"
              onClick={() => handleFeedback('up')}
            >
              <ThumbsUp size={13} aria-hidden />
            </button>
            <button
              type="button"
              className={`msg-action-btn msg-action-feedback${feedback === 'down' ? ' active' : ''}`}
              title="Not helpful"
              onClick={() => handleFeedback('down')}
            >
              <ThumbsDown size={13} aria-hidden />
            </button>
          </div>
          <div className="msg-bubble msg-bubble-assistant">
            {typeof content === 'string'
              ? <p>{content}</p>
              : content.map((block, i) => {
                  if (block.type === 'p' || block.type === 'text') {
                    return <p key={i}>{block.text}</p>;
                  }
                  if (block.type === 'ul') {
                    return (
                      <ul key={i}>
                        {(block.items ?? []).map((it, j) => (
                          <li key={j}>{it}</li>
                        ))}
                      </ul>
                    );
                  }
                  if (block.type === 'code') {
                    return (
                      <pre key={i} className="msg-code">
                        <code>{block.code}</code>
                      </pre>
                    );
                  }
                  return null;
                })}
            {isStreaming && <span className="msg-cursor" aria-hidden />}
          </div>
        </div>
      </div>
    </div>
  );
}