// src/components/chat/index.ts — barrel export for all chat components and hooks.

export { ChatTopBar } from './ChatTopBar';
export { ChatThread } from './ChatThread';
export { MessageBubble } from './MessageBubble';
export { WelcomeScreen } from './WelcomeScreen';
export { SuggestionCards } from './SuggestionCards';
export { Composer } from './Composer';
export { FloatingComposer } from './FloatingComposer';
export { AgentChip } from './AgentChip';
export { SessionList } from './SessionList';
export { InfoPanel } from './InfoPanel';
export { LoadingSkeleton } from './LoadingSkeleton';
export { StreamingIndicator } from './StreamingIndicator';
export { ConfirmModal } from './ConfirmModal';
export { EmptyState } from './EmptyState';
export { useChat } from './useChat';
export { useSlashCommands } from './useSlashCommands';
export { useAutoGrowTextarea } from './useAutoGrowTextarea';
export type { SlashCommand } from './useSlashCommands';