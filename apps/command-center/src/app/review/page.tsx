import { Card } from '@/components/ui/Card';
import { DegradedState } from '@/components/ui';
import { QueueFilters } from '@/components/QueueFilters';
import { ReviewQueueClient } from '@/components/ReviewQueueClient';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { Suspense } from 'react';
import { getReviewQueue } from '@/lib/data';
import { describeOperatorFailure } from '@/lib/describe-error';

export const metadata = { title: 'Review Queue — Unit Talk Command Center' };

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
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const params: Record<string, string> = {};
  for (const [key, val] of Object.entries(searchParams)) {
    if (typeof val === 'string' && val.trim()) params[key] = val.trim();
  }

  let queue: Awaited<ReturnType<typeof getReviewQueue>> | null = null;
  let loadError: string | null = null;
  try {
    queue = await getReviewQueue(params);
  } catch (error) {
    loadError = describeOperatorFailure(error, 'The governed review queue could not be loaded.');
  }

  if (!queue || queue.degraded) {
    return (
      <DegradedState
        severity="critical"
        title="Review queue unavailable"
        causes={[queue?.degraded ?? loadError ?? 'The governed review queue could not be loaded. No queue count was inferred.']}
        action={{ label: 'System Health', href: '/api-health' }}
      />
    );
  }

  const { picks, total } = queue;
  const intervalMs = readRefreshIntervalMs(searchParams);
  const observedAt = new Date().toISOString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <span className="text-sm text-gray-400">{picks.length} review candidate{picks.length !== 1 ? 's' : ''} loaded</span>
          <p className="text-xs text-gray-500">
            Source query reported {total} matching row{total !== 1 ? 's' : ''} before local fixture exclusion.
            Lifecycle and approval state are shown per row; no full-queue split is inferred from this page.
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
