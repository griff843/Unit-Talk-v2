import {
  Card,
  EmptyState,
  InternalLabelBadge,
  Table,
  TableHead,
  TableBody,
  Th,
  Td,
} from '@/components/ui';
import { getResearchPlayers, formatRelativeTime } from '@/lib/data/research';
import { getCurrentOfferGroups, isStaleOdds, type IntelOfferGroup } from '@/lib/data/odds-intel';
import { getDataClient } from '@/lib/data/client';
import { formatAmerican, formatTimestamp } from '@/lib/intel-format';

export const metadata = { title: 'Team Research — Unit Talk Command Center' };

export const dynamic = 'force-dynamic';

interface TeamEvent {
  id: string;
  externalId: string | null;
  eventName: string;
  sportId: string;
  eventDate: string;
  status: string;
}

async function getTeamEvents(teamName: string): Promise<TeamEvent[] | null> {
  try {
    const client = getDataClient();
    const { data, error } = await client
      .from('events')
      .select('id, external_id, event_name, sport_id, event_date, status')
      .ilike('event_name', `%${teamName}%`)
      .order('event_date', { ascending: false })
      .limit(50);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row['id'] ?? ''),
      externalId: typeof row['external_id'] === 'string' ? row['external_id'] : null,
      eventName: String(row['event_name'] ?? ''),
      sportId: String(row['sport_id'] ?? ''),
      eventDate: String(row['event_date'] ?? ''),
      status: String(row['status'] ?? ''),
    }));
  } catch {
    return null;
  }
}

export default async function TeamsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const team = typeof searchParams['team'] === 'string' ? searchParams['team'] : '';

  let teams: Array<{ id: string; displayName: string | null; sport: string | null }> = [];
  let events: TeamEvent[] = [];
  let marketGroups: IntelOfferGroup[] = [];
  let fetchError: string | null = null;

  try {
    const teamsResult = await getResearchPlayers({ type: 'team' });
    teams = teamsResult?.participants ?? [];

    if (team) {
      const eventsResult = await getTeamEvents(team);
      if (eventsResult === null) {
        fetchError = 'Failed to load events for this team.';
      } else {
        events = eventsResult;
        // related current markets: offers for the team's most recent events
        const externalIds = events
          .map((e) => e.externalId)
          .filter((id): id is string => id !== null)
          .slice(0, 3);
        for (const externalId of externalIds) {
          const offers = await getCurrentOfferGroups({ eventId: externalId, limit: 100 });
          if (offers) marketGroups.push(...offers.groups);
        }
        marketGroups = marketGroups.slice(0, 50);
      }
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Unknown error loading team research.';
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="cc-text-secondary mt-1 text-sm">
          Events and current markets for a team. Team list from participants (type=team); events
          matched by name; markets from provider_offer_current (first 3 events, 50 groups max).
        </p>
      </div>

      <form method="GET" className="cc-surface flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="team" className="cc-text-muted text-[10px] font-medium uppercase tracking-wide">
            Team
          </label>
          <select
            id="team"
            name="team"
            defaultValue={team}
            className="cc-select w-72"
          >
            <option value="">— select a team —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.displayName ?? t.id}>
                {t.displayName ?? t.id} {t.sport ? `(${t.sport})` : ''}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
          Load
        </button>
      </form>

      {fetchError ? (
        <Card title="Error">
          <p className="text-xs text-red-400">{fetchError}</p>
        </Card>
      ) : !team ? (
        <EmptyState
          message="Select a team"
          detail={`${teams.length} teams available from participants.`}
        />
      ) : (
        <>
          <Card title={`Events — ${events.length}`}>
            {events.length === 0 ? (
              <EmptyState message="No events matched" detail={`No events whose name contains "${team}".`} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <Th>Event</Th>
                    <Th>Sport</Th>
                    <Th>Date</Th>
                    <Th>Status</Th>
                  </TableHead>
                  <TableBody>
                    {events.map((e) => (
                      <tr key={e.id} className="border-b border-gray-800/50">
                        <Td>{e.eventName}</Td>
                        <Td>{e.sportId}</Td>
                        <Td>
                          {formatTimestamp(e.eventDate)}{' '}
                          <span className="text-gray-500">({formatRelativeTime(e.eventDate)})</span>
                        </Td>
                        <Td>{e.status}</Td>
                      </tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          <Card title={`Current Markets — ${marketGroups.length} groups`}>
            {marketGroups.length === 0 ? (
              <EmptyState
                message="No current markets"
                detail="No provider_offer_current rows for this team's most recent events."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <Th>Market</Th>
                    <Th>Participant</Th>
                    <Th>Books</Th>
                    <Th>Sample (book / line / over / under)</Th>
                    <Th>Updated</Th>
                  </TableHead>
                  <TableBody>
                    {marketGroups.map((g) => {
                      const latest = g.books.reduce((a, b) => (b.snapshotAt > a.snapshotAt ? b : a));
                      return (
                        <tr key={g.groupKey} className="border-b border-gray-800/50">
                          <Td>{g.providerMarketKey}</Td>
                          <Td>{g.providerParticipantId ?? '—'}</Td>
                          <Td num align="right">{new Set(g.books.map((b) => b.bookmakerKey)).size}</Td>
                          <Td>
                            {latest.bookmakerKey} / {latest.line ?? '—'} /{' '}
                            <span className="cc-num">{formatAmerican(latest.overOdds)} / {formatAmerican(latest.underOdds)}</span>
                          </Td>
                          <Td>
                            {formatTimestamp(latest.snapshotAt)}{' '}
                            <span className="text-gray-500">({formatRelativeTime(latest.snapshotAt)})</span>
                            {isStaleOdds(latest.snapshotAt) ? (
                              <span className="ml-1">
                                <InternalLabelBadge label="Stale Odds" />
                              </span>
                            ) : null}
                          </Td>
                        </tr>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          <Card title="Operator Notes">
            <div className="flex items-center gap-2">
              <InternalLabelBadge label="Data Missing" />
              <InternalLabelBadge label="Internal Only" />
            </div>
            <p className="cc-text-secondary mt-3 text-xs">
              {/* TODO(data-contract): operator notes need a `team_notes` table
                  (team participant id, author, note, created_at) plus an
                  apps/api write endpoint. No persistence exists yet. */}
              Operator notes require a persistence contract (team_notes table + apps/api write
              endpoint). Not yet connected.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
