'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AutoRefreshStatusBar } from '@/hooks/useAutoRefresh';
import type { OverviewAlertItem, OverviewDashboardModel, OverviewPipelineStage, OverviewStatCard, OverviewTone } from '@/lib/overview-model';
import Link from 'next/link';

const toneClasses: Record<OverviewTone, string> = {
  healthy: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  warning: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
  critical: 'border-rose-400/30 bg-rose-400/10 text-rose-100',
  neutral: 'border-slate-400/20 bg-slate-400/10 text-slate-100',
};

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatDeltaLabel(trend: OverviewStatCard['trend']) {
  switch (trend) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    default:
      return '→';
  }
}

function useAnimatedNumber(value: number, durationMs = 300) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);

  useEffect(() => {
    const from = previousValueRef.current;
    const to = value;
    previousValueRef.current = value;

    if (from === to) {
      setDisplayValue(to);
      return;
    }

    const start = performance.now();
    let frame = 0;

    const tick = (timestamp: number) => {
      const progress = Math.min((timestamp - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(from + (to - from) * eased));

      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [durationMs, value]);

  return displayValue;
}

function StatValue({ card }: { card: OverviewStatCard }) {
  const animatedPrimary = useAnimatedNumber(card.value);
  const animatedSecondary = useAnimatedNumber(card.secondaryValue ?? 0);

  return (
    <div className="flex items-end gap-2 font-semibold tracking-tight text-white">
      <span className="overview-value-slide text-4xl md:text-5xl">
        {formatCompactNumber(animatedPrimary)}
      </span>
      {card.secondaryValue !== undefined && (
        <span className="mb-1 text-lg text-slate-400">
          / {formatCompactNumber(animatedSecondary)}
        </span>
      )}
      {card.unit && (
        <span className="mb-1 text-sm uppercase tracking-[0.3em] text-slate-500">
          {card.unit}
        </span>
      )}
    </div>
  );
}

function StatCard({ card, index }: { card: OverviewStatCard; index: number }) {
  return (
    <section
      className="overview-section group relative overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.16),transparent_35%),linear-gradient(160deg,rgba(15,23,42,0.96),rgba(2,6,23,0.9))] p-5 shadow-[0_20px_80px_rgba(2,6,23,0.45)]"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="mb-8 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.36em] text-slate-500">{card.label}</p>
          <div className="mt-4">
            <StatValue card={card} />
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${toneClasses[card.tone]}`}>
          {card.secondaryLabel ?? card.label}
        </span>
      </div>
      <div className="overview-delta-reveal flex items-center gap-2 text-sm text-slate-300">
        <span className="text-base">{formatDeltaLabel(card.trend)}</span>
        <span>{card.deltaLabel}</span>
      </div>
    </section>
  );
}

function stageClasses(stage: OverviewPipelineStage) {
  switch (stage.status) {
    case 'healthy':
      return {
        dot: 'bg-emerald-300 shadow-[0_0_0_6px_rgba(52,211,153,0.16)]',
        line: 'bg-emerald-300/60',
        label: 'text-emerald-100',
      };
    case 'warning':
      return {
        dot: 'bg-amber-300 shadow-[0_0_0_6px_rgba(252,211,77,0.16)]',
        line: 'bg-amber-300/50',
        label: 'text-amber-100',
      };
    case 'critical':
      return {
        dot: 'bg-rose-300 shadow-[0_0_0_6px_rgba(251,113,133,0.16)]',
        line: 'bg-rose-300/40',
        label: 'text-rose-100',
      };
    default:
      return {
        dot: 'bg-slate-500 shadow-[0_0_0_6px_rgba(100,116,139,0.12)]',
        line: 'bg-slate-600/60',
        label: 'text-slate-200',
      };
  }
}

function PipelineBand({ stages }: { stages: OverviewPipelineStage[] }) {
  return (
    <section className="overview-section rounded-[32px] border border-white/10 bg-slate-950/80 p-6 shadow-[0_20px_90px_rgba(2,6,23,0.42)]" style={{ animationDelay: '200ms' }}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.36em] text-slate-500">Pipeline Status</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Master health flow</h2>
        </div>
        <p className="max-w-xl text-sm text-slate-400">
          Operator truth only. Every stage reflects current runtime signals, queue state, and exception pressure.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        {stages.map((stage, index) => {
          const tone = stageClasses(stage);
          const nextStage = stages[index + 1];

          return (
            <div key={stage.id} className="relative">
              <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`h-3 w-3 rounded-full ${tone.dot} ${stage.status === 'healthy' ? 'overview-pulse-dot' : ''}`} />
                    <span className={`text-sm font-semibold uppercase tracking-[0.2em] ${tone.label}`}>{stage.label}</span>
                  </div>
                  <span className="text-2xl font-semibold text-white">{formatCompactNumber(stage.count)}</span>
                </div>
                <p className="text-sm text-slate-300">{stage.detail}</p>
                <div className="mt-4 flex gap-2 text-xs text-slate-400">
                  <span>{stage.warningCount} warnings</span>
                  <span>{stage.errorCount} errors</span>
                </div>
              </div>
              {nextStage && (
                <div className="pointer-events-none absolute left-[calc(100%-8px)] top-1/2 hidden h-[2px] w-[calc(100%+16px)] -translate-y-1/2 xl:block">
                  <div
                    className={`h-full w-full ${stage.status === 'critical' ? 'border-t border-dashed border-rose-300/60 bg-transparent' : tone.line} ${stage.status === 'healthy' ? 'overview-connector' : ''}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function badgeClasses(tone: OverviewTone) {
  return toneClasses[tone];
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function PicksFeed({ items }: { items: OverviewDashboardModel['picksFeed'] }) {
  const marqueeItems = useMemo(() => (items.length > 4 ? [...items, ...items] : items), [items]);

  return (
    <section className="overview-section rounded-[32px] border border-white/10 bg-white/[0.03] p-5" style={{ animationDelay: '250ms' }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.36em] text-slate-500">Live Picks Feed</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Recent board flow</h2>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
          Latest 10
        </span>
      </div>
      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/50">
        <div className={items.length > 4 ? 'overview-marquee' : ''}>
          {marqueeItems.map((item, index) => (
            <Link
              key={`${item.id}-${index}`}
              href={`/picks/${item.id}`}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-white/5 px-4 py-4 transition-colors hover:bg-white/[0.04]"
            >
              <span className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${badgeClasses(item.badgeTone)}`}>
                {item.badge}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {item.market} · {item.selection}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {item.sport} · {item.submittedBy} · {item.lifecycleStatus}
                  {item.score !== null ? ` · ${item.score.toFixed(1)}` : ''}
                </p>
              </div>
              <span className="text-xs text-slate-500">{formatTimestamp(item.submittedAt)}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function severityClasses(alert: OverviewAlertItem) {
  switch (alert.severity) {
    case 'critical':
      return 'border-rose-400/20 bg-rose-400/10';
    case 'warning':
      return 'border-amber-300/20 bg-amber-300/10';
    default:
      return 'border-sky-300/20 bg-sky-300/10';
  }
}

function AlertLog({ alerts }: { alerts: OverviewDashboardModel['alerts'] }) {
  const [readIds, setReadIds] = useState<string[]>([]);

  useEffect(() => {
    setReadIds((current) => current.filter((id) => alerts.some((alert) => alert.id === id)));
  }, [alerts]);

  return (
    <section className="overview-section rounded-[32px] border border-white/10 bg-white/[0.03] p-5" style={{ animationDelay: '300ms' }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.36em] text-slate-500">Alert Log</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Runtime exceptions</h2>
        </div>
        <button
          type="button"
          onClick={() => setReadIds(alerts.map((alert) => alert.id))}
          className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/[0.04]"
        >
          Mark all read
        </button>
      </div>
      <div className="space-y-3">
        {alerts.length === 0 ? (
          <div className="rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-5 text-sm text-emerald-100">
            No active alerts. The pipeline is quiet.
          </div>
        ) : alerts.map((alert) => {
          const unread = !readIds.includes(alert.id);

          return (
            <article
              key={alert.id}
              className={`rounded-[24px] border px-4 py-4 ${severityClasses(alert)} ${unread ? 'overview-alert-flash' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-white">{alert.title}</h3>
                  <p className="mt-1 text-sm text-slate-300">{alert.detail}</p>
                </div>
                <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  {alert.severity}
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">{formatTimestamp(alert.at)}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function OverviewDashboardClient({
  model,
  observedAt,
  intervalMs,
}: {
  model: OverviewDashboardModel;
  observedAt: string;
  intervalMs: number;
}) {
  return (
    <div className="relative isolate">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_58%),radial-gradient(circle_at_20%_20%,rgba(244,114,182,0.12),transparent_28%)] blur-3xl" />
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <p className="text-[11px] uppercase tracking-[0.42em] text-sky-300/70">Overview</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Master Health Dashboard
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            One surface for pick intake, score flow, promotion pressure, and publish health. Auto-refresh keeps the board current without introducing write paths.
          </p>
        </div>
        <AutoRefreshStatusBar lastUpdatedAt={observedAt} intervalMs={intervalMs} className="xl:min-w-[360px]" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {model.statCards.map((card, index) => (
          <StatCard key={card.id} card={card} index={index} />
        ))}
      </div>

      <div className="mt-4">
        <PipelineBand stages={model.pipelineStages} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <PicksFeed items={model.picksFeed} />
        </div>
        <div className="xl:col-span-5">
          <AlertLog alerts={model.alerts} />
        </div>
      </div>
    </div>
  );
}
