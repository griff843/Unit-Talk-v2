'use client';

import { useState, useTransition } from 'react';
import { settlePick } from '@/app/actions/settle';
import { Button } from '@/components/ui/Button';

type ResultType = 'win' | 'loss' | 'push' | 'void';

const RESULTS: { value: ResultType; label: string; variant: 'success' | 'danger' | 'secondary' | 'warning' }[] = [
  { value: 'win', label: 'Win', variant: 'success' },
  { value: 'loss', label: 'Loss', variant: 'danger' },
  { value: 'push', label: 'Push', variant: 'secondary' },
  { value: 'void', label: 'Void', variant: 'warning' },
];

interface SettlementFormProps {
  pickId: string;
  isAlreadySettled: boolean;
}

export function SettlementForm({ pickId, isAlreadySettled }: SettlementFormProps) {
  const [selected, setSelected] = useState<ResultType | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  function handleSelect(value: ResultType) {
    setSelected(value);
    setConfirming(false);
    setOutcome(null);
  }

  function handleConfirmClick() {
    if (!selected) return;
    setConfirming(true);
  }

  function handleCancel() {
    setConfirming(false);
  }

  function handleSubmit() {
    if (!selected) return;
    startTransition(async () => {
      const res = await settlePick(pickId, selected);
      if (res.ok) {
        setOutcome({ ok: true, message: `Settled. Record ID: ${res.settlementRecordId}` });
      } else {
        setOutcome({ ok: false, message: res.error });
      }
      setConfirming(false);
    });
  }

  if (outcome?.ok) {
    return (
      <div className="rounded-md border border-emerald-700 bg-emerald-950 p-4">
        <p className="text-sm font-medium text-emerald-300">Settlement recorded.</p>
        <p className="mt-1 font-mono text-xs text-emerald-500">{outcome.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-gray-100">
          {isAlreadySettled ? 'Re-settle Pick' : 'Settle Pick'}
        </h2>
        {isAlreadySettled && (
          <p className="mt-1 text-sm text-gray-400">
            Pick is already settled. Submitting again will create a correction record.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {RESULTS.map(({ value, label, variant }) => (
          <Button
            key={value}
            variant={selected === value ? variant : 'secondary'}
            size="sm"
            onClick={() => handleSelect(value)}
            disabled={isPending}
          >
            {label}
          </Button>
        ))}
      </div>

      {selected && !confirming && !outcome && (
        <Button variant="primary" size="sm" onClick={handleConfirmClick} disabled={isPending} className="w-fit">
          Settle Pick
        </Button>
      )}

      {confirming && selected && (
        <div className="flex flex-col gap-3 rounded-md border border-gray-700 bg-gray-900 p-4">
          <p className="text-sm text-gray-200">
            Confirm: mark this pick as{' '}
            <span className="font-semibold uppercase text-white">{selected}</span>?
          </p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={isPending} onClick={handleSubmit}>
              Confirm
            </Button>
            <Button variant="secondary" size="sm" disabled={isPending} onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {outcome && !outcome.ok && (
        <div className="rounded-md border border-red-700 bg-red-950 p-3">
          <p className="text-sm text-red-300">{outcome.message}</p>
        </div>
      )}
    </div>
  );
}
