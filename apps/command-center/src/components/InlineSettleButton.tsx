'use client';

import { useState, useTransition } from 'react';
import { settlePick } from '@/app/actions/settle';

type ResultType = 'win' | 'loss' | 'push' | 'void';

const OPTIONS: { value: ResultType; label: string; classes: string }[] = [
  { value: 'win',  label: 'W', classes: 'bg-emerald-700 hover:bg-emerald-600 text-white' },
  { value: 'loss', label: 'L', classes: 'bg-red-700 hover:bg-red-600 text-white' },
  { value: 'push', label: 'P', classes: 'bg-gray-600 hover:bg-gray-500 text-white' },
  { value: 'void', label: 'V', classes: 'bg-yellow-700 hover:bg-yellow-600 text-white' },
];

export function InlineSettleButton({ pickId }: { pickId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<ResultType | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return <span className="text-[10px] font-semibold uppercase text-emerald-400">{done}</span>;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-gray-600 px-2 py-0.5 text-[10px] text-gray-400 hover:border-gray-400 hover:text-gray-200"
      >
        Settle
      </button>
    );
  }

  function handleSettle(result: ResultType) {
    setError(null);
    startTransition(async () => {
      const res = await settlePick(pickId, result);
      if (res.ok) {
        setDone(result);
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        {OPTIONS.map(({ value, label, classes }) => (
          <button
            key={value}
            disabled={pending}
            onClick={() => handleSettle(value)}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50 ${classes}`}
          >
            {label}
          </button>
        ))}
        <button
          disabled={pending}
          onClick={() => setOpen(false)}
          className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-gray-300"
        >
          ✕
        </button>
      </div>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  );
}
