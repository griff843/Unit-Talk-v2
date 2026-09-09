import * as React from 'react';

export const SIGNED_INTEGER_PATTERN = '[+-]?[0-9]+';
export const SIGNED_DECIMAL_PATTERN = '[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)';

/** A lone sign, which `Number()` reads as NaN but an operator has simply not finished typing. */
const LONE_SIGN = /^[+-]$/;

/**
 * The value a signed field takes after one keystroke, given the raw input string.
 *
 * A partially typed number is returned verbatim rather than coerced. `Number('-3.')` is `-3`,
 * which re-renders as `-3` and eats the decimal point the operator just typed, making a spread like
 * -3.5 unenterable one keystroke at a time; `Number('-0')` is `-0`, which renders as `0` and eats
 * the sign. Comparing the round-trip catches every such state without enumerating them. Input that is
 * not a number at all returns `null`, which the input reads as "reject this keystroke" and leaves
 * the field unchanged. The form schema remains authoritative for what is finally accepted.
 */
export function nextSignedInputValue(raw: string): number | string | undefined | null {
  if (raw === '') {
    return undefined;
  }
  if (LONE_SIGN.test(raw)) {
    return raw;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return String(parsed) === raw ? parsed : raw;
}

export interface SignedNumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'inputMode' | 'onChange' | 'pattern' | 'type'> {
  integerOnly?: boolean;
  onValueChange: (value: number | string | undefined) => void;
}

/**
 * Text input is intentional: mobile numeric and decimal keypads commonly omit
 * the minus key. The signed pattern preserves browser validation semantics,
 * while the form schema remains authoritative for numeric ranges.
 */
export const SignedNumberInput = React.forwardRef<HTMLInputElement, SignedNumberInputProps>(
  ({ className, integerOnly = false, onValueChange, value, ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      type="text"
      inputMode="text"
      pattern={integerOnly ? SIGNED_INTEGER_PATTERN : SIGNED_DECIMAL_PATTERN}
      className={[
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      ].filter(Boolean).join(' ')}
      value={value ?? ''}
      onChange={(event) => {
        const next = nextSignedInputValue(event.target.value);
        if (next === null) {
          return;
        }
        onValueChange(next);
      }}
    />
  ),
);

SignedNumberInput.displayName = 'SignedNumberInput';
