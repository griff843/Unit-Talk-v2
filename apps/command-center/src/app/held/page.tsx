import { Card } from '@/components/ui/Card';
import { PickIdentityPanel } from '@/components/PickIdentityPanel';
import { ReviewActions } from '@/components/ReviewActions';
import { QueueFilters } from '@/components/QueueFilters';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { buildScoreInsight, scoreToneClasses } from '@/lib/score-insight';
import { Suspense } from 'react';

import { getHeldQueue } from '@/lib/data';

const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;

function readRefreshIntervalMs(searchParams?: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.refresh;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(parsed, 5), 300) * 1000;
  }
  return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
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

  const { picks, total } = await getHeldQueue(params);
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
          <h1 className="text-lg font-bold text-gray-100">Held Picks</h1>
          <span className="text-sm text-gray-400">{total} pick{total !== 1 ? 's' : ''} on hold</span>
          <p className="text-xs text-gray-500">
            Holds now span both lifecycle-gated awaiting_approval picks and legacy pending-review picks.
            Current mix: {lifecycleAwaitingApproval} awaiting_approval, {legacyPending} legacy pending.
          </p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={intervalMs} className="lg:min-w-[360px]" />
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
            {(() => {
              const scoreInsight = buildScoreInsight(pick.metadata ?? null);
              return (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div>
                  <PickIdentityPanel
                    compact
                    pickId={`${pick.id.slice(0, 12)}...`}
                    href={`/picks/${pick.id}`}
                    pick={{
                      source: pick.source,
                      market: pick.market,
                      selection: pick.selection,
                      line: pick.line,
                      odds: pick.odds,
                      metadata: pick.metadata ?? null,
                      eventName: pick.eventName ?? null,
                      eventStartTime: pick.eventStartTime ?? null,
                      sportDisplayName: pick.sportDisplayName ?? null,
                      capperDisplayName: pick.capperDisplayName ?? null,
                      marketTypeDisplayName: pick.marketTypeDisplayName ?? null,
                      settlementResult: pick.settlementResult ?? null,
                      reviewDecision: pick.reviewDecision ?? null,
                    }}
                  />
                  <div className="mt-1 flex gap-4 text-xs text-gray-400">
                    {pick.odds != null && <span>Odds: <span className="text-gray-300">{pick.odds}</span></span>}
                    {pick.line != null && <span>Line: <span className="text-gray-300">{pick.line}</span></span>}
                    {pick.stake_units != null && <span>Units: <span className="text-gray-300">{pick.stake_units}</span></span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-gray-200">
                    {pick.promotion_score != null ? pick.promotion_score.toFixed(1) : '—'}
                  </div>
                  <div className="text-[10px] text-gray-500">routing score</div>
                  <div className={`mt-1 rounded border px-2 py-1 text-[10px] ${scoreToneClasses(scoreInsight.reliabilityTone)}`}>
                    {scoreInsight.edgeSourceLabel}
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-gray-500">
                Routing score reflects promotion policy fit, not win probability. Trust: {scoreInsight.reliabilityLabel.toLowerCase()}.
              </p>

              <div className="rounded border border-yellow-800 bg-yellow-950 px-3 py-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-yellow-300">
                    Held by <span className="font-medium">{pick.heldBy}</span> — {pick.ageHours}h ago
                  </span>
                  <span className="text-yellow-500">{new Date(pick.heldAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-xs text-yellow-400">Reason: {pick.holdReason}</p>
                <p className="mt-1 text-[11px] text-yellow-500">
                  Governance state:{' '}
                  {pick.governanceQueueState === 'awaiting_approval' || pick.status === 'awaiting_approval'
                    ? 'awaiting_approval'
                    : 'pending review'}
                </p>
              </div>

              <ReviewActions pickId={pick.id} decisions={['return', 'approve', 'deny']} />
            </div>
              );
            })()}
          </Card>
        ))
      )}
    </div>
  );
}
