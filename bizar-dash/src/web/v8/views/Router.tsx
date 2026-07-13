import { lazy, useMemo } from 'react';

/**
 * Router — flat state-based view switcher (Sprint S10).
 *
 * Library views (skills/mcps/hooks) hit the backend now. The
 * LibraryItemProps shape used here is the same as the one shipped
 * pre-S10 — no consumer-side changes required.
 */

export interface RouteContext {
  currentId: string;
}

const OverviewView = lazy(() =>
  import('./Overview/OverviewView.js').then((m) => ({ default: m.OverviewView })),
);
const TasksView = lazy(() =>
  import('./Tasks/TasksView.js').then((m) => ({ default: m.TasksView })),
);
const GoalsView = lazy(() =>
  import('./Goals/GoalsView.js').then((m) => ({ default: m.GoalsView })),
);
const AgentsView = lazy(() =>
  import('./Agents/AgentsView.js').then((m) => ({ default: m.AgentsView })),
);
const ActivityView = lazy(() =>
  import('./Activity/ActivityView.js').then((m) => ({ default: m.ActivityView })),
);
const MemoryView = lazy(() =>
  import('./Memory/MemoryView.js').then((m) => ({ default: m.MemoryView })),
);
const LibrariesView = lazy(() =>
  import('./Libraries/LibrariesView.js').then((m) => ({ default: m.LibrariesView })),
);
const SettingsView = lazy(() =>
  import('./Settings/SettingsView.js').then((m) => ({ default: m.SettingsView })),
);

// Library surfaces now pull live data inside the view itself.
// LibraryItemProps is imported so its type stays exported via this
// barrel; the per-kind view imports the runtime directly.
export type { LibraryItemProps } from '../ui/libraries/LibraryItem.js';

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
        return <LibrariesView kind="skills" />;
      case 'mcps':
        return <LibrariesView kind="mcps" />;
      case 'hooks':
        return <LibrariesView kind="hooks" />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewView />;
    }
  }, [id]);
}