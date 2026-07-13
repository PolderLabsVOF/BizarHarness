import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from '../../../src/web/ui/controls/Textarea';

describe('Textarea', () => {
  it('renders and accepts typed input', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Textarea value="" onChange={onChange} aria-label="Description" />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'hello');
    expect(onChange).toHaveBeenCalled();
    expect(input).toBeInTheDocument();
  });

  it('applies the size modifier class on the wrapper', () => {
    render(<Textarea value="" onChange={() => {}} inputSize="lg" aria-label="Lg" />);
    // .field-size-lg sits on the .field wrapper, not the inner textarea.
    expect(screen.getByLabelText('Lg').parentElement).toHaveClass('field-size-lg');
  });

  it('marks itself aria-invalid when error is set', () => {
    render(<Textarea value="" onChange={() => {}} error="Required" aria-label="Err" />);
    const input = screen.getByLabelText('Err');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveClass('field-error');
  });

  it('is disabled when disabled is set', () => {
    render(<Textarea value="" onChange={() => {}} disabled aria-label="Dis" />);
    expect(screen.getByLabelText('Dis')).toBeDisabled();
  });

  it('renders the hint slot when provided', () => {
    render(
      <Textarea
        value=""
        onChange={() => {}}
        hint={<span data-testid="hint">Markdown ok</span>}
        aria-label="With hint"
      />,
    );
    expect(screen.getByTestId('hint')).toBeInTheDocument();
  });

  it('defaults rows to 4 when not provided', () => {
    render(<Textarea value="" onChange={() => {}} aria-label="R" />);
    expect(screen.getByLabelText('R')).toHaveAttribute('rows', '4');
  });

  it('honours an explicit rows override', () => {
    render(<Textarea value="" onChange={() => {}} rows={8} aria-label="R8" />);
    expect(screen.getByLabelText('R8')).toHaveAttribute('rows', '8');
  });
});