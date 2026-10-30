import { createElement } from 'react';
import { describeRecapOutcome, type HumanCapperRecapResult } from './human-capper-recap';

export function correctionConfirmation(current: string | null, proposed: string | null) {
  if (!current) return { allowed: false, message: 'Current settlement is unavailable. Reload before correcting.' };
  if (!proposed) return { allowed: false, message: 'Choose a proposed result.' };
  if (current.toLowerCase() === proposed.toLowerCase()) return { allowed: false, message: 'Choose a result different from the current result.' };
  return { allowed: true, message: `Current: ${current} → Proposed: ${proposed}` };
}

/** Render persistence separately from the API's downstream recap outcome. */
export function correctionOutcomeFeedback(message: string, recap?: HumanCapperRecapResult) {
  const verdict = describeRecapOutcome(recap);
  return createElement('div', { className: 'flex flex-col gap-3', role: 'status' },
    createElement('div', { className: 'rounded-md border border-emerald-700 bg-emerald-950 p-4' },
      createElement('p', { className: 'text-sm font-medium text-emerald-300' }, 'Correction recorded.'),
      createElement('p', { className: 'mt-1 font-mono text-xs text-emerald-500' }, message)),
    verdict.kind === 'posted' && createElement('div', { className: 'rounded-md border border-emerald-700 bg-emerald-950 p-4' },
      createElement('p', { className: 'text-sm font-medium text-emerald-300' }, verdict.headline)),
    (verdict.kind === 'suppressed' || verdict.kind === 'unresolved') && createElement('div', { className: 'rounded-md border border-amber-600 bg-amber-950/60 p-4' },
      createElement('p', { className: 'text-sm font-medium text-amber-200' }, verdict.headline),
      createElement('p', { className: 'mt-1 text-xs text-amber-300/90' }, verdict.detail),
      createElement('p', { className: 'mt-2 font-mono text-[11px] text-amber-400/80' }, `reason: ${verdict.reason}`)));
}
