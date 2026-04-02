export interface BootstrapParticipantSource {
  id: string;
  participantType: 'team' | 'player' | 'league' | 'event' | string;
  sport: string | null;
  league: string | null;
  displayName: string;
  externalId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BootstrapEventSource {
  id: string;
  metadata: Record<string, unknown>;
}

export interface BootstrapEventParticipantSource {
  eventId: string;
  participantId: string;
  role: string;
}

export interface CanonicalBootstrapSummaryRow {
  leagueId: string;
  sportId: string;
  teams: number;
  players: number;
  assignedPlayers: number;
  unassignedPlayers: number;
}

export interface CanonicalBootstrapSummary {
  totalTeams: number;
  totalPlayers: number;
  totalAssignedPlayers: number;
  totalUnassignedPlayers: number;
  teamAliasCount: number;
  playerAliasCount: number;
  unresolvedTeamAliasCount: number;
  byLeague: CanonicalBootstrapSummaryRow[];
}

export interface CanonicalBootstrapInputs {
  participants: BootstrapParticipantSource[];
  events: BootstrapEventSource[];
  eventParticipants: BootstrapEventParticipantSource[];
  expectedLeagueIds?: string[];
}

export function normalizeCanonicalLeagueId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function slugifyCanonicalSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildCanonicalTeamId(leagueId: string, displayName: string) {
  return `${normalizeCanonicalLeagueId(leagueId)}:${slugifyCanonicalSegment(displayName)}`;
}

export function splitDisplayName(displayName: string) {
  const cleaned = displayName.trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0) {
    return { firstName: null, lastName: null };
  }

  const segments = cleaned.split(' ');
  if (segments.length === 1) {
    return { firstName: cleaned, lastName: null };
  }

  return {
    firstName: segments[0] ?? null,
    lastName: segments.slice(1).join(' ') || null,
  };
}

export function summarizeCanonicalBootstrapSource(
  input: CanonicalBootstrapInputs,
): CanonicalBootstrapSummary {
  const teams = input.participants.filter(
    (participant) =>
      participant.participantType === 'team' &&
      normalizeCanonicalLeagueId(participant.league ?? participant.sport) !== null,
  );
  const players = input.participants.filter(
    (participant) =>
      participant.participantType === 'player' &&
      normalizeCanonicalLeagueId(participant.league ?? participant.sport) !== null,
  );

  const teamAliasMap = buildTeamAliasMap(input.events, input.eventParticipants, teams);
  const leagueRows = new Map<string, CanonicalBootstrapSummaryRow>();
  const assignedPlayerIds = new Set<string>();
  const unresolvedTeamKeys = new Set<string>();

  for (const team of teams) {
    const leagueId = normalizeCanonicalLeagueId(team.league ?? team.sport);
    if (!leagueId) {
      continue;
    }

    const row = getOrCreateLeagueRow(leagueRows, leagueId, team.sport ?? team.league ?? leagueId);
    row.teams += 1;
  }

  for (const player of players) {
    const leagueId = normalizeCanonicalLeagueId(player.league ?? player.sport);
    if (!leagueId) {
      continue;
    }

    const row = getOrCreateLeagueRow(leagueRows, leagueId, player.sport ?? player.league ?? leagueId);
    row.players += 1;

    const teamExternalId = readString(player.metadata.team_external_id);
    if (!teamExternalId) {
      row.unassignedPlayers += 1;
      continue;
    }

    if (teamAliasMap.has(teamExternalId)) {
      assignedPlayerIds.add(player.id);
      row.assignedPlayers += 1;
      continue;
    }

    unresolvedTeamKeys.add(teamExternalId);
    row.unassignedPlayers += 1;
  }

  for (const expectedLeagueId of input.expectedLeagueIds ?? []) {
    const normalized = normalizeCanonicalLeagueId(expectedLeagueId);
    if (!normalized || leagueRows.has(normalized)) {
      continue;
    }
    leagueRows.set(normalized, {
      leagueId: normalized,
      sportId: expectedLeagueId.toUpperCase(),
      teams: 0,
      players: 0,
      assignedPlayers: 0,
      unassignedPlayers: 0,
    });
  }

  const byLeague = Array.from(leagueRows.values()).sort((left, right) =>
    left.leagueId.localeCompare(right.leagueId),
  );

  return {
    totalTeams: teams.length,
    totalPlayers: players.length,
    totalAssignedPlayers: assignedPlayerIds.size,
    totalUnassignedPlayers: players.length - assignedPlayerIds.size,
    teamAliasCount: teamAliasMap.size,
    playerAliasCount: players.filter((player) => Boolean(player.externalId)).length,
    unresolvedTeamAliasCount: unresolvedTeamKeys.size,
    byLeague,
  };
}

function buildTeamAliasMap(
  events: BootstrapEventSource[],
  eventParticipants: BootstrapEventParticipantSource[],
  teams: BootstrapParticipantSource[],
) {
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const aliasMap = new Map<string, string>();

  for (const row of eventParticipants) {
    if (row.role !== 'home' && row.role !== 'away') {
      continue;
    }

    const event = eventMap.get(row.eventId);
    const team = teamMap.get(row.participantId);
    if (!event || !team) {
      continue;
    }

    const metadataKey = row.role === 'home' ? 'home_team_external_id' : 'away_team_external_id';
    const providerTeamKey = readString(event.metadata[metadataKey]);
    if (!providerTeamKey) {
      continue;
    }

    const leagueId = normalizeCanonicalLeagueId(team.league ?? team.sport);
    if (!leagueId) {
      continue;
    }

    aliasMap.set(providerTeamKey, buildCanonicalTeamId(leagueId, team.displayName));
  }

  return aliasMap;
}

function getOrCreateLeagueRow(
  rows: Map<string, CanonicalBootstrapSummaryRow>,
  leagueId: string,
  sportId: string,
) {
  const existing = rows.get(leagueId);
  if (existing) {
    return existing;
  }

  const created: CanonicalBootstrapSummaryRow = {
    leagueId,
    sportId: sportId.toUpperCase(),
    teams: 0,
    players: 0,
    assignedPlayers: 0,
    unassignedPlayers: 0,
  };
  rows.set(leagueId, created);
  return created;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
