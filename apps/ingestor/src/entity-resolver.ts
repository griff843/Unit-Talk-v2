import type { EventParticipantRole, IngestorRepositoryBundle, ParticipantRow } from '@unit-talk/db';
import { mapWithConcurrency } from './cooperative.js';
import type {
  SGOEventStatus,
  SGOResolvedEvent,
  SGOResolvedPlayer,
  SGOResolvedTeam,
} from './sgo-fetcher.js';
import { deriveDisplayNameFromProviderId } from './sgo-fetcher.js';

function toEasternDate(utcIso: string): string {
  return new Date(utcIso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Conservative default for per-event player entity-resolution concurrency (UTV2-1298).
 * Caps concurrent PostgREST writes so a heavy MLB slate (~15 events × ~55 players =
 * ~1,700 round-trips) drains well under the 240s per-league wall-clock without a
 * connection / schema-cache / statement-timeout storm.
 */
export const DEFAULT_ENTITY_RESOLUTION_CONCURRENCY = 8;

/**
 * Resolve the effective entity-resolution concurrency. Reversible + observable:
 * `UNIT_TALK_INGESTOR_ENTITY_RESOLUTION_SEQUENTIAL=true` forces the old sequential
 * behavior (concurrency 1); `UNIT_TALK_INGESTOR_ENTITY_CONCURRENCY=<n>` overrides the
 * cap; an explicit `options.concurrency` (tests) wins over both. Always >= 1.
 */
export function resolveEntityConcurrency(options: ResolveEntityOptions): number {
  if (
    String(process.env.UNIT_TALK_INGESTOR_ENTITY_RESOLUTION_SEQUENTIAL).toLowerCase() ===
    'true'
  ) {
    return 1;
  }
  if (typeof options.concurrency === 'number' && Number.isFinite(options.concurrency)) {
    return Math.max(1, Math.floor(options.concurrency));
  }
  const envValue = Number(process.env.UNIT_TALK_INGESTOR_ENTITY_CONCURRENCY);
  if (Number.isFinite(envValue) && envValue >= 1) {
    return Math.floor(envValue);
  }
  return DEFAULT_ENTITY_RESOLUTION_CONCURRENCY;
}

export interface ResolveEntityOptions {
  logger?: Pick<Console, 'warn'>;
  providerKey?: string;
  ingestionCycleRunId?: string;
  snapshotAt?: string;
  historical?: boolean;
  /** Bounded per-event player-upsert concurrency. Overrides env. 1 = sequential. */
  concurrency?: number;
}

/** Phase timing + counts for the entity-resolution phase (UTV2-1298 observability). */
export interface EntityResolutionTimings {
  totalMs: number;
  eventUpsertMs: number;
  teamLinkMs: number;
  playerUpsertMs: number;
  eventParticipantMs: number;
  concurrency: number;
  events: number;
  teamLinks: number;
  players: number;
  eventParticipants: number;
  errors: number;
}

export interface EntityResolutionSummary {
  resolvedEventsCount: number;
  resolvedParticipantsCount: number;
  /** Present when entity resolution actually ran; omitted on skip/default paths. */
  timings?: EntityResolutionTimings;
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
  const concurrency = resolveEntityConcurrency(options);

  // UTV2-1298 phase timing: aggregate time spent per DB sub-phase. Player sub-phase
  // sums overlap under concurrency (sum > wall-clock), which is intentional — the gap
  // between `totalMs` (wall-clock) and the summed sub-phases shows the concurrency win.
  const t = {
    eventUpsertMs: 0,
    teamLinkMs: 0,
    playerUpsertMs: 0,
    eventParticipantMs: 0,
    events: 0,
    teamLinks: 0,
    players: 0,
    eventParticipants: 0,
    errors: 0,
  };
  const startedAt = performance.now();

  for (const event of events) {
    const sportId = normalizeSportId(event.leagueKey ?? event.sportKey);
    const startsAt = event.startsAt;
    if (!sportId || !startsAt) {
      options.logger?.warn?.(
        `Skipping entity resolution for event ${event.providerEventId}: missing sport or start time`,
      );
      continue;
    }

    const eventUpsertStart = performance.now();
    const resolvedEvent = await repositories.events.upsertByExternalId({
      externalId: event.providerEventId,
      sportId,
      eventName: event.eventName,
      eventDate: toEasternDate(startsAt),
      status: mapSGOStatus(event.status),
      metadata: {
        source: options.providerKey ?? 'sgo',
        providerKey: options.providerKey ?? 'sgo',
        ingestionSource: 'ingestor.cycle',
        ingestionCycleRunId: options.ingestionCycleRunId ?? null,
        ingestedAt: options.snapshotAt ?? new Date().toISOString(),
        ingestionMode: options.historical ? 'historical' : 'live',
        venue: event.venue ?? null,
        broadcast: event.broadcast ?? null,
        home_team_external_id: event.teams.home?.teamId ?? null,
        away_team_external_id: event.teams.away?.teamId ?? null,
        starts_at: event.startsAt ?? null,
      },
    });
    t.eventUpsertMs += performance.now() - eventUpsertStart;
    t.events += 1;
    resolvedEventIds.add(resolvedEvent.id);

    // Team links stay sequential (only 2/event, and they share `teamCache`).
    const teamLinkStart = performance.now();
    for (const [team, role] of [
      [event.teams.home, 'home'] as const,
      [event.teams.away, 'away'] as const,
    ]) {
      if (team) {
        t.teamLinks += 1;
      }
      const linkedEventParticipants = await linkResolvedTeam(
        team,
        role,
        sportId,
        resolvedEvent.id,
        repositories,
        teamCache,
        resolvedParticipantIds,
        options,
      );
      t.eventParticipants += linkedEventParticipants;
    }
    t.teamLinkMs += performance.now() - teamLinkStart;

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

    // Players are independent within an event; resolve them with bounded concurrency.
    // Each player's (participant upsert → eventParticipant link) stays ordered; the
    // upserts are idempotent (onConflict) so concurrent distinct entities are safe.
    const players = [...playerMap.values()];
    await mapWithConcurrency(players, concurrency, async (player) => {
      const participantStart = performance.now();
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
      t.playerUpsertMs += performance.now() - participantStart;
      t.players += 1;
      resolvedParticipantIds.add(participant.id);

      const linkStart = performance.now();
      await repositories.eventParticipants.upsert({
        eventId: resolvedEvent.id,
        participantId: participant.id,
        role: 'competitor',
      });
      t.eventParticipantMs += performance.now() - linkStart;
      t.eventParticipants += 1;
    });
  }

  return {
    resolvedEventsCount: resolvedEventIds.size,
    resolvedParticipantsCount: resolvedParticipantIds.size,
    timings: {
      totalMs: Math.round(performance.now() - startedAt),
      eventUpsertMs: Math.round(t.eventUpsertMs),
      teamLinkMs: Math.round(t.teamLinkMs),
      playerUpsertMs: Math.round(t.playerUpsertMs),
      eventParticipantMs: Math.round(t.eventParticipantMs),
      concurrency,
      events: t.events,
      teamLinks: t.teamLinks,
      players: t.players,
      eventParticipants: t.eventParticipants,
      errors: t.errors,
    },
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
): Promise<number> {
  if (!team) {
    return 0;
  }

  const existingTeams = await getTeamsForSport(sportId, repositories, teamCache);
  const match = existingTeams.find(
    (row) => namesMatch(row.display_name, team.displayName),
  );

  if (!match) {
    options.logger?.warn?.(
      `Unable to match team "${team.displayName}" for sport ${sportId}; skipping team link`,
    );
    return 0;
  }

  resolvedParticipantIds.add(match.id);
  await repositories.eventParticipants.upsert({
    eventId,
    participantId: match.id,
    role,
  });
  return 1;
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
  // SGO uses status.finalized (not status.completed) as the authoritative completion signal.
  // status.completed is unreliable — SGO does not set it consistently across all event types
  // (e.g. playoff games). Use status.finalized as the sole gate for 'completed'.
  // See: docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md
  if (status.finalized) {
    return 'completed';
  }
  if (status.live) {
    return 'in_progress';
  }
  return 'scheduled';
}
