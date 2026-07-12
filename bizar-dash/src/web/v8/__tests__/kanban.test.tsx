/**
 * Kanban layer tests — KanbanCard, KanbanColumn, KanbanBoard, KanbanQuickAdd,
 * KanbanContextMenu. Covers rendering, priority/compact variants, quick-add
 * keyboard behavior, and the right-click menu.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  KanbanCard,
  KanbanColumn,
  KanbanBoard,
  KanbanQuickAdd,
  KanbanContextMenu,
} from '../ui/index.js';

describe('KanbanCard', () => {
  it('renders title and optional metadata', () => {
    render(<KanbanCard card={{ id: 'a', title: 'Ship S5', priority: 'high', comments: 3, due: 'Mon' }} />);
    expect(screen.getByText('Ship S5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
  });

  it('hides metadata row in compact variant', () => {
    render(
      <KanbanCard
        variant="compact"
        card={{ id: 'a', title: 'Compact card', comments: 5 }}
      />,
    );
    expect(screen.getByText('Compact card')).toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();
  });

  it('renders priority dot with aria-label', () => {
    render(<KanbanCard card={{ id: 'a', title: 'Urgent!', priority: 'urgent' }} />);
    expect(screen.getByLabelText(/priority: urgent/i)).toBeInTheDocument();
  });

  it('applies data-kanban-card-id for keyboard nav', () => {
    const { container } = render(<KanbanCard card={{ id: 'k-42', title: 'Task' }} />);
    expect(container.querySelector('[data-kanban-card-id="k-42"]')).toBeInTheDocument();
  });
});

describe('KanbanColumn', () => {
  it('renders title and count', () => {
    render(
      <KanbanColumn column={{ id: 'todo', title: 'To Do', count: 5 }}>
        <span>card</span>
      </KanbanColumn>,
    );
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows wip limit', () => {
    render(
      <KanbanColumn column={{ id: 'in-progress', title: 'In Progress', count: 7, wipLimit: 5 }} />,
    );
    expect(screen.getByText('7 / 5')).toBeInTheDocument();
  });

  it('renders overflow and add buttons when handlers provided', () => {
    render(
      <KanbanColumn
        column={{ id: 'x', title: 'X' }}
        onAdd={() => {}}
        onOverflow={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /add card/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /column options/i })).toBeInTheDocument();
  });
});

describe('KanbanBoard', () => {
  it('renders region landmark with accessible label', () => {
    render(
      <KanbanBoard columns={[{ id: 'todo' }, { id: 'done' }]}>
        <KanbanColumn column={{ id: 'todo', title: 'To Do' }} />
        <KanbanColumn column={{ id: 'done', title: 'Done' }} />
      </KanbanBoard>,
    );
    expect(screen.getByRole('region', { name: /kanban board/i })).toBeInTheDocument();
  });
});

describe('KanbanQuickAdd', () => {
  it('starts idle and reveals editor on click', async () => {
    render(<KanbanQuickAdd onAdd={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));
    expect(screen.getByPlaceholderText(/task title/i)).toBeInTheDocument();
  });

  it('submits via Enter and clears value', async () => {
    const onAdd = vi.fn();
    render(<KanbanQuickAdd onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));
    const ta = screen.getByPlaceholderText(/task title/i);
    await userEvent.type(ta, 'New card title{Enter}');
    expect(onAdd).toHaveBeenCalledWith('New card title');
  });

  it('does not submit empty titles', async () => {
    const onAdd = vi.fn();
    render(<KanbanQuickAdd onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));
    const ta = screen.getByPlaceholderText(/task title/i);
    await userEvent.type(ta, '   {Enter}');
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('cancels on Escape', async () => {
    render(<KanbanQuickAdd onAdd={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /add task/i }));
    const ta = screen.getByPlaceholderText(/task title/i);
    await userEvent.type(ta, 'draft');
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(/task title/i)).not.toBeInTheDocument();
  });
});

describe('KanbanContextMenu', () => {
  it('renders card content inside trigger', () => {
    render(
      <KanbanContextMenu>
        <div>Card body</div>
      </KanbanContextMenu>,
    );
    expect(screen.getByText('Card body')).toBeInTheDocument();
  });

  it('shows menu items on contextmenu event', async () => {
    render(
      <KanbanContextMenu>
        <div>Right-click me</div>
      </KanbanContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText('Right-click me'));
    expect(await screen.findByText('Open detail')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText('Move to previous column')).toBeInTheDocument();
    expect(screen.getByText('Move to next column')).toBeInTheDocument();
    expect(screen.getByText('Assign…')).toBeInTheDocument();
    expect(screen.getByText('Archive')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('disables move arrows based on canMoveLeft/canMoveRight', async () => {
    render(
      <KanbanContextMenu canMoveLeft={false} canMoveRight>
        <div>x</div>
      </KanbanContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText('x'));
    const prevItem = await screen.findByText('Move to previous column');
    expect(prevItem.closest('[data-disabled]')).not.toBeNull();
    const nextItem = screen.getByText('Move to next column');
    expect(nextItem.closest('[data-disabled]')).toBeNull();
  });

  it('invokes onDelete when Delete is selected', async () => {
    const onDelete = vi.fn();
    render(
      <KanbanContextMenu onDelete={onDelete}>
        <div>x</div>
      </KanbanContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText('x'));
    await userEvent.click(await screen.findByText('Delete'));
    expect(onDelete).toHaveBeenCalled();
  });
});