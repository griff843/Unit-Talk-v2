'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

// GAUNTLET-CLOSEOUT-028: Fix Radix UI type inference issue
// Cast to any to work around strict type inference
const LabelRoot = LabelPrimitive.Root as any;

const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
);

// Explicit interface to expose className and other standard props
interface LabelProps extends VariantProps<typeof labelVariants> {
  className?: string;
  children?: React.ReactNode;
  htmlFor?: string;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <LabelRoot ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = 'Label';

export { Label };
