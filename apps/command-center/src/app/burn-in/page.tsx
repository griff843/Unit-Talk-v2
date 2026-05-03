import { Card } from '@/components/ui/Card';
import {
  getExceptionQueues,
  getIntelligenceCoverage,
  getProviderCycleHealth,
  getProviderHealth,
  getSnapshotData,
} from '@/lib/data';
import type { IntelligenceCoverage, ProviderCycleHealthSummary, ProviderHealth } from '@/lib/types';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';

const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;

type RowStatus = 'pass' | 'fail' | 'warn' | 'manual';

interface StatusRow {
  label: string;
  value: string;
  status: RowStatus;
  note?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' ? value : fallback;
}

function unwrapResponse(raw: unknown) {
  const top = asRecord(raw);
  return top['data'] !== undefined ? asRecord(top['data']) : top;
}

function readRefreshIntervalMs(searchParams?: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.refresh;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(parsed, 5), 300) * 1000;
  }
  return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
}

function formatPct(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

function statusClasses(status: RowStatus) {
  switch (status) {
    case 'pass':
      return 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/30';
    case 'warn':
      return 'bg-amber-500/10 text-amber-200 border border-amber-500/30';
    case 'fail':
      return 'bg-red-500/10 text-red-200 border border-red-500/30';
    default:
      return 'bg-gray-800 text-gray-300 border border-gray-700';
  }
}

function StatusPill({ status }: { status: RowStatus }) {
  const label = status === 'pass'
    ? 'PASS'
    : status === 'fail'
      ? 'FAIL'
      : status === 'warn'
        ? 'WARN'
        : 'MANUAL';

  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold tracking-wide ${statusClasses(status)}`}>
      {label}
    </span>
  );
}

function StatusTable({ rows }: { rows: StatusRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
            <th className="py-2 pr-4">Check</th>
            <th className="py-2 pr-4">Value</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-gray-900 align-top">
              <td className="py-3 pr-4 text-gray-200">{row.label}</td>
              <td className="py-3 pr-4 font-medium text-gray-100">{row.value}</td>
              <td className="py-3 pr-4"><StatusPill status={row.status} /></td>
              <td className="py-3 text-xs text-gray-500">{row.note ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function countRowsSince(rows: unknown[], field: string, cutoffMs: number) {
  return rows.filter((row) => {
    const value = asString(asRecord(row)[field]);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed >= cutoffMs;
  }).length;
}

function countReceiptsSentToday(rows: unknown[], cutoffMs: number) {
  return rows.filter((row) => {
    const record = asRecord(row);
    const recordedAt = Date.parse(asString(record['recorded_at']));
    return (
      Number.isFinite(recordedAt) &&
      recordedAt >= cutoffMs &&
      asString(record['status']) === 'sent' &&
      asString(record['receipt_type']) === 'discord.message'
    );
  }).length;
}

function countClvSettlements(rows: unknown[], cutoffMs: number) {
  return rows.filter((row) => {
    const record = asRecord(row);
    const createdAt = Date.parse(asString(record['created_at']));
    if (!Number.isFinite(createdAt) || createdAt < cutoffMs) {
      return false;
    }
    const payload = asRecord(record['payload']);
    return payload['clvRaw'] != null || payload['clvPercent'] != null;
  }).length;
}

function countDuplicateReceipts(rows: unknown[], cutoffMs: number) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const record = asRecord(row);
    const recordedAt = Date.parse(asString(record['recorded_at']));
    const outboxId = asString(record['outbox_id']);
    if (!outboxId || !Number.isFinite(recordedAt) || recordedAt < cutoffMs) {
      continue;
    }
    counts.set(outboxId, (counts.get(outboxId) ?? 0) + 1);
  }
  return Array.from(counts.values()).filter((count) => count > 1).length;
}

function providerCycleRowStatus(
  row: ProviderCycleHealthSummary['rows'][number],
): RowStatus {
  switch (row.productionStatus) {
    case 'healthy':
      return 'pass';
    case 'warning':
      return 'warn';
    default:
      return 'fail';
  }
}

const SECTION8_ROWS: Array<{ component: string; verdict: string; note: string }> = [
  { component: 'Devigging', verdict: 'PROVEN', note: 'Submission-time path is live and covered in burn-in truth.' },
  { component: 'Kelly', verdict: 'PARTIAL', note: 'Computed in runtime metadata, but still not surfaced to members.' },
  { component: 'CLV', verdict: 'PROVEN', note: 'Tracked on settled picks and exposed through aggregate coverage.' },
  { component: 'Real edge', verdict: 'CONDITIONAL', note: 'Depends on provider match coverage and live offer availability.' },
  { component: 'Calibration', verdict: 'TEST-ONLY', note: 'No runtime consumer path is surfaced yet.' },
  { component: 'Risk engine', verdict: 'TEST-ONLY', note: 'Domain logic exists, but burn-in still lacks runtime usage.' },
  { component: 'Market signals', verdict: 'DEAD-CODE', note: 'Not part of the current burn-in runtime path.' },
];

export default async function BurnInPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const intervalMs = readRefreshIntervalMs(searchParams);
  const [snapshotResult, todayCoverageResult, weeklyCoverageResult, providerHealthResult, exceptionQueuesResult] = await Promise.all([
    getSnapshotData(),
    getIntelligenceCoverage('1d'),
    getIntelligenceCoverage('7d'),
    getProviderHealth(),
    getExceptionQueues(),
  ]);

  const snapshot = unwrapResponse(snapshotResult);
  const exceptionQueues = unwrapResponse(exceptionQueuesResult);
  const todayCoverage = unwrapResponse(todayCoverageResult) as unknown as IntelligenceCoverage;
  const weeklyCoverage = unwrapResponse(weeklyCoverageResult) as unknown as IntelligenceCoverage;
  const providerHealth = unwrapResponse(providerHealthResult) as unknown as ProviderHealth;
  const providerCycleHealth = await getProviderCycleHealth({
    latestProviderOfferSnapshotAt: providerHealth.latestProviderOfferSnapshotAt ?? null,
  });
  const counts = asRecord(snapshot['counts']);
  const workerRuntime = asRecord(snapshot['workerRuntime']);
  const gradingAgent = asRecord(snapshot['gradingAgent']);
  const alertAgent = asRecord(snapshot['alertAgent']);
  const ingestorHealth = asRecord(snapshot['ingestorHealth']);
  const incidents = asArray(snapshot['incidents']);
  const recentPicks = asArray(snapshot['recentPicks']);
  const recentOutbox = asArray(snapshot['recentOutbox']);
  const recentReceipts = asArray(snapshot['recentReceipts']);
  const recentSettlements = asArray(snapshot['recentSettlements']);
  const recentRuns = asArray(snapshot['recentRuns']);
  const recentAudit = asArray(snapshot['recentAudit']);
  const observedAt = asString(snapshot['observedAt'], new Date().toISOString());
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayCutoffMs = startOfToday.getTime();

  const picksToday = countRowsSince(recentPicks, 'created_at', todayCutoffMs);
  const promotedToday = recentPicks.filter((row) => {
    const record = asRecord(row);
    return Date.parse(asString(record['created_at'])) >= todayCutoffMs
      && asString(record['promotion_status']) === 'qualified';
  }).length;
  const receiptsToday = countReceiptsSentToday(recentReceipts, todayCutoffMs);
  const settlementsToday = countRowsSince(recentSettlements, 'created_at', todayCutoffMs);
  const clvToday = countClvSettlements(recentSettlements, todayCutoffMs);
  const outboxToday = countRowsSince(recentOutbox, 'created_at', todayCutoffMs);
  const duplicateReceiptsToday = countDuplicateReceipts(recentReceipts, todayCutoffMs);
  const operatorInterventionsToday = countRowsSince(recentAudit, 'created_at', todayCutoffMs);
  const recapPostedToday = recentRuns.some((row) => {
    const record = asRecord(row);
    return Date.parse(asString(record['started_at'])) >= todayCutoffMs
      && asString(record['run_type']).startsWith('recap');
  });
  const alertRanToday = recentRuns.some((row) => {
    const record = asRecord(row);
    return Date.parse(asString(record['started_at'])) >= todayCutoffMs
      && asString(record['run_type']).startsWith('alert');
  });

  const entryRows: StatusRow[] = [
    {
      label: '`pnpm verify` green',
      value: 'Manual checkpoint',
      status: 'manual',
      note: 'Still requires an operator to confirm the last known repo gate.',
    },
    {
      label: 'Active capper submissions in last 24h',
      value: `${picksToday} recent submission(s)`,
      status: picksToday > 0 ? 'pass' : 'fail',
      note: 'Derived from recent picks in operator snapshot.',
    },
    {
      label: 'SGO ingestor running',
      value: `${asString(ingestorHealth['status'], 'unknown')} / ${formatTimestamp(asString(ingestorHealth['lastRunAt']))}`,
      status: asString(ingestorHealth['status']) === 'healthy' ? 'pass' : 'fail',
    },
    {
      label: 'Odds API data present',
      value: `${providerHealth.providers.filter((row) => row.providerKey.startsWith('odds-api') && row.last24hRows > 0).length} provider row(s) active`,
      status: providerHealth.providers.some((row) => row.providerKey.startsWith('odds-api') && row.last24hRows > 0) ? 'pass' : 'fail',
    },
    {
      label: 'Provider cycle staging visible',
      value: `${providerCycleHealth.trackedLanes} tracked lane(s)`,
      status: providerCycleHealth.trackedLanes > 0 ? 'pass' : 'warn',
      note: 'Staging-lane truth is shown separately from live provider_offer_current freshness.',
    },
    {
      label: 'Worker runtime healthy',
      value: asString(workerRuntime['drainState'], 'unknown'),
      status: ['stalled', 'blocked'].includes(asString(workerRuntime['drainState'])) ? 'fail' : 'pass',
      note: asString(workerRuntime['detail'], 'No worker detail surfaced'),
    },
    {
      label: 'Operator snapshot accessible',
      value: 'Page loaded',
      status: 'pass',
      note: `Observed ${formatTimestamp(observedAt)}`,
    },
    {
      label: 'Discord delivery confirmed in last 24h',
      value: `${receiptsToday} sent receipt(s)`,
      status: receiptsToday > 0 ? 'pass' : 'fail',
    },
  ];

  const checklistRows: StatusRow[] = [
    {
      label: 'Picks submitted today',
      value: String(picksToday),
      status: picksToday > 0 ? 'pass' : 'warn',
    },
    {
      label: 'Submission events recorded',
      value: String(picksToday),
      status: picksToday > 0 ? 'warn' : 'fail',
      note: 'Currently inferred from recent submissions; direct submission_events aggregation is not surfaced yet.',
    },
    {
      label: 'Domain analysis computed',
      value: `${todayCoverage.domainAnalysis.count} (${formatPct(todayCoverage.domainAnalysis.rate)})`,
      status: todayCoverage.domainAnalysis.count > 0 ? 'pass' : 'warn',
    },
    {
      label: 'Devig result attached',
      value: `${todayCoverage.deviggingResult.count} (${formatPct(todayCoverage.deviggingResult.rate)})`,
      status: todayCoverage.deviggingResult.count > 0 ? 'pass' : 'warn',
    },
    {
      label: 'Kelly sizing attached',
      value: `${todayCoverage.kellySizing.count} (${formatPct(todayCoverage.kellySizing.rate)})`,
      status: todayCoverage.kellySizing.count > 0 ? 'pass' : 'warn',
    },
    {
      label: 'Real edge computed',
      value: `${todayCoverage.realEdge.count} (${formatPct(todayCoverage.realEdge.rate)})`,
      status: todayCoverage.realEdge.count > 0 ? 'pass' : 'warn',
    },
    {
      label: 'Edge source distribution',
      value: `real ${todayCoverage.edgeSourceDistribution.realEdge} / consensus ${todayCoverage.edgeSourceDistribution.consensusEdge} / fallback ${todayCoverage.edgeSourceDistribution.confidenceDelta}`,
      status: todayCoverage.edgeSourceDistribution.confidenceDelta > todayCoverage.edgeSourceDistribution.realEdge ? 'warn' : 'pass',
    },
    {
      label: 'Picks promoted today',
      value: String(promotedToday),
      status: promotedToday > 0 ? 'pass' : 'warn',
    },
    {
      label: 'Outbox rows created today',
      value: String(outboxToday),
      status: outboxToday > 0 ? 'pass' : 'warn',
    },
    {
      label: 'Picks delivered today',
      value: String(receiptsToday),
      status: receiptsToday > 0 ? 'pass' : 'warn',
    },
    {
      label: 'Duplicate deliveries today',
      value: String(duplicateReceiptsToday),
      status: duplicateReceiptsToday === 0 ? 'pass' : 'fail',
    },
    {
      label: 'Dead-letter rows',
      value: String(asNumber(counts['deadLetterOutbox'])),
      status: asNumber(counts['deadLetterOutbox']) === 0 ? 'pass' : 'fail',
    },
    {
      label: 'Game results ingested',
      value: formatTimestamp(asString(ingestorHealth['lastRunAt'])),
      status: asString(ingestorHealth['status']) === 'healthy' ? 'pass' : 'warn',
      note: 'Proxying through ingestor runtime until a direct game_results aggregate is surfaced.',
    },
    {
      label: 'Picks graded today',
      value: String(settlementsToday),
      status: settlementsToday > 0 ? 'pass' : 'warn',
    },
    {
      label: 'CLV populated on settled picks',
      value: `${clvToday}/${settlementsToday || 0}`,
      status: settlementsToday === 0 ? 'warn' : clvToday === settlementsToday ? 'pass' : 'warn',
    },
    {
      label: 'Recap posted today',
      value: recapPostedToday ? 'Yes' : 'No',
      status: recapPostedToday ? 'pass' : 'warn',
      note: `Latest recap post: ${formatTimestamp(asString(gradingAgent['lastRecapPostAt']))}`,
    },
    {
      label: 'Operator interventions today',
      value: String(operatorInterventionsToday),
      status: operatorInterventionsToday > 0 ? 'warn' : 'pass',
      note: 'Derived from recent audit rows surfaced in snapshot.',
    },
    {
      label: 'Alert agent ran today',
      value: alertRanToday ? 'Yes' : 'No',
      status: alertRanToday ? 'pass' : 'warn',
      note: `Latest detection run: ${formatTimestamp(asString(alertAgent['lastDetectionRunAt']))}`,
    },
  ];

  const section7Rows: StatusRow[] = [
    {
      label: '7.4 Live odds from >=2 providers',
      value: `${providerHealth.providers.filter((row) => row.status === 'active').length} active provider key(s)`,
      status: providerHealth.providers.filter((row) => row.status === 'active').length >= 2 ? 'pass' : 'warn',
    },
    {
      label: '7.5 Automated grading + settlement',
      value: `${settlementsToday} grading settlement row(s) today`,
      status: settlementsToday > 0 ? 'pass' : 'warn',
    },
    {
      label: '7.6 CLV tracking live',
      value: `${weeklyCoverage.clvCoverage.withClv}/${weeklyCoverage.clvCoverage.settledPicks} settled rows with CLV`,
      status: weeklyCoverage.clvCoverage.rate >= 0.8 ? 'pass' : 'warn',
    },
    {
      label: '7.7 Recap automation',
      value: formatTimestamp(asString(gradingAgent['lastRecapPostAt'])),
      status: asString(gradingAgent['lastRecapPostAt']) ? 'pass' : 'warn',
    },
    {
      label: '7.9 Alert system live',
      value: formatTimestamp(asString(alertAgent['lastDetectionRunAt'])),
      status: asString(alertAgent['lastDetectionRunAt']) ? 'pass' : 'warn',
    },
    {
      label: '7.11 Domain math consumers wired to live data',
      value: `${weeklyCoverage.realEdge.count} pick(s) with real edge in ${weeklyCoverage.window}`,
      status: weeklyCoverage.realEdge.count > 0 ? 'pass' : 'warn',
    },
    {
      label: '7.12 `pnpm verify` green',
      value: 'Manual checkpoint',
      status: 'manual',
      note: 'Contract keeps this as an operator-attested check.',
    },
  ];

  const queueCounts = asRecord(exceptionQueues['counts']);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-100">Burn-In Scorecard</h1>
          <p className="text-sm text-gray-500">
            Controlled validation truth surface for runtime health, enrichment coverage, provider freshness, and readiness evidence.
          </p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={intervalMs} className="lg:min-w-[360px]" />
      </div>

      <Card title="Entry Conditions">
        <StatusTable rows={entryRows} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Intelligence Truth">
          <div className="space-y-3 text-sm">
            <div>Total picks ({weeklyCoverage.window}): <span className="font-bold text-gray-100">{weeklyCoverage.totalPicks}</span></div>
            <div>Picks with odds: <span className="font-bold text-gray-100">{weeklyCoverage.picksWithOdds}</span></div>
            <div>Domain analysis: <span className="font-bold text-gray-100">{weeklyCoverage.domainAnalysis.count}</span> <span className="text-xs text-gray-500">({formatPct(weeklyCoverage.domainAnalysis.rate)})</span></div>
            <div>Devigging: <span className="font-bold text-gray-100">{weeklyCoverage.deviggingResult.count}</span> <span className="text-xs text-gray-500">({formatPct(weeklyCoverage.deviggingResult.rate)})</span></div>
            <div>Kelly: <span className="font-bold text-gray-100">{weeklyCoverage.kellySizing.count}</span> <span className="text-xs text-gray-500">({formatPct(weeklyCoverage.kellySizing.rate)})</span></div>
            <div>Real edge: <span className="font-bold text-gray-100">{weeklyCoverage.realEdge.count}</span> <span className="text-xs text-gray-500">({formatPct(weeklyCoverage.realEdge.rate)})</span></div>
          </div>
        </Card>

        <Card title="Delivery / Runtime Truth">
          <div className="space-y-3 text-sm">
            <div>Pending outbox: <span className="font-bold text-gray-100">{asNumber(counts['pendingOutbox'])}</span></div>
            <div>Processing outbox: <span className="font-bold text-gray-100">{asNumber(counts['processingOutbox'])}</span></div>
            <div>Sent outbox: <span className="font-bold text-green-400">{asNumber(counts['sentOutbox'])}</span></div>
            <div>Failed outbox: <span className="font-bold text-yellow-400">{asNumber(counts['failedOutbox'])}</span></div>
            <div>Dead-letter outbox: <span className="font-bold text-red-400">{asNumber(counts['deadLetterOutbox'])}</span></div>
            <div>Worker drain state: <span className="font-bold text-gray-100">{asString(workerRuntime['drainState'], 'unknown')}</span></div>
            <div className="text-xs text-gray-500">{asString(workerRuntime['detail'], 'No worker detail')}</div>
          </div>
        </Card>

        <Card title="Provider Truth">
          <div className="space-y-3 text-sm">
            <div>Distinct offer events (24h): <span className="font-bold text-gray-100">{providerHealth.distinctEventsLast24h}</span></div>
            <div>Ingestor status: <span className="font-bold text-gray-100">{providerHealth.ingestorHealth.status}</span></div>
            <div>Latest live snapshot: <span className="font-bold text-gray-100">{formatTimestamp(providerHealth.latestProviderOfferSnapshotAt ?? null)}</span></div>
            <div>SGO quota: <span className="font-bold text-gray-100">{providerHealth.quotaSummary.sgo ? `${providerHealth.quotaSummary.sgo.creditsUsed} used` : '-'}</span></div>
            <div>Odds API quota: <span className="font-bold text-gray-100">{providerHealth.quotaSummary.oddsApi ? `${providerHealth.quotaSummary.oddsApi.creditsUsed} used` : '-'}</span></div>
          </div>
          <div className="mt-4 space-y-2 text-xs text-gray-500">
            {providerHealth.providers.map((row) => (
              <div key={row.providerKey} className="flex items-center justify-between gap-3 rounded border border-gray-800 px-3 py-2">
                <span>{row.providerKey}</span>
                <span>{row.last24hRows} rows / {row.status}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Provider Cycle Production Health">
        <div className="mb-4 grid gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <div className="rounded border border-gray-800 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">Overall</div>
            <div className="mt-1 font-semibold text-gray-100">{providerCycleHealth.overallStatus}</div>
          </div>
          <div className="rounded border border-gray-800 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">Tracked lanes</div>
            <div className="mt-1 font-semibold text-gray-100">{providerCycleHealth.trackedLanes}</div>
          </div>
          <div className="rounded border border-gray-800 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">Merged</div>
            <div className="mt-1 font-semibold text-emerald-300">{providerCycleHealth.mergedLanes}</div>
          </div>
          <div className="rounded border border-gray-800 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">Blocked</div>
            <div className="mt-1 font-semibold text-amber-300">{providerCycleHealth.blockedLanes}</div>
          </div>
          <div className="rounded border border-gray-800 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">Stale gates</div>
            <div className="mt-1 font-semibold text-red-300">{providerCycleHealth.staleLanes}</div>
          </div>
          <div className="rounded border border-gray-800 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">Proof required</div>
            <div className="mt-1 font-semibold text-gray-100">{providerCycleHealth.proofRequiredLanes}</div>
          </div>
        </div>
        <div className="mb-4 space-y-1 text-xs text-gray-500">
          <div>Staging truth only: this panel reflects `provider_cycle_status`, not live `provider_offer_current` cutover.</div>
          <div>Latest staged cycle snapshot: {formatTimestamp(providerCycleHealth.latestCycleSnapshotAt)}</div>
          <div>Latest live offer snapshot: {formatTimestamp(providerCycleHealth.liveOfferSnapshotAt)}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Provider / League</th>
                <th className="py-2 pr-4">Cycle Snapshot</th>
                <th className="py-2 pr-4">Stage</th>
                <th className="py-2 pr-4">Freshness</th>
                <th className="py-2 pr-4">Proof</th>
                <th className="py-2 pr-4">Counts</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {providerCycleHealth.rows.length === 0 ? (
                <tr>
                  <td className="py-3 text-xs text-gray-500" colSpan={7}>
                    No provider cycle staging rows are visible yet.
                  </td>
                </tr>
              ) : providerCycleHealth.rows.map((row) => (
                <tr key={`${row.providerKey}-${row.league}`} className="border-b border-gray-900 align-top">
                  <td className="py-3 pr-4 text-gray-200">
                    <div>{row.providerKey}</div>
                    <div className="text-xs text-gray-500">{row.league}</div>
                  </td>
                  <td className="py-3 pr-4 text-xs text-gray-400">
                    <div>{formatTimestamp(row.cycleSnapshotAt)}</div>
                    <div>updated {formatTimestamp(row.updatedAt)}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusPill status={providerCycleRowStatus(row)} />
                    <div className="mt-1 text-xs text-gray-500">{row.stageStatus}</div>
                  </td>
                  <td className="py-3 pr-4 text-gray-200">{row.freshnessStatus}</td>
                  <td className="py-3 pr-4 text-gray-200">{row.proofStatus}</td>
                  <td className="py-3 pr-4 text-xs text-gray-400">
                    <div>staged {row.stagedCount}</div>
                    <div>merged {row.mergedCount}</div>
                    <div>dupes {row.duplicateCount}</div>
                  </td>
                  <td className="py-3 text-xs text-gray-500">
                    <div>{row.statusReason}</div>
                    {row.failureCategory && (
                      <div className="mt-1">failure: {row.failureCategory}{row.failureScope ? ` / ${row.failureScope}` : ''}</div>
                    )}
                    {row.lastError && (
                      <div className="mt-1 text-red-300">{row.lastError}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Daily Checklist">
        <StatusTable rows={checklistRows} />
      </Card>

      <Card title="Section 7 Gate Readout">
        <StatusTable rows={section7Rows} />
      </Card>

      <Card title="Section 8 Readiness Notes">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Component</th>
                <th className="py-2 pr-4">Verdict</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {SECTION8_ROWS.map((row) => (
                <tr key={row.component} className="border-b border-gray-900">
                  <td className="py-3 pr-4 text-gray-200">{row.component}</td>
                  <td className="py-3 pr-4"><span className="font-semibold text-gray-100">{row.verdict}</span></td>
                  <td className="py-3 text-xs text-gray-500">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Incident Pointer">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 text-sm">
            <div>Snapshot incidents: <span className="font-bold text-gray-100">{incidents.length}</span></div>
            <div>Failed delivery queue: <span className="font-bold text-gray-100">{asNumber(queueCounts['failedDelivery'])}</span></div>
            <div>Dead-letter queue: <span className="font-bold text-gray-100">{asNumber(queueCounts['deadLetter'])}</span></div>
            <div>Pending manual review: <span className="font-bold text-gray-100">{asNumber(queueCounts['pendingManualReview'])}</span></div>
            <div>Stale validated picks: <span className="font-bold text-gray-100">{asNumber(queueCounts['staleValidated'])}</span></div>
            <div>Missing book aliases: <span className="font-bold text-gray-100">{asNumber(queueCounts['missingBookAliases'])}</span></div>
            <div>Missing market aliases: <span className="font-bold text-gray-100">{asNumber(queueCounts['missingMarketAliases'])}</span></div>
          </div>
          <div className="space-y-2 text-xs text-gray-500">
            <p>The burn-in incident log still lives outside the app in <code>out/controlled-validation/incidents.md</code>.</p>
            <p>Market and book review visibility is now derived from live provider offers missing canonical alias coverage.</p>
            <p>Canonical entity alias review remains partially blocked by current schema truth: unresolved entity aliases are not yet representable because <code>provider_entity_aliases</code> still requires a canonical target.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
