import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';
import { V1_REFERENCE_DATA } from '@unit-talk/contracts';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  buildCanonicalTeamId,
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
  extractProjectRefFromUrl,
  normalizeCanonicalLeagueId,
  type UnitTalkSupabaseClient,
} from '@unit-talk/db';

const PAGE_SIZE = 1_000;
const BOOTSTRAP_RPC = 'bootstrap_canonical_reference_data';
const TEAM_ALIAS_PROVIDER = 'sgo';

type JsonObject = Record<string, unknown>;

interface ParticipantRow {
  id: string;
  participant_type: string;
  sport: string | null;
  league: string | null;
  display_name: string;
  external_id: string | null;
  metadata: JsonObject;
  created_at: string;
}

interface EventRow {
  id: string;
  metadata: JsonObject;
  created_at: string;
}

interface EventParticipantRow {
  event_id: string;
  participant_id: string;
  role: string;
}

interface LeagueRow {
  id: string;
  sport_id: string;
  display_name: string;
  active: boolean;
}

interface SportsbookRow {
  id: string;
  display_name: string;
  active: boolean;
  sort_order: number;
}

interface TeamRow {
  id: string;
  league_id: string;
  display_name: string;
  short_name: string;
  abbreviation: string | null;
  city: string | null;
  active: boolean;
  sort_order: number;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

interface PlayerRow {
  id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  active: boolean;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

interface AliasRow {
  id: string;
  provider: string;
  entity_kind: string;
  provider_entity_key: string;
  provider_entity_id: string | null;
  provider_display_name: string | null;
  participant_id: string | null;
  team_id: string | null;
  player_id: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

interface AssignmentRow {
  id: string;
  player_id: string;
  team_id: string;
  league_id: string;
  effective_from: string;
  effective_until: string | null;
  source: string;
  created_at: string;
}

export interface CanonicalSnapshot {
  source: {
    participants: ParticipantRow[];
    events: EventRow[];
    event_participants: EventParticipantRow[];
  };
  canonical: {
    leagues: LeagueRow[];
    sportsbooks: SportsbookRow[];
    teams: TeamRow[];
    players: PlayerRow[];
    aliases: AliasRow[];
    assignments: AssignmentRow[];
  };
}

interface TeamCandidate {
  id: string;
  league_id: string;
  display_name: string;
  participant_id: string;
  source_external_id: string | null;
}

interface PlayerCandidate {
  id: string;
  league_id: string;
  display_name: string;
  external_id: string | null;
}

interface TeamAliasCandidate {
  provider_entity_key: string;
  participant_id: string;
  team_id: string;
  display_name: string;
  source_event_ids: string[];
}

interface PlayerAliasCandidate {
  provider_entity_key: string;
  participant_id: string;
  player_id: string;
  display_name: string;
}

interface AssignmentCandidate {
  player_id: string;
  team_id: string;
  league_id: string;
  source_participant_id: string;
}

export interface BootstrapConflict {
  code: string;
  identity: string;
  detail: string;
}

interface MutationPlan {
  teams_to_insert: TeamCandidate[];
  players_to_insert: PlayerCandidate[];
  team_aliases_to_insert_or_link: TeamAliasCandidate[];
  player_aliases_to_insert_or_link: PlayerAliasCandidate[];
  assignments_to_insert: AssignmentCandidate[];
  rpc_existing_rows_touched: {
    teams: string[];
    players: string[];
    team_aliases: string[];
    player_aliases: string[];
  };
  total_logical_mutations: number;
}

export interface BootstrapAnalysis {
  source_counts: Record<string, number>;
  canonical_counts: Record<string, number>;
  completeness: {
    leagues: {
      present: number;
      required: number;
      missing: string[];
      coverage_percent: number;
    };
    teams: {
      present: number;
      required: number;
      missing: string[];
      extra_in_governed_leagues: string[];
      coverage_percent: number;
    };
    team_aliases: {
      candidates: number;
      linked: number;
      unresolved: number;
      coverage_percent: number;
    };
    sportsbooks: {
      status: 'governance_conflict';
      runtime_catalog_ids: string[];
      database_rows: Array<{ id: string; active: boolean }>;
      detail: string;
    };
  };
  candidates: {
    teams: TeamCandidate[];
    players: PlayerCandidate[];
    team_aliases: TeamAliasCandidate[];
    player_aliases: PlayerAliasCandidate[];
    assignments: AssignmentCandidate[];
  };
  conflicts: BootstrapConflict[];
  mutation_plan: MutationPlan;
  production_mutation_packet: {
    authorized: false;
    target_project_ref: typeof CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF;
    rpc: typeof BOOTSTRAP_RPC;
    preconditions: string[];
    exact_logical_mutations: MutationPlan;
    rollback: {
      delete_inserted_by_identity: Record<string, string[]>;
      restore_preimages_for_rpc_updates: Record<string, unknown[]>;
      verification: string[];
    };
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function snapshotHash(snapshot: CanonicalSnapshot): string {
  return createHash('sha256').update(stableJson(snapshot)).digest('hex');
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 100;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function governedLeagueMap(): Map<string, string> {
  return new Map(
    V1_REFERENCE_DATA.sports.map((sport) => [
      normalizeCanonicalLeagueId(sport.id) ?? sport.id.toLowerCase(),
      sport.id,
    ]),
  );
}

function governedTeamMap(): Map<
  string,
  { league_id: string; display_name: string }
> {
  const result = new Map<string, { league_id: string; display_name: string }>();
  for (const sport of V1_REFERENCE_DATA.sports) {
    const leagueId = normalizeCanonicalLeagueId(sport.id);
    if (!leagueId) continue;
    for (const displayName of sport.teams) {
      const id = buildCanonicalTeamId(leagueId, displayName);
      result.set(id, { league_id: leagueId, display_name: displayName });
    }
  }
  return result;
}

function pushConflict(
  conflicts: BootstrapConflict[],
  code: string,
  identity: string,
  detail: string,
): void {
  conflicts.push({ code, identity, detail });
}

export function analyzeCanonicalBootstrap(
  snapshot: CanonicalSnapshot,
): BootstrapAnalysis {
  const conflicts: BootstrapConflict[] = [];
  const governedLeagues = governedLeagueMap();
  const governedTeams = governedTeamMap();
  const existingLeagueIds = new Set(
    snapshot.canonical.leagues.map((row) => row.id),
  );
  const participantsById = new Map(
    snapshot.source.participants.map((row) => [row.id, row]),
  );

  const teamCandidateBuckets = new Map<string, TeamCandidate[]>();
  for (const participant of snapshot.source.participants) {
    if (participant.participant_type !== 'team') continue;
    const leagueId = normalizeCanonicalLeagueId(
      participant.league ?? participant.sport,
    );
    if (!leagueId) {
      pushConflict(
        conflicts,
        'TEAM_WITHOUT_LEAGUE',
        participant.id,
        'team participant has no league or sport',
      );
      continue;
    }
    const id = buildCanonicalTeamId(leagueId, participant.display_name);
    const governed = governedTeams.get(id);
    if (!governed) {
      pushConflict(
        conflicts,
        'UNGOVERNED_TEAM_IDENTITY',
        participant.id,
        `source would derive ${id}, which is absent from the governed V1 team set`,
      );
      continue;
    }
    const candidate: TeamCandidate = {
      id,
      league_id: leagueId,
      display_name: governed.display_name,
      participant_id: participant.id,
      source_external_id: participant.external_id,
    };
    const bucket = teamCandidateBuckets.get(id) ?? [];
    bucket.push(candidate);
    teamCandidateBuckets.set(id, bucket);
  }

  const teams: TeamCandidate[] = [];
  for (const [id, bucket] of teamCandidateBuckets) {
    if (bucket.length !== 1) {
      pushConflict(
        conflicts,
        'DUPLICATE_CANONICAL_TEAM_IDENTITY',
        id,
        `participants ${bucket
          .map((row) => row.participant_id)
          .sort()
          .join(', ')} derive the same canonical team`,
      );
      continue;
    }
    teams.push(bucket[0]);
  }
  teams.sort((left, right) => left.id.localeCompare(right.id));
  const teamByParticipantId = new Map(
    teams.map((row) => [row.participant_id, row]),
  );

  const players: PlayerCandidate[] = snapshot.source.participants
    .filter((row) => row.participant_type === 'player')
    .flatMap((participant) => {
      const leagueId = normalizeCanonicalLeagueId(
        participant.league ?? participant.sport,
      );
      if (!leagueId || !existingLeagueIds.has(leagueId)) {
        pushConflict(
          conflicts,
          'PLAYER_WITHOUT_CANONICAL_LEAGUE',
          participant.id,
          `player source league ${leagueId ?? '<missing>'} is not present in leagues`,
        );
        return [];
      }
      return [
        {
          id: participant.id,
          league_id: leagueId,
          display_name: participant.display_name,
          external_id: participant.external_id,
        },
      ];
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const playerAliasBuckets = new Map<string, PlayerAliasCandidate[]>();
  for (const player of players) {
    if (!player.external_id) continue;
    const candidate: PlayerAliasCandidate = {
      provider_entity_key: player.external_id,
      participant_id: player.id,
      player_id: player.id,
      display_name: player.display_name,
    };
    const bucket = playerAliasBuckets.get(player.external_id) ?? [];
    bucket.push(candidate);
    playerAliasBuckets.set(player.external_id, bucket);
  }
  const playerAliases: PlayerAliasCandidate[] = [];
  for (const [key, bucket] of playerAliasBuckets) {
    const identities = new Set(bucket.map((row) => row.player_id));
    if (identities.size !== 1) {
      pushConflict(
        conflicts,
        'AMBIGUOUS_PLAYER_ALIAS',
        key,
        `provider key maps to player ids ${[...identities].sort().join(', ')}`,
      );
      continue;
    }
    playerAliases.push(bucket[0]);
  }
  playerAliases.sort((left, right) =>
    left.provider_entity_key.localeCompare(right.provider_entity_key),
  );

  const eventsById = new Map(
    snapshot.source.events.map((row) => [row.id, row]),
  );
  const teamAliasBuckets = new Map<string, TeamAliasCandidate[]>();
  for (const link of snapshot.source.event_participants) {
    if (link.role !== 'home' && link.role !== 'away') continue;
    const event = eventsById.get(link.event_id);
    if (!event) {
      pushConflict(
        conflicts,
        'EVENT_PARTICIPANT_WITHOUT_EVENT',
        `${link.event_id}:${link.participant_id}`,
        'event row is missing',
      );
      continue;
    }
    const metadataKey =
      link.role === 'home' ? 'home_team_external_id' : 'away_team_external_id';
    const providerKey = readString(event.metadata[metadataKey]);
    if (!providerKey) continue;
    const team = teamByParticipantId.get(link.participant_id);
    if (!team) {
      const participant = participantsById.get(link.participant_id);
      pushConflict(
        conflicts,
        'TEAM_ALIAS_WITHOUT_GOVERNED_TEAM',
        providerKey,
        `event ${event.id} points to participant ${participant?.id ?? link.participant_id}, which has no unique governed team candidate`,
      );
      continue;
    }
    const candidate: TeamAliasCandidate = {
      provider_entity_key: providerKey,
      participant_id: team.participant_id,
      team_id: team.id,
      display_name: team.display_name,
      source_event_ids: [event.id],
    };
    const bucket = teamAliasBuckets.get(providerKey) ?? [];
    bucket.push(candidate);
    teamAliasBuckets.set(providerKey, bucket);
  }

  const teamAliases: TeamAliasCandidate[] = [];
  for (const [key, bucket] of teamAliasBuckets) {
    const teamIds = new Set(bucket.map((row) => row.team_id));
    const participantIds = new Set(bucket.map((row) => row.participant_id));
    if (teamIds.size !== 1 || participantIds.size !== 1) {
      pushConflict(
        conflicts,
        'AMBIGUOUS_TEAM_ALIAS',
        key,
        `provider key maps to teams ${[...teamIds].sort().join(', ')} through participants ${[...participantIds].sort().join(', ')}`,
      );
      continue;
    }
    const selected = bucket[0];
    selected.source_event_ids = [
      ...new Set(bucket.flatMap((row) => row.source_event_ids)),
    ].sort();
    teamAliases.push(selected);
  }
  teamAliases.sort((left, right) =>
    left.provider_entity_key.localeCompare(right.provider_entity_key),
  );
  const teamAliasByKey = new Map(
    teamAliases.map((row) => [row.provider_entity_key, row]),
  );

  const assignments: AssignmentCandidate[] = [];
  for (const player of players) {
    const participant = participantsById.get(player.id);
    const teamKey = readString(participant?.metadata['team_external_id']);
    if (!teamKey) continue;
    const teamAlias = teamAliasByKey.get(teamKey);
    if (!teamAlias) {
      pushConflict(
        conflicts,
        'UNRESOLVED_ASSIGNMENT_TEAM_ALIAS',
        player.id,
        `team_external_id ${teamKey} has no unambiguous governed team alias`,
      );
      continue;
    }
    assignments.push({
      player_id: player.id,
      team_id: teamAlias.team_id,
      league_id: player.league_id,
      source_participant_id: player.id,
    });
  }
  assignments.sort((left, right) =>
    `${left.player_id}:${left.team_id}`.localeCompare(
      `${right.player_id}:${right.team_id}`,
    ),
  );

  const existingTeams = new Map(
    snapshot.canonical.teams.map((row) => [row.id, row]),
  );
  const existingPlayers = new Map(
    snapshot.canonical.players.map((row) => [row.id, row]),
  );
  const existingAliases = new Map(
    snapshot.canonical.aliases.map((row) => [
      `${row.provider}:${row.entity_kind}:${row.provider_entity_key}`,
      row,
    ]),
  );

  for (const team of teams) {
    const existing = existingTeams.get(team.id);
    if (
      existing &&
      (existing.league_id !== team.league_id ||
        existing.display_name !== team.display_name ||
        existing.short_name !== team.display_name)
    ) {
      pushConflict(
        conflicts,
        'CONFLICTING_EXISTING_TEAM',
        team.id,
        `existing (${existing.league_id}, ${existing.display_name}, ${existing.short_name}) differs from source (${team.league_id}, ${team.display_name})`,
      );
    }
  }

  for (const player of players) {
    const existing = existingPlayers.get(player.id);
    if (existing && existing.display_name !== player.display_name) {
      pushConflict(
        conflicts,
        'CONFLICTING_EXISTING_PLAYER',
        player.id,
        `existing display_name ${existing.display_name} differs from source ${player.display_name}`,
      );
    }
  }

  for (const alias of teamAliases) {
    const key = `${TEAM_ALIAS_PROVIDER}:team:${alias.provider_entity_key}`;
    const existing = existingAliases.get(key);
    if (
      existing &&
      ((existing.participant_id !== null &&
        existing.participant_id !== alias.participant_id) ||
        (existing.team_id !== null && existing.team_id !== alias.team_id) ||
        existing.player_id !== null)
    ) {
      pushConflict(
        conflicts,
        'CONFLICTING_EXISTING_TEAM_ALIAS',
        alias.provider_entity_key,
        `existing alias points to participant=${existing.participant_id ?? '<null>'}, team=${existing.team_id ?? '<null>'}, player=${existing.player_id ?? '<null>'}`,
      );
    }
  }

  for (const alias of playerAliases) {
    const key = `${TEAM_ALIAS_PROVIDER}:player:${alias.provider_entity_key}`;
    const existing = existingAliases.get(key);
    if (
      existing &&
      ((existing.participant_id !== null &&
        existing.participant_id !== alias.participant_id) ||
        (existing.player_id !== null &&
          existing.player_id !== alias.player_id) ||
        existing.team_id !== null)
    ) {
      pushConflict(
        conflicts,
        'CONFLICTING_EXISTING_PLAYER_ALIAS',
        alias.provider_entity_key,
        `existing alias points to participant=${existing.participant_id ?? '<null>'}, player=${existing.player_id ?? '<null>'}, team=${existing.team_id ?? '<null>'}`,
      );
    }
  }

  const currentAssignmentsByPlayer = new Map<string, AssignmentRow[]>();
  for (const row of snapshot.canonical.assignments.filter(
    (assignment) => assignment.effective_until === null,
  )) {
    const bucket = currentAssignmentsByPlayer.get(row.player_id) ?? [];
    bucket.push(row);
    currentAssignmentsByPlayer.set(row.player_id, bucket);
  }
  for (const candidate of assignments) {
    const current = currentAssignmentsByPlayer.get(candidate.player_id) ?? [];
    const otherTeams = current.filter(
      (row) => row.team_id !== candidate.team_id,
    );
    if (otherTeams.length > 0 || current.length > 1) {
      pushConflict(
        conflicts,
        'CONFLICTING_CURRENT_PLAYER_ASSIGNMENT',
        candidate.player_id,
        `current assignments are ${current
          .map((row) => `${row.id}:${row.team_id}`)
          .sort()
          .join(', ')}`,
      );
    }
  }

  const teamAliasesToLink = teamAliases.filter((alias) => {
    const existing = existingAliases.get(
      `${TEAM_ALIAS_PROVIDER}:team:${alias.provider_entity_key}`,
    );
    return (
      !existing ||
      existing.participant_id !== alias.participant_id ||
      existing.team_id !== alias.team_id
    );
  });
  const playerAliasesToLink = playerAliases.filter((alias) => {
    const existing = existingAliases.get(
      `${TEAM_ALIAS_PROVIDER}:player:${alias.provider_entity_key}`,
    );
    return (
      !existing ||
      existing.participant_id !== alias.participant_id ||
      existing.player_id !== alias.player_id
    );
  });
  const assignmentsToInsert = assignments.filter(
    (candidate) =>
      !(currentAssignmentsByPlayer.get(candidate.player_id) ?? []).some(
        (row) => row.team_id === candidate.team_id,
      ),
  );

  const mutationPlan: MutationPlan = {
    teams_to_insert: teams.filter((row) => !existingTeams.has(row.id)),
    players_to_insert: players.filter((row) => !existingPlayers.has(row.id)),
    team_aliases_to_insert_or_link: teamAliasesToLink,
    player_aliases_to_insert_or_link: playerAliasesToLink,
    assignments_to_insert: assignmentsToInsert,
    rpc_existing_rows_touched: {
      teams: teams
        .filter((row) => existingTeams.has(row.id))
        .map((row) => row.id),
      players: players
        .filter((row) => existingPlayers.has(row.id))
        .map((row) => row.id),
      team_aliases: teamAliases
        .filter((row) =>
          existingAliases.has(
            `${TEAM_ALIAS_PROVIDER}:team:${row.provider_entity_key}`,
          ),
        )
        .map((row) => row.provider_entity_key),
      player_aliases: playerAliases
        .filter((row) =>
          existingAliases.has(
            `${TEAM_ALIAS_PROVIDER}:player:${row.provider_entity_key}`,
          ),
        )
        .map((row) => row.provider_entity_key),
    },
    total_logical_mutations: 0,
  };
  mutationPlan.total_logical_mutations =
    mutationPlan.teams_to_insert.length +
    mutationPlan.players_to_insert.length +
    mutationPlan.team_aliases_to_insert_or_link.length +
    mutationPlan.player_aliases_to_insert_or_link.length +
    mutationPlan.assignments_to_insert.length;

  const requiredLeagueIds = [...governedLeagues.keys()].sort();
  const presentLeagueIds = new Set(
    snapshot.canonical.leagues.map((row) => row.id),
  );
  const missingLeagues = requiredLeagueIds.filter(
    (id) => !presentLeagueIds.has(id),
  );
  for (const row of snapshot.canonical.leagues) {
    const expectedSportId = governedLeagues.get(row.id);
    if (expectedSportId && row.sport_id !== expectedSportId) {
      pushConflict(
        conflicts,
        'CONFLICTING_LEAGUE_SPORT_MAPPING',
        row.id,
        `expected sport_id ${expectedSportId}, found ${row.sport_id}`,
      );
    }
  }

  const requiredTeamIds = [...governedTeams.keys()].sort();
  const existingTeamIds = new Set(
    snapshot.canonical.teams.map((row) => row.id),
  );
  const presentTeams = requiredTeamIds.filter((id) => existingTeamIds.has(id));
  const missingTeams = requiredTeamIds.filter((id) => !existingTeamIds.has(id));
  const governedLeagueIds = new Set(
    requiredTeamIds.map((id) => id.split(':', 1)[0]),
  );
  const extraTeams = snapshot.canonical.teams
    .filter(
      (row) =>
        governedLeagueIds.has(row.league_id) && !governedTeams.has(row.id),
    )
    .map((row) => row.id)
    .sort();
  for (const id of extraTeams) {
    pushConflict(
      conflicts,
      'EXTRA_TEAM_IN_GOVERNED_LEAGUE',
      id,
      'canonical row is absent from the governed V1 team set',
    );
  }

  const linkedTeamAliases = teamAliases.filter((alias) => {
    const existing = existingAliases.get(
      `${TEAM_ALIAS_PROVIDER}:team:${alias.provider_entity_key}`,
    );
    return (
      existing?.participant_id === alias.participant_id &&
      existing.team_id === alias.team_id
    );
  }).length;

  conflicts.sort((left, right) =>
    `${left.code}:${left.identity}`.localeCompare(
      `${right.code}:${right.identity}`,
    ),
  );

  const touchedTeamRows = snapshot.canonical.teams.filter((row) =>
    teams.some((candidate) => candidate.id === row.id),
  );
  const touchedPlayerRows = snapshot.canonical.players.filter((row) =>
    players.some((candidate) => candidate.id === row.id),
  );
  const touchedTeamAliases = snapshot.canonical.aliases.filter(
    (row) =>
      row.provider === TEAM_ALIAS_PROVIDER &&
      row.entity_kind === 'team' &&
      teamAliases.some(
        (candidate) =>
          candidate.provider_entity_key === row.provider_entity_key,
      ),
  );
  const touchedPlayerAliases = snapshot.canonical.aliases.filter(
    (row) =>
      row.provider === TEAM_ALIAS_PROVIDER &&
      row.entity_kind === 'player' &&
      playerAliases.some(
        (candidate) =>
          candidate.provider_entity_key === row.provider_entity_key,
      ),
  );

  return {
    source_counts: {
      participants: snapshot.source.participants.length,
      team_participants: snapshot.source.participants.filter(
        (row) => row.participant_type === 'team',
      ).length,
      player_participants: snapshot.source.participants.filter(
        (row) => row.participant_type === 'player',
      ).length,
      events: snapshot.source.events.length,
      event_participants: snapshot.source.event_participants.length,
    },
    canonical_counts: {
      leagues: snapshot.canonical.leagues.length,
      sportsbooks: snapshot.canonical.sportsbooks.length,
      teams: snapshot.canonical.teams.length,
      players: snapshot.canonical.players.length,
      provider_entity_aliases: snapshot.canonical.aliases.length,
      player_team_assignments: snapshot.canonical.assignments.length,
    },
    completeness: {
      leagues: {
        present: requiredLeagueIds.length - missingLeagues.length,
        required: requiredLeagueIds.length,
        missing: missingLeagues,
        coverage_percent: percent(
          requiredLeagueIds.length - missingLeagues.length,
          requiredLeagueIds.length,
        ),
      },
      teams: {
        present: presentTeams.length,
        required: requiredTeamIds.length,
        missing: missingTeams,
        extra_in_governed_leagues: extraTeams,
        coverage_percent: percent(presentTeams.length, requiredTeamIds.length),
      },
      team_aliases: {
        candidates: teamAliases.length,
        linked: linkedTeamAliases,
        unresolved: teamAliases.length - linkedTeamAliases,
        coverage_percent: percent(linkedTeamAliases, teamAliases.length),
      },
      sportsbooks: {
        status: 'governance_conflict',
        runtime_catalog_ids: V1_REFERENCE_DATA.sportsbooks
          .map((row) => row.id)
          .sort(),
        database_rows: snapshot.canonical.sportsbooks
          .map((row) => ({ id: row.id, active: row.active }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        detail:
          'Ratified policy says 15 active books; current runtime catalog names 10; schema history seeded 11 and later deactivated provider labels. No target is guessed.',
      },
    },
    candidates: {
      teams,
      players,
      team_aliases: teamAliases,
      player_aliases: playerAliases,
      assignments,
    },
    conflicts,
    mutation_plan: mutationPlan,
    production_mutation_packet: {
      authorized: false,
      target_project_ref: CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
      rpc: BOOTSTRAP_RPC,
      preconditions: [
        'PM approves this exact packet after reviewing the fresh production source fingerprint and all conflicts/gaps.',
        'conflicts is empty; no ambiguous alias, duplicate canonical identity, or conflicting current assignment exists.',
        'A same-source non-production prove-staging run passes and its second pass has rpc_invoked=false and identical before/after hashes.',
        'The live command is separately authorized; this UTV2-1773 lane never executes it.',
      ],
      exact_logical_mutations: mutationPlan,
      rollback: {
        delete_inserted_by_identity: {
          teams: mutationPlan.teams_to_insert.map((row) => row.id),
          players: mutationPlan.players_to_insert.map((row) => row.id),
          team_aliases: mutationPlan.team_aliases_to_insert_or_link.map(
            (row) => row.provider_entity_key,
          ),
          player_aliases: mutationPlan.player_aliases_to_insert_or_link.map(
            (row) => row.provider_entity_key,
          ),
          assignments: mutationPlan.assignments_to_insert.map(
            (row) => `${row.player_id}:${row.team_id}`,
          ),
        },
        restore_preimages_for_rpc_updates: {
          teams: touchedTeamRows,
          players: touchedPlayerRows,
          team_aliases: touchedTeamAliases,
          player_aliases: touchedPlayerAliases,
        },
        verification: [
          'Capture a fresh full canonical snapshot immediately before the authorized transaction and verify its SHA-256 matches this packet.',
          'On rollback, delete only packet-listed inserts by canonical/natural identity and restore every listed preimage exactly.',
          'Re-read all six canonical tables and require the stable snapshot hash to equal the pre-bootstrap hash.',
          'Re-run event/team resolution coverage against the same source fingerprint; do not restart ingestion or delivery as part of rollback.',
        ],
      },
    },
  };
}

async function readAllRows<T>(
  client: UnitTalkSupabaseClient,
  table: string,
  columns: string,
  orderColumns: string[],
): Promise<T[]> {
  const rows: T[] = [];
  let expectedCount: number | null = null;
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client.from(table).select(columns, { count: 'exact' });
    for (const column of orderColumns)
      query = query.order(column, { ascending: true });
    const result = await query.range(from, from + PAGE_SIZE - 1);
    if (result.error)
      throw new Error(`Failed to read ${table}: ${result.error.message}`);
    if (result.count === null)
      throw new Error(`Failed closed: ${table} returned no exact count`);
    if (expectedCount === null) expectedCount = result.count;
    if (result.count !== expectedCount) {
      throw new Error(
        `Failed closed: ${table} changed while it was being paged (${expectedCount} -> ${result.count})`,
      );
    }
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (rows.length >= expectedCount) break;
    if (page.length === 0)
      throw new Error(
        `Failed closed: ${table} pagination ended at ${rows.length}/${expectedCount}`,
      );
  }
  if (rows.length !== expectedCount) {
    throw new Error(
      `Failed closed: ${table} read ${rows.length} rows but exact count was ${expectedCount}`,
    );
  }
  return rows;
}

async function loadSnapshot(
  client: UnitTalkSupabaseClient,
): Promise<CanonicalSnapshot> {
  const [
    participants,
    events,
    eventParticipants,
    leagues,
    sportsbooks,
    teams,
    players,
    aliases,
    assignments,
  ] = await Promise.all([
    readAllRows<ParticipantRow>(
      client,
      'participants',
      'id,participant_type,sport,league,display_name,external_id,metadata,created_at',
      ['id'],
    ),
    readAllRows<EventRow>(client, 'events', 'id,metadata,created_at', ['id']),
    readAllRows<EventParticipantRow>(
      client,
      'event_participants',
      'event_id,participant_id,role',
      ['event_id', 'participant_id', 'role'],
    ),
    readAllRows<LeagueRow>(
      client,
      'leagues',
      'id,sport_id,display_name,active',
      ['id'],
    ),
    readAllRows<SportsbookRow>(
      client,
      'sportsbooks',
      'id,display_name,active,sort_order',
      ['id'],
    ),
    readAllRows<TeamRow>(
      client,
      'teams',
      'id,league_id,display_name,short_name,abbreviation,city,active,sort_order,metadata,created_at,updated_at',
      ['id'],
    ),
    readAllRows<PlayerRow>(
      client,
      'players',
      'id,display_name,first_name,last_name,active,metadata,created_at,updated_at',
      ['id'],
    ),
    readAllRows<AliasRow>(
      client,
      'provider_entity_aliases',
      'id,provider,entity_kind,provider_entity_key,provider_entity_id,provider_display_name,participant_id,team_id,player_id,metadata,created_at,updated_at',
      ['provider', 'entity_kind', 'provider_entity_key'],
    ),
    readAllRows<AssignmentRow>(
      client,
      'player_team_assignments',
      'id,player_id,team_id,league_id,effective_from,effective_until,source,created_at',
      ['player_id', 'team_id', 'id'],
    ),
  ]);
  return {
    source: { participants, events, event_participants: eventParticipants },
    canonical: { leagues, sportsbooks, teams, players, aliases, assignments },
  };
}

function assertNoConflicts(analysis: BootstrapAnalysis, phase: string): void {
  if (analysis.conflicts.length === 0) return;
  const preview = analysis.conflicts
    .slice(0, 20)
    .map((row) => `${row.code}:${row.identity}`)
    .join(', ');
  throw new Error(
    `Failed closed during ${phase}: ${analysis.conflicts.length} conflict(s): ${preview}`,
  );
}

async function executeStagingPass(
  client: UnitTalkSupabaseClient,
  phase: string,
) {
  const before = await loadSnapshot(client);
  const analysis = analyzeCanonicalBootstrap(before);
  assertNoConflicts(analysis, phase);
  let rpcInvoked = false;
  if (analysis.mutation_plan.total_logical_mutations > 0) {
    const { error } = await client.rpc(BOOTSTRAP_RPC);
    if (error)
      throw new Error(
        `Failed to run canonical reference bootstrap: ${error.message}`,
      );
    rpcInvoked = true;
  }
  const after = await loadSnapshot(client);
  return {
    phase,
    rpc_invoked: rpcInvoked,
    logical_mutations_planned: analysis.mutation_plan.total_logical_mutations,
    before_hash: snapshotHash(before),
    after_hash: snapshotHash(after),
    before_analysis: analysis,
    after_analysis: analyzeCanonicalBootstrap(after),
    after_snapshot: after,
  };
}

function parseCli(argv: string[]): {
  command: string;
  target: string | null;
  output: string | null;
} {
  const command = argv[0] ?? 'inspect';
  let target: string | null = null;
  let output: string | null = null;
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--target' || flag === '--output') {
      if (!value || value.startsWith('--'))
        throw new Error(`${flag} requires a value`);
      if (flag === '--target') target = value;
      else output = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${flag}`);
  }
  return { command, target, output };
}

function assertDeclaredTarget(
  command: string,
  declaredTarget: string | null,
  connectionUrl: string,
): string {
  const { projectRef, host } = extractProjectRefFromUrl(connectionUrl);
  if (command === 'prove-staging') {
    if (declaredTarget !== 'staging')
      throw new Error('prove-staging requires --target staging');
    if (projectRef !== EXPECTED_STAGING_SUPABASE_PROJECT_REF) {
      throw new Error(
        `REFUSED: writable target is ${projectRef ?? 'unidentified'} (host=${host ?? 'unparseable'}), expected staging ${EXPECTED_STAGING_SUPABASE_PROJECT_REF}`,
      );
    }
    return projectRef;
  }
  if (command !== 'inspect')
    throw new Error('Command must be inspect, prove-staging, or self-test');
  if (
    declaredTarget === 'production' &&
    projectRef === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF
  )
    return projectRef;
  if (
    declaredTarget === 'staging' &&
    projectRef === EXPECTED_STAGING_SUPABASE_PROJECT_REF
  )
    return projectRef;
  throw new Error(
    `REFUSED: inspect requires an exact --target production|staging match; declared=${declaredTarget ?? '<missing>'}, observed=${projectRef ?? 'unidentified'} (host=${host ?? 'unparseable'})`,
  );
}

async function emitReport(
  report: unknown,
  output: string | null,
): Promise<void> {
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    const resolved = path.resolve(output);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, rendered, 'utf8');
    console.log(JSON.stringify({ ok: true, output: resolved }));
    return;
  }
  process.stdout.write(rendered);
}

function minimalSnapshot(): CanonicalSnapshot {
  const hawksParticipant: ParticipantRow = {
    id: '00000000-0000-4000-8000-000000000001',
    participant_type: 'team',
    sport: 'NBA',
    league: null,
    display_name: 'Hawks',
    external_id: 'team:NBA:Hawks',
    metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
  };
  const player: ParticipantRow = {
    id: '00000000-0000-4000-8000-000000000002',
    participant_type: 'player',
    sport: 'NBA',
    league: null,
    display_name: 'Proof Player',
    external_id: 'proof-player',
    metadata: { team_external_id: 'proof-hawks' },
    created_at: '2026-01-01T00:00:00.000Z',
  };
  return {
    source: {
      participants: [hawksParticipant, player],
      events: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          metadata: { home_team_external_id: 'proof-hawks' },
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      event_participants: [
        {
          event_id: '00000000-0000-4000-8000-000000000003',
          participant_id: hawksParticipant.id,
          role: 'home',
        },
      ],
    },
    canonical: {
      leagues: V1_REFERENCE_DATA.sports.map((sport) => ({
        id: sport.id.toLowerCase(),
        sport_id: sport.id,
        display_name: sport.name,
        active: true,
      })),
      sportsbooks: V1_REFERENCE_DATA.sportsbooks.map((book, index) => ({
        id: book.id,
        display_name: book.name,
        active: true,
        sort_order: index,
      })),
      teams: [],
      players: [],
      aliases: [],
      assignments: [],
    },
  };
}

function runSelfTest(): void {
  const snapshot = minimalSnapshot();
  const first = analyzeCanonicalBootstrap(snapshot);
  assert.equal(first.conflicts.length, 0);
  assert.equal(first.mutation_plan.teams_to_insert.length, 1);
  assert.equal(first.mutation_plan.players_to_insert.length, 1);
  assert.equal(first.mutation_plan.team_aliases_to_insert_or_link.length, 1);
  assert.equal(first.mutation_plan.player_aliases_to_insert_or_link.length, 1);
  assert.equal(first.mutation_plan.assignments_to_insert.length, 1);

  const hawks = first.candidates.teams[0];
  const player = first.candidates.players[0];
  assert.ok(hawks && player);
  snapshot.canonical.teams.push({
    id: hawks.id,
    league_id: hawks.league_id,
    display_name: hawks.display_name,
    short_name: hawks.display_name,
    abbreviation: null,
    city: null,
    active: true,
    sort_order: 0,
    metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });
  snapshot.canonical.players.push({
    id: player.id,
    display_name: player.display_name,
    first_name: 'Proof',
    last_name: 'Player',
    active: true,
    metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });
  snapshot.canonical.aliases.push(
    {
      id: '00000000-0000-4000-8000-000000000004',
      provider: 'sgo',
      entity_kind: 'team',
      provider_entity_key: 'proof-hawks',
      provider_entity_id: 'proof-hawks',
      provider_display_name: 'Hawks',
      participant_id: hawks.participant_id,
      team_id: hawks.id,
      player_id: null,
      metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000005',
      provider: 'sgo',
      entity_kind: 'player',
      provider_entity_key: 'proof-player',
      provider_entity_id: 'proof-player',
      provider_display_name: 'Proof Player',
      participant_id: player.id,
      team_id: null,
      player_id: player.id,
      metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  );
  snapshot.canonical.assignments.push({
    id: '00000000-0000-4000-8000-000000000006',
    player_id: player.id,
    team_id: hawks.id,
    league_id: hawks.league_id,
    effective_from: '2026-01-01',
    effective_until: null,
    source: 'bootstrap:sgo-participants',
    created_at: '2026-01-01T00:00:00.000Z',
  });
  const second = analyzeCanonicalBootstrap(snapshot);
  assert.equal(second.conflicts.length, 0);
  assert.equal(
    second.mutation_plan.total_logical_mutations,
    0,
    'second pass must be a logical no-op',
  );

  const celtics = snapshot.source.participants[0];
  assert.ok(celtics);
  snapshot.source.participants.push({
    ...celtics,
    id: '00000000-0000-4000-8000-000000000007',
    display_name: 'Celtics',
  });
  snapshot.source.events.push({
    id: '00000000-0000-4000-8000-000000000008',
    metadata: { away_team_external_id: 'proof-hawks' },
    created_at: '2026-01-02T00:00:00.000Z',
  });
  snapshot.source.event_participants.push({
    event_id: '00000000-0000-4000-8000-000000000008',
    participant_id: '00000000-0000-4000-8000-000000000007',
    role: 'away',
  });
  const ambiguous = analyzeCanonicalBootstrap(snapshot);
  assert.ok(
    ambiguous.conflicts.some((row) => row.code === 'AMBIGUOUS_TEAM_ALIAS'),
  );
  console.log(
    JSON.stringify({
      ok: true,
      tests: 3,
      assertions: [
        'candidate derivation',
        'second-pass no-op',
        'ambiguous alias refusal',
      ],
    }),
  );
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.command === 'self-test') {
    runSelfTest();
    return;
  }
  if (cli.command === 'prove-staging')
    process.env['UNIT_TALK_DB_TARGET_POLICY'] = 'staging-only';
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const projectRef = assertDeclaredTarget(
    cli.command,
    cli.target,
    connection.url,
  );
  const client = createDatabaseClientFromConnection(connection);

  if (cli.command === 'inspect') {
    const snapshot = await loadSnapshot(client);
    const analysis = analyzeCanonicalBootstrap(snapshot);
    await emitReport(
      {
        schema_version: 1,
        issue_id: 'UTV2-1773',
        mode: 'read-only-inspect',
        target_project_ref: projectRef,
        generated_at: new Date().toISOString(),
        source_snapshot_sha256: snapshotHash(snapshot),
        writes_performed: 0,
        analysis,
      },
      cli.output,
    );
    return;
  }

  const first = await executeStagingPass(client, 'first execution');
  assertNoConflicts(first.after_analysis, 'post-first verification');
  if (first.after_analysis.mutation_plan.total_logical_mutations !== 0) {
    throw new Error(
      `Failed closed: first execution left ${first.after_analysis.mutation_plan.total_logical_mutations} logical mutation(s) unapplied`,
    );
  }
  const secondBeforeHash = snapshotHash(first.after_snapshot);
  const second = await executeStagingPass(client, 'second execution');
  assertNoConflicts(second.after_analysis, 'post-second verification');
  if (second.rpc_invoked)
    throw new Error(
      'Failed closed: second execution invoked the RPC instead of remaining a no-op',
    );
  if (
    second.before_hash !== second.after_hash ||
    second.before_hash !== secondBeforeHash
  ) {
    throw new Error(
      `Failed closed: second execution mutated canonical state (${second.before_hash} -> ${second.after_hash})`,
    );
  }
  await emitReport(
    {
      schema_version: 1,
      issue_id: 'UTV2-1773',
      mode: 'non-production-idempotency-proof',
      target_project_ref: projectRef,
      generated_at: new Date().toISOString(),
      production_writes_performed: 0,
      first_execution: {
        rpc_invoked: first.rpc_invoked,
        logical_mutations_planned: first.logical_mutations_planned,
        before_hash: first.before_hash,
        after_hash: first.after_hash,
        after_analysis: first.after_analysis,
      },
      second_execution: {
        rpc_invoked: second.rpc_invoked,
        logical_mutations_planned: second.logical_mutations_planned,
        before_hash: second.before_hash,
        after_hash: second.after_hash,
        byte_stable: second.before_hash === second.after_hash,
        after_analysis: second.after_analysis,
      },
    },
    cli.output,
  );
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Failed to run canonical reference bootstrap',
    );
    process.exitCode = 1;
  });
}
