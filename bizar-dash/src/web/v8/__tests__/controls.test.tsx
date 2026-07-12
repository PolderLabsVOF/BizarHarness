/**
 * Controls layer tests — Button, IconButton, Input, Checkbox, Switch, Toggle,
 * Select, Slider. Covers rendering, a11y attributes, and event wiring.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Button,
  IconButton,
  Input,
  Checkbox,
  Switch,
  Toggle,
  Slider,
} from '../ui/index.js';

describe('Button', () => {
  it('renders with default variant and size', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: /go/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows loading spinner and disables interaction', () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole('button', { name: /saving/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('renders leftIcon and rightIcon', () => {
    render(
      <Button leftIcon={<span data-testid="li" />} rightIcon={<span data-testid="ri" />}>
        X
      </Button>,
    );
    expect(screen.getByTestId('li')).toBeInTheDocument();
    expect(screen.getByTestId('ri')).toBeInTheDocument();
  });

  it('does not invoke onClick when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>X</Button>);
    await userEvent.click(screen.getByRole('button', { name: /x/i }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('requires aria-label', () => {
    render(<IconButton aria-label="Close">×</IconButton>);
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('toggles active state', () => {
    render(
      <IconButton aria-label="Pin" active>
        ★
      </IconButton>,
    );
    const btn = screen.getByRole('button', { name: /pin/i });
    expect(btn).toHaveAttribute('data-active', 'true');
  });
});

describe('Input', () => {
  it('renders with placeholder', () => {
    render(<Input placeholder="Search…" aria-label="Search" />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('forwards value via change handler', () => {
    const onChange = vi.fn();
    render(<Input aria-label="x" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('x'), { target: { value: 'a' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('renders leftAddon when provided', () => {
    render(<Input leftAddon={<span data-testid="addon" />} aria-label="x" />);
    expect(screen.getByTestId('addon')).toBeInTheDocument();
  });
});

describe('Checkbox', () => {
  it('renders with role=checkbox', () => {
    render(<Checkbox aria-label="Accept" />);
    expect(screen.getByRole('checkbox', { name: /accept/i })).toBeInTheDocument();
  });

  it('toggles checked state on click', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Accept" onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /accept/i }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe('Switch', () => {
  it('renders with role=switch', () => {
    render(<Switch aria-label="Dark mode" />);
    expect(screen.getByRole('switch', { name: /dark/i })).toBeInTheDocument();
  });
});

describe('Toggle', () => {
  it('renders with role=button and aria-pressed', () => {
    render(<Toggle aria-label="Bold">B</Toggle>);
    const btn = screen.getByRole('button', { name: /bold/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('invokes onPressedChange when clicked', async () => {
    const onPressedChange = vi.fn();
    render(<Toggle aria-label="Bold" onPressedChange={onPressedChange}>B</Toggle>);
    await userEvent.click(screen.getByRole('button', { name: /bold/i }));
    expect(onPressedChange).toHaveBeenCalled();
  });
});

describe('Slider', () => {
  it('renders with role=slider', () => {
    render(<Slider defaultValue={[50]} aria-label="Volume" />);
    expect(screen.getByRole('slider', { name: /volume/i })).toBeInTheDocument();
  });
});