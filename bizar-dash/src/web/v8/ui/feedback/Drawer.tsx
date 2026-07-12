/**
 * Drawer — alias for the right-side Sheet. The semantic distinction exists
 * because in v8 a Drawer is task / agent detail (right side, fixed width)
 * while a Sheet is more general (4 sides).
 *
 * Use this component name when you want a detail panel.
 */
export { Sheet as Drawer, SheetContent as DrawerContent, SheetTrigger as DrawerTrigger, SheetClose as DrawerClose } from './Sheet.js';