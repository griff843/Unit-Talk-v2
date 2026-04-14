import Link from 'next/link';
import { PickIdentityPanel } from '@/components/PickIdentityPanel';
import { InterventionAction } from '@/components/InterventionAction';
import { Card } from '@/components/ui/Card';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';
const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;

interface ExceptionQueues {
  counts: {
    failedDelivery: number;
    deadLetter: number;
    pendingManualReview: number;
    staleValidated: number;
    awaitingApprovalDrift: number;
    awaitingApprovalStale: number;
    rerunCandidates: number;
    missingBookAliases: number;
    missingMarketAliases: number;
  };
  failedDelivery: Array<Record<string, unknown>>;
  deadLetter: Array<Record<string, unknown>>;
  pendingManualReview: Array<Record<string, unknown>>;
  staleValidated: Array<Record<string, unknown>>;
  awaitingApprovalDrift: Array<Record<string, unknown>>;
  rerunCandidates: Array<Record<string, unknown>>;
  missingBookAliases: Array<Record<string, unknown>>;
  missingMarketAliases: Array<Record<string, unknown>>;
}

async function fetchExceptionQueues(): Promise<ExceptionQueues | null> {
  try {
    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/exception-queues`, { cache: 'no-store' });
    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as { ok: boolean; data: ExceptionQueues };
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

function readRefreshIntervalMs(searchParams?: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.refresh;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(parsed, 5), 300) * 1000;
  }
  return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
}

function CountBadge({ count, color }: { count: number; color: string }) {
  if (count === 0) {
    return <span className="text-xs text-gray-500">0</span>;
  }

  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${color}`}>{count}</span>;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function buildPickIdentityFromRow(row: Record<string, unknown>) {
  const metadata = readObject(row['metadata']);

  return {
    source: typeof row['source'] === 'string' ? row['source'] : null,
    market: typeof row['market'] === 'string' ? row['market'] : null,
    selection: typeof row['selection'] === 'string' ? row['selection'] : null,
    line: typeof row['line'] === 'number' ? row['line'] : null,
    odds: typeof row['odds'] === 'number' ? row['odds'] : null,
    metadata,
    eventName: typeof row['eventName'] === 'string' ? row['eventName'] : null,
    eventStartTime: typeof row['eventStartTime'] === 'string' ? row['eventStartTime'] : null,
    sport: typeof row['sportDisplayName'] === 'string' ? row['sportDisplayName'] : null,
    capperDisplayName: typeof row['capperDisplayName'] === 'string' ? row['capperDisplayName'] : null,
    marketTypeDisplayName:
      typeof row['marketTypeDisplayName'] === 'string' ? row['marketTypeDisplayName'] : null,
    settlementResult: typeof row['settlementResult'] === 'string' ? row['settlementResult'] : null,
    reviewDecision: typeof row['reviewDecision'] === 'string' ? row['reviewDecision'] : null,
  };
}

function buildPickIdentityFromNestedPick(row: Record<string, unknown>) {
  const pick = readObject(row['pick']);
  if (!pick) {
    return null;
  }

  return {
    source: typeof pick['source'] === 'string' ? pick['source'] : null,
    market: typeof pick['market'] === 'string' ? pick['market'] : null,
    selection: typeof pick['selection'] === 'string' ? pick['selection'] : null,
    line: typeof pick['line'] === 'number' ? pick['line'] : null,
    odds: typeof pick['odds'] === 'number' ? pick['odds'] : null,
    metadata: readObject(pick['metadata']),
    eventName: typeof pick['eventName'] === 'string' ? pick['eventName'] : null,
    eventStartTime: typeof pick['eventStartTime'] === 'string' ? pick['eventStartTime'] : null,
  };
}

function PickIdentityCell({
  pickId,
  pick,
}: {
  pickId: string;
  pick: ReturnType<typeof buildPickIdentityFromRow> | ReturnType<typeof buildPickIdentityFromNestedPick>;
}) {
  if (!pick) {
    return (
      <Link href={`/picks/${pickId}`} className="font-mono text-xs text-blue-400 hover:underline">
        {pickId.slice(0, 8)}...
      </Link>
    );
  }

  return (
    <PickIdentityPanel
      compact
      pickId={`${pickId.slice(0, 8)}...`}
      href={`/picks/${pickId}`}
      pick={pick}
    />
  );
}

function buildForcePromoteContext(row: Record<string, unknown>) {
  const score =
    row['promotion_score'] != null && Number.isFinite(Number(row['promotion_score']))
      ? Number(row['promotion_score']).toFixed(1)
      : 'none';
  const status = String(row['promotion_status'] ?? 'unknown');
  const target = String(row['promotion_target'] ?? 'best-bets');
  return `Current status: ${status}. Score: ${score}. Target will be ${target}.`;
}

function QueueSummary({ data }: { data: ExceptionQueues | null }) {
  const cards = [
    { label: 'Failed Delivery', count: data?.counts.failedDelivery ?? 0, color: 'bg-red-500/20 text-red-400' },
    { label: 'Dead Letter', count: data?.counts.deadLetter ?? 0, color: 'bg-red-500/20 text-red-400' },
    { label: 'Manual Review', count: data?.counts.pendingManualReview ?? 0, color: 'bg-yellow-500/20 text-yellow-400' },
    { label: 'Stale Validated', count: data?.counts.staleValidated ?? 0, color: 'bg-yellow-500/20 text-yellow-400' },
    { label: 'Approval Drift', count: data?.counts.awaitingApprovalDrift ?? 0, color: 'bg-orange-500/20 text-orange-300' },
    { label: 'Rerun Candidates', count: data?.counts.rerunCandidates ?? 0, color: 'bg-blue-500/20 text-blue-400' },
    { label: 'Missing Books', count: data?.counts.missingBookAliases ?? 0, color: 'bg-gray-700 text-gray-200' },
    { label: 'Missing Markets', count: data?.counts.missingMarketAliases ?? 0, color: 'bg-gray-700 text-gray-200' },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded border border-gray-800 bg-gray-900/50 p-3 text-center">
          <CountBadge count={card.count} color={card.color} />
          <p className="mt-1 text-[10px] font-medium uppercase text-gray-500">{card.label}</p>
        </div>
      ))}
    </div>
  );
}

function DeliveryQueueCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
}) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <Card title={`${title} (${rows.length})`}>
      <div className="space-y-3">
        {rows.map((row) => {
          const pickId = String(row['pick_id'] ?? '');
          const pick = buildPickIdentityFromNestedPick(row);
          const pickSource = pick?.source;
          const isProofSource = pickSource && (pickSource.includes('proof') || pickSource.includes('test'));

          return (
            <div key={String(row['id'] ?? pickId)} className="rounded border border-gray-800 bg-gray-950/60 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <PickIdentityCell pickId={pickId} pick={pick} />
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
                    <span>Target: <span className="text-gray-200">{String(row['target'] ?? '—')}</span></span>
                    <span>Status: <span className="text-gray-200">{String(row['status'] ?? '—')}</span></span>
                    <span>Attempts: <span className="text-gray-200">{String(row['attempt_count'] ?? 0)}</span></span>
                    <span>Age: <span className="text-gray-200">{String(row['ageHours'] ?? 0)}h</span></span>
                    {pickSource ? (
                      <span>
                        Source:{' '}
                        <span className={isProofSource ? 'text-yellow-300' : 'text-gray-200'}>{pickSource}</span>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-red-300">{String(row['last_error'] ?? 'No error message')}</p>
                </div>
                <div className="shrink-0">
                  <InterventionAction label="Retry" variant="primary" pickId={pickId} action="retry_delivery" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const data = await fetchExceptionQueues();
  const intervalMs = readRefreshIntervalMs(searchParams);
  const observedAt = new Date().toISOString();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">Exception Operations</h1>
          <p className="text-sm text-gray-500">
            Use this queue to resolve delivery failures, approval drift, manual review blockers, and stale picks with full bet context.
          </p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={intervalMs} className="lg:min-w-[360px]" />
      </div>

      <QueueSummary data={data} />

      <DeliveryQueueCard title="Failed Delivery" rows={data?.failedDelivery ?? []} />
      <DeliveryQueueCard title="Dead Letter" rows={data?.deadLetter ?? []} />

      {(data?.pendingManualReview.length ?? 0) > 0 && (
        <Card title={`Pending Manual Review (${data!.counts.pendingManualReview})`}>
          <div className="space-y-3">
            {data!.pendingManualReview.map((row) => {
              const pickId = String(row['pick_id'] ?? '');
              return (
                <div key={String(row['id'] ?? pickId)} className="rounded border border-gray-800 bg-gray-950/60 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <PickIdentityCell pickId={pickId} pick={null} />
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
                        <span>Review reason: <span className="text-yellow-300">{String(row['review_reason'] ?? '—')}</span></span>
                        <span>Settled by: <span className="text-gray-200">{String(row['settled_by'] ?? '—')}</span></span>
                        <span>Created: <span className="text-gray-200">{new Date(String(row['created_at'] ?? '')).toLocaleString()}</span></span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Link href={`/picks/${pickId}`} className="rounded border border-gray-700 px-3 py-2 text-xs text-blue-300 hover:bg-gray-800">
                        Resolve
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {(data?.awaitingApprovalDrift.length ?? 0) > 0 && (
        <Card title={`Awaiting Approval Drift (${data!.counts.awaitingApprovalDrift})`}>
          <div className="space-y-3">
            {data!.awaitingApprovalDrift.map((row) => {
              const pickId = String(row['id'] ?? '');
              const missingEvidence = Boolean(row['missingLifecycleEvidence']);
              const mismatch = Boolean(row['lifecycleMismatch']);
              const stale = Boolean(row['stale']);

              return (
                <div key={pickId} className="rounded border border-gray-800 bg-gray-950/60 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <PickIdentityCell pickId={pickId} pick={buildPickIdentityFromRow(row)} />
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
                        <span>Status: <span className="text-gray-200">{String(row['status'] ?? '—')}</span></span>
                        <span>Age: <span className="text-orange-300">{String(row['ageHours'] ?? 0)}h</span></span>
                        <span>Latest lifecycle: <span className="text-gray-200">{String(row['latestLifecycleToState'] ?? '—')}</span></span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        {missingEvidence ? <span className="rounded-full bg-red-500/20 px-2 py-1 text-red-300">missing lifecycle evidence</span> : null}
                        {mismatch ? <span className="rounded-full bg-orange-500/20 px-2 py-1 text-orange-200">lifecycle mismatch</span> : null}
                        {stale ? <span className="rounded-full bg-yellow-500/20 px-2 py-1 text-yellow-200">stale awaiting approval</span> : null}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Link href={`/picks/${pickId}`} className="rounded border border-gray-700 px-3 py-2 text-xs text-blue-300 hover:bg-gray-800">
                        Inspect
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {(data?.rerunCandidates.length ?? 0) > 0 && (
        <Card title={`Rerun / Override Candidates (${data!.counts.rerunCandidates})`}>
          <div className="mb-4 rounded border border-yellow-800/60 bg-yellow-900/20 p-3 text-xs text-yellow-100">
            Use <span className="font-medium text-yellow-300">Rerun</span> first when the issue may be stale inputs or drift.
            Reserve <span className="font-medium text-yellow-300">Force Promote</span> for deliberate overrides you would defend in audit history.
          </div>
          <div className="space-y-3">
            {data!.rerunCandidates.map((row) => {
              const pickId = String(row['id'] ?? '');
              return (
                <div key={pickId} className="rounded border border-gray-800 bg-gray-950/60 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <PickIdentityCell pickId={pickId} pick={buildPickIdentityFromRow(row)} />
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
                        <span>Score: <span className="text-gray-200">{row['promotion_score'] != null ? Number(row['promotion_score']).toFixed(1) : '—'}</span></span>
                        <span>Promotion status: <span className="text-yellow-300">{String(row['promotion_status'] ?? '—')}</span></span>
                        <span>Target: <span className="text-gray-200">{String(row['promotion_target'] ?? '—')}</span></span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <InterventionAction label="Rerun" variant="primary" pickId={pickId} action="rerun_promotion" />
                      <InterventionAction
                        label="Force Promote"
                        variant="warning"
                        pickId={pickId}
                        action="force_promote"
                        target={String(row['promotion_target'] ?? 'best-bets')}
                        contextNote={buildForcePromoteContext(row)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {(data?.staleValidated.length ?? 0) > 0 && (
        <Card title={`Stale Validated (${data!.counts.staleValidated})`}>
          <div className="space-y-3">
            {data!.staleValidated.map((row) => {
              const pickId = String(row['id'] ?? '');
              return (
                <div key={pickId} className="rounded border border-gray-800 bg-gray-950/60 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <PickIdentityCell pickId={pickId} pick={buildPickIdentityFromRow(row)} />
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-400">
                        <span>Score: <span className="text-gray-200">{row['promotion_score'] != null ? Number(row['promotion_score']).toFixed(1) : '—'}</span></span>
                        <span>Age: <span className="text-yellow-300">{String(row['ageHours'] ?? 0)}h</span></span>
                        <span>Lifecycle: <span className="text-gray-200">{String(row['status'] ?? '—')}</span></span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <InterventionAction label="Rerun Promo" variant="primary" pickId={pickId} action="rerun_promotion" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {((data?.missingBookAliases.length ?? 0) > 0 || (data?.missingMarketAliases.length ?? 0) > 0) && (
        <Card title="Provider Alias Gaps">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-gray-800 bg-gray-950/60 p-4">
              <h2 className="text-sm font-semibold text-gray-100">Missing Book Aliases</h2>
              <div className="mt-3 space-y-2">
                {(data?.missingBookAliases ?? []).map((row) => (
                  <div key={`${String(row['provider'] ?? '')}:${String(row['providerBookKey'] ?? '')}`} className="rounded border border-gray-800 px-3 py-2 text-xs text-gray-300">
                    <div>{String(row['provider'] ?? '—')} / {String(row['providerBookKey'] ?? '—')}</div>
                    <div className="mt-1 text-gray-500">
                      occurrences {String(row['occurrences'] ?? 0)} • last seen {String(row['latestSeenAt'] ?? '—')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded border border-gray-800 bg-gray-950/60 p-4">
              <h2 className="text-sm font-semibold text-gray-100">Missing Market Aliases</h2>
              <div className="mt-3 space-y-2">
                {(data?.missingMarketAliases ?? []).map((row) => (
                  <div key={`${String(row['provider'] ?? '')}:${String(row['providerMarketKey'] ?? '')}`} className="rounded border border-gray-800 px-3 py-2 text-xs text-gray-300">
                    <div>{String(row['provider'] ?? '—')} / {String(row['providerMarketKey'] ?? '—')}</div>
                    <div className="mt-1 text-gray-500">
                      occurrences {String(row['occurrences'] ?? 0)} • last seen {String(row['latestSeenAt'] ?? '—')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {data &&
      data.counts.failedDelivery === 0 &&
      data.counts.deadLetter === 0 &&
      data.counts.pendingManualReview === 0 &&
      data.counts.staleValidated === 0 &&
      data.counts.awaitingApprovalDrift === 0 &&
      data.counts.rerunCandidates === 0 &&
      data.counts.missingBookAliases === 0 &&
      data.counts.missingMarketAliases === 0 ? (
        <Card>
          <p className="text-sm text-gray-500">No active exceptions. System is healthy.</p>
        </Card>
      ) : null}
    </div>
  );
}
