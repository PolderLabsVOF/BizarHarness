/*
 * feedback/index.ts — Barrel export for the Bizar feedback components (Wave 2C).
 *
 * Side-effect imports ship `feedback.css` alongside the JS so consumers
 * only need `import { ToastProvider, useToast } from '../ui/feedback'`
 * to mount the visual surface. Exports are deliberately focused — no
 * re-export of legacy components, no prefix collisions.
 */

import './feedback.css';

export {
  ToastProvider,
  useToast,
  type ToastProviderProps,
  type ToastApi,
  type ToastItem,
  type ToastKind,
} from './Toast';
export { Dialog, type DialogProps } from './Dialog';
export {
  Tooltip,
  type TooltipProps,
  type TooltipSide,
} from './Tooltip';
export {
  Badge,
  type BadgeProps,
  type BadgeVariant,
  type BadgeSize,
} from './Badge';
export {
  StatusDot,
  type StatusDotProps,
  type StatusDotVariant,
  type StatusDotSize,
} from './StatusDot';
export {
  ProgressBar,
  type ProgressBarProps,
  type ProgressVariant,
  type ProgressSize,
} from './ProgressBar';
