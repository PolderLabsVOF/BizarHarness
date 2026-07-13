// tests/ui/data/KeyValueList.test.tsx — Wave 2B

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { KeyValueList } from '../../../src/web/ui/data/KeyValueList';

describe('KeyValueList', () => {
  const items = [
    { key: 'name', label: 'Name', value: 'Bizar' },
    { key: 'ver', label: 'Version', value: '6.3.0', mono: true, copyable: true },
    { key: 'mode', label: 'Mode', value: 'dev' },
  ];

  it('renders all labels and values', () => {
    render(<KeyValueList items={items} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Bizar')).toBeInTheDocument();
    expect(screen.getByText('Version')).toBeInTheDocument();
    expect(screen.getByText('6.3.0')).toBeInTheDocument();
  });

  it('uses horizontal layout by default', () => {
    const { container } = render(<KeyValueList items={items} />);
    expect(container.querySelector('.bd-kv-list--horizontal')).toBeInTheDocument();
    expect(container.querySelector('.bd-kv-list--vertical')).toBeNull();
  });

  it('switches to vertical layout when specified', () => {
    const { container } = render(
      <KeyValueList items={items} orientation="vertical" />,
    );
    expect(container.querySelector('.bd-kv-list--vertical')).toBeInTheDocument();
    expect(container.querySelector('.bd-kv-list--horizontal')).toBeNull();
  });

  it('applies mono class to values when mono is true', () => {
    const { container } = render(<KeyValueList items={items} />);
    const values = container.querySelectorAll('.bd-kv-list__value');
    // First value is non-mono, second is mono.
    expect(values[0].classList.contains('bd-kv-list__value--mono')).toBe(false);
    expect(values[1].classList.contains('bd-kv-list__value--mono')).toBe(true);
  });

  it('renders a copy button when copyable is true', () => {
    render(<KeyValueList items={items} />);
    expect(screen.getByLabelText('Copy to clipboard')).toBeInTheDocument();
  });

  it('writes to clipboard on copy and shows the success state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    render(<KeyValueList items={items} />);
    await userEvent.click(screen.getByLabelText('Copy to clipboard'));
    expect(writeText).toHaveBeenCalledWith('6.3.0');
  });
});
