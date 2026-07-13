import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup } from '../../../src/web/ui/controls/RadioGroup';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', description: 'B-description' },
  { value: 'c', label: 'Gamma', disabled: true },
];

describe('RadioGroup', () => {
  it('renders a radiogroup with the options', () => {
    render(<RadioGroup name="g" value="a" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Beta/ })).toBeInTheDocument();
  });

  it('marks the controlled option as checked', () => {
    render(
      <RadioGroup name="g" value="b" onChange={() => {}} options={OPTIONS} />,
    );
    expect(screen.getByRole('radio', { name: /Beta/ })).toBeChecked();
  });

  it('fires onChange with the chosen value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RadioGroup name="g" value="a" onChange={onChange} options={OPTIONS} />,
    );
    await user.click(screen.getByRole('radio', { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('respects the disabled option', () => {
    render(
      <RadioGroup name="g" value="a" onChange={() => {}} options={OPTIONS} />,
    );
    const gamma = screen.getByRole('radio', { name: /Gamma/ });
    expect(gamma).toBeDisabled();
  });

  it('applies the horizontal orientation class', () => {
    render(
      <RadioGroup
        name="g"
        value="a"
        onChange={() => {}}
        options={OPTIONS}
        orientation="horizontal"
        data-testid="rg"
      />,
    );
    expect(screen.getByTestId('rg')).toHaveClass('radio-group-horizontal');
  });
});
