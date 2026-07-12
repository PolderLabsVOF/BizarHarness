/*
 * index.ts — Barrel for the Data component family (Wave 2B).
 *
 * Imports data.css as a side-effect so consumers only need a single
 * `import { StatTile } from '../ui/data'` to ship the styles. All 8
 * components are exported by name + type so consumers can pick either.
 */

import './data.css';

export { StatTile, type StatTileProps } from './StatTile';
export { Sparkline, type SparklineProps } from './Sparkline';
export {
  BarChart,
  type BarChartProps,
  type BarChartDatum,
} from './BarChart';
export {
  DataTable,
  type DataTableProps,
  type DataTableColumn,
  type DataTableSort,
} from './DataTable';
export {
  KeyValueList,
  type KeyValueListProps,
  type KeyValueItem,
} from './KeyValueList';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { LoadingState, type LoadingStateProps } from './LoadingState';
export { ErrorState, type ErrorStateProps } from './ErrorState';
