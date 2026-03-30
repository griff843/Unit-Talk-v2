'use client';

import { useState, useTransition } from 'react';
import { settlePick } from '@/app/actions/settle';

type ResultType = 'win' | 'loss' | 'push' | 'void';

const RESULTS: { value: ResultType; label: string; colors: string }[] = [
  {
    value: 'win',
    label: 'Win',
    colors:
      'bg-green-600 hover:bg-green-700 disabled:bg-green-900 data-[selected=true]:ring-2 data-[selected=true]:ring-green-400',
  },
  {
    value: 'loss',
    label: 'Loss',
    colors:
      'bg-red-600 hover:bg-red-700 disabled:bg-red-900 data-[selected=true]:ring-2 data-[selected=true]:ring-red-400',
  },
  {
    value: 'push',
    label: 'Push',
    colors:
      'bg-gray-600 hover:bg-gray-700 disabled:bg-gray-900 data-[selected=true]:ring-2 data-[selected=true]:ring-gray-400',
  },
  {
    value: 'void',
    label: 'Void',
    colors:
      'bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-900 data-[selected=true]:ring-2 data-[selected=true]:ring-yellow-400',
  },
];

interface CorrectionFormProps {
  pickId: string;
}

export function CorrectionForm({ pickId }: CorrectionFormProps) {
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
        setOutcome({
          ok: true,
          message: `Correction recorded. Record ID: ${res.settlementRecordId}`,
        });
      } else {
        setOutcome({ ok: false, message: res.error });
      }
      setConfirming(false);
    });
  }

  if (outcome?.ok) {
    return (
      <div className="rounded-md border border-green-700 bg-green-950 p-4">
        <p className="text-sm font-medium text-green-300">Correction recorded.</p>
        <p className="mt-1 font-mono text-xs text-green-500">{outcome.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-gray-100">Correct Settlement</h2>
        <p className="mt-1 text-sm text-gray-400">
          Original settlement will be preserved. A new correction record will be created.
        </p>
      </div>

      {/* Result selector */}
      <div className="flex flex-wrap gap-2">
        {RESULTS.map(({ value, label, colors }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleSelect(value)}
            disabled={isPending}
            data-selected={selected === value}
            className={`rounded px-4 py-2 text-sm font-medium text-white transition-colors ${colors}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Confirmation step */}
      {selected && !confirming && !outcome && (
        <button
          type="button"
          onClick={handleConfirmClick}
          disabled={isPending}
          className="w-fit rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Submit Correction
        </button>
      )}

      {confirming && selected && (
        <div className="flex flex-col gap-3 rounded-md border border-gray-700 bg-gray-900 p-4">
          <p className="text-sm text-gray-200">
            Confirm: correct this pick to{' '}
            <span className="font-semibold uppercase text-white">{selected}</span>?
          </p>
          <p className="text-xs text-gray-500">
            The original settlement record will be preserved and a new correction record will be
            linked to it.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="rounded bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50"
            >
              {isPending ? 'Submitting…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPending}
              className="rounded border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
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
