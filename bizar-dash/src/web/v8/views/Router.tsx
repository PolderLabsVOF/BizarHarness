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
const SchedulesView = lazy(() =>
  import('./Schedules/SchedulesView.js').then((m) => ({ default: m.SchedulesView })),
);
const BackgroundJobsView = lazy(() =>
  import('./BackgroundJobs/BackgroundJobsView.js').then((m) => ({ default: m.BackgroundJobsView })),
);
const DoctorView = lazy(() =>
  import('./Doctor/DoctorView.js').then((m) => ({ default: m.DoctorView })),
);
const UsageView = lazy(() =>
  import('./Usage/UsageView.js').then((m) => ({ default: m.UsageView })),
);
const BackupView = lazy(() =>
  import('./Backup/BackupView.js').then((m) => ({ default: m.BackupView })),
);
const NotificationsView = lazy(() =>
  import('./Notifications/NotificationsView.js').then((m) => ({ default: m.NotificationsView })),
);
const DiagnosticsView = lazy(() =>
  import('./Diagnostics/DiagnosticsView.js').then((m) => ({ default: m.DiagnosticsView })),
);
const EvalView = lazy(() =>
  import('./Eval/EvalView.js').then((m) => ({ default: m.EvalView })),
);
const ChatView = lazy(() =>
  import('./Chat/ChatView.js').then((m) => ({ default: m.ChatView })),
);
const ProjectsView = lazy(() =>
  import('./Projects/ProjectsView.js').then((m) => ({ default: m.ProjectsView })),
);
const ClaudeSessionsView = lazy(() =>
  import('./ClaudeSessions/ClaudeSessionsView.js').then((m) => ({ default: m.ClaudeSessionsView })),
);
const HistoryView = lazy(() =>
  import('./History/HistoryView.js').then((m) => ({ default: m.HistoryView })),
);
const AdminView = lazy(() =>
  import('./Admin/AdminView.js').then((m) => ({ default: m.AdminView })),
);
const AuthView = lazy(() =>
  import('./Auth/AuthView.js').then((m) => ({ default: m.AuthView })),
);
const EnvVarsView = lazy(() =>
  import('./EnvVars/EnvVarsView.js').then((m) => ({ default: m.EnvVarsView })),
);
const ConfigView = lazy(() =>
  import('./Config/ConfigView.js').then((m) => ({ default: m.ConfigView })),
);
const DialogsView = lazy(() =>
  import('./Dialogs/DialogsView.js').then((m) => ({ default: m.DialogsView })),
);
const ProvidersView = lazy(() =>
  import('./Providers/ProvidersView.js').then((m) => ({ default: m.ProvidersView })),
);
const ModsView = lazy(() =>
  import('./Mods/ModsView.js').then((m) => ({ default: m.ModsView })),
);
const UpdateView = lazy(() =>
  import('./Update/UpdateView.js').then((m) => ({ default: m.UpdateView })),
);
const ArtifactsView = lazy(() =>
  import('./Artifacts/ArtifactsView.js').then((m) => ({ default: m.ArtifactsView })),
);
const LightRAGView = lazy(() =>
  import('./LightRAG/LightRAGView.js').then((m) => ({ default: m.LightRAGView })),
);
const VoiceView = lazy(() =>
  import('./Voice/VoiceView.js').then((m) => ({ default: m.VoiceView })),
);
const ClipboardView = lazy(() =>
  import('./Clipboard/ClipboardView.js').then((m) => ({ default: m.ClipboardView })),
);
const ObsidianView = lazy(() =>
  import('./Obsidian/ObsidianView.js').then((m) => ({ default: m.ObsidianView })),
);
const MiscView = lazy(() =>
  import('./Misc/MiscView.js').then((m) => ({ default: m.MiscView })),
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
      case 'schedules':
        return <SchedulesView />;
      case 'background':
        return <BackgroundJobsView />;
      case 'doctor':
        return <DoctorView />;
      case 'usage':
        return <UsageView />;
      case 'backup':
        return <BackupView />;
      case 'notifications':
        return <NotificationsView />;
      case 'diagnostics':
        return <DiagnosticsView />;
      case 'eval':
        return <EvalView />;
      case 'chat':
        return <ChatView />;
      case 'projects-list':
        return <ProjectsView />;
      case 'claude-sessions':
        return <ClaudeSessionsView />;
      case 'history':
        return <HistoryView />;
      case 'admin':
        return <AdminView />;
      case 'auth':
        return <AuthView />;
      case 'env-vars':
        return <EnvVarsView />;
      case 'config':
        return <ConfigView />;
      case 'dialogs':
        return <DialogsView />;
      case 'providers':
        return <ProvidersView />;
      case 'mods':
        return <ModsView />;
      case 'update':
        return <UpdateView />;
      case 'artifacts':
        return <ArtifactsView />;
      case 'lightrag':
        return <LightRAGView />;
      case 'voice':
        return <VoiceView />;
      case 'clipboard':
        return <ClipboardView />;
      case 'obsidian':
        return <ObsidianView />;
      case 'misc':
        return <MiscView />;
      default:
        return <OverviewView />;
    }
  }, [id]);
}