// src/components/chat/AgentNode.tsx — single card in the agent orchestration tree.
//
// Two modes:
//   collapsible=true  — header is a button with a chevron; toggles its
//                       own summary + children visibility.
//   collapsible=false — header is a static div (no chevron / no toggle).
//                       Children render if present but cannot be
//                       collapsed by the user.
//
// FIX #1 (session-collapsed-by-default) is handled at the *parent*
// (SubAgentList / AgentTree) which decides whether to mount this
// node's children at all. This component is purely presentational.

import { useState } from 'react';

export type AgentStatus = 'idle' | 'streaming' | 'done' | 'blocked' | 'awaiting';

export interface AgentTreeNode {
  id: string;
  name: string;
  role?: string;
  status: AgentStatus;
  summary?: string;
  children?: AgentTreeNode[];
}

interface Props {
  node: AgentTreeNode;
  depth?: number;
  collapsible?: boolean;
  isLast?: boolean;
  /** Controlled open state — used by SubAgentList so the parent rail
   *  row's tree-chevron is the single source of truth for collapse. */
  open?: boolean;
  onToggle?: (next: boolean) => void;
}

export function AgentNode({
  node,
  depth = 0,
  collapsible = false,
  isLast = true,
  open: controlledOpen,
  onToggle,
}: Props) {
  const [internalOpen, setInternalOpen] = useState<boolean>(collapsible);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onToggle?.(next);
  };

  const hasChildren = (node.children?.length ?? 0) > 0;

  const headContent = (
    <>
      {collapsible && (
        <span
          className={`agent-node-chevron ${open ? 'open' : ''}`}
          aria-hidden
        >
          ›
        </span>
      )}
      <span
        className={`agent-node-dot status-${node.status}`}
        aria-hidden
      />
      <span className="agent-node-name">{node.name}</span>
      {node.role && <span className="agent-node-role chat-mono">{node.role}</span>}
      <span className={`agent-node-pill status-${node.status}`}>{node.status}</span>
    </>
  );

  return (
    <div
      className={[
        'agent-node',
        `depth-${depth}`,
        `status-${node.status}`,
        open ? 'open' : 'closed',
        isLast ? 'last' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {collapsible ? (
        <button
          type="button"
          className={`agent-node-head status-${node.status} collapsible`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          aria-expanded={open}
        >
          {headContent}
        </button>
      ) : (
        <div className={`agent-node-head status-${node.status}`}>
          {headContent}
        </div>
      )}
      {open && (
        <>
          {node.summary && (
            <div className="agent-node-summary">{node.summary}</div>
          )}
          {hasChildren && (
            <div className="agent-node-children">
              {node.children!.map((child, i) => (
                <AgentNode
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  collapsible={false}
                  isLast={i === node.children!.length - 1}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}