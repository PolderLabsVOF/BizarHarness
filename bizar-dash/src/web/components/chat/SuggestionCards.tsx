// src/components/chat/SuggestionCards.tsx — 4 hardcoded suggestion cards for first-run.

import { Code, BookOpen, Lightbulb, Image as ImageIcon } from 'lucide-react';

interface Props {
  projectName: string;
  onPickSuggestion: (text: string) => void;
}

export function SuggestionCards({ projectName, onPickSuggestion }: Props) {
  const suggestions = [
    {
      icon: <Code size={16} />,
      title: projectName ? `Explain ${projectName}` : 'Explain this project',
      preview: 'Give me a tour of the codebase, highlight the architecture, and call out any anti-patterns or hotspots.',
      prompt: projectName
        ? `Explain the ${projectName} project. Give me a tour of the codebase, highlight the architecture, and call out any anti-patterns or hotspots.`
        : 'Explain the current project. Give me a tour of the codebase, highlight the architecture, and call out any anti-patterns or hotspots.',
    },
    {
      icon: <BookOpen size={16} />,
      title: 'Summarize recent sessions',
      preview: 'Read my last 5 chat sessions and give me a 3-bullet summary of what I worked on and what got stuck.',
      prompt: 'Read my last 5 chat sessions and give me a 3-bullet summary of what I worked on and what got stuck.',
    },
    {
      icon: <Lightbulb size={16} />,
      title: 'Suggest a refactor',
      preview: 'Look for the largest, most painful files in this project and propose a concrete refactor for the worst one.',
      prompt: 'Look for the largest, most painful files in this project and propose a concrete refactor for the worst one.',
    },
    {
      icon: <ImageIcon size={16} />,
      title: 'Find visual regressions',
      preview: 'Open the dashboard, screenshot the Chat tab, and flag any layout problems or anti-patterns you see.',
      prompt: 'Open the dashboard, screenshot the Chat tab, and flag any layout problems or anti-patterns you see.',
    },
  ];

  return (
    <div className="chat-suggestions">
      {suggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          className="chat-suggestion"
          onClick={() => onPickSuggestion(s.prompt)}
        >
          <div className="chat-suggestion-title">{s.icon}<span>{s.title}</span></div>
          <div className="chat-suggestion-preview">{s.preview}</div>
        </button>
      ))}
    </div>
  );
}