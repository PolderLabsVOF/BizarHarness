/*
 * KeyValueList.tsx — Definition-list style rows (Wave 2B).
 *
 * Renders label/value pairs in either a definition-grid (horizontal, two
 * columns) or stacked (vertical, label above value) layout. Each value can
 * be opt-in mono-font and/or copyable — `copyable` adds a small icon button
 * that copies `String(value)` to the clipboard and briefly switches to a
 * checkmark so the action is confirmed. The whole item is keyboard-focusable
 * for screen-reader users.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, Copy } from 'lucide-react';
import { cx } from '../utils/cx';

export type KeyValueItem = {
  key: string;
  label: string;
  value: ReactNode;
  mono?: boolean;
  copyable?: boolean;
};

export type KeyValueListProps = {
  items: KeyValueItem[];
  orientation?: 'horizontal' | 'vertical';
  className?: string;
};

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onClick = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setDone(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1500);
      })
      .catch(() => {
        // ignore — clipboard may be unavailable in private mode
      });
  }, [text]);

  return (
    <button
      type="button"
      className={cx('bd-kv-list__copy', done && 'bd-kv-list__copy--done')}
      aria-label={done ? 'Copied' : 'Copy to clipboard'}
      onClick={onClick}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function KeyValueList({
  items,
  orientation = 'horizontal',
  className,
}: KeyValueListProps): React.JSX.Element {
  return (
    <dl
      className={cx(
        'bd-kv-list',
        orientation === 'horizontal'
          ? 'bd-kv-list--horizontal'
          : 'bd-kv-list--vertical',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.key} className="bd-kv-list__row">
          <dt className="bd-kv-list__label">{item.label}</dt>
          <dd
            className={cx(
              'bd-kv-list__value',
              item.mono && 'bd-kv-list__value--mono',
            )}
          >
            <span>{item.value}</span>
            {item.copyable && (
              <CopyButton text={String(item.value)} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
