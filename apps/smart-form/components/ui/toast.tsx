'use client';

import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

// GAUNTLET-CLOSEOUT-028: Fix Radix UI type inference issue
// Cast to any to work around strict type inference
const ToastViewportPrimitive = ToastPrimitives.Viewport as any;
const ToastRootPrimitive = ToastPrimitives.Root as any;
const ToastActionPrimitive = ToastPrimitives.Action as any;
const ToastClosePrimitive = ToastPrimitives.Close as any;
const ToastTitlePrimitive = ToastPrimitives.Title as any;
const ToastDescriptionPrimitive = ToastPrimitives.Description as any;

const ToastProvider = ToastPrimitives.Provider;

interface ToastViewportProps {
  className?: string;
}

const ToastViewport = React.forwardRef<HTMLOListElement, ToastViewportProps>(
  ({ className, ...props }, ref) => (
    <ToastViewportPrimitive
      ref={ref}
      className={cn(
        'fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]',
        className
      )}
      {...props}
    />
  )
);
ToastViewport.displayName = 'ToastViewport';

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'border bg-background text-foreground',
        destructive:
          'destructive group border-destructive bg-destructive text-destructive-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

interface ToastRootProps extends VariantProps<typeof toastVariants> {
  children?: React.ReactNode;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const Toast = React.forwardRef<HTMLLIElement, ToastRootProps>(
  ({ className, variant, children, ...props }, ref) => {
    return (
      <ToastRootPrimitive
        ref={ref}
        className={cn(toastVariants({ variant }), className)}
        {...props}
      >
        {children}
      </ToastRootPrimitive>
    );
  }
);
Toast.displayName = 'Toast';

interface ToastActionProps {
  className?: string;
  altText: string;
  children?: React.ReactNode;
}

const ToastAction = React.forwardRef<HTMLButtonElement, ToastActionProps>(
  ({ className, ...props }, ref) => (
    <ToastActionPrimitive
      ref={ref}
      className={cn(
        'inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive',
        className
      )}
      {...props}
    />
  )
);
ToastAction.displayName = 'ToastAction';

interface ToastCloseProps {
  className?: string;
}

const ToastClose = React.forwardRef<HTMLButtonElement, ToastCloseProps>(
  ({ className, ...props }, ref) => (
    <ToastClosePrimitive
      ref={ref}
      className={cn(
        'absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600',
        className
      )}
      toast-close=""
      {...props}
    >
      <X className="h-4 w-4" />
    </ToastClosePrimitive>
  )
);
ToastClose.displayName = 'ToastClose';

interface ToastTitleProps {
  children?: React.ReactNode;
  className?: string;
}

const ToastTitle = React.forwardRef<HTMLDivElement, ToastTitleProps>(
  ({ className, children, ...props }, ref) => (
    <ToastTitlePrimitive ref={ref} className={cn('text-sm font-semibold', className)} {...props}>
      {children}
    </ToastTitlePrimitive>
  )
);
ToastTitle.displayName = 'ToastTitle';

interface ToastDescriptionProps {
  children?: React.ReactNode;
  className?: string;
}

const ToastDescription = React.forwardRef<HTMLDivElement, ToastDescriptionProps>(
  ({ className, children, ...props }, ref) => (
    <ToastDescriptionPrimitive ref={ref} className={cn('text-sm opacity-90', className)} {...props}>
      {children}
    </ToastDescriptionPrimitive>
  )
);
ToastDescription.displayName = 'ToastDescription';

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
