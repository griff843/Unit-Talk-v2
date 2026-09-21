import Link from '@/components/OperatorLink';
import { Suspense } from 'react';
import { StatCard, DegradedState } from '@/components/ui';
import { resolveActorOrRefusal } from '@/lib/require-actor';
import { Card } from '@/components/ui/Card';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { getOperationsMetrics, getOperationsActivity } from '@/lib/data/operations-home';
import { getOutboxSummary } from '@/lib/data/outbox';
import { getRuntimeHealth } from '@/lib/data/runtime-truth';

export const metadata = { title: 'Operations Overview — Unit Talk Command Center' };

function SectionLoading({ label }: { label: string }) {
  return <div role="status" className="cc-surface p-5 text-sm cc-text-muted">Loading {label}…</div>;
}
function SectionUnavailable({ label, href }: { label: string; href: string }) {
  return <div role="status" className="cc-surface p-5 text-sm">
    <p>{label} could not be verified. Refresh to retry.</p>
    <Link href={href} className="mt-2 inline-block text-blue-300 underline">Open {label.toLowerCase()}</Link>
  </div>;
}

async function OperatorMetrics() {
  try {
    const data = await getOperationsMetrics();
    return <section aria-label="Operator counts" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Governed picks" value={data.total} />
        <StatCard label="Submitted today · UTC" value={data.submittedToday} />
        <StatCard label="Settlement review" value={data.manualReview} />
        <StatCard label="Delivered · awaiting settlement" value={data.awaitingSettlement} />
        <StatCard label="Posted over 24h · no result" value={data.agedPosted} />
      </div>
      <p className="text-xs cc-text-muted">Exact counts of operator-governed picks; proof fixtures excluded. The age check uses posting time. Observed {data.observedAt}.</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/picks" className="text-blue-300 underline">Find a pick</Link>
        <Link href="/settlement" className="text-blue-300 underline">Open settlement work</Link>
        <Link href="/exceptions" className="text-blue-300 underline">Inspect exceptions</Link>
        <Link href="/performance" className="text-blue-300 underline">View performance record</Link>
      </div>
    </section>;
  } catch (error) {
    console.error('Operations counts unavailable', error);
    return <SectionUnavailable label="Operator counts" href="/picks" />;
  }
}

async function DeliverySummary() {
  try {
    const data = await getOutboxSummary();
    return <Card title="Delivery queue">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Pending" value={data.counts.pending} />
        <StatCard label="Processing" value={data.counts.processing} />
        <StatCard label="Failed" value={data.counts.failed} />
        <StatCard label="Dead letter" value={data.counts.dead_letter} />
        <StatCard label="Marked sent" value={data.counts.sent} />
      </div>
      <p className="mt-3 break-words text-xs cc-text-muted">{data.oldestUnsentCreatedAt ? `Oldest unsent record: ${data.oldestUnsentCreatedAt}.` : 'No unsent operator delivery records.'} Counts describe persisted outbox states.</p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <Link href="/operations/outbox" className="text-blue-300 underline">Inspect delivery attempts</Link>
        <Link href="/operations/discord" className="text-blue-300 underline">Receipts and delivery controls</Link>
      </div>
    </Card>;
  } catch (error) {
    console.error('Operations delivery summary unavailable', error);
    return <SectionUnavailable label="Delivery queue" href="/operations/outbox" />;
  }
}

async function RuntimeSummary() {
  try {
    const health = await getRuntimeHealth();
    return <Card title="Runtime API health">
      <p className="text-lg font-semibold capitalize">{health.apiStatus}</p>
      <p className="mt-1 text-xs cc-text-muted">Source: runtime API health endpoint. Observed {new Date().toISOString()}.</p>
      {health.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{health.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      <Link href="/api-health" className="mt-3 inline-block text-sm text-blue-300 underline">Inspect component health and freshness</Link>
    </Card>;
  } catch (error) {
    console.error('Runtime API health unavailable', error);
    return <Card title="Runtime API health">
      <p className="text-sm">Unknown — the configured runtime health endpoint could not be verified.</p>
      <Link href="/api-health" className="mt-3 inline-block text-sm text-blue-300 underline">Inspect component health and freshness</Link>
    </Card>;
  }
}

async function RecentActivity() {
  try {
    const activity = await getOperationsActivity();
    return <Card title="Recent lifecycle activity">
      {activity.length === 0 ? <p className="text-sm cc-text-muted">No lifecycle activity has been recorded for operator picks.</p> :
        <ol className="divide-y divide-gray-800">{activity.map((row) => <li key={row.id} className="space-y-1 py-3 text-sm">
          <Link href={`/picks/${row.pick_id}`} className="break-words font-medium text-blue-300 underline">{row.pick.selection ?? row.pick_id}</Link>
          <p>{row.from_state ?? 'Created'} → {row.to_state}</p>
          <p className="break-words text-xs cc-text-muted">{row.reason ?? 'No reason recorded'} · Writer: {row.writer_role} · {row.created_at}</p>
        </li>)}</ol>}
      <p className="mt-3 text-xs cc-text-muted">Latest 10 persisted transitions. Open a pick for its complete settlement, delivery, and audit history.</p>
    </Card>;
  } catch (error) {
    console.error('Operator lifecycle activity unavailable', error);
    return <SectionUnavailable label="Lifecycle activity" href="/picks" />;
  }
}

export default async function DashboardPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await resolveActorOrRefusal();
  if (!actor.ok) return <DegradedState severity="critical" title="Overview truth unavailable" causes={['Sign in to read operator data.']} />;
  const params = await searchParams;
  const refresh = Number(params?.refresh);
  const intervalMs = Number.isFinite(refresh) && refresh > 0 ? Math.min(Math.max(refresh, 5), 300) * 1000 : 30_000;
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <p className="text-sm cc-text-muted">What needs attention, what is waiting on a result, and the latest recorded operator activity.</p>
      <AutoRefreshStatusBar lastUpdatedAt={new Date().toISOString()} intervalMs={intervalMs} />
    </div>
    <Suspense fallback={<SectionLoading label="operator counts" />}><OperatorMetrics /></Suspense>
    <Suspense fallback={<SectionLoading label="delivery queue" />}><DeliverySummary /></Suspense>
    <Suspense fallback={<SectionLoading label="runtime API health" />}><RuntimeSummary /></Suspense>
    <Suspense fallback={<SectionLoading label="lifecycle activity" />}><RecentActivity /></Suspense>
  </div>;
}
