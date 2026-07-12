import Link from 'next/link';
import { StatCard, SeverityBadge, Table, TableHead, TableBody, Th, Td, DegradedState } from '@/components/ui';
import { getExceptionQueues } from '@/lib/data/picks';
import { getProviderCycleHealth } from '@/lib/data/provider-cycle-health';
import { getPipelineHealthSnapshot } from '@/lib/data/pipeline-health';
import { fetchRuntimeHealth } from '@/lib/server-api';

export const metadata = { title: 'Fire Board — Unit Talk Command Center' };
import { describeThrown } from '@/lib/describe-error';
import {
  buildFireBoard,
  countBySeverity,
  formatRelativeAge,
  type FireBoardExceptionCounts,
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

async function loadFireBoardInputs(): Promise<{ inputs: FireBoardInputs; loadErrors: string[] }> {
  const nowMs = Date.now();
  const loadErrors: string[] = [];

  const [exceptionsSettled, providerSettled, pipelineSettled, runtimeSettled] = await Promise.allSettled([
    getExceptionQueues(),
    getProviderCycleHealth(),
    getPipelineHealthSnapshot(),
    fetchRuntimeHealth(),
  ]);

  let exceptions: FireBoardExceptionCounts | null = null;
  if (exceptionsSettled.status === 'fulfilled') {
    const data = exceptionsSettled.value.data as { counts: FireBoardExceptionCounts & Record<string, number> };
    exceptions = data.counts;
  } else {
    loadErrors.push(`exception queues: ${String(exceptionsSettled.reason)}`);
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
    loadErrors.push(`provider cycle health: ${String(providerSettled.reason)}`);
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
    loadErrors.push(`pipeline health: ${String(pipelineSettled.reason)}`);
  }

  const runtime = runtimeSettled.status === 'fulfilled' ? runtimeSettled.value : null;

  return {
    inputs: {
      exceptions,
      providerCycle,
      pipeline,
      runtime: runtime ? { apiStatus: runtime.apiStatus, warnings: runtime.warnings } : null,
      runtimeUnavailable: runtimeSettled.status === 'rejected',
      nowMs,
    },
    loadErrors,
  };
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

export default async function FireBoardPage() {
  let inputs: FireBoardInputs | null = null;
  let loadErrors: string[] = [];
  let fatalError: string | null = null;

  try {
    const loaded = await loadFireBoardInputs();
    inputs = loaded.inputs;
    loadErrors = loaded.loadErrors;
  } catch (error) {
    fatalError = describeThrown(error);
  }

  const observedAt = new Date().toISOString();

  if (fatalError || !inputs) {
    return (
      <div className="flex flex-col gap-6">
        <div className="cc-surface p-5 border border-red-500/30">
          <div className="flex items-center gap-2">
            <SeverityBadge severity="critical" label="Load Failed" />
            <span className="text-sm text-gray-200">Fire board data could not be loaded.</span>
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
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Critical" value={counts.critical} />
        <StatCard label="Warning" value={counts.warning} />
        <StatCard label="Needs PM" value={counts['needs-pm']} />
        <StatCard label="Info" value={counts.info} />
      </div>

      {loadErrors.length > 0 ? (
        <DegradedState
          severity="warning"
          title="Partial data"
          causes={loadErrors}
          action={{ label: 'System Health', href: '/api-health' }}
        />
      ) : null}

      {items.length === 0 ? (
        <div className="cc-surface p-5">
          <div className="flex items-center gap-2">
            <SeverityBadge severity="healthy" label="All Clear" />
            <span className="text-sm text-gray-200">No active fires across outbox, pipeline, providers, or runtime.</span>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
}
