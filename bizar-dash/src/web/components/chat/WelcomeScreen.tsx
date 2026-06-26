// src/components/chat/WelcomeScreen.tsx — gradient greeting + no-project state.

import { Folder } from 'lucide-react';
import { SuggestionCards } from './SuggestionCards';

interface Props {
  variant: 'empty' | 'no-project';
  projectName: string;
  onPickSuggestion: (text: string) => void;
}

export function WelcomeScreen({ variant, projectName, onPickSuggestion }: Props) {
  if (variant === 'no-project') {
    return (
      <div className="chat-welcome">
        <h1 className="chat-welcome-h1">
          <span className="chat-greeting-hello">No project selected.</span>
        </h1>
        <p className="chat-welcome-subtitle">Pick a project in Overview to scope chat sessions.</p>
      </div>
    );
  }

  const displayName = projectName || 'there';

  return (
    <div className="chat-welcome">
      <h1 className="chat-welcome-h1">
        <span className="chat-greeting-hello">Hello, </span>
        <span className="chat-greeting-name">{displayName}.</span>
      </h1>
      <p className="chat-welcome-subtitle">How can I help you today?</p>
      <SuggestionCards projectName={projectName} onPickSuggestion={onPickSuggestion} />
    </div>
  );
}