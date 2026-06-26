// src/components/chat/EmptyState.tsx — chat-local empty state (variant of shared EmptyState).

import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  message: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, message, action }: Props) {
  return (
    <div className="chat-empty-state">
      {icon && <div className="chat-empty-state-icon">{icon}</div>}
      <h2 className="chat-empty-state-title">{title}</h2>
      <p className="chat-empty-state-message">{message}</p>
      {action && <div className="chat-empty-state-action">{action}</div>}
    </div>
  );
}