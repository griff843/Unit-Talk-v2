import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import { Card } from '@/components/ui';
import React, { Suspense } from 'react';
import { resolveActorOrRefusal } from '@/lib/require-actor';
import { SystemProviderTelemetry } from '@/components/SystemProviderTelemetry';
import { getRuntimeTruth } from '@/lib/data/runtime-truth';
import { describeOperatorFailure } from '@/lib/describe-error';
import type { RuntimeTruthReport } from '@unit-talk/observability';

export const metadata = { title: 'System Health — Unit Talk Command Center' };

export default async function ApiHealthPage() {
  if (!(await resolveActorOrRefusal()).ok) return <Card title="System Health unavailable"><p>Command Center authentication is required.</p></Card>;
  const observedAt = new Date().toISOString();
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <p className="text-sm text-gray-500">Recorded provider observations and independently verified runtime status.</p>
      <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={30_000} className="lg:min-w-[360px]" />
    </div>
    <Suspense fallback={<Card title="Provider telemetry"><p>Loading provider observations…</p></Card>}><SystemProviderTelemetry /></Suspense>
    <Suspense fallback={<Card title="Runtime Truth"><p>Loading runtime status…</p></Card>}><RuntimeTruthSection /></Suspense>
  </div>;
}

async function RuntimeTruthSection() {
  try { return <RuntimeTruthPanel runtimeTruth={await getRuntimeTruth()} error={null} />; }
  catch (error) { return <RuntimeTruthPanel runtimeTruth={null} error={describeOperatorFailure(error)} />; }
}

function RuntimeTruthPanel({
  runtimeTruth,
  error,
}: {
  runtimeTruth: RuntimeTruthReport | null;
  error: string | null;
}) {
  if (!runtimeTruth) {
    return (
      <Card title="Runtime Truth">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          Runtime truth unavailable: {error ?? 'unknown error'}
        </div>
      </Card>
    );
  }

  const workTone = runtimeTruth.work.doingRealWork
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-100';

  return (
    <Card title="Runtime Truth">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <RuntimeTruthMetric label="Mode" value={runtimeTruth.runtimeMode} detail={runtimeTruth.persistenceMode} />
        <RuntimeTruthMetric label="Auth" value={runtimeTruth.auth.mode} detail={runtimeTruth.auth.enabled === null ? 'not applicable' : runtimeTruth.auth.enabled ? 'operator API key active' : 'fail-open bypass'} />
        <RuntimeTruthMetric label="Last work" value={formatLastWork(runtimeTruth.work.lastWorkAt)} detail={`observed ${formatLastWork(runtimeTruth.observedAt)}`} />
        <RuntimeTruthMetric label="Targets" value={formatTargets(runtimeTruth.work.workerTargets)} detail={runtimeTruth.work.dryRun ? 'dry-run enabled' : 'live side effects allowed'} />
      </div>
      <div className={`mt-4 rounded-2xl border p-4 text-sm ${workTone}`}>
        <div className="font-semibold">
          {runtimeTruth.work.doingRealWork ? 'Doing real work' : 'Not doing real work'}
        </div>
        <div className="mt-1 text-xs opacity-85">{runtimeTruth.work.reason}</div>
      </div>
    </Card>
  );
}

function RuntimeTruthMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--cc-border-subtle)] bg-white/[0.02] p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-text-muted)]">{label}</div>
      <div className="mt-2 break-words text-sm font-semibold text-[var(--cc-text-primary)]">{value}</div>
      <div className="mt-1 break-words text-xs text-[var(--cc-text-secondary)]">{detail}</div>
    </div>
  );
}

function formatTargets(targets: string[]) {
  return targets.length > 0 ? targets.join(', ') : 'none';
}

function formatLastWork(value: string | null) {
  if (!value) return 'none';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}
