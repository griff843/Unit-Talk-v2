'use client';

import { useEffect, useRef, useState, useTransition, createElement } from 'react';
import { useRouter } from 'next/navigation';

export const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;
export const DEFAULT_INTERACTION_PAUSE_MS = 10_000;

export type AutoRefreshPauseReason = 'hidden' | 'interacting' | null;

export interface UseAutoRefreshOptions {
  lastUpdatedAt: string;
  intervalMs?: number;
  interactionPauseMs?: number;
}

export interface AutoRefreshState {
  isRefreshing: boolean;
  isVisible: boolean;
  pauseReason: AutoRefreshPauseReason;
  lastUpdatedLabel: string;
  statusLabel: string;
  nextRefreshInSeconds: number | null;
  refreshNow: () => void;
}

export interface AutoRefreshStatusBarProps {
  lastUpdatedAt: string;
  intervalMs?: number;
  className?: string;
}

function clampIntervalMs(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function parseTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function formatRelativeAge(nowMs: number, updatedAtMs: number) {
  const ageMs = Math.max(0, nowMs - updatedAtMs);
  const ageSeconds = Math.floor(ageMs / 1000);

  if (ageSeconds < 5) {
    return 'just now';
  }

  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`;
  }

  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) {
    return `${ageMinutes}m ago`;
  }

  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) {
    return `${ageHours}h ago`;
  }

  const ageDays = Math.floor(ageHours / 24);
  return `${ageDays}d ago`;
}

function formatCountdown(seconds: number) {
  if (seconds <= 0) {
    return 'now';
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function getStatusToneClass(pauseReason: AutoRefreshPauseReason, isRefreshing: boolean) {
  if (isRefreshing) {
    return 'border-blue-500/40 bg-blue-500/10 text-blue-200';
  }

  if (pauseReason === 'hidden') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }

  if (pauseReason === 'interacting') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }

  return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
}

function getButtonClassName(isRefreshing: boolean) {
  return [
    'rounded border px-3 py-1 text-xs font-medium transition-colors',
    isRefreshing
      ? 'cursor-wait border-blue-500/40 bg-blue-500/10 text-blue-200'
      : 'border-gray-700 bg-gray-800 text-gray-200 hover:border-gray-600 hover:bg-gray-700',
  ].join(' ');
}

export function useAutoRefresh({
  lastUpdatedAt,
  intervalMs = DEFAULT_AUTO_REFRESH_INTERVAL_MS,
  interactionPauseMs = DEFAULT_INTERACTION_PAUSE_MS,
}: UseAutoRefreshOptions): AutoRefreshState {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const normalizedIntervalMs = clampIntervalMs(intervalMs, DEFAULT_AUTO_REFRESH_INTERVAL_MS);
  const normalizedInteractionPauseMs = clampIntervalMs(
    interactionPauseMs,
    DEFAULT_INTERACTION_PAUSE_MS,
  );
  const parsedLastUpdatedAt = parseTimestamp(lastUpdatedAt);
  const [nowMs, setNowMs] = useState(() => parsedLastUpdatedAt);
  const [isVisible, setIsVisible] = useState(true);
  const [interactionUntilMs, setInteractionUntilMs] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastObservedAtMs, setLastObservedAtMs] = useState(parsedLastUpdatedAt);
  const [lastCycleAtMs, setLastCycleAtMs] = useState(parsedLastUpdatedAt);
  const lastObservedAtRef = useRef(parsedLastUpdatedAt);

  useEffect(() => {
    const nextObservedAtMs = parseTimestamp(lastUpdatedAt);
    if (nextObservedAtMs !== lastObservedAtRef.current) {
      lastObservedAtRef.current = nextObservedAtMs;
      setLastObservedAtMs(nextObservedAtMs);
      setLastCycleAtMs(nextObservedAtMs);
      setIsRefreshing(false);
    }
    setNowMs(Date.now());
  }, [lastUpdatedAt]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const syncVisibility = () => {
      const visible = document.visibilityState === 'visible';
      setIsVisible(visible);
      setNowMs(Date.now());
    };

    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);

  useEffect(() => {
    const markInteraction = () => {
      const nextExpiry = Date.now() + normalizedInteractionPauseMs;
      setInteractionUntilMs((current) => (current > nextExpiry ? current : nextExpiry));
      setNowMs(Date.now());
    };

    const events: Array<keyof DocumentEventMap> = [
      'pointerdown',
      'keydown',
      'focusin',
      'input',
      'touchstart',
      'wheel',
    ];

    for (const eventName of events) {
      document.addEventListener(eventName, markInteraction, { passive: true });
    }

    return () => {
      for (const eventName of events) {
        document.removeEventListener(eventName, markInteraction);
      }
    };
  }, [normalizedInteractionPauseMs]);

  const isInteracting = interactionUntilMs > nowMs;
  const pauseReason: AutoRefreshPauseReason = !isVisible
    ? 'hidden'
    : isInteracting
      ? 'interacting'
      : null;
  const nextRefreshAtMs = lastCycleAtMs + normalizedIntervalMs;
  const nextRefreshInSeconds = pauseReason ? null : Math.max(0, Math.ceil((nextRefreshAtMs - nowMs) / 1000));

  useEffect(() => {
    if (pauseReason || isRefreshing || isPending) {
      return;
    }

    if (nowMs < nextRefreshAtMs) {
      return;
    }

    setIsRefreshing(true);
    setLastCycleAtMs(Date.now());
    startTransition(() => {
      router.refresh();
    });
  }, [isPending, isRefreshing, nextRefreshAtMs, nowMs, pauseReason, router, startTransition]);

  useEffect(() => {
    if (!isRefreshing) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsRefreshing(false);
    }, normalizedIntervalMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isRefreshing, normalizedIntervalMs]);

  const refreshNow = () => {
    setIsRefreshing(true);
    setLastCycleAtMs(Date.now());
    startTransition(() => {
      router.refresh();
    });
  };

  const statusLabel = isRefreshing
    ? 'Refreshing now'
    : pauseReason === 'hidden'
      ? 'Paused - tab hidden'
      : pauseReason === 'interacting'
        ? 'Paused - interacting'
        : nextRefreshInSeconds === 0
          ? 'Refresh due now'
          : `Next refresh in ${formatCountdown(nextRefreshInSeconds ?? 0)}`;

  return {
    isRefreshing,
    isVisible,
    pauseReason,
    lastUpdatedLabel: formatRelativeAge(nowMs, lastObservedAtMs),
    statusLabel,
    nextRefreshInSeconds,
    refreshNow,
  };
}

export function AutoRefreshStatusBar({
  lastUpdatedAt,
  intervalMs,
  className,
}: AutoRefreshStatusBarProps) {
  const state = useAutoRefresh({ lastUpdatedAt, intervalMs });
  const rootClassName = [
    'flex flex-wrap items-center justify-between gap-3 rounded border border-gray-800 bg-gray-900/70 px-4 py-3 shadow-sm shadow-black/20',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const buttonClassName = getButtonClassName(state.isRefreshing);
  const toneClassName = getStatusToneClass(state.pauseReason, state.isRefreshing);

  return createElement(
    'div',
    {
      className: rootClassName,
      role: 'status',
      'aria-live': 'polite',
    },
    createElement(
      'div',
      { className: 'flex min-w-0 flex-col gap-0.5' },
      createElement(
        'span',
        { className: 'text-[10px] font-medium uppercase tracking-[0.28em] text-gray-500' },
        'Auto-refresh',
      ),
      createElement(
      'span',
        { className: 'text-sm text-gray-100', title: new Date(lastUpdatedAt).toISOString() },
        `Last updated ${state.lastUpdatedLabel}`,
      ),
    ),
    createElement(
      'div',
      { className: 'flex items-center gap-2' },
      createElement(
        'span',
        { className: `rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClassName}` },
        state.statusLabel,
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: state.refreshNow,
          disabled: state.isRefreshing,
          className: buttonClassName,
        },
        state.isRefreshing ? 'Refreshing...' : 'Refresh now',
      ),
    ),
  );
}
