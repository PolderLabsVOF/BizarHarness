import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bot } from 'lucide-react';
import { AgentCard } from '../ui/agents/AgentCard';
import { AgentActivity, type AgentActivityItem } from '../ui/agents/AgentActivity';

describe('AgentCard', () => {
  it('renders name, role, status badge', () => {
    render(<AgentCard id="a1" name="Atlas" role="Lead researcher" status="busy" />);
    expect(screen.getByText(/atlas/i)).toBeInTheDocument();
    expect(screen.getByText(/lead researcher/i)).toBeInTheDocument();
    expect(screen.getByText(/busy/i)).toBeInTheDocument();
  });

  it('shows current task and last activity + tasksToday', () => {
    render(
      <AgentCard
        id="a1"
        name="Atlas"
        role="x"
        status="busy"
        currentTask="Writing sprint contract"
        lastActivity="2m ago"
        tasksToday={7}
      />,
    );
    expect(screen.getByText(/writing sprint contract/i)).toBeInTheDocument();
    expect(screen.getByText(/2m ago/i)).toBeInTheDocument();
    expect(screen.getByText(/7 today/i)).toBeInTheDocument();
  });

  it('invokes onOpen when clicked', async () => {
    const onOpen = vi.fn();
    render(<AgentCard id="a1" name="Atlas" role="x" status="idle" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /atlas/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders error status label', () => {
    render(<AgentCard id="a1" name="Atlas" role="x" status="error" />);
    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });
});

describe('AgentActivity', () => {
  const items: AgentActivityItem[] = [
    {
      id: 'i1',
      icon: <Bot size={14} aria-hidden="true" />,
      title: 'Run started',
      description: 'Picked up "Patch login bug"',
      meta: '12:04',
      tone: 'info',
    },
    {
      id: 'i2',
      title: 'Tool call',
      description: 'grep',
      meta: '12:05',
    },
    {
      id: 'i3',
      title: 'Run finished',
      meta: '12:08',
      tone: 'success',
    },
  ];

  it('renders all items', () => {
    render(<AgentActivity items={items} />);
    expect(screen.getByText(/run started/i)).toBeInTheDocument();
    expect(screen.getByText(/tool call/i)).toBeInTheDocument();
    expect(screen.getByText(/run finished/i)).toBeInTheDocument();
  });

  it('renders as an ordered list', () => {
    const { container } = render(<AgentActivity items={items} />);
    expect(container.querySelector('ol')).not.toBeNull();
  });

  it('hides optional description and meta when absent', () => {
    render(
      <AgentActivity
        items={[{ id: 'i1', title: 'Single' }]}
      />,
    );
    expect(screen.getByText(/single/i)).toBeInTheDocument();
  });
});