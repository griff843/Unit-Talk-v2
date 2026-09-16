'use client';

import { useState, useTransition } from 'react';
import { settlePick } from '@/app/actions/settle';
import type { OperatorGradingContextInput } from '@/lib/operator-grading-context';
import { Button } from '@/components/ui/Button';

type ResultType = 'win' | 'loss' | 'push' | 'void';
type ConfidenceType = 'confirmed' | 'estimated' | 'pending';

const RESULTS: { value: ResultType; label: string; variant: 'success' | 'danger' | 'secondary' | 'warning' }[] = [
  { value: 'win', label: 'Win', variant: 'success' },
  { value: 'loss', label: 'Loss', variant: 'danger' },
  { value: 'push', label: 'Push', variant: 'secondary' },
  { value: 'void', label: 'Void', variant: 'warning' },
];

const CONFIDENCES: ConfidenceType[] = ['confirmed', 'estimated', 'pending'];

interface CorrectionFormProps {
  pickId: string;
}

export function CorrectionForm({ pickId }: CorrectionFormProps) {
  const [selected, setSelected] = useState<ResultType | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  const [outcomeBasis, setOutcomeBasis] = useState('');
  const [resultSourceUrl, setResultSourceUrl] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const [confidence, setConfidence] = useState<ConfidenceType>('confirmed');
  const [notes, setNotes] = useState('');

  const attestationComplete =
    outcomeBasis.trim() !== '' && resultSourceUrl.trim() !== '' && observedAt.trim() !== '';

  function handleSelect(value: ResultType) {
    setSelected(value);
    setConfirming(false);
    setOutcome(null);
  }

  function handleConfirmClick() {
    if (!selected || !attestationComplete) return;
    setConfirming(true);
  }

  function handleCancel() {
    setConfirming(false);
  }

  function handleObservedNow() {
    setObservedAt(new Date().toISOString());
  }

  function handleSubmit() {
    if (!selected) return;
    const attestation: OperatorGradingContextInput = {
      outcomeBasis,
      resultSourceUrl,
      observedAt,
      confidence,
      notes,
    };
    startTransition(async () => {
      const res = await settlePick(pickId, selected, attestation);
      if (res.ok) {
        setOutcome({ ok: true, message: `Correction recorded. Record ID: ${res.settlementRecordId}` });
      } else {
        setOutcome({ ok: false, message: res.error });
      }
      setConfirming(false);
    });
  }

  if (outcome?.ok) {
    return (
      <div className="rounded-md border border-emerald-700 bg-emerald-950 p-4">
        <p className="text-sm font-medium text-emerald-300">Correction recorded.</p>
        <p className="mt-1 font-mono text-xs text-emerald-500">{outcome.message}</p>
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

      {selected && (
        <fieldset className="flex flex-col gap-3 rounded-md border border-gray-700 bg-gray-900/60 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Correction attestation
          </legend>
          <p className="text-xs text-gray-500">
            Required, and it is what distinguishes the correction from the record it corrects: the
            prior settlement carries its own source and observation instant, and this one carries
            yours.
          </p>

          <label className="flex flex-col gap-1 text-xs text-gray-400" htmlFor="correct-outcome-basis">
            Why the original was wrong, and how you determined the correct outcome
            <input
              id="correct-outcome-basis"
              className="cc-input"
              value={outcomeBasis}
              onChange={(e) => setOutcomeBasis(e.target.value)}
              disabled={isPending}
              placeholder="Official scoring change; final 27-24, Chiefs covered -2.5"
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-400" htmlFor="correct-result-source-url">
            Where a reader can independently check it
            <input
              id="correct-result-source-url"
              className="cc-input font-mono"
              value={resultSourceUrl}
              onChange={(e) => setResultSourceUrl(e.target.value)}
              disabled={isPending}
              placeholder="https://www.nfl.com/games/..."
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-400" htmlFor="correct-observed-at">
            Observed at (ISO-8601)
            <span className="flex gap-2">
              <input
                id="correct-observed-at"
                className="cc-input min-w-0 flex-1 font-mono"
                value={observedAt}
                onChange={(e) => setObservedAt(e.target.value)}
                disabled={isPending}
                placeholder="2026-09-15T23:41:00Z"
                autoComplete="off"
              />
              <Button variant="secondary" size="sm" disabled={isPending} onClick={handleObservedNow}>
                Now
              </Button>
            </span>
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-400" htmlFor="correct-confidence">
            Confidence
            <select
              id="correct-confidence"
              className="cc-input"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value as ConfidenceType)}
              disabled={isPending}
            >
              {CONFIDENCES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-400" htmlFor="correct-notes">
            Notes (optional)
            <input
              id="correct-notes"
              className="cc-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isPending}
              autoComplete="off"
            />
          </label>
        </fieldset>
      )}

      {selected && !confirming && !outcome && (
        <Button
          variant="primary"
          size="sm"
          onClick={handleConfirmClick}
          disabled={isPending || !attestationComplete}
          className="w-fit"
        >
          Submit Correction
        </Button>
      )}

      {confirming && selected && (
        <div className="flex flex-col gap-3 rounded-md border border-gray-700 bg-gray-900 p-4">
          <p className="text-sm text-gray-200">
            Confirm: correct this pick to{' '}
            <span className="font-semibold uppercase text-white">{selected}</span>?
          </p>
          <p className="text-xs text-gray-500">
            The original settlement record will be preserved and a new correction record will be linked to it.
            Attested from <span className="font-mono text-gray-400">{resultSourceUrl}</span>, observed{' '}
            <span className="font-mono text-gray-400">{observedAt}</span>.
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
