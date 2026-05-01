'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CounterAnimation } from './CounterAnimation';

export interface StatCardProps {
  label: string;
  value: number;
  delta?: number | string;
  unit?: string;
  liveUpdate?: boolean;
}

function formatPrimary(value: number, unit?: string) {
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
  return unit ? `${formatted}${unit}` : formatted;
}

function normalizeDelta(delta: number | string | undefined) {
  if (delta == null) return null;
  if (typeof delta === 'number') {
    const sign = delta > 0 ? '+' : '';
    return {
      text: `${sign}${delta.toFixed(Math.abs(delta) >= 10 ? 0 : 1)}%`,
      tone: delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral',
    } as const;
  }

  const tone = delta.startsWith('+') ? 'positive' : delta.startsWith('-') ? 'negative' : 'neutral';
  return { text: delta, tone } as const;
}

export function StatCard({ label, value, delta, unit, liveUpdate = false }: StatCardProps) {
  const [showDelta, setShowDelta] = useState(false);
  const [glowing, setGlowing] = useState(false);
  const deltaMeta = useMemo(() => normalizeDelta(delta), [delta]);

  useEffect(() => {
    setShowDelta(false);
    const timeout = window.setTimeout(() => setShowDelta(true), 280);
    return () => window.clearTimeout(timeout);
  }, [value]);

  useEffect(() => {
    if (!liveUpdate) return;
    setGlowing(true);
    const timeout = window.setTimeout(() => setGlowing(false), 520);
    return () => window.clearTimeout(timeout);
  }, [liveUpdate, value]);

  const deltaToneClass =
    deltaMeta?.tone === 'positive'
      ? 'text-emerald-300'
      : deltaMeta?.tone === 'negative'
        ? 'text-rose-300'
        : 'text-[var(--cc-text-secondary)]';

  return (
    <article
      className={`cc-surface relative overflow-hidden p-5 transition-shadow duration-[250ms] ${glowing ? 'shadow-[0_0_0_1px_rgba(167,139,250,0.6),0_0_28px_rgba(124,58,237,0.22)]' : ''}`}
    >
      <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(148,163,184,0.42)] to-transparent" />
      <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--cc-text-muted)]">{label}</p>
      <div className="mt-4 flex items-end gap-3">
        <CounterAnimation
          value={value}
          duration={300}
          format={(nextValue) => formatPrimary(nextValue, unit)}
          className="text-4xl font-semibold tracking-[-0.05em] text-[var(--cc-text-primary)]"
        />
        {deltaMeta ? (
          <span
            className={`inline-flex translate-y-2 items-center rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium transition-all duration-[180ms] ${
              showDelta ? `translate-y-0 opacity-100 ${deltaToneClass}` : 'opacity-0'
            }`}
          >
            {deltaMeta.text}
          </span>
        ) : null}
      </div>
    </article>
  );
}
