import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Star } from 'lucide-react';
import { IconButton } from '../../../src/web/ui/controls/IconButton';

describe('IconButton', () => {
  it('renders an accessible button with the supplied label', () => {
    render(<IconButton aria-label="Star" icon={<Star data-testid="i" />} />);
    expect(screen.getByRole('button', { name: 'Star' })).toBeInTheDocument();
  });

  it('forwards onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <IconButton aria-label="X" icon={<Star />} onClick={onClick} />,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies variant + size classes', () => {
    const { container } = render(
      <IconButton aria-label="X" icon={<Star />} variant="danger" size="lg" />,
    );
    const btn = container.firstChild as HTMLElement;
    expect(btn).toHaveClass('icon-btn-danger', 'icon-btn-size-lg');
  });

  it('is disabled when disabled is set', () => {
    render(
      <IconButton aria-label="X" icon={<Star />} disabled />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
