// src/lib/utils.ts — tiny shared helpers.

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Compact relative time. */
export function formatRelative(ts: number | string | Date | undefined | null): string {
  if (!ts && ts !== 0) return '';
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(t).toLocaleDateString();
}

/** Full localized timestamp. */
export function formatTime(ts: number | string | Date | undefined | null): string {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

/** Trailing-suffix truncation. */
export function truncate(s: string | undefined | null, max = 160): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Debounce. */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms = 200,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Color helpers (status badges). */
export const priorityColors: Record<string, string> = {
  low: 'var(--text-dim)',
  normal: 'var(--info)',
  high: 'var(--error)',
};

export const statusBadgeKind = (
  status: string,
): 'success' | 'warning' | 'error' | 'info' | 'accent' | '' => {
  switch (status) {
    case 'approved':
    case 'done':
      return 'success';
    case 'draft':
    case 'queued':
      return '';
    case 'in-progress':
    case 'doing':
      return 'info';
    case 'rejected':
      return 'error';
    default:
      return 'accent';
  }
};

/** Cheap hash for change-detection on text (e.g. raw JSON). */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}
