'use client';

import { useState, useTransition } from 'react';
import { settlePick } from '@/app/actions/settle';
import type { OperatorGradingContextInput } from '@/lib/operator-grading-context';
import {
  describeRecapOutcome,
  type HumanCapperRecapResult,
} from '@/lib/human-capper-recap';
import { Button } from '@/components/ui/Button';

type ResultType = 'win' | 'loss' | 'push' | 'void';
type ConfidenceType = 'confirmed' | 'estimated' | 'pending';

const RESULTS: {
  value: ResultType;
  label: string;
  variant: 'success' | 'danger' | 'secondary' | 'warning';
  idleClass: string;
}[] = [
  { value: 'win', label: 'Win', variant: 'success', idleClass: 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10' },
  { value: 'loss', label: 'Loss', variant: 'danger', idleClass: 'border-rose-500/40 text-rose-300 hover:bg-rose-500/10' },
  { value: 'push', label: 'Push', variant: 'secondary', idleClass: 'border-gray-600 text-gray-300 hover:bg-white/[0.06]' },
  { value: 'void', label: 'Void', variant: 'warning', idleClass: 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10' },
];

const CONFIDENCES: ConfidenceType[] = ['confirmed', 'estimated', 'pending'];

interface SettlementFormProps {
  pickId: string;
  isAlreadySettled: boolean;
}

export function SettlementForm({ pickId, isAlreadySettled }: SettlementFormProps) {
  const [selected, setSelected] = useState<ResultType | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<
    { ok: boolean; message: string; recap?: HumanCapperRecapResult } | null
  >(null);

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
        setOutcome({
          ok: true,
          message: `Settled. Record ID: ${res.settlementRecordId}`,
          ...(res.recap === undefined ? {} : { recap: res.recap }),
        });
      } else {
        setOutcome({ ok: false, message: res.error });
      }
      setConfirming(false);
    });
  }

  if (outcome?.ok) {
    // UTV2-1939: settling a delivered human-capper pick has TWO outcomes -- the
    // record was written, and members either were or were not told. Rendering
    // one green panel for both is how canary 816a84c7's suppressed recap went
    // unnoticed. The recap gets its own panel, and a suppressed one is never
    // green.
    const recapVerdict = describeRecapOutcome(outcome.recap);
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-emerald-700 bg-emerald-950 p-4">
          <p className="text-sm font-medium text-emerald-300">Settlement recorded.</p>
          <p className="mt-1 font-mono text-xs text-emerald-500">{outcome.message}</p>
        </div>

        {recapVerdict.kind === 'posted' && (
          <div className="rounded-md border border-emerald-700 bg-emerald-950 p-4">
            <p className="text-sm font-medium text-emerald-300">{recapVerdict.headline}</p>
          </div>
        )}

        {(recapVerdict.kind === 'suppressed' || recapVerdict.kind === 'unresolved') && (
          <div className="rounded-md border border-amber-600 bg-amber-950/60 p-4">
            <p className="text-sm font-medium text-amber-200">{recapVerdict.headline}</p>
            <p className="mt-1 text-xs text-amber-300/90">{recapVerdict.detail}</p>
            <p className="mt-2 font-mono text-[11px] text-amber-400/80">
              reason: {recapVerdict.reason}
            </p>
          </div>
        )}
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

      <p className="text-xs text-gray-500">
        Settlement writes an immutable record — corrections append, they never overwrite.
      </p>
      <div className="flex flex-wrap gap-2">
        {RESULTS.map(({ value, label, variant, idleClass }) => (
          <Button
            key={value}
            variant={selected === value ? variant : 'ghost'}
            size="md"
            onClick={() => handleSelect(value)}
            disabled={isPending}
            className={selected === value ? 'min-w-[88px] font-semibold' : `min-w-[88px] border font-semibold ${idleClass}`}
          >
            {label}
          </Button>
        ))}
      </div>

      {selected && (
        <fieldset className="flex flex-col gap-3 rounded-md border border-gray-700 bg-gray-900/60 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Grading attestation
          </legend>
          <p className="text-xs text-gray-500">
            Required. The API refuses a manual settlement of an evidence-plane pick that does not say
            where the outcome came from.
          </p>

          <label className="flex flex-col gap-1 text-xs text-gray-400" htmlFor="settle-outcome-basis">
            How you determined the outcome
            <input
              id="settle-outcome-basis"
              className="cc-input"
              value={outcomeBasis}
              onChange={(e) => setOutcomeBasis(e.target.value)}
              disabled={isPending}
              placeholder="Final score 27-24, Chiefs covered -2.5"
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-400" htmlFor="settle-result-source-url">
            Where a reader can independently check it
            <input
              id="settle-result-source-url"
              className="cc-input font-mono"
              value={resultSourceUrl}
              onChange={(e) => setResultSourceUrl(e.target.value)}
              disabled={isPending}
              placeholder="https://www.nfl.com/games/..."
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-gray-400" htmlFor="settle-observed-at">
            Observed at (ISO-8601)
            <span className="flex gap-2">
              <input
                id="settle-observed-at"
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

          <label className="flex flex-col gap-1 text-xs text-gray-400" htmlFor="settle-confidence">
            Confidence
            <select
              id="settle-confidence"
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

          <label className="flex flex-col gap-1 text-xs text-gray-400" htmlFor="settle-notes">
            Notes (optional)
            <input
              id="settle-notes"
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
          Settle Pick
        </Button>
      )}

      {confirming && selected && (
        <div className="flex flex-col gap-3 rounded-md border border-gray-700 bg-gray-900 p-4">
          <p className="text-sm text-gray-200">
            Confirm: mark this pick as{' '}
            <span className="font-semibold uppercase text-white">{selected}</span>? This creates a
            permanent settlement record.
          </p>
          <p className="text-xs text-gray-500">
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
