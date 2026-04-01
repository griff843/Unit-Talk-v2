import { Card } from '@/components/ui/Card';
import { QueueFilters } from '@/components/QueueFilters';
import { ReviewQueueClient } from '@/components/ReviewQueueClient';
import { Suspense } from 'react';

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

async function fetchReviewQueue(params: Record<string, string>): Promise<{ picks: ReviewPick[]; total: number }> {
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/review-queue?${qs}`, { cache: 'no-store' });
    if (!res.ok) return { picks: [], total: 0 };
    const json = (await res.json()) as { ok: boolean; data: { picks: ReviewPick[]; total: number } };
    return json.ok ? json.data : { picks: [], total: 0 };
  } catch {
    return { picks: [], total: 0 };
  }
}

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params: Record<string, string> = {};
  for (const [key, val] of Object.entries(searchParams)) {
    if (typeof val === 'string' && val.trim()) params[key] = val.trim();
  }

  const { picks, total } = await fetchReviewQueue(params);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-100">Review Queue</h1>
        <span className="text-sm text-gray-400">{total} pick{total !== 1 ? 's' : ''} awaiting review</span>
      </div>

      <Card>
        <Suspense fallback={<div className="text-xs text-gray-500">Loading...</div>}>
          <QueueFilters basePath="/review" />
        </Suspense>
      </Card>

      <ReviewQueueClient picks={picks} total={total} />
    </div>
  );
}
