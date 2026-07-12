import { describe, it, expect } from 'vitest';
import { cx } from '../ui/utils/cx.js';

describe('cx', () => {
  it('returns a single class verbatim', () => {
    expect(cx('btn')).toBe('btn');
  });

  it('joins truthy values with a space', () => {
    expect(cx('btn', 'btn--primary', undefined, false, null)).toBe('btn btn--primary');
  });

  it('honors object conditionals', () => {
    expect(cx('btn', { 'btn--active': true, 'btn--disabled': false })).toBe('btn btn--active');
  });

  it('lets later tailwind utilities win', () => {
    expect(cx('p-2', 'p-4')).toBe('p-4');
    expect(cx('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('drops falsy values without leaving double spaces', () => {
    expect(cx('a', undefined, 'b', null, '', 'c')).toBe('a b c');
  });
});