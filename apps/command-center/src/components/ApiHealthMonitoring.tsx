'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { AutoRefreshStatusBar, DEFAULT_AUTO_REFRESH_INTERVAL_MS } from '@/hooks/useAutoRefresh';
import { Sparkline } from '@/components/ui';
import type { ApiHealthPageData, ApiHealthProviderCard } from '@/lib/data/api-health';

const REFRESH_DEBOUNCE_MS = 1200;

function formatRelativeAge(value: string | null, nowMs: number) {
  if (!value) return 'waiting for first heartbeat';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const deltaSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  if (deltaSeconds < 5) return 'just now';
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  return `${Math.floor(deltaHours / 24)}d ago`;
}

function formatTimestamp(value: string | null) {
  if (!value) return 'No snapshot yet';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function formatResponseMs(value: number | null) {
  return value == null ? 'No samples' : `${Math.round(value)}ms`;
}

function formatQuotaDetail(provider: ApiHealthProviderCard) {
  if (provider.quotaPct == null) {
    return 'Quota telemetry unavailable';
  }
  if (provider.quotaLimit != null) {
    return `${provider.quotaUsed}/${provider.quotaLimit} credits used`;
  }
  if (provider.quotaRemaining != null) {
    return `${provider.quotaUsed} used · ${provider.quotaRemaining} remaining`;
  }
  return `${provider.quotaUsed} credits used`;
}

function statusTone(status: ApiHealthProviderCard['status']) {
  switch (status) {
    case 'healthy':
      return {
        label: 'Healthy',
        dot: 'bg-fuchsia-400 shadow-[0_0_18px_rgba(232,121,249,0.65)]',
        ring: 'border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100',
        panel: 'border-fuchsia-500/25 shadow-[0_0_0_1px_rgba(217,70,239,0.1),0_0_40px_rgba(168,85,247,0.10)]',
        sparkStroke: 'stroke-fuchsia-300',
        sparkFill: 'fill-fuchsia-400/10',
        arcColor: 'rgb(232,121,249)',
      };
    case 'degraded':
      return {
        label: 'Degraded',
        dot: 'bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.55)]',
        ring: 'border-amber-400/40 bg-amber-500/10 text-amber-100',
        panel: 'border-amber-500/25 shadow-[0_0_0_1px_rgba(245,158,11,0.08),0_0_40px_rgba(245,158,11,0.08)]',
        sparkStroke: 'stroke-amber-300',
        sparkFill: 'fill-amber-400/10',
        arcColor: 'rgb(251,191,36)',
      };
    default:
      return {
        label: 'Down',
        dot: 'bg-rose-400 shadow-[0_0_18px_rgba(251,113,133,0.55)]',
        ring: 'border-rose-400/40 bg-rose-500/10 text-rose-100',
        panel: 'border-rose-500/25 shadow-[0_0_0_1px_rgba(244,63,94,0.08),0_0_40px_rgba(244,63,94,0.08)]',
        sparkStroke: 'stroke-rose-300',
        sparkFill: 'fill-rose-400/10',
        arcColor: 'rgb(251,113,133)',
      };
  }
}

function quotaTone(quotaPct: number | null) {
  if (quotaPct == null) return { bar: 'bg-slate-500', text: 'text-slate-300' };
  if (quotaPct >= 90) return { bar: 'bg-rose-400', text: 'text-rose-200' };
  if (quotaPct >= 70) return { bar: 'bg-amber-300', text: 'text-amber-200' };
  return { bar: 'bg-emerald-400', text: 'text-emerald-200' };
}

function RadialQuota({ pct, color }: { pct: number; color: string }) {
  const r = 44;
  const cx = 56;
  const cy = 56;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - Math.min(pct, 100) / 100);

  return (
    <svg viewBox="0 0 112 112" className="h-36 w-36 -rotate-90">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(30,41,59)" strokeWidth="10" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        style={{ transition: 'stroke-dashoffset 0.7s ease' }}
      />
    </svg>
  );
}

