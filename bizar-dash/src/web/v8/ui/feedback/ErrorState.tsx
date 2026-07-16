import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { Alert } from './Alert.js';
import { Button } from '../controls/Button.js';

/**
 * ErrorState — surfaced error with optional retry CTA.
 *
 * Use when a view's primary fetch failed and we want to recover,
 * not when the fetch succeeded with zero rows (use EmptyState).
 *
 * Two layout modes:
 * - inline (default): Alert-tone=danger banner with optional retry button
 * - block: centered icon + title + description + retry (mirrors EmptyState)
 *
 * `error` is the raw error (Error | string | null). When non-null,
 * the message is rendered below the title. Use the `silent` flag to
 * omit the message (e.g. when the parent already shows it).
 */
export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  error?: Error | string | null;
  onRetry?: () => void;
  retryLabel?: string;
  /** Use the centered block layout instead of the inline Alert. */
  block?: boolean;
  /** Hide the error message (parent surfaces it elsewhere). */
  silent?: boolean;
  testid?: string;
}

function errMessage(error: Error | string | null | undefined): string {
  if (error === null || error === undefined) return '';
  return typeof error === 'string' ? error : error.message;
}

export const ErrorState = forwardRef<HTMLDivElement, ErrorStateProps>(function ErrorState(
  props,
  ref,
) {
  const {
    title = 'Something went wrong',
    description,
    error,
    onRetry,
    retryLabel = 'Retry',
    block = false,
    silent = false,
    testid,
    className,
    ...rest
  } = props;

  const message = silent ? '' : errMessage(error);

  if (block) {
    return (
      <div
        ref={ref}
        data-testid={testid ?? 'error-state'}
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-12) var(--space-6)',
          textAlign: 'center',
          color: 'var(--fg-muted)',
        }}
        {...rest}
      >
        <div style={{ color: 'var(--danger)', display: 'inline-flex' }}>
          <AlertCircle size={28} aria-hidden />
        </div>
        <div style={{ fontSize: 'var(--fs-16)', fontWeight: 600, color: 'var(--fg)' }}>{title}</div>
        {description !== undefined && (
          <div style={{ fontSize: 'var(--fs-13)', maxWidth: 480 }}>{description}</div>
        )}
        {message !== '' && (
          <code style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)' }}>{message}</code>
        )}
        {onRetry !== undefined && (
          <Button variant="primary" onClick={onRetry} data-testid="error-state-retry">
            <RefreshCcw size={14} aria-hidden /> {retryLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} data-testid={testid ?? 'error-state'} className={className} {...rest}>
      <Alert
        tone="danger"
        title={title}
        action={
          onRetry !== undefined ? (
            <Button variant="ghost" onClick={onRetry} data-testid="error-state-retry" aria-label={retryLabel}>
              <RefreshCcw size={14} aria-hidden /> {retryLabel}
            </Button>
          ) : undefined
        }
      >
        {description}
        {message !== '' && (
          <div style={{ marginTop: 'var(--space-1)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>
            {message}
          </div>
        )}
      </Alert>
    </div>
  );
});