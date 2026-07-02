// src/components/chat/_legacy.ts — backward-compatibility shim.
//
// MobileChat.tsx (mobile view) and any other consumer that imports the
// original names (`SessionList`, `InfoPanel`, `FloatingComposer`)
// continues to work even after the v3.22 redesign renamed these
// components. Each renamed component keeps its NEW default export in
// the new file; this module re-exports them under the OLD names.
//
// Notes for future maintainers:
// - `ChatTopBar`, `ChatThread`, `useChat`, `useSlashCommands` keep
//   their original filenames + exports; nothing to shim here.
// - `SessionList`   → ChatRail
// - `InfoPanel`     → ChatInfoPanel
// - `FloatingComposer` → ChatComposer
// - `MessageBubble` / `StreamingIndicator` / `AgentChip` / `WelcomeScreen`
//   / `SuggestionCards` / `Composer` / `FirstRunGreeting` / `ConfirmModal`
//   / `EmptyState` / `LoadingSkeleton` / `useAutoGrowTextarea` are
//   unchanged and continue to be exported from `index.ts`.

export { ChatRail as SessionList } from './ChatRail';
export { ChatInfoPanel as InfoPanel } from './ChatInfoPanel';
export { ChatComposer as FloatingComposer } from './ChatComposer';

// Re-export the unchanged pieces too so this file is a single drop-in
// for any consumer that wants to keep using old names in one place.
export { ChatTopBar } from './ChatTopBar';
export { ChatThread } from './ChatThread';
export { useChat } from './useChat';
export { useSlashCommands } from './useSlashCommands';
export type { SlashCommand } from './useSlashCommands';