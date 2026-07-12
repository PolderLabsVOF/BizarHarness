import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchInput } from '../../../src/web/ui/controls/SearchInput';

describe('SearchInput', () => {
  it('renders a searchbox with the value', () => {
    render(<SearchInput value="hi" onChange={() => {}} />);
    const input = screen.getByRole('searchbox');
    expect(input).toHaveValue('hi');
  });

  it('fires onChange when typing', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchInput value="" onChange={onChange} />);
    await user.type(screen.getByRole('searchbox'), 'a');
    expect(onChange).toHaveBeenCalled();
  });

  it('shows a clear button when value is non-empty and clears on click', async () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchInput
        value="something"
        onChange={onChange}
        onClear={onClear}
      />,
    );
    const clearBtn = screen.getByRole('button', { name: 'Clear search' });
    await user.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith('');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('does not show a clear button when value is empty', () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(
      screen.queryByRole('button', { name: 'Clear search' }),
    ).not.toBeInTheDocument();
  });

  it('is disabled when disabled is set', () => {
    render(<SearchInput value="x" onChange={() => {}} disabled />);
    expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Clear search' }),
    ).not.toBeInTheDocument();
  });
});
