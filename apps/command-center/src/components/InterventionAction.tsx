'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';

interface InterventionActionProps {
  label: string;
  variant: 'primary' | 'danger' | 'warning' | 'success';
  onExecute: (reason: string) => Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }>;
}

export function InterventionAction({ label, variant, onExecute }: InterventionActionProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  function handleSubmit() {
    if (reason.trim().length === 0) return;
    startTransition(async () => {
      const res = await onExecute(reason.trim());
      if (res.ok) {
        setOutcome({ ok: true, message: 'Action completed successfully.' });
      } else {
        setOutcome({ ok: false, message: res.error ?? 'Action failed.' });
      }
      setOpen(false);
    });
  }

  if (outcome?.ok) {
    return <span className="text-xs text-emerald-400">{outcome.message}</span>;
  }

  if (outcome && !outcome.ok) {
    return <span className="text-xs text-red-400">{outcome.message}</span>;
  }

  if (!open) {
    return <Button variant={variant} size="sm" onClick={() => setOpen(true)}>{label}</Button>;
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        rows={2}
        className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div className="flex gap-2">
        <Button variant={variant} size="sm" loading={isPending} onClick={handleSubmit} disabled={reason.trim().length === 0}>
          Confirm
        </Button>
        <Button variant="secondary" size="sm" onClick={() => { setOpen(false); setReason(''); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
