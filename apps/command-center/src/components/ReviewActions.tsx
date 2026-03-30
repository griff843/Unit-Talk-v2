'use client';

import { useState, useTransition } from 'react';
import { reviewPick, type ReviewDecision } from '@/app/actions/review';

interface ReviewActionsProps {
  pickId: string;
  /** Which decisions to show. Defaults to approve/deny/hold. */
  decisions?: ReviewDecision[];
}

const DECISION_CONFIG: Record<ReviewDecision, { label: string; colors: string; confirmLabel: string }> = {
  approve: {
    label: 'Approve',
    colors: 'bg-green-600 hover:bg-green-700 data-[selected=true]:ring-2 data-[selected=true]:ring-green-400',
    confirmLabel: 'Confirm Approve',
  },
  deny: {
    label: 'Deny',
    colors: 'bg-red-600 hover:bg-red-700 data-[selected=true]:ring-2 data-[selected=true]:ring-red-400',
    confirmLabel: 'Confirm Deny',
  },
  hold: {
    label: 'Hold',
    colors: 'bg-yellow-600 hover:bg-yellow-700 data-[selected=true]:ring-2 data-[selected=true]:ring-yellow-400',
    confirmLabel: 'Confirm Hold',
  },
  return: {
    label: 'Return to Review',
    colors: 'bg-blue-600 hover:bg-blue-700 data-[selected=true]:ring-2 data-[selected=true]:ring-blue-400',
    confirmLabel: 'Confirm Return',
  },
};

export function ReviewActions({ pickId, decisions = ['approve', 'deny', 'hold'] }: ReviewActionsProps) {
  const [selected, setSelected] = useState<ReviewDecision | null>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  function handleSelect(decision: ReviewDecision) {
    setSelected(decision);
    setConfirming(false);
    setOutcome(null);
  }

  function handleConfirmClick() {
    if (!selected || reason.trim().length === 0) return;
    setConfirming(true);
  }

  function handleCancel() {
    setConfirming(false);
  }

  function handleSubmit() {
    if (!selected || reason.trim().length === 0) return;
    startTransition(async () => {
      const res = await reviewPick(pickId, selected, reason.trim());
      if (res.ok) {
        setOutcome({
          ok: true,
          message: `Decision recorded: ${selected}. Review ID: ${res.reviewId}`,
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
        <p className="text-sm font-medium text-green-300">Review recorded.</p>
        <p className="mt-1 font-mono text-xs text-green-500">{outcome.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Decision buttons */}
      <div className="flex flex-wrap gap-2">
        {decisions.map((d) => {
          const config = DECISION_CONFIG[d];
          return (
            <button
              key={d}
              type="button"
              onClick={() => handleSelect(d)}
              disabled={isPending}
              data-selected={selected === d}
              className={`rounded px-4 py-2 text-sm font-medium text-white transition-colors ${config.colors}`}
            >
              {config.label}
            </button>
          );
        })}
      </div>

      {/* Reason input */}
      {selected && !confirming && !outcome && (
        <div className="flex flex-col gap-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            rows={2}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleConfirmClick}
            disabled={isPending || reason.trim().length === 0}
            className="w-fit rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Submit {DECISION_CONFIG[selected].label}
          </button>
        </div>
      )}

      {/* Confirmation step */}
      {confirming && selected && (
        <div className="flex flex-col gap-3 rounded-md border border-gray-700 bg-gray-900 p-4">
          <p className="text-sm text-gray-200">
            Confirm: <span className="font-semibold uppercase text-white">{selected}</span> this pick?
          </p>
          <p className="text-xs text-gray-400">Reason: {reason}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="rounded bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50"
            >
              {isPending ? 'Submitting...' : 'Confirm'}
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
