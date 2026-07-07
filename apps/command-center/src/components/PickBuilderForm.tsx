'use client';

import { useMemo, useState, useTransition } from 'react';
import { ConfirmDialog, InternalLabelBadge } from '@/components/ui';
import { DiscordEmbedPreview } from '@/components/DiscordEmbedPreview';
import {
  DISPATCH_TARGETS,
  EMPTY_PICK_BUILDER_INPUT,
  RISK_RATINGS,
  TIER_DESTINATIONS,
  buildSubmissionDraft,
  computePickReadiness,
  type PickBuilderInput,
} from '@/lib/pick-builder-model';
import { submitBuiltPick, type SubmitPickResult } from '@/app/actions/execution';

const inputClass =
  'w-full rounded-lg border border-[var(--cc-border-subtle,#334155)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--cc-text-primary,#e2e8f0)] outline-none transition-colors focus:border-[var(--cc-accent,#38bdf8)]';

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide cc-text-muted">{label}</span>
      {children}
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </label>
  );
}

export function PickBuilderForm() {
  const [input, setInput] = useState<PickBuilderInput>(EMPTY_PICK_BUILDER_INPUT);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<SubmitPickResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const readiness = useMemo(() => computePickReadiness(input), [input]);

  const set = (key: keyof PickBuilderInput) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setInput((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = () => {
    setConfirming(false);
    setResult(null);
    startTransition(async () => {
      const res = await submitBuiltPick(buildSubmissionDraft(input));
      setResult(res);
      if (res.ok) setInput(EMPTY_PICK_BUILDER_INPUT);
    });
  };

  const previewSource = useMemo(() => {
    const line = input.line.trim() ? Number(input.line) : null;
    const odds = input.odds.trim() ? Number(input.odds) : null;
    return {
      market: input.market || null,
      selection: input.selection || null,
      line: Number.isFinite(line as number) ? line : null,
      odds: Number.isFinite(odds as number) ? odds : null,
      eventName: input.event || null,
      eventStartTime: null,
      sport: input.sport || null,
      metadata: {
        tierDestination: input.tierDestination,
        book: input.book,
        riskRating: input.riskRating,
        thesis: input.reasoning,
      },
    };
  }, [input]);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {/* Left: form */}
      <div className="cc-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide cc-text-secondary">
            Compose Pick
          </h2>
          <InternalLabelBadge label="Internal Only" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Sport">
            <input className={inputClass} value={input.sport} onChange={set('sport')} placeholder="Baseball" />
          </Field>
          <Field label="League">
            <input className={inputClass} value={input.league} onChange={set('league')} placeholder="MLB" />
          </Field>
          <div className="col-span-2">
            <Field label="Event">
              <input className={inputClass} value={input.event} onChange={set('event')} placeholder="NYY @ BOS" />
            </Field>
          </div>
          <Field label="Market">
            <input className={inputClass} value={input.market} onChange={set('market')} placeholder="total_runs" />
          </Field>
          <Field label="Selection">
            <input className={inputClass} value={input.selection} onChange={set('selection')} placeholder="Over" />
          </Field>
          <Field label="Line" error={readiness.fieldErrors['line']}>
            <input className={inputClass} value={input.line} onChange={set('line')} placeholder="8.5" inputMode="decimal" />
          </Field>
          <Field label="Odds (American)" error={readiness.fieldErrors['odds']}>
            <input className={inputClass} value={input.odds} onChange={set('odds')} placeholder="-110" inputMode="numeric" />
          </Field>
          <Field label="Book">
            <input className={inputClass} value={input.book} onChange={set('book')} placeholder="DraftKings" />
          </Field>
          <Field label="Confidence (0–1)" error={readiness.fieldErrors['confidence']}>
            <input className={inputClass} value={input.confidence} onChange={set('confidence')} placeholder="0.72" inputMode="decimal" />
          </Field>
          <Field label="Tier Destination" error={readiness.fieldErrors['tierDestination']}>
            <select className={inputClass} value={input.tierDestination} onChange={set('tierDestination')}>
              <option value="">Select tier…</option>
              {TIER_DESTINATIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Risk Rating" error={readiness.fieldErrors['riskRating']}>
            <select className={inputClass} value={input.riskRating} onChange={set('riskRating')}>
              <option value="">Select risk…</option>
              {RISK_RATINGS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Dispatch Target">
            <select className={inputClass} value={input.dispatchTarget} onChange={set('dispatchTarget')}>
              <option value="">Select target…</option>
              {DISPATCH_TARGETS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Scheduled Time" error={readiness.fieldErrors['scheduledTime']}>
            <input className={inputClass} type="datetime-local" value={input.scheduledTime} onChange={set('scheduledTime')} />
          </Field>
          <div className="col-span-2">
            <Field label="Reasoning">
              <textarea className={inputClass} rows={3} value={input.reasoning} onChange={set('reasoning')} placeholder="Why this pick, in plain internal language." />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Injury Notes">
              <textarea className={inputClass} rows={2} value={input.injuryNotes} onChange={set('injuryNotes')} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Movement Notes">
              <textarea className={inputClass} rows={2} value={input.movementNotes} onChange={set('movementNotes')} />
            </Field>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            disabled={!readiness.valid || isPending}
            onClick={() => setConfirming(true)}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? 'Submitting…' : 'Submit for Approval'}
          </button>
          <span className="text-xs cc-text-muted">
            Submits via POST /api/submissions. Enters the review queue — never posts directly.
          </span>
        </div>

        {result ? (
          <div className={`mt-4 rounded-lg border p-3 text-sm ${result.ok ? 'border-emerald-500/30 text-emerald-400' : 'border-red-500/30 text-red-400'}`}>
            {result.ok
              ? `Submitted. Submission ${result.submissionId || '(id unavailable)'}${result.pickId ? ` → pick ${result.pickId}` : ''}. Awaiting approval.`
              : `Submission failed: ${result.error}`}
          </div>
        ) : null}
      </div>

      {/* Right: readiness checklist + Discord preview */}
      <div className="flex flex-col gap-6">
        <div className="cc-surface p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide cc-text-secondary">
            Readiness Checklist
          </h2>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <InternalLabelBadge label="Approval Required" />
              <span className="cc-text-secondary">All operator picks require governance approval.</span>
            </li>
            {readiness.missingFields.length === 0 ? (
              <li className="text-emerald-400">All required fields present.</li>
            ) : (
              readiness.missingFields.map((f) => (
                <li key={f} className="text-yellow-400">Missing: {f}</li>
              ))
            )}
            {Object.entries(readiness.fieldErrors).map(([k, v]) => (
              <li key={k} className="text-red-400">{v}</li>
            ))}
            <li className={readiness.dispatchReady ? 'text-emerald-400' : 'cc-text-muted'}>
              {readiness.dispatchReady
                ? 'Dispatch ready (post-approval).'
                : 'Not dispatch ready — book and dispatch target required.'}
            </li>
          </ul>
        </div>

        <div className="cc-surface p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide cc-text-secondary">
            Discord Preview
          </h2>
          <DiscordEmbedPreview source={previewSource} />
        </div>
      </div>

      <ConfirmDialog
        action="SUBMIT PICK"
        confirmText="This submits the composed pick into the governed pipeline. It will require approval before any member dispatch."
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={submit}
      />
    </div>
  );
}
