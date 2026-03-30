import { Card } from '@/components/ui/Card';
import { ReviewActions } from '@/components/ReviewActions';
import { QueueFilters } from '@/components/QueueFilters';
import Link from 'next/link';
import { Suspense } from 'react';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

interface HeldPick {
  id: string;
  source: string;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  stake_units: number | null;
  promotion_score: number | null;
  created_at: string;
  heldBy: string;
  heldAt: string;
  holdReason: string;
  ageHours: number;
}

async function fetchHeldQueue(params: Record<string, string>): Promise<{ picks: HeldPick[]; total: number }> {
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/held-queue?${qs}`, { cache: 'no-store' });
    if (!res.ok) return { picks: [], total: 0 };
    const json = (await res.json()) as { ok: boolean; data: { picks: HeldPick[]; total: number } };
    return json.ok ? json.data : { picks: [], total: 0 };
  } catch {
    return { picks: [], total: 0 };
  }
}

export default async function HeldQueuePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params: Record<string, string> = {};
  for (const [key, val] of Object.entries(searchParams)) {
    if (typeof val === 'string' && val.trim()) params[key] = val.trim();
  }

  const { picks, total } = await fetchHeldQueue(params);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-100">Held Picks</h1>
        <span className="text-sm text-gray-400">{total} pick{total !== 1 ? 's' : ''} on hold</span>
      </div>

      <Card>
        <Suspense fallback={<div className="text-xs text-gray-500">Loading...</div>}>
          <QueueFilters basePath="/held" />
        </Suspense>
      </Card>

      {picks.length === 0 ? (
        <Card>
          <p className="text-sm text-gray-500">No picks currently held.</p>
        </Card>
      ) : (
        picks.map((pick) => (
          <Card key={pick.id}>
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div>
                  <Link href={`/picks/${pick.id}`} className="font-mono text-sm text-blue-400 hover:underline" aria-label={`Pick ${pick.id}`}>
                    {pick.id.slice(0, 12)}...
                  </Link>
                  <div className="mt-1 flex gap-4 text-xs text-gray-400">
                    <span>Source: <span className="text-gray-300">{pick.source}</span></span>
                    <span>Market: <span className="text-gray-300">{pick.market}</span></span>
                    <span>Selection: <span className="text-gray-300">{pick.selection}</span></span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-gray-200">
                    {pick.promotion_score != null ? pick.promotion_score.toFixed(1) : '—'}
                  </div>
                  <div className="text-[10px] text-gray-500">score</div>
                </div>
              </div>

              <div className="rounded border border-yellow-800 bg-yellow-950 px-3 py-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-yellow-300">
                    Held by <span className="font-medium">{pick.heldBy}</span> — {pick.ageHours}h ago
                  </span>
                  <span className="text-yellow-500">{new Date(pick.heldAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-xs text-yellow-400">Reason: {pick.holdReason}</p>
              </div>

              <ReviewActions pickId={pick.id} decisions={['return', 'approve', 'deny']} />
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
