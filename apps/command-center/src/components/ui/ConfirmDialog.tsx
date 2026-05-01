'use client';

import React, { useEffect, useState } from 'react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  action: string;
  confirmText: string;
  onConfirm: () => void;
  open?: boolean;
  onClose?: () => void;
}

export function confirmTextMatches(action: string, value: string) {
  return value === action;
}

export function ConfirmDialog({
  action,
  confirmText,
  onConfirm,
  open = true,
  onClose,
}: ConfirmDialogProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!open) {
      setValue('');
    }
  }, [open]);

  if (!open) return null;

  const enabled = confirmTextMatches(action, value);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.56)] p-4">
      <div className="cc-surface w-full max-w-lg p-6">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--cc-text-muted)]">Confirm Destructive Action</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[var(--cc-text-primary)]">{action}</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--cc-text-secondary)]">{confirmText}</p>

        <label className="mt-5 block text-sm text-[var(--cc-text-secondary)]">
          Type <span className="font-semibold text-[var(--cc-text-primary)]">{action}</span> to continue.
          <input
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            className="mt-3 w-full rounded-2xl border border-[var(--cc-border-subtle)] bg-white/[0.03] px-4 py-3 text-[var(--cc-text-primary)] outline-none transition-colors focus:border-[var(--cc-accent)]"
          />
        </label>

        <div className="mt-6 flex items-center justify-end gap-3">
          {onClose ? (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          ) : null}
          <Button variant="danger" disabled={!enabled} onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
