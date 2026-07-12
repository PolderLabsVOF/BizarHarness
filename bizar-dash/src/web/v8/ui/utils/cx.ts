/**
 * cx — className combiner.
 *
 * Wraps `clsx` (truthy filtering + conditionals) with `tailwind-merge`
 * (later utilities win — `cx('p-2', 'p-4')` → `'p-4'`).
 *
 * Usage:
 *   cx('btn', isActive && 'btn--active', props.className)
 *
 * Why a wrapper: keeps imports to one symbol across the v8 codebase and
 * lets us swap the implementation later (or add caching) without ripping
 * through every component.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cx(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
