import { Card, EmptyState } from '@/components/ui';
import Link from 'next/link';
import { getResearchMatchups } from '@/lib/data';
import type { ResearchMatchup } from '@/lib/data';

const SPORT_OPTIONS = [
  { value: 'nba', label: 'NBA' },
  { value: 'mlb', label: 'MLB' },
  { value: 'nhl', label: 'NHL' },
  { value: 'nfl', label: 'NFL' },
];

function defaultDateValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatEventDate(eventDate: string | null): string {
  if (!eventDate) return '—';
  return new Date(eventDate).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function matchupLabel(event: ResearchMatchup): string {
  if (event.homeTeam && event.awayTeam) {
    return `${event.awayTeam} @ ${event.homeTeam}`;
  }
  return event.eventName ?? event.id;
}

export default async function MatchupCardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const sport = typeof searchParams['sport'] === 'string' ? searchParams['sport'] : 'nba';
  const date = typeof searchParams['date'] === 'string' ? searchParams['date'] : defaultDateValue();
  const q = typeof searchParams['q'] === 'string' ? searchParams['q'] : undefined;
  const eventId = typeof searchParams['eventId'] === 'string' ? searchParams['eventId'] : undefined;

  const result = await getResearchMatchups({ sport, date, q, eventId });
  const events = result?.events ?? [];
  const total = result?.total ?? 0;
  const selectedEvent = eventId ? events.find((e) => e.id === eventId) ?? null : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Matchup Card</h1>
        <p className="mt-1 text-sm text-gray-400">
          Browse upcoming events with matchup context.
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="matchup-sport" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Sport
          </label>
          <select
            id="matchup-sport"
            name="sport"
            defaultValue={sport}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {SPORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="matchup-date" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Date
          </label>
          <input
            id="matchup-date"
            name="date"
            type="date"
            defaultValue={date}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="matchup-query" className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Team / Matchup
          </label>
          <input
            id="matchup-query"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search teams or event names..."
            className="w-60 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-gray-950"
          >
            Load Matchups
          </button>
          <Link
            href={`/research/matchups?sport=${encodeURIComponent(sport)}&date=${encodeURIComponent(defaultDateValue())}`}
            className="rounded border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            Reset
          </Link>
        </div>
      </form>

      {!result ? (
        <EmptyState
          message="Unable to load matchup data."
          detail="The events table may be empty or unavailable."
          action={{ label: 'Back to Research', href: '/research' }}
        />
      ) : events.length === 0 ? (
        <EmptyState
          message="No matchups found"
          detail="Try another sport, date, or broader search term."
          action={{ label: 'Back to Research', href: '/research' }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <Card title={`Matchups (${total})`}>
            <div className="space-y-3">
              {events.map((event) => {
                const href = `/research/matchups?${new URLSearchParams({
                  sport,
                  date,
                  ...(q ? { q } : {}),
                  eventId: event.id,
                }).toString()}`;
                const active = selectedEvent?.id === event.id;

                return (
                  <Link
                    key={event.id}
                    href={href}
                    className={`block rounded border px-4 py-3 transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-950/30'
                        : 'border-gray-800 bg-gray-950/50 hover:border-gray-700 hover:bg-gray-900/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-100">{matchupLabel(event)}</div>
                        <div className="mt-1 text-xs text-gray-400">
                          {event.sportId?.toUpperCase() ?? '—'} · {formatEventDate(event.eventDate)}
                        </div>
                      </div>
                      <span className="rounded border border-gray-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                        {event.status ?? 'unknown'}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>

          {selectedEvent ? (
            <Card title="Selected Matchup">
              <div className="space-y-3">
                <div className="text-lg font-semibold text-white">{matchupLabel(selectedEvent)}</div>
                <div className="text-xs text-gray-400">
                  {selectedEvent.eventName ?? selectedEvent.id} · {selectedEvent.sportId?.toUpperCase() ?? '—'} · {formatEventDate(selectedEvent.eventDate)}
                </div>
                {(selectedEvent.homeTeam || selectedEvent.awayTeam) && (
                  <div className="grid grid-cols-1 gap-2 mt-2">
                    {selectedEvent.awayTeam && (
                      <div className="flex items-center justify-between rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <span className="text-sm text-gray-200">{selectedEvent.awayTeam}</span>
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">away</span>
                      </div>
                    )}
                    {selectedEvent.homeTeam && (
                      <div className="flex items-center justify-between rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <span className="text-sm text-gray-200">{selectedEvent.homeTeam}</span>
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">home</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <EmptyState
              message="Select a matchup"
              detail="Choose an event from the list to inspect its details."
              action={{ label: 'Back to Research', href: '/research' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
