import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import * as RxSlider from '@radix-ui/react-slider';
import { cx } from '../utils/cx.js';

/**
 * Slider — single or range numeric input.
 *
 * Built on Radix Slider for keyboard arrow + home/end handling.
 */
export type SliderProps = ComponentPropsWithoutRef<typeof RxSlider.Root>;

export const Slider = forwardRef<HTMLSpanElement, SliderProps>(function Slider(props, ref) {
  const { className, ...rest } = props;
  return (
    <RxSlider.Root
      ref={ref}
      className={cx('v8-slider', className)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        userSelect: 'none',
        touchAction: 'none',
        width: '100%',
        height: 20,
      }}
      {...rest}
    >
      <RxSlider.Track
        style={{
          background: 'var(--surface-2)',
          position: 'relative',
          flexGrow: 1,
          borderRadius: 'var(--radius-pill)',
          height: 4,
        }}
      >
        <RxSlider.Range
          style={{
            position: 'absolute',
            background: 'var(--accent)',
            borderRadius: 'var(--radius-pill)',
            height: '100%',
          }}
        />
      </RxSlider.Track>
      {(Array.isArray(props.value ?? props.defaultValue)
        ? (props.value ?? props.defaultValue ?? [])
        : [props.value ?? props.defaultValue ?? 0]
      ).map((_, i) => (
        <RxSlider.Thumb
          key={i}
          aria-label={props['aria-label'] ?? `Thumb ${i + 1}`}
          style={{
            display: 'block',
            width: 14,
            height: 14,
            background: 'var(--fg)',
            border: '2px solid var(--accent)',
            borderRadius: 'var(--radius-pill)',
            cursor: 'grab',
            boxShadow: 'var(--shadow-1)',
          }}
        />
      ))}
    </RxSlider.Root>
  );
});