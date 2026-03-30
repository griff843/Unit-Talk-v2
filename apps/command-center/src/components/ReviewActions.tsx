'use client';

import { useState, useTransition } from 'react';
import { reviewPick, type ReviewDecision } from '@/app/actions/review';
import { Button } from '@/components/ui/Button';

interface ReviewActionsProps {
  pickId: string;
  decisions?: ReviewDecision[];
}

const DECISION_CONFIG: Record<ReviewDecision, { label: string; variant: 'success' | 'danger' | 'warning' | 'primary' }> = {
  approve: { label: 'Approve', variant: 'success' },
  deny: { label: 'Deny', variant: 'danger' },
  hold: { label: 'Hold', variant: 'warning' },
  return: { label: 'Return to Review', variant: 'primary' },
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
        setOutcome({ ok: true, message: `Decision recorded: ${selected}. Review ID: ${res.reviewId}` });
      } else {
        setOutcome({ ok: false, message: res.error });
      }
      setConfirming(false);
    });
  }

  if (outcome?.ok) {
    return (
      <div className="rounded-md border border-emerald-700 bg-emerald-950 p-4">
        <p className="text-sm font-medium text-emerald-300">Review recorded.</p>
        <p className="mt-1 font-mono text-xs text-emerald-500">{outcome.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {decisions.map((d) => {
          const config = DECISION_CONFIG[d];
          return (
            <Button
              key={d}
              variant={selected === d ? config.variant : 'secondary'}
              size="sm"
              onClick={() => handleSelect(d)}
              disabled={isPending}
            >
              {config.label}
            </Button>
          );
        })}
      </div>

      {selected && !confirming && !outcome && (
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-400">
            Reason <span className="text-red-400">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Required — explain your decision"
            rows={2}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {reason.trim().length === 0 && (
            <p className="text-xs text-gray-500">A reason is required for every review decision.</p>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleConfirmClick}
            disabled={isPending || reason.trim().length === 0}
          >
            Submit {DECISION_CONFIG[selected].label}
          </Button>
        </div>
      )}

      {confirming && selected && (
        <div className="flex flex-col gap-3 rounded-md border border-gray-700 bg-gray-900 p-4">
          <p className="text-sm text-gray-200">
            Confirm: <span className="font-semibold uppercase text-white">{selected}</span> this pick?
          </p>
          <p className="text-xs text-gray-400">Reason: {reason}</p>
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
