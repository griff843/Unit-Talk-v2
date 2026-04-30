'use client';

import React from 'react';
import { Sparkline } from './Sparkline';

export interface ProviderHealthCardProps {
  provider: string;
  status: 'healthy' | 'degraded' | 'down';
  responseMs: number | null;
  quotaPct: number;
  callsToday: number;
  lastCheckedAt: string | null;
  sparkline?: number[];
}

export function resolveQuotaTone(quotaPct: number) {
  if (quotaPct > 90) return 'bg-rose-400';
  if (quotaPct >= 70) return 'bg-amber-400';
  return 'bg-emerald-400';
}

function resolveStatusTone(status: ProviderHealthCardProps['status']) {
  if (status === 'down') return 'bg-rose-400';
  if (status === 'degraded') return 'bg-amber-400';
  return 'bg-emerald-400';
}

function formatCheckedAt(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'No recent check';
}

export function ProviderHealthCard({
  provider,
  status,
  responseMs,
  quotaPct,
  callsToday,
  lastCheckedAt,
  sparkline = [],
}: ProviderHealthCardProps) {
  return (
    <article className="cc-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--cc-text-muted)]">Provider</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--cc-text-primary)]">{provider}</h3>
        </div>
        <span className="relative inline-flex h-3 w-3">
          <span className={`absolute inset-0 rounded-full ${resolveStatusTone(status)}`} />
          <span className={`absolute inset-0 rounded-full ${resolveStatusTone(status)} animate-ping opacity-75`} />
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--cc-text-muted)]">Status</p>
          <p className="mt-1 text-sm capitalize text-[var(--cc-text-secondary)]">{status}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--cc-text-muted)]">Response</p>
          <p className="mt-1 text-sm text-[var(--cc-text-secondary)]">{responseMs == null ? 'Unavailable' : `${responseMs}ms`}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--cc-text-muted)]">Calls Today</p>
          <p className="mt-1 text-sm text-[var(--cc-text-secondary)]">{callsToday.toLocaleString()}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--cc-text-muted)]">24h Response Trend</div>
          <div className="text-[11px] text-[var(--cc-text-muted)]">{formatCheckedAt(lastCheckedAt)}</div>
        </div>
        <Sparkline points={sparkline} label={`${provider} response time trend`} />
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-[var(--cc-text-muted)]">
          <span>Quota Usage</span>
          <span>{quotaPct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className={`h-full rounded-full transition-[width] duration-[250ms] ${resolveQuotaTone(quotaPct)}`} style={{ width: `${Math.min(100, Math.max(0, quotaPct))}%` }} />
        </div>
      </div>
    </article>
  );
}
