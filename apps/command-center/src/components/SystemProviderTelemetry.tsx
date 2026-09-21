import React from 'react';
import { ProviderHealthCard, Card } from './ui';
import { getSystemProviderTelemetry } from '@/lib/data/provider-telemetry';

export async function SystemProviderTelemetry() {
  try {
    const telemetry = await getSystemProviderTelemetry();
    return <section aria-label="Provider telemetry" className="space-y-4">
      <p className="text-sm text-gray-400">Offer freshness threshold: {telemetry.staleMinutes} minutes. Request counts cover recorded ingest runs started in the last 24 hours; they are not offer counts or billing totals.</p>
      {telemetry.problems.length ? <div role="status" className="rounded-xl border border-amber-500/30 p-4 text-sm text-amber-200">{telemetry.problems.join(' ')}</div> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {telemetry.providers.map((row) => <div key={row.provider} className="space-y-2">
          <ProviderHealthCard provider={row.provider === 'sgo' ? 'SGO' : 'Odds API'}
            status={row.freshness === 'fresh' ? 'healthy' : row.freshness === 'stale' ? 'degraded' : 'unknown'}
            statusLabel={row.freshness === 'unknown' ? 'Offer freshness unknown' : `Latest offer ${row.freshness}`}
            responseMs={row.meanCycleMs} responseLabel={`Mean cycle duration · N=${row.samples.length}`}
            callsToday={row.quota?.requests ?? null} callsLabel="Requests recorded · 24h"
            quotaPct={row.quota?.quotaPct ?? null} lastCheckedAt={row.latestOfferAt} sparkline={row.samples}
            trendLabel="Latest cycle samples · 24h" />
          <div className="space-y-1 px-2 text-xs text-gray-400">
            <p>Current offers: {row.totalOffers?.toLocaleString('en-US') ?? 'Unavailable'} · created in 24h: {row.createdOffers24h?.toLocaleString('en-US') ?? 'Unavailable'}</p>
            <p>Latest offer observation: {row.latestOfferAt ?? 'Unavailable'}</p>
            <p>Request observations: {row.quota?.recordedRuns ?? 'Unavailable'} runs{row.quota?.uncountedRuns ? `; ${row.quota.uncountedRuns} additional runs lack request counts` : ''}.</p>
            <p>Quota run started: {row.quota?.quotaObservedAt ?? 'Unavailable'} · remaining: {row.quota?.remaining ?? 'Unavailable'} · limit: {row.quota?.limit ?? 'Unavailable'}</p>
          </div>
        </div>)}
      </div>
      <p className="text-xs text-gray-500">Observed {telemetry.observedAt}. Cycle duration includes ingestion processing; it is not an HTTP response-time measurement.</p>
    </section>;
  } catch {
    return <Card title="Provider telemetry"><p className="text-sm text-amber-200">Provider telemetry could not be verified. Runtime status is loaded independently.</p></Card>;
  }
}
