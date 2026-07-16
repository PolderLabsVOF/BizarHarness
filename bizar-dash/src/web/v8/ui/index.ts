/**
 * v8 UI barrel — public surface of the v8 component library.
 *
 * Naming convention:
 *   - layouts/primitives → exported directly
 *   - controls/*         → Sprint S2
 *   - feedback/*         → Sprint S2
 *   - data/*             → Sprint S3
 *   - navigation/*       → Sprint S4
 *   - kanban/*           → Sprint S5 (centerpiece)
 *
 * Always import from this barrel — never reach into individual files.
 * That keeps refactors inside the v8 tree trivial.
 */

// primitives (Sprint S1)
export { Box, type BoxProps, type BoxStyleProps } from './primitives/Box.js';
export { Stack, type StackProps } from './primitives/Stack.js';
export { Inline, type InlineProps } from './primitives/Inline.js';
export { Cluster, type ClusterProps } from './primitives/Cluster.js';
export { Grid, type GridProps, type GridCols } from './primitives/Grid.js';
export { Center, type CenterProps } from './primitives/Center.js';
export { Separator, type SeparatorProps } from './primitives/Separator.js';
export { ScrollArea, type ScrollAreaProps } from './primitives/ScrollArea.js';
export { Portal, type PortalProps } from './primitives/Portal.js';
export { VisuallyHidden, type VisuallyHiddenProps } from './primitives/VisuallyHidden.js';

// utils
export { cx } from './utils/cx.js';

// theme
export {
  ThemeProvider,
  type ThemeProviderProps,
  type ThemeMode,
  type ResolvedTheme,
  type ThemeContextValue,
  ThemeContext,
} from './theme/ThemeProvider.js';
export { useTheme } from './theme/useTheme.js';
export {
  DensityProvider,
  type DensityProviderProps,
  type Density,
  type DensityContextValue,
  DensityContext,
} from './theme/DensityProvider.js';
export { useDensity } from './theme/useDensity.js';
export { ThemeToggle, DensityToggle } from './theme/ThemeToggle.js';

// ── controls (Sprint S2) ─────────────────────────────────────────────────

export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from './controls/Button.js';
export {
  IconButton,
  type IconButtonProps,
  type IconButtonVariant,
  type IconButtonSize,
} from './controls/IconButton.js';
export { ButtonGroup, type ButtonGroupProps } from './controls/ButtonGroup.js';
export { Input, type InputProps } from './controls/Input.js';
export { Textarea, type TextareaProps } from './controls/Textarea.js';
export { Checkbox, type CheckboxProps } from './controls/Checkbox.js';
export { Switch, type SwitchProps } from './controls/Switch.js';
export { Toggle, type ToggleProps } from './controls/Toggle.js';
export {
  ToggleGroup,
  ToggleGroupItem,
  type ToggleGroupProps,
  type ToggleGroupItemProps,
  type ToggleGroupType,
} from './controls/ToggleGroup.js';
export { RadioGroup, RadioGroupItem, type RadioGroupProps } from './controls/RadioGroup.js';
export {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
  type SelectProps,
} from './controls/Select.js';
export { Slider, type SliderProps } from './controls/Slider.js';
export { Field, type FieldProps } from './controls/Field.js';
export { Form, type FormProps } from './controls/Form.js';

// ── feedback (Sprint S2) ─────────────────────────────────────────────────

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogPortal,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  type DialogProps,
  type DialogContentProps,
  type DialogSize,
} from './feedback/Dialog.js';
export {
  Tooltip,
  TooltipProvider,
  type TooltipProps,
  type TooltipSide,
  type TooltipAlign,
} from './feedback/Tooltip.js';
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverClose,
  type PopoverProps,
  type PopoverContentProps,
} from './feedback/Popover.js';
export { Toaster, toast, type ToasterProps } from './feedback/Toast.js';
export { Alert, type AlertProps, type AlertTone } from './feedback/Alert.js';
export { Banner, type BannerProps } from './feedback/Banner.js';
export { Skeleton, SkeletonText, type SkeletonProps } from './feedback/Skeleton.js';
export { Spinner, type SpinnerProps } from './feedback/Spinner.js';
export { EmptyState, type EmptyStateProps } from './feedback/EmptyState.js';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  type DropdownMenuProps,
  type DropdownMenuContentProps,
  type DropdownMenuItemProps,
} from './feedback/DropdownMenu.js';
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuGroup,
  type ContextMenuProps,
  type ContextMenuContentProps,
  type ContextMenuItemProps,
} from './feedback/ContextMenu.js';
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  type SheetProps,
  type SheetContentProps,
  type SheetSide,
} from './feedback/Sheet.js';
export {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerClose,
} from './feedback/Drawer.js';

// ── data (Sprint S3) ──────────────────────────────────────────────────────

