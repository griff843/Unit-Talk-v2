'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Card } from '@/components/ui/Card';
import {
  buildVirtualWindow,
  filterEvents,
  mergeEventStreams,
  type EventStreamRecord,
} from '@/lib/events-feed';
import { ReplayControlPanel } from './ReplayControlPanel';

const POLL_INTERVAL_MS = 5_000;
const ROW_HEIGHT = 92;
const VIEWPORT_HEIGHT = 620;

interface EventsWorkspaceProps {
  initialEvents: EventStreamRecord[];
  observedAt: string;
}

interface EventApiResponse {
  events: EventStreamRecord[];
  observedAt: string;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function eventTone(type: string) {
  if (type.includes('rejected') || type.includes('failed')) {
    return 'from-rose-500/20 to-rose-500/5 text-rose-200 border-rose-400/20';
  }
  if (type.includes('materialized') || type.includes('posted')) {
    return 'from-emerald-500/20 to-emerald-500/5 text-emerald-200 border-emerald-400/20';
  }
  if (type.includes('validated')) {
    return 'from-cyan-500/20 to-cyan-500/5 text-cyan-200 border-cyan-400/20';
  }
  return 'from-slate-500/20 to-slate-500/5 text-slate-200 border-white/10';
}

export function EventsWorkspace({ initialEvents, observedAt }: EventsWorkspaceProps) {
  const [events, setEvents] = useState(initialEvents);
  const [bufferedEvents, setBufferedEvents] = useState<EventStreamRecord[]>([]);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [expandedEventId, setExpandedEventId] = useState<string | null>(initialEvents[0]?.id ?? null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [lastObservedAt, setLastObservedAt] = useState(observedAt);
  const [isPending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const poll = async () => {
      const response = await fetch('/api/events?limit=250', { cache: 'no-store' });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as EventApiResponse;
      setLastObservedAt(payload.observedAt);

      const knownIds = new Set([...events, ...bufferedEvents].map((event) => event.id));
      const incoming = payload.events.filter((event) => !knownIds.has(event.id));
      if (incoming.length === 0) {
        return;
      }

      const incomingIds = new Set(incoming.map((event) => event.id));
      startTransition(() => {
        if (paused) {
          setBufferedEvents((current) => mergeEventStreams(current, incoming));
          return;
        }

        setEvents((current) => mergeEventStreams(current, incoming));
        setFreshIds(incomingIds);
      });

      window.setTimeout(() => {
        setFreshIds((current) => {
          const next = new Set(current);
          for (const id of incomingIds) {
            next.delete(id);
          }
          return next;
        });
      }, 180);
    };

    const intervalId = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [bufferedEvents, events, paused]);

  const allTypes = useMemo(
    () => [...new Set([...events, ...bufferedEvents].map((event) => event.type))].sort(),
    [bufferedEvents, events],
  );

  const filteredEvents = useMemo(
    () => filterEvents(events, { selectedTypes, query: deferredQuery }),
    [deferredQuery, events, selectedTypes],
  );

  const selectedEvent = filteredEvents.find((event) => event.id === expandedEventId) ?? filteredEvents[0] ?? null;
  const virtualWindow = buildVirtualWindow({
    totalCount: filteredEvents.length,
    scrollTop,
    viewportHeight: VIEWPORT_HEIGHT,
    rowHeight: ROW_HEIGHT,
    overscan: 5,
  });
  const visibleEvents = filteredEvents.slice(virtualWindow.startIndex, virtualWindow.endIndex);

  const toggleType = (type: string) => {
    setSelectedTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const flushBufferedEvents = () => {
    if (bufferedEvents.length === 0) {
      return;
    }

    setEvents((current) => mergeEventStreams(current, bufferedEvents));
    setFreshIds(new Set(bufferedEvents.map((event) => event.id)));
    setBufferedEvents([]);
    setPaused(false);

    window.setTimeout(() => setFreshIds(new Set()), 180);
  };

  const jumpToLatest = () => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="overflow-hidden rounded-[1.75rem] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_32%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-6 shadow-[0_24px_120px_rgba(14,165,233,0.12)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.36em] text-cyan-300/80">
              Event Stream
            </p>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-white">Live stream + replay</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">
                Monitor operator-facing submission events in real time, pause the stream without losing arrivals,
                and inspect payload detail before stepping into replay mode.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricPill label="Visible events" value={String(filteredEvents.length)} />
            <MetricPill label="Buffered while paused" value={String(bufferedEvents.length)} accent="amber" />
            <MetricPill label="Observed at" value={formatTimestamp(lastObservedAt)} />
          </div>
        </div>
      </section>

      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (paused && bufferedEvents.length > 0) {
                    flushBufferedEvents();
                    return;
                  }
                  setPaused((current) => !current);
                }}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  paused
                    ? 'border-amber-400/40 bg-amber-500/10 text-amber-100'
                    : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                }`}
              >
                {paused ? `Resume stream${bufferedEvents.length > 0 ? ` (${bufferedEvents.length})` : ''}` : 'Pause stream'}
              </button>

              <button
                type="button"
                onClick={() => setReplayOpen((current) => !current)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  replayOpen
                    ? 'border-cyan-300/50 bg-cyan-500/10 text-cyan-100'
                    : 'border-white/10 bg-white/[0.03] text-slate-200'
                }`}
              >
                {replayOpen ? 'Hide replay mode' : 'Replay mode'}
              </button>

              <div className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-400">
                Auto-poll every {POLL_INTERVAL_MS / 1000}s
              </div>
            </div>

            <label className="relative w-full xl:max-w-sm">
              <span className="sr-only">Search events</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search types, source, or payload..."
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/50"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {allTypes.map((type) => {
              const active = selectedTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-cyan-300/50 bg-cyan-500/10 text-cyan-100'
                      : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                  }`}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1">
          <Card>
            <div className="relative">
              {paused ? (
                <div className="animate-overlay-fade pointer-events-none absolute inset-x-4 top-4 z-10 rounded-2xl border border-amber-300/25 bg-slate-900/88 px-4 py-3 text-sm text-amber-100 backdrop-blur">
                  Paused. {bufferedEvents.length} new event{bufferedEvents.length === 1 ? '' : 's'} waiting in buffer.
                </div>
              ) : null}

              <div
                ref={listRef}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                className="overflow-y-auto rounded-[1.5rem] border border-white/5 bg-slate-950/70"
                style={{ height: `${VIEWPORT_HEIGHT}px` }}
              >
                {filteredEvents.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                    No events match the current filters.
                  </div>
                ) : (
                  <div style={{ paddingTop: virtualWindow.paddingTop, paddingBottom: virtualWindow.paddingBottom }}>
                    {visibleEvents.map((event) => {
                      const expanded = selectedEvent?.id === event.id;
                      const isFresh = freshIds.has(event.id);

                      return (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => setExpandedEventId(event.id)}
                          className={`group flex w-full items-center border-b border-white/5 bg-transparent px-4 text-left transition ${
                            isFresh ? 'animate-event-enter' : ''
                          } ${expanded ? 'bg-cyan-500/[0.08]' : 'hover:bg-white/[0.03]'}`}
                          style={{ height: `${ROW_HEIGHT}px` }}
                        >
                          <div className="grid w-full grid-cols-[152px_minmax(0,140px)_140px_minmax(0,1fr)_28px] items-center gap-4">
                            <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                              {formatTimestamp(event.timestamp)}
                            </div>
                            <div>
                              <span className={`inline-flex rounded-full border bg-gradient-to-r px-3 py-1 text-xs font-semibold ${eventTone(event.type)}`}>
                                {event.type}
                              </span>
                            </div>
                            <div className="text-sm text-slate-300">{event.source}</div>
                            <div className="min-w-0">
                              <p className="truncate text-sm text-slate-100">{event.summary}</p>
                            </div>
                            <div className="text-right text-slate-500">{expanded ? '−' : '+'}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <div className="mt-4">
            <Card title="Payload Detail">
              {selectedEvent ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`inline-flex rounded-full border bg-gradient-to-r px-3 py-1 text-xs font-semibold ${eventTone(selectedEvent.type)}`}>
                      {selectedEvent.type}
                    </span>
                    <span className="text-sm text-slate-400">{selectedEvent.source}</span>
                    <span className="text-sm text-slate-500">{formatTimestamp(selectedEvent.timestamp)}</span>
                  </div>
                  <pre className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-950/80 p-4 text-xs leading-6 text-slate-300">
                    {JSON.stringify(selectedEvent.payload ?? {}, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Select an event to inspect its payload.</p>
              )}
            </Card>
          </div>
        </div>

        <div
          className={`overflow-hidden transition-all duration-[250ms] ease-out ${
            replayOpen ? 'w-full xl:w-[360px] opacity-100' : 'max-xl:hidden xl:w-0 opacity-0'
          }`}
        >
          <div
            className={`h-full min-w-[320px] transition-transform duration-[250ms] ease-out ${
              replayOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <ReplayControlPanel
              events={events}
              bufferedCount={bufferedEvents.length}
              paused={paused}
              onJumpToLatest={jumpToLatest}
              onApplyBuffered={flushBufferedEvents}
            />
          </div>
        </div>
      </div>

      {isPending ? <p className="text-xs text-slate-500">Updating event stream...</p> : null}

      <style jsx global>{`
        @keyframes cc-event-enter {
          from {
            opacity: 0;
            transform: translateY(-14px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes cc-overlay-fade {
          from {
            opacity: 0;
          }

          to {
            opacity: 1;
          }
        }

        .animate-event-enter {
          animation: cc-event-enter 150ms ease-out;
        }

        .animate-overlay-fade {
          animation: cc-overlay-fade 150ms ease-out;
        }
      `}</style>
    </div>
  );
}

function MetricPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'amber';
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${accent === 'amber' ? 'border-amber-300/20 bg-amber-500/10' : 'border-white/10 bg-white/[0.03]'}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-medium ${accent === 'amber' ? 'text-amber-100' : 'text-white'}`}>{value}</p>
    </div>
  );
}
