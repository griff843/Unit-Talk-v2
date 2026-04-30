'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface LiveEventFeedEvent {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  tone?: 'info' | 'success' | 'warning' | 'error';
}

export interface LiveEventFeedProps {
  events: LiveEventFeedEvent[];
  paused: boolean;
  onTogglePause: () => void;
}

const ROW_HEIGHT = 72;
const VIEWPORT_HEIGHT = 360;
const OVERSCAN = 4;

function toneClass(tone: LiveEventFeedEvent['tone']) {
  if (tone === 'success') return 'border-emerald-400/30';
  if (tone === 'warning') return 'border-amber-400/30';
  if (tone === 'error') return 'border-rose-400/30';
  return 'border-sky-400/20';
}

export function LiveEventFeed({ events, paused, onTogglePause }: LiveEventFeedProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [visibleEvents, setVisibleEvents] = useState(events);
  const [queuedEvents, setQueuedEvents] = useState(0);

  useEffect(() => {
    if (paused) {
      const delta = Math.max(0, events.length - visibleEvents.length);
      setQueuedEvents(delta);
      return;
    }

    setVisibleEvents(events);
    setQueuedEvents(0);
  }, [events, paused, visibleEvents.length]);

  const totalHeight = visibleEvents.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(visibleEvents.length, startIndex + visibleCount);

  const windowedEvents = useMemo(
    () =>
      visibleEvents.slice(startIndex, endIndex).map((event, offset) => ({
        event,
        top: (startIndex + offset) * ROW_HEIGHT,
      })),
    [endIndex, startIndex, visibleEvents],
  );

  return (
    <section className="cc-surface relative overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--cc-border-subtle)] px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--cc-text-muted)]">Live Event Feed</h3>
          <p className="mt-1 text-sm text-[var(--cc-text-secondary)]">{visibleEvents.length.toLocaleString()} events in memory</p>
        </div>
        <button
          type="button"
          onClick={onTogglePause}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            paused
              ? 'border-amber-300/30 bg-amber-300/10 text-amber-100'
              : 'border-[var(--cc-border-strong)] bg-white/[0.03] text-[var(--cc-text-secondary)]'
          }`}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </header>

      <div
        ref={viewportRef}
        className="relative overflow-y-auto"
        style={{ height: VIEWPORT_HEIGHT }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {windowedEvents.map(({ event, top }) => (
            <article
              key={event.id}
              className={`absolute left-4 right-4 rounded-2xl border bg-white/[0.02] px-4 py-3 animate-[cc-event-enter_150ms_var(--ease-out)] ${toneClass(event.tone)}`}
              style={{ top, height: ROW_HEIGHT - 8 }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--cc-text-primary)]">{event.title}</p>
                  <p className="mt-1 truncate text-xs text-[var(--cc-text-secondary)]">{event.detail}</p>
                </div>
                <time className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-[var(--cc-text-muted)]">{event.timestamp}</time>
              </div>
            </article>
          ))}
        </div>
      </div>

      {paused ? (
        <div className="absolute inset-0 flex items-start justify-end bg-[rgba(15,23,42,0.26)] px-5 py-4">
          <div className="rounded-full border border-slate-200/10 bg-slate-900/70 px-3 py-1 text-xs font-medium text-slate-100">
            Paused - {queuedEvents} new events
          </div>
        </div>
      ) : null}
    </section>
  );
}
