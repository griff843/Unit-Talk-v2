'use client';

import { useEffect, useMemo, useState } from 'react';
import { LiveEventFeed, PipelineFlow, StatCard } from '@/components/ui';
import type { DashboardData, DashboardRuntimeData, LifecycleSignal, OperationalException, PickRow } from '@/lib/types';

type OverviewDashboardClientProps = {
  data: DashboardData;
  runtime: DashboardRuntimeData;
};

type FeedRow = {
  id: string;
  tier: 'S' | 'A' | 'B' | 'C' | 'D';
  player: string;
  market: string;
  submittedAt: string;
  status: string;
};

type AlertEvent = {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  tone: 'info' | 'warning' | 'error';
};

const TIER_CLASSES: Record<FeedRow['tier'], string> = {
  S: 'border-fuchsia-400/40 bg-fuchsia-500/12 text-fuchsia-100',
  A: 'border-sky-400/40 bg-sky-500/12 text-sky-100',
  B: 'border-emerald-400/40 bg-emerald-500/12 text-emerald-100',
  C: 'border-amber-400/40 bg-amber-500/12 text-amber-100',
  D: 'border-rose-400/40 bg-rose-500/12 text-rose-100',
};

const ALERT_TONE_CLASSES = {
  critical: 'border-red-400/30 bg-red-500/10 text-red-100',
  high: 'border-orange-400/30 bg-orange-500/10 text-orange-100',
  medium: 'border-yellow-400/30 bg-yellow-500/10 text-yellow-100',
  low: 'border-blue-400/30 bg-blue-500/10 text-blue-100',
} as const;

function formatDelta(value: number) {
  if (value === 0) return '0 vs yesterday';
  return `${value > 0 ? '+' : ''}${value} vs yesterday`;
}

function formatLagDelta(runtime: DashboardRuntimeData) {
  const lag = runtime.observability.pendingOutboxAgeMaxMinutes;
  if (lag == null || lag === 0) return 'Steady';
  return lag > 15 ? 'Needs attention' : 'Within target';
}

function scoreSignal(signal: LifecycleSignal) {
  if (signal.status === 'BROKEN') return 0;
  if (signal.status === 'DEGRADED') return 1;
  return 2;
}

function apiHealthLabel(signals: LifecycleSignal[]) {
  const min = Math.min(...signals.map(scoreSignal));
  if (min === 0) return { label: 'Down', tone: 'text-red-300' };
  if (min === 1) return { label: 'Degraded', tone: 'text-amber-300' };
  return { label: 'Healthy', tone: 'text-emerald-300' };
}

function pipelineStatus(signal: LifecycleSignal | undefined): 'healthy' | 'idle' | 'error' {
  if (!signal) return 'idle';
  if (signal.status === 'BROKEN') return 'error';
  if (signal.status === 'DEGRADED') return 'idle';
  return 'healthy';
}

