'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

// GAUNTLET-CLOSEOUT-028: Fix Radix UI type inference issue
// Cast to any to work around strict type inference
const SelectRoot = SelectPrimitive.Root as any;
const SelectTriggerPrimitive = SelectPrimitive.Trigger as any;
const SelectIconPrimitive = SelectPrimitive.Icon as any;
const SelectPortal = SelectPrimitive.Portal as any;
const SelectContentPrimitive = SelectPrimitive.Content as any;
const SelectViewport = SelectPrimitive.Viewport as any;
const SelectLabelPrimitive = SelectPrimitive.Label as any;
const SelectItemPrimitive = SelectPrimitive.Item as any;
const SelectItemIndicator = SelectPrimitive.ItemIndicator as any;
const SelectItemText = SelectPrimitive.ItemText as any;
const SelectSeparatorPrimitive = SelectPrimitive.Separator as any;

interface SelectProps {
  children?: React.ReactNode;
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  name?: string;
}

const Select: React.FC<SelectProps> = ({ children, ...props }) => (
  <SelectRoot {...props}>{children}</SelectRoot>
);
Select.displayName = 'Select';

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

interface SelectTriggerProps {
  children?: React.ReactNode;
  className?: string;
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => (
    <SelectTriggerPrimitive
      ref={ref}
      className={cn(
        'flex h-10 w-full items-center justify-between rounded-md border border-input bg-white px-3 py-2 text-black ring-offset-background placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
      <SelectIconPrimitive asChild>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </SelectIconPrimitive>
    </SelectTriggerPrimitive>
  )
);
SelectTrigger.displayName = 'SelectTrigger';

interface SelectContentProps {
  children?: React.ReactNode;
  className?: string;
  position?: 'popper' | 'item-aligned';
}

const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children, position = 'popper', ...props }, ref) => (
    <SelectPortal>
      <SelectContentPrimitive
        ref={ref}
        className={cn(
          'relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-white text-black shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className
        )}
        position={position}
        {...props}
      >
        <SelectViewport
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]'
          )}
        >
          {children}
        </SelectViewport>
      </SelectContentPrimitive>
    </SelectPortal>
  )
);
SelectContent.displayName = 'SelectContent';

interface SelectLabelProps {
  children?: React.ReactNode;
  className?: string;
}

const SelectLabel = React.forwardRef<HTMLDivElement, SelectLabelProps>(
  ({ className, children, ...props }, ref) => (
    <SelectLabelPrimitive
      ref={ref}
      className={cn('py-1.5 pl-8 pr-2 text-sm font-semibold text-black', className)}
      {...props}
    >
      {children}
    </SelectLabelPrimitive>
  )
);
SelectLabel.displayName = 'SelectLabel';

interface SelectItemProps {
  children?: React.ReactNode;
  className?: string;
  value: string;
  disabled?: boolean;
}

const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, ...props }, ref) => (
    <SelectItemPrimitive
      ref={ref}
      className={cn(
        'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-black outline-none focus:bg-gray-100 focus:text-black data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectItemIndicator>
          <Check className="h-4 w-4" />
        </SelectItemIndicator>
      </span>
      <SelectItemText>{children}</SelectItemText>
    </SelectItemPrimitive>
  )
);
SelectItem.displayName = 'SelectItem';

interface SelectSeparatorProps {
  className?: string;
}

const SelectSeparator = React.forwardRef<HTMLDivElement, SelectSeparatorProps>(
  ({ className, ...props }, ref) => (
    <SelectSeparatorPrimitive
      ref={ref}
      className={cn('-mx-1 my-1 h-px bg-muted', className)}
      {...props}
    />
  )
);
SelectSeparator.displayName = 'SelectSeparator';

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
