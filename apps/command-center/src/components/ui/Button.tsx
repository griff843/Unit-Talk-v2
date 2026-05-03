import React from 'react';

const variants = {
  primary: 'bg-[var(--cc-accent)] text-white hover:bg-[var(--cc-accent-strong)] focus:ring-[var(--cc-accent)]',
  secondary:
    'border border-[var(--cc-border-strong)] text-[var(--cc-text-secondary)] hover:bg-[var(--cc-bg-surface-hover)] focus:ring-[var(--cc-border-strong)]',
  danger: 'bg-[var(--cc-danger)] text-white hover:brightness-90 focus:ring-[var(--cc-danger)]',
  success: 'bg-[var(--cc-success)] text-white hover:brightness-90 focus:ring-[var(--cc-success)]',
  warning: 'bg-[var(--cc-warning)] text-white hover:brightness-90 focus:ring-[var(--cc-warning)]',
  ghost:
    'text-[var(--cc-text-secondary)] hover:text-[var(--cc-text-primary)] hover:bg-[var(--cc-bg-surface-hover)] focus:ring-[var(--cc-border-strong)]',
} as const;

const sizes = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
} as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-[var(--cc-bg-canvas)] disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