function deriveTier(pick: PickRow): FeedRow['tier'] {
  const score = pick.score ?? 0;
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

function readPlayerLabel(pick: PickRow) {
  const selection = pick.pickDetails.selection || 'Unassigned';
  const trimmed = selection.replace(/^player\s+/i, '').trim();
  return trimmed.length > 0 ? trimmed : selection;
}

function relativeTimestamp(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

function alertSeverity(exception: OperationalException) {
  if (exception.severity === 'critical') return 'critical' as const;
  if (exception.category === 'delivery') return 'high' as const;
  if (exception.category === 'settlement') return 'medium' as const;
  return 'low' as const;
}

function deriveAlertEvent(exception: OperationalException): AlertEvent {
  const severity = alertSeverity(exception);
  return {
    id: exception.id,
    title: exception.title,
    detail: exception.detail,
    timestamp: severity.toUpperCase(),
    tone: severity === 'critical' ? 'error' : severity === 'high' ? 'warning' : 'info',
  };
}

function buildFeedRows(picks: PickRow[]): FeedRow[] {
  return picks
    .slice()
    .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
    .slice(0, 10)
    .map((pick) => ({
      id: pick.id,
      tier: deriveTier(pick),
      player: readPlayerLabel(pick),
      market: pick.pickDetails.market,
      submittedAt: pick.submittedAt,
      status: pick.lifecycleStatus,
    }));
}

function buildPipelineStages(data: DashboardData, runtime: DashboardRuntimeData) {
  const signalByName = new Map<LifecycleSignal['signal'], LifecycleSignal>(
    data.signals.map((signal) => [signal.signal, signal]),
  );

  return [
    { name: 'Ingest', count: runtime.providerSummary.active, status: pipelineStatus(signalByName.get('submission')) },
    { name: 'Normalize', count: data.picks.filter((pick) => pick.lifecycleStatus === 'validated').length, status: pipelineStatus(signalByName.get('scoring')) },
    { name: 'Grade', count: runtime.grading.runCount, status: pipelineStatus(signalByName.get('stats_propagation')) },
    { name: 'Promote', count: data.picks.filter((pick) => pick.promotionStatus === 'qualified').length, status: pipelineStatus(signalByName.get('promotion')) },
    { name: 'Publish', count: runtime.outbox.sent + runtime.receipts.sent, status: pipelineStatus(signalByName.get('discord_delivery')) },
  ];
}

function PicksTicker({ picks }: { picks: FeedRow[] }) {
  const [paused, setPaused] = useState(false);
  const tickerRows = picks.length > 0 ? [...picks, ...picks] : picks;

  return (
    <section className="cc-surface overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--cc-border-subtle)] px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--cc-text-muted)]">Live Picks Feed</h2>
          <p className="mt-1 text-sm text-[var(--cc-text-secondary)]">Most recent 10 picks with tier-badged rows.</p>
        </div>
        <button
          type="button"
          onClick={() => setPaused((current) => !current)}
          className="rounded-full border border-[var(--cc-border-strong)] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-[var(--cc-text-secondary)] transition-colors hover:bg-white/[0.08] hover:text-[var(--cc-text-primary)]"
        >
          {paused ? 'Resume scroll' : 'Pause scroll'}
        </button>
      </header>
      {picks.length === 0 ? (
        <div className="px-5 py-8 text-sm text-[var(--cc-text-secondary)]">No picks available for the live feed.</div>
      ) : (
        <div className="relative h-[392px] overflow-hidden">
          <div className={`flex flex-col gap-3 p-4 ${paused ? '' : 'animate-[cc-feed-scroll_28s_linear_infinite]'}`}>
            {tickerRows.map((pick, index) => (
              <article
                key={`${pick.id}-${index}`}
                className="rounded-[22px] border border-[var(--cc-border-subtle)] bg-[color-mix(in_srgb,var(--cc-bg-surface-elevated)_88%,transparent)] px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${TIER_CLASSES[pick.tier]}`}>
                        {pick.tier}
                      </span>
                      <span className="truncate text-sm font-semibold text-[var(--cc-text-primary)]">{pick.player}</span>
                    </div>
                    <p className="mt-2 truncate text-sm text-[var(--cc-text-secondary)]">{pick.market}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">{pick.status}</p>
                    <p className="mt-2 text-xs text-[var(--cc-text-secondary)]">{relativeTimestamp(pick.submittedAt)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AlertLog({ events }: { events: AlertEvent[] }) {
  const [unreadIds, setUnreadIds] = useState<string[]>(() => events.map((event) => event.id));
  const visibleEvents = events.filter((event) => unreadIds.includes(event.id));

  return (
    <section className="cc-surface flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--cc-border-subtle)] px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--cc-text-muted)]">Alert Log</h2>
          <p className="mt-1 text-sm text-[var(--cc-text-secondary)]">Chronological operator alerts with severity coloring.</p>
        </div>
        <button
          type="button"
          onClick={() => setUnreadIds([])}
          className="rounded-full border border-[var(--cc-border-strong)] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-[var(--cc-text-secondary)] transition-colors hover:bg-white/[0.08] hover:text-[var(--cc-text-primary)]"
        >
          Mark all read
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {visibleEvents.length === 0 ? (
          <div className="rounded-[22px] border border-[var(--cc-border-subtle)] bg-white/[0.03] px-4 py-5 text-sm text-[var(--cc-text-secondary)]">
            No unread alerts.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleEvents.map((event) => {
              const severity = event.tone === 'error' ? 'critical' : event.tone === 'warning' ? 'high' : 'low';
              return (
                <article key={event.id} className={`rounded-[22px] border px-4 py-4 ${ALERT_TONE_CLASSES[severity]}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{event.title}</p>
                      <p className="mt-1 text-sm opacity-90">{event.detail}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
                      {severity}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function OverviewDashboardClient({ data, runtime }: OverviewDashboardClientProps) {
  const [feedPaused, setFeedPaused] = useState(false);
  const apiHealth = useMemo(() => apiHealthLabel(data.signals), [data.signals]);
  const yesterdayPicks = Math.max(0, data.stats.total - data.picks.length);
  const todayPickDelta = data.picks.length - yesterdayPicks;
  const activeAgentsHealthy = runtime.worker.drainState === 'running' || runtime.worker.drainState === 'idle';
  const pipelineStages = useMemo(() => buildPipelineStages(data, runtime), [data, runtime]);
  const feedRows = useMemo(() => buildFeedRows(data.picks), [data.picks]);
  const alertEvents = useMemo(
    () =>
      data.exceptions.length > 0
        ? data.exceptions.map(deriveAlertEvent)
        : [
            {
              id: 'health-ok',
              title: 'No active exceptions',
              detail: 'Runtime health is stable across the current operator-visible flow.',
              timestamp: 'LOW',
              tone: 'info' as const,
            },
          ],
    [data.exceptions],
  );
  const eventFeed = useMemo(
    () =>
      feedRows.map((pick) => ({
        id: pick.id,
        title: `${pick.tier} tier ${pick.player}`,
        detail: `${pick.market} • ${pick.status}`,
        timestamp: relativeTimestamp(pick.submittedAt),
        tone: pick.tier === 'D' ? 'warning' as const : 'success' as const,
      })),
    [feedRows],
  );

  useEffect(() => {
    if (!feedPaused) return;
    const timer = window.setTimeout(() => setFeedPaused(false), 12000);
    return () => window.clearTimeout(timer);
  }, [feedPaused]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <StatCard label="Today's Picks" value={data.picks.length} delta={formatDelta(todayPickDelta)} liveUpdate />
        <article className="cc-surface p-5">
          <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--cc-text-muted)]">Active Agents</p>
          <div className="mt-4 flex items-end gap-3">
            <span className="text-4xl font-semibold tracking-[-0.05em] text-[var(--cc-text-primary)]">4</span>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${activeAgentsHealthy ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/20 bg-amber-500/10 text-amber-200'}`}>
              {activeAgentsHealthy ? '4/4 healthy' : '3/4 healthy'}
            </span>
          </div>
        </article>
        <StatCard
          label="Pipeline Lag Avg"
          value={runtime.observability.pendingOutboxAgeMaxMinutes ?? 0}
          delta={formatLagDelta(runtime)}
          unit="m"
          liveUpdate
        />
        <article className="cc-surface p-5">
          <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--cc-text-muted)]">API Health</p>
          <div className="mt-4 flex items-end gap-3">
            <span className={`text-4xl font-semibold tracking-[-0.05em] ${apiHealth.tone}`}>{apiHealth.label}</span>
            <span className="text-xs text-[var(--cc-text-secondary)]">{data.signals.filter((signal) => signal.status !== 'WORKING').length} degraded signals</span>
          </div>
        </article>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--cc-text-muted)]">Pipeline Status</h2>
          <p className="mt-1 text-sm text-[var(--cc-text-secondary)]">Ingest through publish flow, colored by live signal state.</p>
        </div>
        <PipelineFlow stages={pipelineStages} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <PicksTicker picks={feedRows} />
          <LiveEventFeed events={eventFeed} paused={feedPaused} onTogglePause={() => setFeedPaused((current) => !current)} />
        </div>
        <AlertLog events={alertEvents} />
      </div>
    </div>
  );
}
