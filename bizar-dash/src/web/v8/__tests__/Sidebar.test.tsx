import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bot, CheckSquare, Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import { Sidebar, type SidebarSection } from '../shell/Sidebar.js';

const SECTIONS: SidebarSection[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'overview', label: 'Overview', icon: Layers },
      { id: 'tasks', label: 'Tasks', icon: CheckSquare, count: 47 },
    ],
  },
  {
    id: 'ops',
    label: 'Ops',
    items: [{ id: 'agents', label: 'Agents', icon: Bot, count: '8/16' }],
  },
];

function renderSidebar(props: {
  onItemSelect?: ReturnType<typeof vi.fn>;
  activeId?: string;
} = {}): { onItemSelect?: ReturnType<typeof vi.fn> } {
  render(
    <Sidebar
      sections={SECTIONS}
      defaultSections={false}
      onItemSelect={props.onItemSelect}
      activeId={props.activeId}
    />,
  );
  return props;
}

describe('Sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders every section label and item', () => {
    renderSidebar();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Ops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tasks/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /agents/i })).toBeInTheDocument();
  });

  it('renders items as <button> elements (not anchors)', () => {
    renderSidebar();
    const overview = screen.getByRole('button', { name: /overview/i });
    expect(overview.tagName).toBe('BUTTON');
    expect(overview).not.toHaveAttribute('href');
  });

  it('fires onItemSelect with the clicked item id', async () => {
    const user = userEvent.setup();
    const onItemSelect = vi.fn();
    renderSidebar({ onItemSelect });

    await user.click(screen.getByRole('button', { name: /^Tasks$/i }));

    expect(onItemSelect).toHaveBeenCalledTimes(1);
    expect(onItemSelect).toHaveBeenCalledWith('tasks');
  });

  it('marks activeId item with aria-current="page"', () => {
    renderSidebar({ activeId: 'tasks' });
    const tasks = screen.getByRole('button', { name: /^Tasks$/i });
    const overview = screen.getByRole('button', { name: /^Overview$/i });
    expect(tasks).toHaveAttribute('aria-current', 'page');
    expect(overview).not.toHaveAttribute('aria-current');
  });

  it('marks each item with aria-label so collapsed icons stay announced', () => {
    renderSidebar();
    // aria-label is always set; expanded view relies on visible label,
    // collapsed view relies on aria-label.
    expect(screen.getByRole('button', { name: /^Tasks$/i })).toHaveAttribute('aria-label', 'Tasks');
    expect(screen.getByRole('button', { name: /^Agents$/i })).toHaveAttribute('aria-label', 'Agents');
  });

  it('persists collapsed state in localStorage when toggled', async () => {
    const user = userEvent.setup();
    renderSidebar();
    // Find the collapse button by its aria-label (always present).
    const collapseBtn = screen.getByRole('button', { name: /collapse sidebar/i });
    await user.click(collapseBtn);
    expect(window.localStorage.getItem('bizar:sidebar:collapsed')).toBe('1');
  });
});
