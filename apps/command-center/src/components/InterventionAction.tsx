'use client';

import { useState, useTransition } from 'react';
import {
  overridePromotion,
  rerunPromotion,
  requeueDelivery,
  retryDelivery,
} from '@/app/actions/intervention';
import { Button } from '@/components/ui/Button';

interface InterventionActionProps {
  label: string;
  variant: 'primary' | 'danger' | 'warning' | 'success';
  pickId: string;
  action: 'retry_delivery' | 'rerun_promotion' | 'force_promote' | 'suppress' | 'requeue_delivery';
  target?: string;
}

export function InterventionAction({ label, variant, pickId, action, target }: InterventionActionProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  function handleSubmit() {
    startTransition(async () => {
      const res = await executeIntervention(action, pickId, reason.trim(), target);
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
        placeholder={action === 'requeue_delivery' ? 'Optional reason' : 'Reason (required)'}
        rows={2}
        className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div className="flex gap-2">
        <Button
          variant={variant}
          size="sm"
          loading={isPending}
          onClick={handleSubmit}
          disabled={requiresReason(action) && reason.trim().length === 0}
        >
          Confirm
        </Button>
        <Button variant="secondary" size="sm" onClick={() => { setOpen(false); setReason(''); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function requiresReason(action: InterventionActionProps['action']) {
  return action !== 'requeue_delivery';
}

async function executeIntervention(
  action: InterventionActionProps['action'],
  pickId: string,
  reason: string,
  target?: string,
) {
  switch (action) {
    case 'retry_delivery':
      return retryDelivery(pickId, reason);
    case 'rerun_promotion':
      return rerunPromotion(pickId, reason);
    case 'force_promote':
      return overridePromotion(pickId, 'force_promote', reason, target);
    case 'suppress':
      return overridePromotion(pickId, 'suppress', reason, target);
    case 'requeue_delivery':
      return requeueDelivery(pickId);
    default:
      return { ok: false as const, error: 'Unknown intervention action.' };
  }
}
