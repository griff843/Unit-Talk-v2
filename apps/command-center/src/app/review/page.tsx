import { Card } from '@/components/ui/Card';
import { QueueFilters } from '@/components/QueueFilters';
import { ReviewQueueClient } from '@/components/ReviewQueueClient';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { Suspense } from 'react';
import { getReviewQueue } from '@/lib/data';

const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;

function readRefreshIntervalMs(searchParams?: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.refresh;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(parsed, 5), 300) * 1000;
  }
  return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
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

  const { picks, total } = await getReviewQueue(params);
  const intervalMs = readRefreshIntervalMs(searchParams);
  const observedAt = new Date().toISOString();
  const lifecycleAwaitingApproval = picks.filter(
    (pick) => pick.governanceQueueState === 'awaiting_approval' || pick.status === 'awaiting_approval',
  ).length;
  const legacyPending = Math.max(total - lifecycleAwaitingApproval, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">Review Queue</h1>
          <span className="text-sm text-gray-400">{total} pick{total !== 1 ? 's' : ''} awaiting review</span>
          <p className="text-xs text-gray-500">
            Governance queue truth: {lifecycleAwaitingApproval} lifecycle-gated awaiting_approval
            {', '}
            {legacyPending} legacy pending-review pick{legacyPending !== 1 ? 's' : ''}.
          </p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={intervalMs} className="lg:min-w-[360px]" />
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
