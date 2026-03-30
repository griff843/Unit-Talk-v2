import { Card } from '@/components/ui/Card';
import { ReviewActions } from '@/components/ReviewActions';
import Link from 'next/link';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

interface ReviewPick {
  id: string;
  source: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  stake_units: number | null;
  promotion_score: number | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

async function fetchReviewQueue(): Promise<{ picks: ReviewPick[]; total: number }> {
  try {
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/review-queue`, { cache: 'no-store' });
    if (!res.ok) return { picks: [], total: 0 };
    const json = (await res.json()) as { ok: boolean; data: { picks: ReviewPick[]; total: number } };
    return json.ok ? json.data : { picks: [], total: 0 };
  } catch {
    return { picks: [], total: 0 };
  }
}

export default async function ReviewQueuePage() {
  const { picks, total } = await fetchReviewQueue();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-100">Review Queue</h1>
        <span className="text-sm text-gray-400">{total} pick{total !== 1 ? 's' : ''} awaiting review</span>
      </div>

      {picks.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-500">No picks awaiting review.</p>
        </Card>
      ) : (
        picks.map((pick) => {
          const scores = pick.metadata?.['promotionScores'] as Record<string, number> | undefined;
          return (
            <Card key={pick.id}>
              <div className="flex flex-col gap-4">
                {/* Pick info */}
                <div className="flex items-start justify-between">
                  <div>
                    <Link href={`/picks/${pick.id}`} className="font-mono text-sm text-blue-400 hover:underline">
                      {pick.id.slice(0, 12)}...
                    </Link>
                    <div className="mt-1 flex gap-4 text-xs text-gray-400">
                      <span>Source: <span className="text-gray-300">{pick.source}</span></span>
                      <span>Market: <span className="text-gray-300">{pick.market}</span></span>
                      <span>Selection: <span className="text-gray-300">{pick.selection}</span></span>
                    </div>
                    <div className="mt-1 flex gap-4 text-xs text-gray-400">
                      {pick.odds != null && <span>Odds: <span className="text-gray-300">{pick.odds}</span></span>}
                      {pick.line != null && <span>Line: <span className="text-gray-300">{pick.line}</span></span>}
                      {pick.stake_units != null && <span>Units: <span className="text-gray-300">{pick.stake_units}</span></span>}
                      <span>Created: <span className="text-gray-300">{new Date(pick.created_at).toLocaleString()}</span></span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-200">
                      {pick.promotion_score != null ? pick.promotion_score.toFixed(1) : '—'}
                    </div>
                    <div className="text-[10px] text-gray-500">score</div>
                  </div>
                </div>

                {/* Score breakdown */}
                {scores && (
                  <div className="flex gap-3 text-xs text-gray-400">
                    {Object.entries(scores).map(([key, val]) => (
                      <span key={key}>{key}: <span className="text-gray-300">{typeof val === 'number' ? val.toFixed(0) : String(val)}</span></span>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <ReviewActions pickId={pick.id} decisions={['approve', 'deny', 'hold']} />
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
