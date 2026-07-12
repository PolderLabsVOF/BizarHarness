import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Slider } from '../../../src/web/ui/controls/Slider';

describe('Slider', () => {
  it('renders a slider with the supplied value', () => {
    render(<Slider value={20} onChange={() => {}} />);
    const input = screen.getByRole('slider') as HTMLInputElement;
    expect(input.value).toBe('20');
  });

  it('fires onChange with a number when the value changes', () => {
    const onChange = vi.fn();
    render(<Slider value={0} onChange={onChange} min={0} max={10} />);
    const input = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(typeof lastCall).toBe('number');
    expect(lastCall).toBe(5);
  });

  it('renders the label and value readout when showValue is true', () => {
    render(<Slider value={42} onChange={() => {}} label="Volume" showValue />);
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('forwards min/max/step to the native input', () => {
    render(<Slider value={1} onChange={() => {}} min={0} max={10} step={2} />);
    const input = screen.getByRole('slider') as HTMLInputElement;
    expect(input.min).toBe('0');
    expect(input.max).toBe('10');
    expect(input.step).toBe('2');
  });

  it('is disabled when disabled is set', () => {
    render(<Slider value={1} onChange={() => {}} disabled />);
    expect(screen.getByRole('slider')).toBeDisabled();
  });
});
