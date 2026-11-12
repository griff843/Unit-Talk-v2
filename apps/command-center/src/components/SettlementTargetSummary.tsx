import type { PickIdentityRead } from '@/lib/data/pick-identity';

function value(value: string | number | null | undefined, fallback = 'Not recorded') {
  return value == null || value === '' ? fallback : String(value);
}

export function SettlementTargetSummary({ target }: { target: PickIdentityRead }) {
  const corrected = Boolean(target.settlement?.correctsId);
  return (
    <div className="mb-5 rounded-lg border border-blue-500/25 bg-blue-500/5 p-4" data-testid="settlement-target-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-100">{value(target.identity.capper, 'Capper not recorded')} · {value(target.identity.sport, 'Sport not recorded')}</h3>
          <p className="mt-1 text-sm text-gray-300">{value(target.identity.matchup)} · {value(target.identity.marketType ?? target.identity.market)} · {value(target.identity.selection)}</p>
        </div>
        <span className="rounded-full border border-gray-600 px-2 py-1 text-xs uppercase tracking-wide text-gray-300">{target.status}</span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-gray-500">Line / odds</dt><dd className="text-gray-200">{value(target.line)} · {value(target.identity.oddsLabel)}</dd></div>
        <div><dt className="text-xs text-gray-500">Stake</dt><dd className="text-gray-200">{value(target.stakeUnits)} units</dd></div>
        <div><dt className="text-xs text-gray-500">Submitted</dt><dd className="text-gray-200">{value(target.submittedAt ? new Date(target.submittedAt).toLocaleString() : null)}</dd></div>
      </dl>
      <div className="mt-4 border-t border-gray-800 pt-3 text-sm">
        <span className="text-gray-500">Current effective result:</span>{' '}
        <span className="font-semibold text-gray-200">{value(target.settlement?.result, 'Not settled')}{corrected ? ' (corrected)' : ''}</span>
        <span className="ml-2 text-gray-500">source: {value(target.settlement?.source, 'Not recorded')}</span>
      </div>
      <p className="mt-2 break-all font-mono text-[11px] text-gray-500">Pick ID: {target.id}</p>
      {corrected && <p className="mt-2 text-xs text-amber-200">This result is a correction of an earlier settlement record; a further correction supersedes it.</p>}
    </div>
  );
}
