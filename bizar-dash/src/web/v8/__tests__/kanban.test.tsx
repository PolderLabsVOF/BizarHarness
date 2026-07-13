/**
 * Kanban layer tests — KanbanCard, KanbanColumn, KanbanBoard, KanbanQuickAdd,
 * KanbanContextMenu, KanbanProgress, KanbanCardBadges, KanbanToolbar,
 * KanbanEmptyColumn, useKanbanSelection. Covers rendering, priority/compact
 * variants, quick-add keyboard behavior, the right-click menu, progress,
 * badges, the toolbar's bulk-action swap, and selection bookkeeping.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  KanbanCard,
  KanbanColumn,
  KanbanBoard,
  KanbanQuickAdd,
  KanbanContextMenu,
  KanbanProgress,
  KanbanCardBadges,
  KanbanToolbar,
  KanbanEmptyColumn,
  useKanbanSelection,
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

describe('KanbanProgress', () => {
  it('renders nothing when value is 0 and no label/caption', () => {
    const { container } = render(<KanbanProgress value={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the inline bar with a label', () => {
    render(<KanbanProgress value={42} label="42%" />);
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('clamps values outside 0..100', () => {
    render(<KanbanProgress value={150} label="100%" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('renders block layout with caption + label', () => {
    render(<KanbanProgress value={50} caption="Writing tests" label="50%" layout="block" />);
    expect(screen.getByText('Writing tests')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });
});

describe('KanbanCardBadges', () => {
  it('returns null when given no badges', () => {
    const { container } = render(<KanbanCardBadges badges={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a label per badge', () => {
    render(
      <KanbanCardBadges
        badges={[
          { label: 'recurring', tone: 'info' },
          { label: 'atlas', tone: 'accent' },
        ]}
      />,
    );
    expect(screen.getByText('recurring')).toBeInTheDocument();
    expect(screen.getByText('atlas')).toBeInTheDocument();
  });

  it('collapses overflow into a +N chip', () => {
    render(
      <KanbanCardBadges
        max={2}
        badges={[
          { label: 'one', tone: 'neutral' },
          { label: 'two', tone: 'neutral' },
          { label: 'three', tone: 'neutral' },
          { label: 'four', tone: 'neutral' },
        ]}
      />,
    );
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.queryByText('three')).not.toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});

describe('KanbanEmptyColumn', () => {
  it('renders the default message', () => {
    render(<KanbanEmptyColumn />);
    expect(screen.getByText(/drop a task here/i)).toBeInTheDocument();
  });

  it('renders a custom message', () => {
    render(<KanbanEmptyColumn message="Nothing in Done" />);
    expect(screen.getByText(/nothing in done/i)).toBeInTheDocument();
  });
});

describe('KanbanToolbar', () => {
  it('shows the New task button when nothing is selected', async () => {
    const onNewTask = vi.fn();
    render(
      <KanbanToolbar
        totalCount={10}
        visibleCount={10}
        selectedCount={0}
        query=""
        onQueryChange={() => {}}
        filters={[]}
        onFilterToggle={() => {}}
        onClearFilters={() => {}}
        onNewTask={onNewTask}
      />,
    );
    const btn = screen.getByRole('button', { name: /new task/i });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onNewTask).toHaveBeenCalled();
  });

  it('swaps to bulk mode when selectionCount > 0', () => {
    render(
      <KanbanToolbar
        totalCount={10}
        visibleCount={10}
        selectedCount={3}
        query=""
        onQueryChange={() => {}}
        filters={[]}
        onFilterToggle={() => {}}
        onClearFilters={() => {}}
        onBulkArchive={() => {}}
        onBulkDelete={() => {}}
      />,
    );
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /archive/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument();
  });

  it('filters input updates the query', async () => {
    const onQueryChange = vi.fn();
    render(
      <KanbanToolbar
        totalCount={10}
        visibleCount={3}
        selectedCount={0}
        query="ab"
        onQueryChange={onQueryChange}
        filters={[]}
        onFilterToggle={() => {}}
        onClearFilters={() => {}}
      />,
    );
    const input = screen.getByLabelText(/filter tasks/i) as HTMLInputElement;
    expect(input.value).toBe('ab');
    await userEvent.clear(input);
    await userEvent.type(input, 'xy');
    expect(onQueryChange).toHaveBeenCalled();
  });
});

describe('useKanbanSelection', () => {
  it('starts empty and toggles ids', () => {
    const { result } = renderHook(() => useKanbanSelection());
    expect(result.current.selected.size).toBe(0);
    act(() => result.current.toggle('a'));
    expect(result.current.has('a')).toBe(true);
    act(() => result.current.toggle('a'));
    expect(result.current.has('a')).toBe(false);
  });

  it('clear drops everything', () => {
    const { result } = renderHook(() => useKanbanSelection());
    act(() => {
      result.current.add(['a', 'b', 'c']);
    });
    expect(result.current.selected.size).toBe(3);
    act(() => result.current.clear());
    expect(result.current.selected.size).toBe(0);
  });

  it('Esc clears selection', () => {
    const { result } = renderHook(() => useKanbanSelection());
    act(() => result.current.add(['a']));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(result.current.selected.size).toBe(0);
  });

  it('Esc is ignored when typing in an input', () => {
    const { result } = renderHook(() => useKanbanSelection());
    act(() => result.current.add(['a']));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(result.current.selected.size).toBe(1);
    document.body.removeChild(input);
  });
});

describe('KanbanCard selection', () => {
  it('renders a checkbox when onSelectionChange is provided', () => {
    const onChange = vi.fn();
    render(
      <KanbanCard
        card={{ id: 'c1', title: 'Pick me' }}
        selected={false}
        onSelectionChange={onChange}
        showSelection
      />,
    );
    const cb = screen.getByRole('checkbox');
    expect(cb).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith('c1', true);
  });

  it('marks the card as selected when prop is true', () => {
    const { container } = render(
      <KanbanCard card={{ id: 'c1', title: 'x' }} selected showSelection onSelectionChange={() => {}} />,
    );
    expect(container.querySelector('[data-selected="true"]')).not.toBeNull();
  });
});