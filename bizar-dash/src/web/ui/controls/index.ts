/*
 * index.ts — Barrel for form controls (Wave 2A).
 *
 * Side-effect import of controls.css ships the stylesheet to any
 * consumer that imports from this module graph. Wave 2's ui/index.ts
 * re-exports the exports below — leaving the CSS wiring here means
 * styles arrive without an additional integration step.
 */

import './controls.css';

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { IconButton } from './IconButton';
export type { IconButtonProps, IconButtonVariant, IconButtonSize } from './IconButton';
export { Toggle } from './Toggle';
export type { ToggleProps, ToggleSize } from './Toggle';
export { TextInput } from './TextInput';
export type { TextInputProps, TextInputSize } from './TextInput';
export { NumberInput } from './NumberInput';
export type { NumberInputProps, NumberInputSize } from './NumberInput';
export { Select } from './Select';
export type { SelectProps, SelectOption, SelectSize } from './Select';
export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';
export { RadioGroup } from './RadioGroup';
export type { RadioGroupProps, RadioOption, RadioOrientation } from './RadioGroup';
export { Slider } from './Slider';
export type { SliderProps } from './Slider';
export { SearchInput } from './SearchInput';
export type { SearchInputProps, SearchInputSize } from './SearchInput';
export { Kbd } from './Kbd';
export type { KbdProps } from './Kbd';
