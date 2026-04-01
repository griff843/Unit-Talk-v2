'use client';

import { useState, useTransition } from 'react';
import { bulkReviewPicks, type ReviewDecision, type BulkReviewResult } from '@/app/actions/review';
import { Button } from '@/components/ui/Button';

interface BulkReviewBarProps {
  selectedIds: string[];
  onClearSelection: () => void;
}

const BULK_DECISIONS: { decision: ReviewDecision; label: string; variant: 'success' | 'danger' | 'warning' }[] = [
  { decision: 'approve', label: 'Bulk Approve', variant: 'success' },
  { decision: 'deny', label: 'Bulk Deny', variant: 'danger' },
  { decision: 'hold', label: 'Bulk Hold', variant: 'warning' },
];

export function BulkReviewBar({ selectedIds, onClearSelection }: BulkReviewBarProps) {
  const [activeDecision, setActiveDecision] = useState<ReviewDecision | null>(null);
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkReviewResult | null>(null);

  if (selectedIds.length === 0) return null;

  function handleExecute(decision: ReviewDecision) {
    setActiveDecision(decision);
    setResult(null);
  }

  function handleSubmit() {
    if (!activeDecision || reason.trim().length === 0) return;
    startTransition(async () => {
      const res = await bulkReviewPicks(selectedIds, activeDecision, reason.trim());
      setResult(res);
      setActiveDecision(null);
      setReason('');
      if (res.failed.length === 0) {
        onClearSelection();
      }
    });
  }

  function handleCancel() {
    setActiveDecision(null);
    setReason('');
    setResult(null);
  }

  return (
    <div className="sticky top-0 z-10 rounded-md border border-gray-700 bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200">
          {selectedIds.length} pick{selectedIds.length !== 1 ? 's' : ''} selected
        </span>
        <div className="flex items-center gap-2">
          {!activeDecision && BULK_DECISIONS.map((bd) => (
            <Button
              key={bd.decision}
              variant={bd.variant}
              size="sm"
              disabled={isPending}
              onClick={() => handleExecute(bd.decision)}
            >
              {bd.label}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={onClearSelection} disabled={isPending}>
            Clear
          </Button>
        </div>
      </div>

      {activeDecision && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-xs text-gray-400">
            Reason for bulk {activeDecision} <span className="text-red-400">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Required -- reason for bulk ${activeDecision}`}
            rows={2}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={isPending}
              disabled={reason.trim().length === 0}
              onClick={handleSubmit}
            >
              Confirm {activeDecision} ({selectedIds.length})
            </Button>
            <Button variant="secondary" size="sm" disabled={isPending} onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 text-xs">
          {result.succeeded.length > 0 && (
            <p className="text-emerald-400">
              {result.succeeded.length} pick{result.succeeded.length !== 1 ? 's' : ''} processed successfully.
            </p>
          )}
          {result.failed.length > 0 && (
            <p className="text-red-400">
              {result.failed.length} pick{result.failed.length !== 1 ? 's' : ''} failed: {result.failed.map((id) => id.slice(0, 8)).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
