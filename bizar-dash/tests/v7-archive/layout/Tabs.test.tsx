import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Tabs } from '../../../src/web/ui/layout/Tabs';

const TABS = [
  { id: 'one', label: 'One' },
  { id: 'two', label: 'Two' },
  { id: 'three', label: 'Three', disabled: true },
  { id: 'four', label: 'Four' },
];

describe('Tabs', () => {
  it('renders all tabs as a tablist', () => {
    render(<Tabs tabs={TABS} activeId="one" onChange={() => {}} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('marks the active tab with aria-selected=true', () => {
    render(<Tabs tabs={TABS} activeId="two" onChange={() => {}} />);
    const active = screen.getByRole('tab', { name: 'Two' });
    expect(active).toHaveAttribute('aria-selected', 'true');
  });

  it('fires onChange when a tab is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeId="one" onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: 'Two' }));
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('skips disabled tabs on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeId="one" onChange={onChange} />);
    const disabled = screen.getByRole('tab', { name: 'Three' });
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves active id right on ArrowRight (skipping disabled)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeId="one" onChange={onChange} />);
    const active = screen.getByRole('tab', { name: 'One' });
    active.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('moves active id left on ArrowLeft', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeId="two" onChange={onChange} />);
    const active = screen.getByRole('tab', { name: 'Two' });
    active.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('one');
  });

  it('wraps around from the last enabled tab to the first', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeId="four" onChange={onChange} />);
    const active = screen.getByRole('tab', { name: 'Four' });
    active.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('one');
  });

  it('applies the pill variant class', () => {
    const { container } = render(
      <Tabs tabs={TABS} activeId="one" onChange={() => {}} variant="pill" />,
    );
    expect(container.querySelector('.bizar-tabs--pill')).toBeInTheDocument();
  });

  it('applies the underline variant class by default', () => {
    const { container } = render(
      <Tabs tabs={TABS} activeId="one" onChange={() => {}} />,
    );
    expect(container.querySelector('.bizar-tabs--underline')).toBeInTheDocument();
  });
});
