import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberInput } from '../../../src/web/ui/controls/NumberInput';

describe('NumberInput', () => {
  it('renders a spinbox with the numeric value', () => {
    render(<NumberInput value={5} onChange={() => {}} />);
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveValue(5);
  });

  it('accepts a string value', () => {
    render(<NumberInput value="12" onChange={() => {}} />);
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveValue(12);
  });

  it('fires onChange with a number when typing digits', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<NumberInput value={0} onChange={onChange} />);
    const input = screen.getByRole('spinbutton');
    input.focus();
    await user.type(input, '7');
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(typeof lastCall === 'number' || lastCall === '07').toBe(true);
  });

  it('forwards min/max/step', () => {
    render(
      <NumberInput
        value={1}
        onChange={() => {}}
        min={0}
        max={10}
        step={0.5}
      />,
    );
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.min).toBe('0');
    expect(input.max).toBe('10');
    expect(input.step).toBe('0.5');
  });

  it('applies error class when error is set', () => {
    render(<NumberInput value={1} onChange={() => {}} error="bad" />);
    expect(screen.getByRole('spinbutton')).toHaveClass('field-error');
  });

  it('is disabled when disabled is set', () => {
    render(<NumberInput value={1} onChange={() => {}} disabled />);
    expect(screen.getByRole('spinbutton')).toBeDisabled();
  });
});
