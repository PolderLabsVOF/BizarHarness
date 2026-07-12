/**
 * Navigation layer tests — Tabs, NavLink, Pagination, CommandPalette.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  NavLink,
  Pagination,
  Dialog,
  DialogContent,
  CommandPalette,
  CommandPaletteGroup,
  CommandPaletteItem,
} from '../ui/index.js';

// cmdk uses scrollIntoView for keyboard navigation; jsdom doesn't implement it.
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {
      // noop for tests
    };
  }
});

describe('Tabs', () => {
  it('switches content on trigger click', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Alpha</TabsTrigger>
          <TabsTrigger value="b">Beta</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content A</TabsContent>
        <TabsContent value="b">Content B</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('Content A')).toBeInTheDocument();
    expect(screen.queryByText('Content B')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /beta/i }));
    expect(await screen.findByText('Content B')).toBeInTheDocument();
  });

  it('marks active trigger with data-state="active"', () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">x</TabsContent>
        <TabsContent value="two">y</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tab', { name: /one/i })).toHaveAttribute('data-state', 'active');
  });
});

describe('NavLink', () => {
  it('renders link with active state via aria-current', () => {
    render(<NavLink href="/tasks" aria-current="page">Tasks</NavLink>);
    const link = screen.getByRole('link', { name: /tasks/i });
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('renders without active state by default', () => {
    render(<NavLink href="/about">About</NavLink>);
    const link = screen.getByRole('link', { name: /about/i });
    expect(link).not.toHaveAttribute('aria-current');
  });
});

describe('Pagination', () => {
  it('invokes onChange when clicking a visible page button', async () => {
    const onChange = vi.fn();
    render(<Pagination page={2} totalPages={10} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /page 3/i }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('disables prev/next at edges', () => {
    render(<Pagination page={1} totalPages={5} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /first page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
  });

  it('renders ellipsis when total pages > 7', () => {
    render(<Pagination page={5} totalPages={20} onChange={() => {}} />);
    expect(screen.getAllByText('…').length).toBeGreaterThanOrEqual(1);
  });
});

describe('CommandPalette', () => {
  it('renders items and filters by query', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent title="cmdk">
          <CommandPalette placeholder="Search…">
            <CommandPaletteGroup heading="Navigation">
              <CommandPaletteItem value="go:tasks">Go to Tasks</CommandPaletteItem>
              <CommandPaletteItem value="go:goals">Go to Goals</CommandPaletteItem>
              <CommandPaletteItem value="go:agents">Go to Agents</CommandPaletteItem>
            </CommandPaletteGroup>
          </CommandPalette>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('Go to Tasks')).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'goals' } });
    expect(await screen.findByText('Go to Goals')).toBeInTheDocument();
    expect(screen.queryByText('Go to Tasks')).not.toBeInTheDocument();
  });

  it('invokes onSelect when an item is selected', async () => {
    const onSelect = vi.fn();
    render(
      <Dialog defaultOpen>
        <DialogContent title="cmdk">
          <CommandPalette>
            <CommandPaletteGroup>
              <CommandPaletteItem value="act:ping" onSelect={onSelect}>
                Ping
              </CommandPaletteItem>
            </CommandPaletteGroup>
          </CommandPalette>
        </DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByText('Ping'));
    expect(onSelect).toHaveBeenCalled();
  });
});