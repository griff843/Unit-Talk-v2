import { Card } from '@/components/ui/Card';
import Link from 'next/link';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

interface ReviewRow {
  id: string;
  pickId: string;
  decision: string;
  reason: string;
  decidedBy: string;
  decidedAt: string;
  pick: {
    market: string;
    selection: string;
    source: string;
    score: number | null;
    status: string;
  } | null;
  outcome: string | null;
}

async function fetchReviewHistory(decision?: string): Promise<{ reviews: ReviewRow[]; total: number }> {
  try {
    const params = new URLSearchParams();
    if (decision) params.set('decision', decision);
    params.set('limit', '50');
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/review-history?${params}`, { cache: 'no-store' });
    if (!res.ok) return { reviews: [], total: 0 };
    const json = (await res.json()) as { ok: boolean; data: { reviews: ReviewRow[]; total: number } };
    return json.ok ? json.data : { reviews: [], total: 0 };
  } catch {
    return { reviews: [], total: 0 };
  }
}

const DECISION_COLORS: Record<string, string> = {
  approve: 'text-green-400',
  deny: 'text-red-400',
  hold: 'text-yellow-400',
  return: 'text-blue-400',
};

const OUTCOME_COLORS: Record<string, string> = {
  win: 'text-green-400',
  loss: 'text-red-400',
  push: 'text-gray-300',
  void: 'text-yellow-400',
};

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filterDecision = typeof searchParams['decision'] === 'string' ? searchParams['decision'] : undefined;
  const { reviews, total } = await fetchReviewHistory(filterDecision);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-bold text-gray-100">Decision Audit</h1>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { value: undefined, label: 'All' },
          { value: 'approve', label: 'Approved' },
          { value: 'deny', label: 'Denied' },
          { value: 'hold', label: 'Held' },
          { value: 'return', label: 'Returned' },
        ].map((tab) => (
          <Link
            key={tab.label}
            href={tab.value ? `/decisions?decision=${tab.value}` : '/decisions'}
            className={`rounded px-3 py-1 text-xs ${
              filterDecision === tab.value || (!filterDecision && !tab.value)
                ? 'bg-blue-600 text-white'
                : 'border border-gray-700 text-gray-400 hover:bg-gray-800'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <Card title={`Decisions (${total})`}>
        {reviews.length === 0 ? (
          <p className="text-sm text-gray-500">No review decisions recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-xs uppercase text-gray-400">
                  <th className="py-2 pr-3">Pick</th>
                  <th className="py-2 pr-3">Decision</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">By</th>
                  <th className="py-2 pr-3">Market</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Pick Status</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800">
                    <td className="py-2 pr-3">
                      <Link href={`/picks/${r.pickId}`} className="font-mono text-xs text-blue-400 hover:underline">
                        {r.pickId.slice(0, 8)}...
                      </Link>
                    </td>
                    <td className={`py-2 pr-3 text-xs font-medium ${DECISION_COLORS[r.decision] ?? 'text-gray-300'}`}>
                      {r.decision}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-400 max-w-[200px] truncate" title={r.reason}>
                      {r.reason}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{r.decidedBy}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{r.pick?.market ?? '—'}</td>
                    <td className="py-2 pr-3 text-xs text-gray-300">
                      {r.pick?.score != null ? r.pick.score.toFixed(1) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-300">{r.pick?.status ?? '—'}</td>
                    <td className={`py-2 pr-3 text-xs font-medium ${OUTCOME_COLORS[r.outcome ?? ''] ?? 'text-gray-500'}`}>
                      {r.outcome ?? '—'}
                    </td>
                    <td className="py-2 text-xs text-gray-400">{new Date(r.decidedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
