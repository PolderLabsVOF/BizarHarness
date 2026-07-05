import { describe, it, expect, vi } from 'vitest';
import {
  cn,
  formatRelative,
  formatTime,
  truncate,
  debounce,
  statusBadgeKind,
  hashText,
  autoTitleFromContent,
} from '../../src/web/lib/utils';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('filters falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('returns empty string with no args', () => {
    expect(cn()).toBe('');
  });
});

describe('formatRelative', () => {
  it('returns empty string for null/undefined', () => {
    expect(formatRelative(null)).toBe('');
    expect(formatRelative(undefined)).toBe('');
  });

  it('returns "just now" for recent timestamps', () => {
    expect(formatRelative(Date.now())).toBe('just now');
    expect(formatRelative(Date.now() + 1000)).toBe('just now');
  });

  it('returns minutes', () => {
    const fiveMinAgo = Date.now() - 5 * 60_000;
    expect(formatRelative(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours', () => {
    const twoHoursAgo = Date.now() - 2 * 3_600_000;
    expect(formatRelative(twoHoursAgo)).toBe('2h ago');
  });

  it('returns days', () => {
    const threeDaysAgo = Date.now() - 3 * 86_400_000;
    expect(formatRelative(threeDaysAgo)).toBe('3d ago');
  });

  it('returns localized date for older timestamps', () => {
    const oldDate = Date.now() - 30 * 86_400_000;
    const result = formatRelative(oldDate);
    expect(result).not.toMatch(/^(just now|\d+[mhd] ago)$/);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatTime', () => {
  it('returns empty for null/undefined', () => {
    expect(formatTime(null)).toBe('');
    expect(formatTime(undefined)).toBe('');
  });

  it('formats a Date object', () => {
    const d = new Date('2024-06-15T12:00:00');
    const result = formatTime(d);
    expect(result).toBe(d.toLocaleString());
  });

  it('formats a timestamp number', () => {
    const ts = new Date('2024-06-15T12:00:00').getTime();
    expect(formatTime(ts)).toBe(new Date(ts).toLocaleString());
  });
});

describe('truncate', () => {
  it('returns empty for null/undefined', () => {
    expect(truncate(null)).toBe('');
    expect(truncate(undefined)).toBe('');
  });

  it('returns string as-is when shorter than max', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis when longer than max', () => {
    expect(truncate('hello world this is long', 10)).toBe('hello worl…');
  });

  it('uses default max of 160', () => {
    const short = 'a'.repeat(100);
    expect(truncate(short)).toBe(short);
    const long = 'a'.repeat(200);
    expect(truncate(long)).toHaveLength(161);
    expect(truncate(long)).toMatch(/…$/);
  });
});

describe('debounce', () => {
  it('delays execution', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('calls with the latest arguments', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    debounced('b');
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('b');
    vi.useRealTimers();
  });
});

describe('statusBadgeKind', () => {
  it('returns success for approved/done', () => {
    expect(statusBadgeKind('approved')).toBe('success');
    expect(statusBadgeKind('done')).toBe('success');
  });

  it('returns empty for draft/queued', () => {
    expect(statusBadgeKind('draft')).toBe('');
    expect(statusBadgeKind('queued')).toBe('');
  });

  it('returns info for in-progress/doing', () => {
    expect(statusBadgeKind('in-progress')).toBe('info');
    expect(statusBadgeKind('doing')).toBe('info');
  });

  it('returns error for rejected', () => {
    expect(statusBadgeKind('rejected')).toBe('error');
  });

  it('returns accent for unknown statuses', () => {
    expect(statusBadgeKind('unknown')).toBe('accent');
  });
});

describe('hashText', () => {
  it('returns a string', () => {
    expect(typeof hashText('hello')).toBe('string');
  });

  it('is deterministic', () => {
    expect(hashText('hello')).toBe(hashText('hello'));
  });

  it('differs for different inputs', () => {
    expect(hashText('hello')).not.toBe(hashText('world'));
  });
});

describe('autoTitleFromContent', () => {
  it('extracts first non-empty line', () => {
    expect(autoTitleFromContent('Hello world')).toBe('Hello world');
  });

  it('strips markdown heading markers', () => {
    expect(autoTitleFromContent('## My Feature')).toBe('My Feature');
  });

  it('generates fallback title when body is empty', () => {
    const result = autoTitleFromContent('');
    expect(result).toMatch(/^Untitled task/);
  });

  it('returns empty when fallback is false and body is empty', () => {
    expect(autoTitleFromContent('', false)).toBe('');
  });

  it('truncates long first lines', () => {
    const long = 'a'.repeat(100);
    const result = autoTitleFromContent(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toMatch(/…$/);
  });
});
