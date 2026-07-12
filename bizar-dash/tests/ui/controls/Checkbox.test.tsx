import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from '../../../src/web/ui/controls/Checkbox';

describe('Checkbox', () => {
  it('renders with the supplied label', () => {
    render(<Checkbox checked={false} onChange={() => {}} label="Accept" />);
    expect(screen.getByRole('checkbox', { name: 'Accept' })).toBeInTheDocument();
  });

  it('fires onChange(true) when clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox checked={false} onChange={onChange} label="X" />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggles checked visually when checked is true', () => {
    render(<Checkbox checked onChange={() => {}} label="X" data-testid="c" />);
    expect(screen.getByTestId('c')).toHaveClass('checkbox-checked');
  });

  it('renders indeterminate state class', () => {
    render(
      <Checkbox
        checked={false}
        indeterminate
        onChange={() => {}}
        label="X"
        data-testid="c"
      />,
    );
    expect(screen.getByTestId('c')).toHaveClass('checkbox-indeterminate');
  });

  it('is disabled when disabled is set', () => {
    render(
      <Checkbox checked={false} onChange={() => {}} label="X" disabled />,
    );
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
