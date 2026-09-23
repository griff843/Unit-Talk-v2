import Link from '@/components/OperatorLink';
import { StatCard, SeverityBadge, Table, TableHead, TableBody, Th, Td, DegradedState } from '@/components/ui';
import { getExceptionQueues, getNonGovernedDeliveryRows, type DeliveryOutboxRow, type ExceptionQueues, type NonGovernedDeliveryRows } from '@/lib/data/picks';
import { getProviderCycleHealth } from '@/lib/data/provider-cycle-health';
import { getPipelineHealthSnapshot } from '@/lib/data/pipeline-health';
import { getRuntimeHealth } from '@/lib/data/runtime-truth';

export const metadata = { title: 'Exceptions — Unit Talk Command Center' };
import { describeOperatorFailure } from '@/lib/describe-error';
import {
  buildFireBoard,
  countBySeverity,
  formatRelativeAge,
  type FireBoardItem,
  type FireBoardInputs,
  type FireBoardSeverity,
} from '@/lib/fire-board-model';

export const dynamic = 'force-dynamic';

const SEVERITY_SECTIONS: Array<{ severity: FireBoardSeverity; heading: string }> = [
  { severity: 'critical', heading: 'Critical — act now' },
  { severity: 'warning', heading: 'Warning — degraded' },
  { severity: 'needs-pm', heading: 'Needs PM decision' },
  { severity: 'info', heading: 'Info — watch' },
];

async function loadFireBoardInputs(showNonGoverned: boolean): Promise<{
  inputs: FireBoardInputs;
  loadErrors: string[];
  governedDelivery: { live: number; historicalDeadLetters: number } | null;
  nonGovernedDelivery: NonGovernedDeliveryRows | null;
}> {
  const nowMs = Date.now();
  const loadErrors: string[] = [];

  const [exceptionsSettled, providerSettled, pipelineSettled, runtimeSettled, nonGovernedSettled] = await Promise.allSettled([
    getExceptionQueues(),
    getProviderCycleHealth(),
    getPipelineHealthSnapshot(),
    getRuntimeHealth(),
    showNonGoverned ? getNonGovernedDeliveryRows() : Promise.resolve(null),
  ]);

  let exceptionQueues: ExceptionQueues | null = null;
  if (exceptionsSettled.status === 'fulfilled') {
    exceptionQueues = exceptionsSettled.value.data;
  } else {
    loadErrors.push(`exception queues: ${describeOperatorFailure(exceptionsSettled.reason)}`);
  }

  let providerCycle: FireBoardInputs['providerCycle'] = null;
  if (providerSettled.status === 'fulfilled') {
    const summary = providerSettled.value;
    providerCycle = {
      overallStatus: summary.overallStatus,
      trackedLanes: summary.trackedLanes,
      failedLanes: summary.failedLanes,
      staleLanes: summary.staleLanes,
      blockedLanes: summary.blockedLanes,
      proofRequiredLanes: summary.proofRequiredLanes,
      latestUpdatedAt: summary.latestUpdatedAt,
    };
  } else {
    loadErrors.push(`provider cycle health: ${describeOperatorFailure(providerSettled.reason)}`);
  }

  let pipeline: FireBoardInputs['pipeline'] = null;
  if (pipelineSettled.status === 'fulfilled') {
    const snapshot = pipelineSettled.value;
    pipeline = {
      overallStatus: String(snapshot.overallStatus),
      itemsInFlight: snapshot.itemsInFlight,
      errorCount: snapshot.errorCount,
      observedAt: snapshot.observedAt,
    };
  } else {
    loadErrors.push(`pipeline health: ${describeOperatorFailure(pipelineSettled.reason)}`);
  }

  const runtime = runtimeSettled.status === 'fulfilled' ? runtimeSettled.value : null;
  const nonGovernedDelivery = nonGovernedSettled.status === 'fulfilled' ? nonGovernedSettled.value : null;
  if (showNonGoverned && nonGovernedSettled.status === 'rejected') {
    loadErrors.push(`non-governed delivery rows: ${describeOperatorFailure(nonGovernedSettled.reason)}`);
  }

  return {
    inputs: {
      exceptions: exceptionQueues?.counts ?? null,
      providerCycle,
      pipeline,
      runtime: runtime ? { apiStatus: runtime.apiStatus, warnings: runtime.warnings } : null,
      runtimeUnavailable: runtimeSettled.status === 'rejected',
      nowMs,
    },
    loadErrors,
    governedDelivery: exceptionQueues ? {
      live: exceptionQueues.counts.failedDelivery + exceptionQueues.counts.deadLetter,
      historicalDeadLetters: exceptionQueues.counts.historicalDeadLetter,
    } : null,
    nonGovernedDelivery,
  };
}

