import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '../../../src/web/ui/controls/Select';

const OPTIONS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C', disabled: true },
];

describe('Select', () => {
  it('renders all options', () => {
    render(<Select value="" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('option', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'C' })).toBeInTheDocument();
  });

  it('renders a disabled placeholder option when placeholder is provided', () => {
    render(
      <Select value="" onChange={() => {}} options={OPTIONS} placeholder="Pick…" />,
    );
    const placeholder = screen.getByRole('option', { name: 'Pick…' });
    expect(placeholder).toBeDisabled();
  });

  it('fires onChange when an option is selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select value="" onChange={onChange} options={OPTIONS} />);
    await user.selectOptions(screen.getByRole('combobox'), 'b');
    expect(onChange).toHaveBeenCalled();
  });

  it('reflects the controlled value', () => {
    render(<Select value="a" onChange={() => {}} options={OPTIONS} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('a');
  });

  it('applies size modifier', () => {
    render(
      <Select
        value=""
        onChange={() => {}}
        options={OPTIONS}
        inputSize="sm"
        data-testid="s"
      />,
    );
    expect(screen.getByTestId('s')).toHaveClass('select-size-sm');
  });

  it('sets aria-invalid when error is provided', () => {
    render(
      <Select
        value=""
        onChange={() => {}}
        options={OPTIONS}
        error="required"
      />,
    );
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  });
});
