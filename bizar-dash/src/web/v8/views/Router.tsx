import { useMemo } from 'react';
import { OverviewView } from './Overview/OverviewView.js';
import { TasksView } from './Tasks/TasksView.js';
import { GoalsView } from './Goals/GoalsView.js';
import { AgentsView } from './Agents/AgentsView.js';
import { ActivityView } from './Activity/ActivityView.js';
import { MemoryView } from './Memory/MemoryView.js';
import { LibrariesView } from './Libraries/LibrariesView.js';
import { SettingsView } from './Settings/SettingsView.js';
import type { LibraryItemProps } from '../ui/libraries/LibraryItem.js';

/**
 * Router — flat state-based view switcher.
 *
 * PLAN.md §S9 calls for TanStack Router; this is a stub for now — the
 * state lives in `App.tsx`. We expose `useRouter` only as a typed map
 * of `id → View`, plus a few helper hooks.
 *
 * Library views (skills/mcps/hooks) render the same surface with
 * different sample data; the data lives here so the Library surface
 * stays generic.
 */

export interface RouteContext {
  currentId: string;
}

const SKILLS: LibraryItemProps[] = [
  { id: 'frigg', name: 'Frigg', slug: 'frigg', status: 'enabled', description: 'Read-only codebase Q&A. Returns file:line refs.', meta: 'v1.2.0 · used 14× today' },
  { id: 'mimir', name: 'Mimir', slug: 'mimir', status: 'enabled', description: 'Deep codebase research via Semble search.', meta: 'v0.9.0 · used 6× today' },
  { id: 'odin', name: 'Odin', slug: 'odin', status: 'enabled', description: 'Pure router that delegates to Thor / Tyr.', meta: 'v2.1.0 · used 22× today' },
  { id: 'tyr', name: 'Tyr', slug: 'tyr', status: 'enabled', description: 'Top-tier implementation engine.', meta: 'v2.1.0 · used 11× today' },
  { id: 'thor', name: 'Thor', slug: 'thor', status: 'enabled', description: 'Mid-complexity implementation.', meta: 'v2.1.0 · used 18× today' },
  { id: 'heimdall', name: 'Heimdall', slug: 'heimdall', status: 'enabled', description: 'Deterministic mechanical edits.', meta: 'v1.4.0 · used 9× today' },
];

const MCPS: LibraryItemProps[] = [
  { id: 'semble', name: 'Semble', slug: 'semble', status: 'enabled', description: 'Instant code search across the workspace.', meta: 'v1.0.0 · index 18,432 symbols' },
  { id: 'codegraph', name: 'CodeGraph', slug: 'codegraph', status: 'enabled', description: 'SQLite knowledge graph with call-path resolution.', meta: 'v0.6.0 · indexed at .codegraph/' },
  { id: 'bizar-mem', name: 'Bizar memory', slug: 'bizar-mem', status: 'disabled', description: 'Cross-session memo vault.', meta: 'v0.4.0 · disabled' },
];

const HOOKS: LibraryItemProps[] = [
  { id: 'pretooluse-check-arch', name: 'PreToolUse:check-arch', slug: 'PreToolUse:check-arch', status: 'enabled', description: 'Refuses cross-layer imports.', meta: 'fires 312× today' },
  { id: 'posttooluse-test', name: 'PostToolUse:test', slug: 'PostToolUse:test', status: 'enabled', description: 'Runs vitest on saved files.', meta: 'fires 88× today' },
  { id: 'sessionstart-load-proj', name: 'SessionStart:load-project', slug: 'SessionStart:load-project', status: 'enabled', description: 'Reads `.bizar/PROJECT.md` + memory vault.', meta: 'fires on session start' },
  { id: 'sessionend-trace', name: 'SessionEnd:trace', slug: 'SessionEnd:trace', status: 'enabled', description: 'Appends to `.harness/traces/sessions.jsonl`.', meta: 'fires on session end' },
  { id: 'userpromptsubmit-mem', name: 'UserPromptSubmit:mem', slug: 'UserPromptSubmit:mem', status: 'error', description: 'Searches memory vault for prior context.', meta: 'exit 1 — needs token' },
];

export function useViewForId(id: string): JSX.Element {
  return useMemo(() => {
    switch (id) {
      case 'overview':
        return <OverviewView />;
      case 'tasks':
        return <TasksView />;
      case 'goals':
        return <GoalsView />;
      case 'agents':
        return <AgentsView />;
      case 'activity':
        return <ActivityView />;
      case 'memory':
        return <MemoryView />;
      case 'skills':
        return <LibrariesView kind="skills" items={SKILLS} />;
      case 'mcps':
        return <LibrariesView kind="mcps" items={MCPS} />;
      case 'hooks':
        return <LibrariesView kind="hooks" items={HOOKS} />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewView />;
    }
  }, [id]);
}