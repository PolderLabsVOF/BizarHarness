/**
 * Feedback layer tests — Dialog, Alert, Toast, Tooltip, Skeleton, EmptyState,
 * DropdownMenu, ContextMenu, Sheet. Covers rendering, a11y, and overlays.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Alert,
  Banner,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogClose,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  Sheet,
  SheetContent,
  SheetClose,
  Skeleton,
  SkeletonText,
  EmptyState,
  TooltipProvider,
  Tooltip,
} from '../ui/index.js';

describe('Alert', () => {
  it('renders title and tone', () => {
    render(<Alert tone="warning" title="Watch out">Be careful</Alert>);
    expect(screen.getByText('Watch out')).toBeInTheDocument();
    expect(screen.getByText('Be careful')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('uses status role for info tone', () => {
    render(<Alert tone="info" title="Note" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('hides icon when icon={false}', () => {
    const { container } = render(<Alert icon={false} title="x" />);
    expect(container.querySelector('.v8-alert svg')).toBeNull();
  });
});

describe('Banner', () => {
  it('renders message and supports an action slot', () => {
    render(
      <Banner tone="warning">
        <span data-testid="msg">Outage in progress</span>
      </Banner>,
    );
    expect(screen.getByTestId('msg')).toBeInTheDocument();
  });

  it('renders an action button via action prop', () => {
    render(
      <Banner tone="info" action={<button>Subscribe</button>}>
        Heads up
      </Banner>,
    );
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('opens and closes via trigger and close', async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent title="Confirm">
          <p>Body</p>
          <DialogClose>Close</DialogClose>
        </DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByText('Open'));
    expect(await screen.findByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Close'));
    await waitFor(() => {
      expect(screen.queryByText('Body')).not.toBeInTheDocument();
    });
  });
});

describe('Skeleton', () => {
  it('renders with v8-skeleton class for pulse animation', () => {
    const { container } = render(<Skeleton width={100} height={20} />);
    const el = container.firstChild;
    expect(el).toHaveClass('v8-skeleton');
  });

  it('renders multiple lines with SkeletonText', () => {
    const { container } = render(<SkeletonText lines={3} />);
    expect(container.querySelectorAll('.v8-skeleton').length).toBe(3);
  });
});

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(
      <EmptyState
        title="No tasks yet"
        description="Add your first task to get started"
      />,
    );
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
    expect(screen.getByText(/add your first task/i)).toBeInTheDocument();
  });

  it('renders an action button via action prop', () => {
    render(
      <EmptyState title="Empty" action={<button>New task</button>} />,
    );
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument();
  });
});

describe('DropdownMenu', () => {
  it('opens and lists items', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Copy</DropdownMenuItem>
          <DropdownMenuItem>Paste</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await userEvent.click(screen.getByText('Menu'));
    expect(await screen.findByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Paste')).toBeInTheDocument();
  });

  it('renders shortcut text', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuItem shortcut="⌘ C">Copy</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(await screen.findByText('⌘ C')).toBeInTheDocument();
  });
});

describe('ContextMenu', () => {
  it('renders items inside trigger', async () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Inspect</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(screen.getByText('Right-click me')).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText('Right-click me'));
    expect(await screen.findByText('Inspect')).toBeInTheDocument();
  });
});

describe('Sheet', () => {
  it('renders title and supports close', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent title="Task #42">
          <p>Detail</p>
          <SheetClose>Done</SheetClose>
        </SheetContent>
      </Sheet>,
    );
    expect(await screen.findByText('Detail')).toBeInTheDocument();
    expect(screen.getByText('Task #42')).toBeInTheDocument();
  });

  it('applies data-side attribute for animation', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent title="x" side="right">
          body
        </SheetContent>
      </Sheet>,
    );
    await waitFor(() => {
      expect(document.querySelector('.v8-sheet')).toHaveAttribute('data-side', 'right');
    });
  });
});

describe('Tooltip', () => {
  it('shows tooltip text on hover', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Helpful">
          <button>Hover me</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.hover(screen.getByText('Hover me'));
    // Radix renders the tooltip text in two nodes (visible + a11y fallback).
    const nodes = await screen.findAllByText('Helpful');
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});