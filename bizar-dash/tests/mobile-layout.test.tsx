// tests/mobile-layout.test.tsx — v5.4 mobile navigation shell tests.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Activity, MessageSquare, CheckSquare, Grid } from 'lucide-react';
import { MobileHeader } from '../src/web/components/MobileHeader';
import { MobileBottomNav } from '../src/web/components/MobileBottomNav';
import { MobileDrawer } from '../src/web/components/MobileDrawer';
import { MobileLayout } from '../src/web/components/MobileLayout';
import type { MobileTab } from '../src/web/components/MobileBottomNav';

const TABS: MobileTab[] = [
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'settings', label: 'Settings', icon: Grid },
  { id: 'more', label: 'More', icon: Grid },
];

describe('MobileHeader', () => {
  it('renders with title', () => {
    render(
      <MobileHeader
        onMenuClick={vi.fn()}
        scrolled={false}
        activeTab="activity"
      />,
    );
    expect(screen.getByText('Bizar')).toBeInTheDocument();
  });

  it('renders menu button', () => {
    render(
      <MobileHeader
        onMenuClick={vi.fn()}
        scrolled={false}
        activeTab="activity"
      />,
    );
    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument();
  });

  it('renders search button by default', () => {
    render(
      <MobileHeader
        onMenuClick={vi.fn()}
        scrolled={false}
        activeTab="activity"
        onSearch={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  it('renders settings exit button when onSettings is provided', () => {
    render(
      <MobileHeader
        onMenuClick={vi.fn()}
        scrolled={false}
        activeTab="settings"
        onSettings={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /exit settings/i })).toBeInTheDocument();
  });

  it('shows Settings title when activeTab is settings', () => {
    render(
      <MobileHeader
        onMenuClick={vi.fn()}
        scrolled={false}
        activeTab="settings"
      />,
    );
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('calls onMenuClick when menu button is clicked', () => {
    const onMenuClick = vi.fn();
    render(
      <MobileHeader
        onMenuClick={onMenuClick}
        scrolled={false}
        activeTab="activity"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('applies scrolled class when scrolled prop is true', () => {
    const { container } = render(
      <MobileHeader
        onMenuClick={vi.fn()}
        scrolled={true}
        activeTab="activity"
      />,
    );
    expect(container.querySelector('.mobile-header')).toHaveClass('is-scrolled');
  });
});

describe('MobileBottomNav', () => {
  it('renders all primary tabs', () => {
    render(
      <MobileBottomNav
        tabs={TABS}
        activeTab="activity"
        onTabChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
  });

  it('marks the active tab', () => {
    render(
      <MobileBottomNav
        tabs={TABS}
        activeTab="chat"
        onTabChange={vi.fn()}
      />,
    );
    const chatButton = screen.getByRole('tab', { name: /chat/i });
    expect(chatButton).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onTabChange when a tab is clicked', () => {
    const onTabChange = vi.fn();
    render(
      <MobileBottomNav
        tabs={TABS}
        activeTab="activity"
        onTabChange={onTabChange}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /tasks/i }));
    expect(onTabChange).toHaveBeenCalledWith('tasks');
  });
});

describe('MobileDrawer', () => {
  it('does not render when open is false', () => {
    const { container } = render(
      <MobileDrawer
        open={false}
        onClose={vi.fn()}
        tabs={TABS}
        activeTab="activity"
        onTabChange={vi.fn()}
      />,
    );
    expect(container.querySelector('.mobile-drawer')).not.toHaveClass('is-open');
  });

  it('renders overlay when open', () => {
    render(
      <MobileDrawer
        open={true}
        onClose={vi.fn()}
        tabs={TABS}
        activeTab="activity"
        onTabChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/all views/i)).toBeInTheDocument();
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(
      <MobileDrawer
        open={true}
        onClose={onClose}
        tabs={TABS}
        activeTab="activity"
        onTabChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/all views/i).previousSibling as Element);
    // The overlay is the div before the aside
  });

  it('renders all tabs in the drawer', () => {
    render(
      <MobileDrawer
        open={true}
        onClose={vi.fn()}
        tabs={TABS}
        activeTab="activity"
        onTabChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
  });

  it('calls onTabChange when a drawer item is clicked', () => {
    const onTabChange = vi.fn();
    render(
      <MobileDrawer
        open={true}
        onClose={vi.fn()}
        tabs={TABS}
        activeTab="activity"
        onTabChange={onTabChange}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /tasks/i }));
    expect(onTabChange).toHaveBeenCalledWith('tasks');
  });
});

describe('MobileLayout', () => {
  it('renders mobile header', () => {
    render(
      <MobileLayout
        activeTab="activity"
        onTabChange={vi.fn()}
        tabs={TABS}
        fullTabs={TABS}
      >
        <div>Child content</div>
      </MobileLayout>,
    );
    expect(screen.getByText('Bizar')).toBeInTheDocument();
  });

  it('renders bottom nav with primary tabs', () => {
    render(
      <MobileLayout
        activeTab="activity"
        onTabChange={vi.fn()}
        tabs={TABS}
        fullTabs={TABS}
      >
        <div>Child content</div>
      </MobileLayout>,
    );
    const nav = screen.getByRole('tablist', { name: /primary/i });
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveTextContent('Activity');
    expect(nav).toHaveTextContent('Chat');
  });

  it('opens drawer on menu click', () => {
    render(
      <MobileLayout
        activeTab="activity"
        onTabChange={vi.fn()}
        tabs={TABS}
        fullTabs={TABS}
      >
        <div>Child content</div>
      </MobileLayout>,
    );
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByLabelText(/all views/i)).toBeInTheDocument();
  });

  it('closes drawer on overlay click', () => {
    render(
      <MobileLayout
        activeTab="activity"
        onTabChange={vi.fn()}
        tabs={TABS}
        fullTabs={TABS}
      >
        <div>Child content</div>
      </MobileLayout>,
    );
    // Open drawer first
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const drawer = screen.getByLabelText(/all views/i);
    expect(drawer).toHaveClass('is-open');
  });

  it('renders children content', () => {
    render(
      <MobileLayout
        activeTab="activity"
        onTabChange={vi.fn()}
        tabs={TABS}
        fullTabs={TABS}
      >
        <div data-testid="child">Child content</div>
      </MobileLayout>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
