import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextInput } from '../../../src/web/ui/controls/TextInput';

describe('TextInput', () => {
  it('renders and accepts typed input', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TextInput value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'hello');
    expect(onChange).toHaveBeenCalled();
    expect(input).toBeInTheDocument();
  });

  it('applies the size modifier class', () => {
    render(<TextInput value="" onChange={() => {}} inputSize="lg" />);
    expect(screen.getByRole('textbox').parentElement).toHaveClass('field-size-lg');
  });

  it('marks itself aria-invalid when error is set', () => {
    render(<TextInput value="" onChange={() => {}} error="Required" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveClass('field-error');
  });

  it('is disabled when disabled is set', () => {
    render(<TextInput value="" onChange={() => {}} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('renders leftIcon when provided', () => {
    render(
      <TextInput
        value=""
        onChange={() => {}}
        leftIcon={<span data-testid="icon">L</span>}
      />,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
});
