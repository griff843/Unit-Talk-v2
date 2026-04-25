import { Card, EmptyState } from '@/components/ui';
import Link from 'next/link';

const OPERATOR_WEB_BASE = process.env.OPERATOR_WEB_URL ?? 'http://localhost:4200';

interface EventSummary {
  eventId: string;
  externalId: string | null;
  eventName: string;
  eventDate: string;
  startTime: string | null;
  status: string;
  sportId: string;
  leagueId: string | null;
  matchupLabel: string;
  teams: Array<{
    participantId: string;
    teamId: string | null;
    displayName: string;
    role: 'home' | 'away';
  }>;
}

interface EventParticipant {
  participantId: string;
  canonicalId: string | null;
  participantType: 'team' | 'player';
  displayName: string;
  role: string;
  teamId: string | null;
  teamName: string | null;
}

interface EventOffer {
  sportsbookId: string | null;
  sportsbookName: string | null;
  marketTypeId: string | null;
  marketDisplayName: string;
  participantId: string | null;
  participantName: string | null;
  line: number | null;
  overOdds: number | null;
  underOdds: number | null;
  snapshotAt: string;
  providerKey: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
}

interface EventDetail extends EventSummary {
  participants: EventParticipant[];
  offers: EventOffer[];
}

interface EventsResponse {
  events: EventSummary[];
  selectedEvent: EventDetail | null;
  total: number;
  observedAt: string;
}

const SPORT_OPTIONS = [
  { value: 'nba', label: 'NBA' },
  { value: 'mlb', label: 'MLB' },
  { value: 'nhl', label: 'NHL' },
  { value: 'nfl', label: 'NFL' },
];

function defaultDateValue() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchEvents(params: {
  sport: string;
  date: string;
  q?: string;
  eventId?: string;
}): Promise<EventsResponse | null> {
  try {
    const query = new URLSearchParams({
      sport: params.sport,
      date: params.date,
      limit: '24',
    });
    if (params.q) query.set('q', params.q);
    if (params.eventId) query.set('eventId', params.eventId);

    const res = await fetch(`${OPERATOR_WEB_BASE}/api/operator/events?${query.toString()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as EventsResponse;
  } catch {
    return null;
  }
}

function formatStartTime(startTime: string | null, eventDate: string): string {
  const source = startTime ?? `${eventDate}T00:00:00.000Z`;
  return new Date(source).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatOdds(value: number | null): string {
  if (value === null) {
    return '—';
  }
  return value > 0 ? `+${value}` : String(value);
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

  const data = await fetchEvents({ sport, date, q, eventId });
  const selectedEvent = data?.selectedEvent ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-gray-500">Research</p>
        <h1 className="mt-1 text-xl font-bold text-white">Matchup Card</h1>
        <p className="mt-1 text-sm text-gray-400">
          Browse upcoming events with participant assignments and recent market context.
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

      {!data ? (
        <EmptyState
          message="Unable to load matchup data."
          detail="Check that operator-web is reachable and the /api/operator/events endpoint is responding."
          action={{ label: 'Back to Research', href: '/research' }}
        />
      ) : data.events.length === 0 ? (
        <EmptyState
          message="No matchups found"
          detail="Try another sport, date, or broader search term."
          action={{ label: 'Back to Research', href: '/research' }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <Card title={`Matchups (${data.total})`}>
            <div className="space-y-3">
              {data.events.map((event) => {
                const href = `/research/matchups?${new URLSearchParams({
                  sport,
                  date,
                  ...(q ? { q } : {}),
                  eventId: event.eventId,
                }).toString()}`;
                const active = selectedEvent?.eventId === event.eventId;

                return (
                  <Link
                    key={event.eventId}
                    href={href}
                    className={`block rounded border px-4 py-3 transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-950/30'
                        : 'border-gray-800 bg-gray-950/50 hover:border-gray-700 hover:bg-gray-900/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-100">{event.matchupLabel}</div>
                        <div className="mt-1 text-xs text-gray-400">
                          {event.leagueId ?? event.sportId.toUpperCase()} · {formatStartTime(event.startTime, event.eventDate)}
                        </div>
                      </div>
                      <span className="rounded border border-gray-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                        {event.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {event.teams.map((team) => (
                        <span
                          key={`${event.eventId}-${team.participantId}`}
                          className="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-[11px] text-gray-300"
                        >
                          {team.role} · {team.displayName}
                        </span>
                      ))}
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>

          {selectedEvent ? (
            <div className="space-y-6">
              <Card title="Selected Matchup">
                <div className="space-y-3">
                  <div>
                    <div className="text-lg font-semibold text-white">{selectedEvent.matchupLabel}</div>
                    <div className="mt-1 text-xs text-gray-400">
                      {selectedEvent.eventName} · {selectedEvent.leagueId ?? selectedEvent.sportId.toUpperCase()} · {formatStartTime(selectedEvent.startTime, selectedEvent.eventDate)}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {selectedEvent.teams.map((team) => (
                      <div
                        key={`${selectedEvent.eventId}-${team.participantId}`}
                        className="flex items-center justify-between rounded border border-gray-800 bg-gray-950/60 px-3 py-2"
                      >
                        <span className="text-sm text-gray-200">{team.displayName}</span>
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">{team.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              <Card title={`Participants (${selectedEvent.participants.length})`}>
                <div className="space-y-2">
                  {selectedEvent.participants.map((participant) => (
                    <div
                      key={`${selectedEvent.eventId}-${participant.participantId}`}
                      className="flex items-center justify-between rounded border border-gray-800 bg-gray-950/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-gray-200">{participant.displayName}</div>
                        <div className="text-[11px] text-gray-500">
                          {participant.participantType} · {participant.teamName ?? participant.role}
                        </div>
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-gray-500">{participant.role}</div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title={`Recent Offers (${selectedEvent.offers.length})`}>
                {selectedEvent.offers.length === 0 ? (
                  <div className="text-xs text-gray-500">No recent provider offers attached to this event.</div>
                ) : (
                  <div className="space-y-2">
                    {selectedEvent.offers.slice(0, 12).map((offer, index) => (
                      <div
                        key={`${offer.providerKey}-${offer.providerMarketKey}-${offer.participantId ?? 'event'}-${index}`}
                        className="rounded border border-gray-800 bg-gray-950/60 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm text-gray-200">{offer.marketDisplayName}</div>
                            <div className="mt-1 text-[11px] text-gray-500">
                              {offer.participantName ?? 'Event market'} · {offer.sportsbookName ?? offer.providerKey}
                            </div>
                          </div>
                          <div className="text-right text-xs text-gray-300">
                            <div>Line {offer.line ?? '—'}</div>
                            <div className="text-[11px] text-gray-500">
                              O {formatOdds(offer.overOdds)} / U {formatOdds(offer.underOdds)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          ) : (
            <EmptyState
              message="Select a matchup"
              detail="Choose an event from the list to inspect participants and recent offers."
              action={{ label: 'Back to Research', href: '/research' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
