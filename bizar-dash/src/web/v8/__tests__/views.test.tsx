import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { OverviewView } from '../views/Overview/OverviewView.js';
import { TasksView } from '../views/Tasks/TasksView.js';
import { GoalsView } from '../views/Goals/GoalsView.js';
import { AgentsView } from '../views/Agents/AgentsView.js';
import { ActivityView } from '../views/Activity/ActivityView.js';
import { MemoryView } from '../views/Memory/MemoryView.js';
import { LibrariesView } from '../views/Libraries/LibrariesView.js';
import { SettingsView } from '../views/Settings/SettingsView.js';

function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ThemeProvider>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

describe('OverviewView', () => {
  it('renders stat tiles, recent activity, and needs-attention cards', () => {
    render(<Providers><OverviewView /></Providers>);
    expect(screen.getByRole('heading', { level: 1, name: /overview/i })).toBeInTheDocument();
    expect(screen.getByText(/Active tasks/i)).toBeInTheDocument();
    expect(screen.getByText(/Goals on track/i)).toBeInTheDocument();
    expect(screen.getByText(/Recent activity/i)).toBeInTheDocument();
    expect(screen.getByText(/Needs attention/i)).toBeInTheDocument();
  });
});

describe('TasksView', () => {
  it('renders the kanban columns with sample cards', () => {
    render(<Providers><TasksView /></Providers>);
    expect(screen.getByRole('heading', { level: 1, name: /tasks/i })).toBeInTheDocument();
    expect(screen.getByText(/Backlog/i)).toBeInTheDocument();
    expect(screen.getByText(/To do/i)).toBeInTheDocument();
    expect(screen.getByText(/In progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Wire TanStack Router in v8 App/i)).toBeInTheDocument();
  });
});

describe('GoalsView', () => {
  it('renders goals and key results', () => {
    render(<Providers><GoalsView /></Providers>);
    expect(screen.getByRole('heading', { level: 1, name: /goals/i })).toBeInTheDocument();
    expect(screen.getByText(/Ship v8 dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Cut S9 polish in half/i)).toBeInTheDocument();
    expect(screen.getByText(/Key results — current focus/i)).toBeInTheDocument();
    expect(screen.getByText(/Publish Plan.md with 17 sections/i)).toBeInTheDocument();
  });
});

describe('AgentsView', () => {
  it('renders the agent roster and a featured activity feed', () => {
    render(<Providers><AgentsView /></Providers>);
    expect(screen.getByRole('heading', { level: 1, name: /agents/i })).toBeInTheDocument();
    expect(screen.getByText(/Lead researcher/i)).toBeInTheDocument();
    expect(screen.getByText(/Frontend specialist/i)).toBeInTheDocument();
    expect(screen.getByText(/Activity — Atlas/i)).toBeInTheDocument();
  });
});

describe('ActivityView', () => {
  it('renders the full event history', () => {
    render(<Providers><ActivityView /></Providers>);
    expect(screen.getByRole('heading', { level: 1, name: /activity/i })).toBeInTheDocument();
    expect(screen.getByText(/Merged PR #42 — OKLch token system/i)).toBeInTheDocument();
  });
});

describe('MemoryView', () => {
  it('renders memos with project and global scopes', () => {
    render(<Providers><MemoryView /></Providers>);
    expect(screen.getByRole('heading', { level: 1, name: /memory/i })).toBeInTheDocument();
    expect(screen.getAllByText(/^Project$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Global$/i).length).toBeGreaterThan(0);
  });
});

describe('LibrariesView (Skills)', () => {
  const items = [
    { id: 'frigg', name: 'Frigg', slug: 'frigg', status: 'enabled' as const, description: 'Read-only codebase Q&A.' },
    { id: 'mimir', name: 'Mimir', slug: 'mimir', status: 'enabled' as const, description: 'Deep codebase research.' },
  ];

  it('renders the title and library items', () => {
    const { container } = render(<Providers><LibrariesView kind="skills" items={items} /></Providers>);
    expect(screen.getByRole('heading', { level: 1, name: /skills/i })).toBeInTheDocument();
    expect(container.textContent).toContain('Frigg');
    expect(container.textContent).toContain('Read-only codebase Q&A.');
  });
});

describe('SettingsView', () => {
  it('renders the 16 settings sections', () => {
    render(<Providers><SettingsView /></Providers>);
    expect(screen.getByRole('heading', { level: 2, name: /^General$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Theme$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Density$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Privacy$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^Advanced$/i })).toBeInTheDocument();
  });

  it('shows the settings nav with the active section', () => {
    render(<Providers><SettingsView /></Providers>);
    const navButtons = screen.getAllByRole('button');
    const generalBtn = navButtons.find((b) => b.textContent === 'General');
    expect(generalBtn?.getAttribute('aria-current')).toBe('true');
  });
});