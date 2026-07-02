// src/components/chat/AgentTree.tsx — vertical chain of session cards connected by
// backbone+L-stub connectors. Two modes:
//
//   full tree (variant="full") — renders the root card and all its children.
//     Used inside the thread head when the active session has sub-agents.
//
//   children-only (variant="rail" via SubAgentList) — renders only the children
//     of the root; the rail row above already shows the root card, so
//     re-rendering it would duplicate. Children hang directly off the
//     rail row via standard backbone + L-stub connectors.
//
// FIX #1 — the parent (ChatRail) passes `open=false` by default for a
// freshly-clicked session so the tree is collapsed on first click; the
// user can open it via the chevron in the row.

import { Fragment } from 'react';
import { AgentNode, type AgentTreeNode } from './AgentNode';

interface FullTreeProps {
  tree: { root: AgentTreeNode };
  variant?: 'full';
  open?: boolean;
}

interface ChildrenOnlyProps {
  children: AgentTreeNode[];
  variant: 'rail' | 'thread';
  open?: boolean;
}

function isFullTree(props: FullTreeProps | ChildrenOnlyProps): props is FullTreeProps {
  return (props as FullTreeProps).tree !== undefined;
}

export function AgentTree(props: FullTreeProps | ChildrenOnlyProps) {
  const open = props.open ?? true;

  if (isFullTree(props)) {
    return (
      <div className={`agent-tree variant-${props.variant ?? 'full'}`}>
        <AgentNode node={props.tree.root} depth={0} open={open} />
      </div>
    );
  }

  // Children-only path (used by SubAgentList hanging off the rail row).
  const list = props.children ?? [];
  return (
    <div className={`agent-tree variant-${props.variant} agent-tree-children-only`}>
      <div className="agent-tree-children-body">
        {list.map((child, i) => (
          <Fragment key={child.id}>
            <AgentNode
              node={child}
              depth={0}
              collapsible={false}
              open={open}
              isLast={i === list.length - 1}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/* ── SubAgentList — convenience wrapper used by the ChatRail to render
   the children of a session's tree directly under the active row. ── */
export function SubAgentList({
  children,
  variant = 'rail',
  open = true,
}: {
  children: AgentTreeNode[];
  variant?: 'rail' | 'thread';
  open?: boolean;
}) {
  if (!open) return null;
  return <AgentTree variant={variant} open={open} children={children} />;
}