function ProviderCard({ provider, nowMs }: { provider: ApiHealthProviderCard; nowMs: number }) {
  const tone = statusTone(provider.status);
  const quota = quotaTone(provider.quotaPct);
  const ringValue = provider.quotaPct ?? 0;
  const sparkPoints = provider.sparkline.map((row) => row.avgResponseMs ?? 0);

  return (
    <article className={`relative overflow-hidden rounded-[28px] border bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-5 ${tone.panel}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.07),transparent_38%)]" />
      <div className="relative flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500">External Provider</div>
            <div>
              <h2 className="font-serif text-2xl text-white">{provider.providerName}</h2>
              <p className="mt-1 text-sm text-slate-400">{provider.statusDetail}</p>
            </div>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] ${tone.ring}`}>
            <span className="relative flex h-2.5 w-2.5 items-center justify-center">
              <span className={`api-health-pulse absolute inline-flex h-full w-full rounded-full ${tone.dot}`} />
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${tone.dot}`} />
            </span>
            {tone.label}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricBlock label="Avg response" value={formatResponseMs(provider.avgResponseMs)} detail="Rolling 24h average" />
          <MetricBlock label="Last checked" value={formatRelativeAge(provider.lastCheckedAt, nowMs)} detail={formatTimestamp(provider.lastCheckedAt)} />
          <MetricBlock label="Today's calls" value={provider.todayCallCount.toLocaleString()} detail={`${provider.last24hRows.toLocaleString()} rows in last 24h`} />
          <MetricBlock label="Latest snapshot" value={formatRelativeAge(provider.latestSnapshotAt, nowMs)} detail={`${provider.totalRows.toLocaleString()} total provider rows`} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_320px]">
          <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">24h Response Trend</div>
                <div className="mt-1 text-sm text-slate-300">Hourly average runtime across ingestor heartbeats</div>
              </div>
            </div>
            <div className="h-40 flex items-end">
              {sparkPoints.length > 0 ? (
                <Sparkline
                  points={sparkPoints}
                  label={`${provider.providerName} 24h response trend`}
                  strokeClassName={tone.sparkStroke}
                  fillClassName={tone.sparkFill}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">No data</div>
              )}
            </div>
          </section>

          <section className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Quota Load</div>
                <div className={`mt-1 text-sm ${quota.text}`}>{provider.quotaPct == null ? 'No cap reported' : `${Math.round(provider.quotaPct)}% used`}</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <RadialQuota pct={ringValue} color={tone.arcColor} />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{formatQuotaDetail(provider)}</div>
                  <div className="mt-1 text-xs text-slate-500">Color shifts from green to yellow to red as capacity tightens.</div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                    <span>Usage bar</span>
                    <span>{provider.quotaPct == null ? 'n/a' : `${Math.round(provider.quotaPct)}%`}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-[width,background-color] duration-700 ${quota.bar}`}
                      style={{ width: `${provider.quotaPct ?? 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

function MetricBlock({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-50">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

export function ApiHealthMonitoring({
  data,
  supabaseUrl,
  supabaseAnonKey,
}: {
  data: ApiHealthPageData;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
}) {
  const router = useRouter();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) {
      return;
    }

    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let refreshTimeout: number | null = null;

    const queueRefresh = () => {
      if (refreshTimeout != null) {
        return;
      }
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        startTransition(() => {
          router.refresh();
        });
      }, REFRESH_DEBOUNCE_MS);
    };

    const channel = client
      .channel('api-health-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_runs' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_offers' }, queueRefresh)
      .subscribe();

    return () => {
      if (refreshTimeout != null) {
        window.clearTimeout(refreshTimeout);
      }
      void client.removeChannel(channel);
    };
  }, [router, startTransition, supabaseAnonKey, supabaseUrl]);

  return (
    <div className="flex flex-col gap-6">
      <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(88,28,135,0.22),rgba(15,23,42,0.96)_38%,rgba(2,6,23,1)_100%)] p-6 shadow-2xl shadow-black/30">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,114,182,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.12),transparent_28%)]" />
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-fuchsia-200/80">Command Center / API Health</div>
            <h1 className="max-w-2xl font-serif text-4xl text-white">External provider pulse, quota load, and ingestion heartbeat in one operator surface.</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-300">
              This shell keeps the existing provider-health data path intact, then layers live refresh, hourly response trends, and quota saturation so operators can spot provider drift before the pipeline goes dark.
            </p>
          </div>
          <AutoRefreshStatusBar
            lastUpdatedAt={data.observedAt}
            intervalMs={DEFAULT_AUTO_REFRESH_INTERVAL_MS}
            className="border-white/10 bg-slate-950/55 xl:min-w-[360px]"
          />
        </div>
        <div className="relative mt-5 flex flex-wrap gap-3 text-xs text-slate-300">
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            {data.providers.length} provider card(s)
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            Supabase realtime {data.realtimeEnabled && supabaseUrl && supabaseAnonKey ? 'enabled' : 'unavailable'}
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            {isPending ? 'Refreshing from live change feed…' : `Observed ${formatRelativeAge(data.observedAt, nowMs)}`}
          </div>
        </div>
      </div>

      <div className="grid gap-5">
        {data.providers.map((provider) => (
          <ProviderCard key={provider.providerKey} provider={provider} nowMs={nowMs} />
        ))}
      </div>
    </div>
  );
}
