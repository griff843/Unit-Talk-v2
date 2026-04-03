import type { PickRow } from '@/lib/types';
import Link from 'next/link';

const promotionLabels: Record<string, { text: string; color: string }> = {
  qualified: { text: 'qualified', color: 'text-green-400' },
  not_eligible: { text: 'not eligible', color: 'text-yellow-400' },
  suppressed: { text: 'suppressed', color: 'text-orange-400' },
  expired: { text: 'expired', color: 'text-red-400' },
  pending: { text: 'pending', color: 'text-gray-500' },
};

function summarizeReason(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.includes('board cap')) return 'board cap';
  if (reason.includes('below threshold')) return 'below threshold';
  if (reason.includes('confidence')) return 'low confidence';
  if (reason.includes('stale')) return 'stale';
  if (reason.includes('risk')) return 'risk blocked';
  if (reason.includes('duplicate')) return 'duplicate';
  if (reason.includes('approval')) return 'not approved';
  if (reason.includes('posting window')) return 'window closed';
  return reason.split('|')[0]?.trim().slice(0, 30) ?? null;
}

function LifecycleCell({ pick }: { pick: PickRow }) {
  const label = promotionLabels[pick.promotionStatus] ?? promotionLabels['pending']!;

  if (pick.lifecycleStatus === 'validated') {
    const reason = summarizeReason(pick.promotionReason);
    return (
      <div className="flex flex-col">
        <span className="text-gray-300">validated</span>
        <span className={`text-[10px] ${label.color}`}>
          {label.text}{reason ? ` · ${reason}` : ''}
        </span>
      </div>
    );
  }

  if (pick.lifecycleStatus === 'queued' || pick.lifecycleStatus === 'posted') {
    return (
      <div className="flex flex-col">
        <span className="text-gray-300">{pick.lifecycleStatus}</span>
        <span className="text-[10px] text-green-400">qualified</span>
      </div>
    );
  }

  return <span className="text-gray-300">{pick.lifecycleStatus}</span>;
}

function PromotionCell({ pick }: { pick: PickRow }) {
  const label = promotionLabels[pick.promotionStatus] ?? promotionLabels['pending']!;

  return (
    <div className="flex flex-col">
      <span className={label.color}>{label.text}</span>
      <span className="text-[10px] text-gray-500">
        {pick.promotionTarget ?? 'no target'}
        {pick.score != null ? ` · ${pick.score.toFixed(1)}` : ''}
      </span>
    </div>
  );
}

function DeliveryCell({ pick }: { pick: PickRow }) {
  const receipt = pick.receiptChannel
    ? `${pick.receiptChannel}${pick.receiptStatus ? ` (${pick.receiptStatus})` : ''}`
    : 'no receipt';

  return (
    <div className="flex flex-col">
      <span className="text-gray-300">{pick.deliveryStatus}</span>
      <span className="text-[10px] text-gray-500">{receipt}</span>
    </div>
  );
}

function IntelligenceCell({ pick }: { pick: PickRow }) {
  const flags = [
    pick.intelligence.domainAnalysis ? 'DA' : null,
    pick.intelligence.deviggingResult ? 'DV' : null,
    pick.intelligence.kellySizing ? 'KS' : null,
    pick.intelligence.realEdge ? 'RE' : null,
    pick.intelligence.clv ? 'CLV' : null,
  ].filter((value): value is string => value !== null);

  return (
    <div className="flex flex-col">
      <span className="text-gray-300">{flags.length > 0 ? flags.join(' · ') : 'missing'}</span>
      <span className="text-[10px] text-gray-500">{pick.intelligence.edgeSource ?? 'no edge source'}</span>
    </div>
  );
}

export function PickLifecycleTable({ picks }: { picks: PickRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
            <th className="py-2 pr-4">Pick ID</th>
            <th className="py-2 pr-4">Submitted</th>
            <th className="py-2 pr-4">Submitter</th>
            <th className="py-2 pr-4">Source</th>
            <th className="py-2 pr-4">Sport</th>
            <th className="py-2 pr-4">Pick Details</th>
            <th className="py-2 pr-4">Units</th>
            <th className="py-2 pr-4">Lifecycle</th>
            <th className="py-2 pr-4">Promotion</th>
            <th className="py-2 pr-4">Delivery</th>
            <th className="py-2 pr-4">Intelligence</th>
            <th className="py-2 pr-4">Settlement</th>
            <th className="py-2">Result</th>
          </tr>
        </thead>
        <tbody>
          {picks.length === 0 ? (
            <tr>
              <td colSpan={13} className="py-4 text-center text-sm text-gray-500">No picks found.</td>
            </tr>
          ) : picks.map((pick) => (
            <tr key={pick.id} className="border-b border-gray-800 hover:bg-gray-800">
              <td className="py-2 pr-4">
                <Link href={`/picks/${pick.id}`} className="font-mono text-xs text-blue-400 hover:underline">
                  {pick.id.slice(0, 8)}&hellip;
                </Link>
              </td>
              <td className="py-2 pr-4 text-xs text-gray-300">{new Date(pick.submittedAt).toLocaleString()}</td>
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.submitter}</td>
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.source}</td>
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.sport ?? '—'}</td>
              <td className="py-2 pr-4 text-xs text-gray-300">
                {pick.pickDetails.market} &mdash; {pick.pickDetails.selection}
                {pick.pickDetails.line != null && ` (${pick.pickDetails.line})`}
                {pick.pickDetails.odds != null && ` @ ${pick.pickDetails.odds}`}
              </td>
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.unitSize ?? '—'}</td>
              <td className="py-2 pr-4 text-xs">
                <LifecycleCell pick={pick} />
              </td>
              <td className="py-2 pr-4 text-xs">
                <PromotionCell pick={pick} />
              </td>
              <td className="py-2 pr-4 text-xs">
                <DeliveryCell pick={pick} />
              </td>
              <td className="py-2 pr-4 text-xs">
                <IntelligenceCell pick={pick} />
              </td>
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.settlementStatus}</td>
              <td className="py-2 text-xs font-semibold text-gray-200">{pick.result ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
