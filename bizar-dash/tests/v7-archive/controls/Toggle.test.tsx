import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggle } from '../../../src/web/ui/controls/Toggle';

describe('Toggle', () => {
  it('renders as a switch with checked state', () => {
    render(<Toggle checked onChange={() => {}} />);
    const input = screen.getByRole('switch');
    expect(input).toBeChecked();
  });

  it('fires onChange(true) when clicked off→on', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Toggle checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders with the checked class on the label', () => {
    render(<Toggle checked onChange={() => {}} data-testid="t" />);
    expect(screen.getByTestId('t')).toHaveClass('toggle-checked');
  });

  it('renders the small size modifier class', () => {
    render(
      <Toggle checked={false} onChange={() => {}} size="sm" data-testid="t" />,
    );
    expect(screen.getByTestId('t')).toHaveClass('toggle-sm');
  });

  it('is disabled when disabled is set', () => {
    render(
      <Toggle checked={false} onChange={() => {}} disabled />,
    );
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