export { Card, CardHeader, CardBody, CardFooter, type CardProps, type CardHeaderProps, type CardVariant } from './data/Card.js';
export { Badge, type BadgeProps, type BadgeTone, type BadgeSize } from './data/Badge.js';
export { Chip, type ChipProps } from './data/Chip.js';
export { Avatar, AvatarStack, type AvatarProps, type AvatarSize, type AvatarStackProps } from './data/Avatar.js';
export { StatTile, StatGrid, type StatTileProps, type StatTrend, type StatGridProps } from './data/StatTile.js';
export { Sparkline, type SparklineProps } from './data/Sparkline.js';
export { BarList, type BarListProps, type BarListItem } from './data/BarList.js';
export { Timeline, type TimelineProps, type TimelineItem } from './data/Timeline.js';
export {
  Accordion,
  AccordionItem,
  type AccordionProps,
  type AccordionItemProps,
} from './data/Accordion.js';
export { ViewHeader, type ViewHeaderProps, type BreadcrumbItem } from './data/ViewHeader.js';
export {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
  type TableProps,
  type TableHeadProps,
  type TableBodyProps,
  type TableRowProps,
  type TableHeaderProps,
  type TableCellProps,
} from './data/Table.js';
export { Kbd, type KbdProps } from './data/Kbd.js';

// ── navigation (Sprint S4) ────────────────────────────────────────────────

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  type TabsProps,
  type TabsListProps,
  type TabsTriggerProps,
  type TabsVariant,
} from './navigation/Tabs.js';
export { NavLink, type NavLinkProps } from './navigation/NavLink.js';
export { Pagination, type PaginationProps } from './navigation/Pagination.js';
export {
  CommandPalette,
  CommandPaletteGroup,
  CommandPaletteItem,
  CommandPaletteSeparator,
  useCommandPaletteHotkey,
  type CommandPaletteProps,
  type CommandPaletteGroupProps,
  type CommandPaletteItemProps,
} from './navigation/CommandPalette.js';

// ── kanban (Sprint S5 — centerpiece) ──────────────────────────────────────

export {
  KanbanCard,
  useKanbanCardSortable,
  type KanbanCardProps,
  type KanbanCardData,
  type KanbanCardVariant,
  type KanbanPriority,
} from './kanban/KanbanCard.js';
export {
  KanbanColumn,
  type KanbanColumnProps,
  type KanbanColumnData,
} from './kanban/KanbanColumn.js';
export {
  KanbanBoard,
  KanbanBoardContext,
  useKanbanBoard,
  type KanbanBoardProps,
  type KanbanBoardContextValue,
} from './kanban/KanbanBoard.js';
export { KanbanQuickAdd, type KanbanQuickAddProps } from './kanban/KanbanQuickAdd.js';
export { KanbanContextMenu, type KanbanContextMenuProps } from './kanban/KanbanContextMenu.js';
export {
  KanbanToolbar,
  type KanbanToolbarProps,
  type KanbanFilter,
} from './kanban/KanbanToolbar.js';
export {
  KanbanDetailDialog,
  type KanbanDetailDialogProps,
} from './kanban/KanbanDetailDialog.js';
export {
  KanbanEmptyColumn,
  type KanbanEmptyColumnProps,
} from './kanban/KanbanEmptyColumn.js';
export {
  KanbanProgress,
  type KanbanProgressProps,
} from './kanban/KanbanProgress.js';
export {
  KanbanCardBadges,
  type KanbanCardBadgesProps,
  type KanbanCardBadge,
} from './kanban/KanbanCardBadges.js';
export {
  useKanbanSelection,
  type UseKanbanSelectionApi,
} from './kanban/useKanbanSelection.js';

// ── goals (Sprint S6) ─────────────────────────────────────────────────────

export {
  GoalCard,
  type GoalCardProps,
  type GoalStatus,
} from './goals/GoalCard.js';
export {
  KeyResult,
  type KeyResultProps,
  type KeyResultStatus,
} from './goals/KeyResult.js';

// ── agents (Sprint S6) ────────────────────────────────────────────────────

export {
  AgentCard,
  type AgentCardProps,
  type AgentStatus,
} from './agents/AgentCard.js';
export {
  AgentActivity,
  type AgentActivityProps,
  type AgentActivityItem,
} from './agents/AgentActivity.js';

// ── activity (Sprint S7) ──────────────────────────────────────────────────

export {
  ActivityFeed,
  type ActivityFeedProps,
  type ActivityItem,
  type ActivityTone,
} from './activity/ActivityFeed.js';

// ── memory (Sprint S7) ────────────────────────────────────────────────────

export {
  MemoryVault,
  type MemoryVaultProps,
  type MemoryEntry,
  type MemoryScope,
} from './memory/MemoryVault.js';

// ── libraries (Sprint S7) ─────────────────────────────────────────────────

export {
  LibraryItem,
  type LibraryItemProps,
  type LibraryStatus,
} from './libraries/LibraryItem.js';
export { LibraryGrid, type LibraryGridProps } from './libraries/LibraryGrid.js';

// ── settings (Sprint S8) ──────────────────────────────────────────────────

export {
  SettingsSection,
  type SettingsSectionProps,
} from './settings/SettingsSection.js';
export {
  SettingsRow,
  type SettingsRowProps,
} from './settings/SettingsRow.js';
export {
  SettingsNav,
  type SettingsNavProps,
  type SettingsNavItem,
} from './settings/SettingsNav.js';

// ── chat (Sprint S37, v9.3.0) ───────────────────────────────────────────

export { readEventStream, type EventStreamHandlers, type EventStreamOptions } from './chat/EventStream.js';
export { MessageBubble, EmptyTranscript, type MessageBubbleProps } from './chat/MessageBubble.js';
export { ChatDrawer, type ChatDrawerProps } from './chat/ChatDrawer.js';