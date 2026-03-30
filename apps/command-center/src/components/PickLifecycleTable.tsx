import type { PickRow } from '@/lib/types';
import Link from 'next/link';

export function PickLifecycleTable({ picks }: { picks: PickRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
            <th className="py-2 pr-4">Pick ID</th>
            <th className="py-2 pr-4">Submitted</th>
            <th className="py-2 pr-4">Submitter</th>
            <th className="py-2 pr-4">Sport / Event</th>
            <th className="py-2 pr-4">Pick Details</th>
            <th className="py-2 pr-4">Units</th>
            <th className="py-2 pr-4">Score</th>
            <th className="py-2 pr-4">Lifecycle</th>
            <th className="py-2 pr-4">Delivery</th>
            <th className="py-2 pr-4">Settlement</th>
            <th className="py-2">Result</th>
          </tr>
        </thead>
        <tbody>
          {picks.length === 0 ? (
            <tr>
              <td colSpan={11} className="py-4 text-center text-sm text-gray-500">No picks found.</td>
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
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.sport}</td>
              <td className="py-2 pr-4 text-xs text-gray-300">
                {pick.pickDetails.market} &mdash; {pick.pickDetails.selection}
                {pick.pickDetails.line != null && ` (${pick.pickDetails.line})`}
                {pick.pickDetails.odds != null && ` @ ${pick.pickDetails.odds}`}
              </td>
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.unitSize ?? '—'}</td>
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.score != null ? pick.score.toFixed(1) : '—'}</td>
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.lifecycleStatus}</td>
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.deliveryStatus}</td>
              <td className="py-2 pr-4 text-xs text-gray-300">{pick.settlementStatus}</td>
              <td className="py-2 text-xs font-semibold text-gray-200">{pick.result ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
