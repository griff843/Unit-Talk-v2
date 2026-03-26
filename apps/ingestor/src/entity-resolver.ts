import type { EventParticipantRole, IngestorRepositoryBundle, ParticipantRow } from '@unit-talk/db';
import type {
  SGOEventStatus,
  SGOResolvedEvent,
  SGOResolvedPlayer,
  SGOResolvedTeam,
} from './sgo-fetcher.js';
import { deriveDisplayNameFromProviderId } from './sgo-fetcher.js';

export interface ResolveEntityOptions {
  logger?: Pick<Console, 'warn'>;
}

export interface EntityResolutionSummary {
  resolvedEventsCount: number;
  resolvedParticipantsCount: number;
}

export async function resolveSgoEntities(
  events: SGOResolvedEvent[],
  repositories: Pick<
    IngestorRepositoryBundle,
    'events' | 'eventParticipants' | 'participants'
  >,
  options: ResolveEntityOptions = {},
): Promise<EntityResolutionSummary> {
  const resolvedEventIds = new Set<string>();
  const resolvedParticipantIds = new Set<string>();
  const teamCache = new Map<string, ParticipantRow[]>();

  for (const event of events) {
    const sportId = normalizeSportId(event.leagueKey ?? event.sportKey);
    const startsAt = event.startsAt;
    if (!sportId || !startsAt) {
      options.logger?.warn?.(
        `Skipping entity resolution for event ${event.providerEventId}: missing sport or start time`,
      );
      continue;
    }

    const resolvedEvent = await repositories.events.upsertByExternalId({
      externalId: event.providerEventId,
      sportId,
      eventName: event.eventName,
      eventDate: startsAt.slice(0, 10),
      status: mapSGOStatus(event.status),
      metadata: {
        venue: event.venue ?? null,
        broadcast: event.broadcast ?? null,
        home_team_external_id: event.teams.home?.teamId ?? null,
        away_team_external_id: event.teams.away?.teamId ?? null,
        starts_at: event.startsAt ?? null,
      },
    });
    resolvedEventIds.add(resolvedEvent.id);

    await linkResolvedTeam(
      event.teams.home,
      'home',
      sportId,
      resolvedEvent.id,
      repositories,
      teamCache,
      resolvedParticipantIds,
      options,
    );
    await linkResolvedTeam(
      event.teams.away,
      'away',
      sportId,
      resolvedEvent.id,
      repositories,
      teamCache,
      resolvedParticipantIds,
      options,
    );

    const playerMap = new Map<string, SGOResolvedPlayer>();
    for (const player of event.players) {
      playerMap.set(player.playerId, player);
    }
    for (const providerParticipantId of event.providerParticipantIds) {
      if (isReservedSideParticipantId(providerParticipantId)) {
        continue;
      }
      if (!playerMap.has(providerParticipantId)) {
        playerMap.set(providerParticipantId, {
          playerId: providerParticipantId,
          teamId: null,
          displayName: deriveDisplayNameFromProviderId(providerParticipantId),
          firstName: null,
          lastName: null,
        });
      }
    }

    for (const player of playerMap.values()) {
      const participant = await repositories.participants.upsertByExternalId({
        externalId: player.playerId,
        displayName:
          player.displayName.length > 0
            ? player.displayName
            : deriveDisplayNameFromProviderId(player.playerId),
        participantType: 'player',
        sport: sportId,
        league: event.leagueKey ?? null,
        metadata: {
          headshot_url: null,
          position: null,
          jersey_number: null,
          team_external_id: player.teamId ?? null,
        },
      });
      resolvedParticipantIds.add(participant.id);
      await repositories.eventParticipants.upsert({
        eventId: resolvedEvent.id,
        participantId: participant.id,
        role: 'competitor',
      });
    }
  }

  return {
    resolvedEventsCount: resolvedEventIds.size,
    resolvedParticipantsCount: resolvedParticipantIds.size,
  };
}

async function linkResolvedTeam(
  team: SGOResolvedTeam | null,
  role: Extract<EventParticipantRole, 'home' | 'away'>,
  sportId: string,
  eventId: string,
  repositories: Pick<IngestorRepositoryBundle, 'eventParticipants' | 'participants'>,
  teamCache: Map<string, ParticipantRow[]>,
  resolvedParticipantIds: Set<string>,
  options: ResolveEntityOptions,
) {
  if (!team) {
    return;
  }

  const existingTeams = await getTeamsForSport(sportId, repositories, teamCache);
  const match = existingTeams.find(
    (row) => namesMatch(row.display_name, team.displayName),
  );

  if (!match) {
    options.logger?.warn?.(
      `Unable to match team "${team.displayName}" for sport ${sportId}; skipping team link`,
    );
    return;
  }

  resolvedParticipantIds.add(match.id);
  await repositories.eventParticipants.upsert({
    eventId,
    participantId: match.id,
    role,
  });
}

async function getTeamsForSport(
  sportId: string,
  repositories: Pick<IngestorRepositoryBundle, 'participants'>,
  cache: Map<string, ParticipantRow[]>,
) {
  const cached = cache.get(sportId);
  if (cached) {
    return cached;
  }

  const teams = await repositories.participants.listByType('team', sportId);
  cache.set(sportId, teams);
  return teams;
}

function normalizeSportId(value: string | null) {
  return value ? value.toUpperCase() : null;
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function namesMatch(left: string, right: string) {
  const normalizedLeft = normalizeName(left);
  const normalizedRight = normalizeName(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(normalizedRight) ||
    normalizedRight.endsWith(normalizedLeft)
  );
}

function isReservedSideParticipantId(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^(player[-_])?(home|away)$/.test(normalized);
}

export function mapSGOStatus(status: SGOEventStatus | null | undefined) {
  if (!status) {
    return 'scheduled';
  }
  if (status.completed && status.finalized) {
    return 'completed';
  }
  if (status.live) {
    return 'in_progress';
  }
  return 'scheduled';
}