function DeliveryRowsTable({ rows }: { rows: DeliveryOutboxRow[] }) {
  return (
    <Table>
      <TableHead>
        <Th>Target</Th>
        <Th>Status</Th>
        <Th>Attempts</Th>
        <Th>Last updated</Th>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-gray-800/60">
            <Td>{row.target}</Td>
            <Td>{row.status}</Td>
            <Td>{String(row.attempt_count ?? '—')}</Td>
            <Td>{row.updated_at}</Td>
          </tr>
        ))}
      </TableBody>
    </Table>
  );
}

function FireBoardTable({ items, nowMs }: { items: FireBoardItem[]; nowMs: number }) {
  return (
    <Table>
      <TableHead>
        <Th>Severity</Th>
        <Th>System</Th>
        <Th>Problem</Th>
        <Th>Impact</Th>
        <Th>Age</Th>
        <Th>Next action</Th>
      </TableHead>
      <TableBody>
        {items.map((item) => (
          <tr key={`${item.system}:${item.title}`} className="border-b border-gray-800/60">
            <Td><SeverityBadge severity={item.severity} /></Td>
            <Td>{item.system}</Td>
            <Td>
              <div className="font-semibold text-gray-100">{item.title}</div>
              <div className="mt-0.5 cc-text-muted text-xs">{item.detail}</div>
            </Td>
            <Td>{item.impact}</Td>
            <Td>
              <span title={item.lastSeen ?? undefined}>{formatRelativeAge(item.lastSeen, nowMs) ?? '—'}</span>
            </Td>
            <Td>
              {item.href ? (
                <Link href={item.href} className="text-blue-400 hover:underline">
                  {item.nextAction}
                </Link>
              ) : (
                item.nextAction
              )}
            </Td>
          </tr>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function ExceptionsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const showNonGoverned = searchParams?.['deliveryPopulation'] === 'non-governed';
  let inputs: FireBoardInputs | null = null;
  let loadErrors: string[] = [];
  let fatalError: string | null = null;
  let governedDelivery: { live: number; historicalDeadLetters: number } | null = null;
  let nonGovernedDelivery: NonGovernedDeliveryRows | null = null;

  try {
    const loaded = await loadFireBoardInputs(showNonGoverned);
    inputs = loaded.inputs;
    loadErrors = loaded.loadErrors;
    governedDelivery = loaded.governedDelivery;
    nonGovernedDelivery = loaded.nonGovernedDelivery;
  } catch (error) {
    fatalError = describeOperatorFailure(error, 'Exception sources could not be loaded.');
  }

  const observedAt = new Date().toISOString();

  if (fatalError || !inputs) {
    return (
      <div className="flex flex-col gap-6">
        <div className="cc-surface p-5 border border-red-500/30">
          <div className="flex items-center gap-2">
            <SeverityBadge severity="critical" label="Load Failed" />
            <span className="text-sm text-gray-200">Exception data could not be loaded.</span>
          </div>
          <p className="mt-2 text-xs cc-text-muted font-mono">{fatalError}</p>
        </div>
      </div>
    );
  }

  const items = buildFireBoard(inputs);
  const counts = countBySeverity(items);

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <p className="text-sm cc-text-muted">
          What is broken and what matters most, ranked by severity. Observed {observedAt}.
        </p>
        <p className="text-xs cc-text-muted">
          Delivery exceptions use governed targets only. Non-governed delivery traffic is diagnostic data, not an operational exception.
        </p>
      </div>

      <div className="cc-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">Governed delivery exceptions</h2>
            {governedDelivery?.live === 0 ? (
              <p className="mt-1 text-sm text-gray-300">
                No live governed delivery exceptions. This is an empty queue, not an unavailable query.
              </p>
            ) : (
              <p className="mt-1 text-sm text-gray-300">
                {governedDelivery?.live} live governed delivery exception{governedDelivery?.live === 1 ? '' : 's'}.
              </p>
            )}
            {governedDelivery && governedDelivery.historicalDeadLetters > 0 ? (
              <p className="mt-1 text-xs cc-text-muted">
                {governedDelivery.historicalDeadLetters} governed dead letter{governedDelivery.historicalDeadLetters === 1 ? '' : 's'} older than 24 hours are historical delivery records, not live incidents.
              </p>
            ) : null}
          </div>
          <Link
            href={showNonGoverned ? '/exceptions' : '/exceptions?deliveryPopulation=non-governed'}
            className="text-sm text-blue-400 hover:underline"
          >
            {showNonGoverned ? 'Hide non-governed delivery rows' : 'Show non-governed delivery rows'}
          </Link>
        </div>
      </div>

      {showNonGoverned && nonGovernedDelivery ? (
        <div className="cc-surface p-5">
          <h2 className="text-sm font-semibold text-gray-100">Non-governed delivery rows — diagnostic only</h2>
          <p className="mt-1 text-sm text-gray-300">
            {nonGovernedDelivery.total} rows are outside the governed delivery registry and are not operational exceptions.
          </p>
          <p className="mt-1 text-xs cc-text-muted">
            {Object.entries(nonGovernedDelivery.statusCounts).map(([status, count]) => `${status}: ${count}`).join(' · ')}. Showing the 50 most recently updated rows.
          </p>
          <div className="mt-4 overflow-x-auto">
            <DeliveryRowsTable rows={nonGovernedDelivery.rows} />
          </div>
        </div>
      ) : null}

      {loadErrors.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Critical" value={counts.critical} />
          <StatCard label="Warning" value={counts.warning} />
          <StatCard label="Needs PM" value={counts['needs-pm']} />
          <StatCard label="Info" value={counts.info} />
        </div>
      ) : null}

      {loadErrors.length > 0 ? (
        <DegradedState
          severity="warning"
          title="Partial data"
          causes={loadErrors}
          action={{ label: 'System Health', href: '/api-health' }}
        />
      ) : null}

      {items.length === 0 && loadErrors.length === 0 ? (
        <div className="cc-surface p-5">
          <div className="flex items-center gap-2">
            <SeverityBadge severity="healthy" label="All Clear" />
            <span className="text-sm text-gray-200">No active fires across outbox, pipeline, providers, or runtime.</span>
          </div>
        </div>
      ) : items.length > 0 ? (
        SEVERITY_SECTIONS.map(({ severity, heading }) => {
          const sectionItems = items.filter((item) => item.severity === severity);
          if (sectionItems.length === 0) return null;
          return (
            <div key={severity} className="cc-surface p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide cc-text-secondary">
                {heading} ({sectionItems.length})
              </h2>
              <div className="overflow-x-auto">
                <FireBoardTable items={sectionItems} nowMs={inputs.nowMs} />
              </div>
            </div>
          );
        })
      ) : (
        <div className="cc-surface p-5 text-sm text-gray-300">
          No exceptions were found in the available sources. Unavailable sources prevent an all-clear determination.
        </div>
      )}
    </div>
  );
}
