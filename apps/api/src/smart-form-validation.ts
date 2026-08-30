import type {
  CanonicalParticipantIdentity,
  SmartFormParticipantResolution,
  SubmissionPayload,
} from '@unit-talk/contracts';
import type { EventBrowseResult, ReferenceDataRepository } from '@unit-talk/db';
import { ApiError } from './errors.js';

const TEAM_SPORTS = new Set(['NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB', 'NHL', 'SOCCER']);

export async function validateSmartFormRelationships(
  payload: SubmissionPayload,
  referenceData: ReferenceDataRepository,
): Promise<void> {
  if (payload.source !== 'smart-form') return;

  const metadata = payload.metadata;
  const distributionMode = metadata?.['distributionMode'];
  if (distributionMode !== 'track-only' && distributionMode !== 'delivery-eligible') {
    fail('distributionMode must be track-only or delivery-eligible');
  }

  const resolution = readResolution(metadata?.['participantResolution']);
  if (!resolution) fail('participantResolution must use the typed canonical or manual contract');

  const sportId = readRequiredString(resolution.sportId, 'participantResolution.sportId');
  const metadataSport = readOptionalString(metadata?.['sport']);
  if (metadataSport && normalize(metadataSport) !== normalize(sportId)) {
    fail('participantResolution sport does not match metadata sport');
  }

  if (resolution.resolution === 'manual') {
    validateManualResolution(payload, resolution);
    return;
  }

  const eventId = readOptionalString(resolution.eventId);
  if (!eventId) {
    assertFlatMetadataIdentity(payload, resolution);
    if (TEAM_SPORTS.has(sportId.toUpperCase())) {
      await validateStructuredTeamFallback(resolution, sportId, referenceData);
    } else {
      fail('canonical participant resolution without an event is not verifiable; use explicit manual override');
    }
    return;
  }

  const event = await referenceData.getEventBrowse(eventId);
  if (!event) fail(`canonical event was not found: ${eventId}`);
  validateCanonicalEvent(payload, resolution, sportId, event);
}

function validateManualResolution(
  payload: SubmissionPayload,
  resolution: Extract<SmartFormParticipantResolution, { resolution: 'manual' }>,
) {
  if (resolution.eventId !== null || resolution.manualOverride !== true) {
    fail('manual participant resolution cannot include a canonical event ID');
  }
  if (resolution.reason !== 'canonical-coverage-gap') {
    fail('manual participant resolution must state canonical-coverage-gap provenance');
  }
  if (!readOptionalString(resolution.enteredEventName)) {
    fail('manual participant resolution requires enteredEventName');
  }
  if (!Array.isArray(resolution.enteredParticipants)) {
    fail('manual participant resolution requires enteredParticipants');
  }
  for (const participant of resolution.enteredParticipants) {
    if (!participant || participant.canonicalParticipantId !== null) {
      fail('manual participants must have canonicalParticipantId=null');
    }
    readRequiredString(participant.displayName, 'manual participant displayName');
  }
  for (const key of ['eventId', 'teamId', 'playerId', 'participantId']) {
    if (readOptionalString(payload.metadata?.[key])) {
      fail(`manual participant resolution cannot carry canonical ${key}`);
    }
  }
  if (payload.eventName && normalize(payload.eventName) !== normalize(resolution.enteredEventName)) {
    fail('manual enteredEventName does not match submission eventName');
  }
}

async function validateStructuredTeamFallback(
  resolution: Extract<SmartFormParticipantResolution, { resolution: 'canonical' }>,
  sportId: string,
  referenceData: ReferenceDataRepository,
) {
  if (!resolution.away || !resolution.home) {
    fail('team-sport canonical fallback requires distinct away and home participants');
  }
  validateDistinctSides(resolution.away, resolution.home);
  await Promise.all([
    validateSearchBackedTeam(resolution.away, sportId, referenceData),
    validateSearchBackedTeam(resolution.home, sportId, referenceData),
  ]);

  if (resolution.team) {
    await validateSearchBackedTeam(resolution.team, sportId, referenceData);
    const sideIds = new Set([resolution.away.participantId, resolution.home.participantId]);
    if (!sideIds.has(resolution.team.participantId)) {
      fail(`selected team ${resolution.team.participantId} is not part of the structured matchup`);
    }
  }

  if (resolution.player) {
    fail('canonical player selection requires a canonical event so team membership can be verified');
  }
}

async function validateSearchBackedTeam(
  identity: CanonicalParticipantIdentity,
  sportId: string,
  referenceData: ReferenceDataRepository,
) {
  if (identity.participantType !== 'team') fail('structured event sides must be canonical teams');
  const results = await referenceData.searchTeams(sportId, identity.displayName, 25);
  const match = results.find((row) => row.participantId === identity.participantId);
  if (!match) fail(`participant ${identity.participantId} is not canonical for sport ${sportId}`);
  if (normalize(match.displayName) !== normalize(identity.displayName)) {
    fail(`participant ID/display mismatch for ${identity.participantId}`);
  }
}

function validateCanonicalEvent(
  payload: SubmissionPayload,
  resolution: Extract<SmartFormParticipantResolution, { resolution: 'canonical' }>,
  sportId: string,
  event: EventBrowseResult,
) {
  if (normalize(event.sportId) !== normalize(sportId)) {
    fail(`event ${event.eventId} belongs to ${event.sportId}, not ${sportId}`);
  }
  if (resolution.eventName && !matchesCanonicalEventName(resolution.eventName, event.eventName)) {
    fail(`event ID/display mismatch for ${event.eventId}`);
  }
  if (payload.eventName && !matchesCanonicalEventName(payload.eventName, event.eventName)) {
    fail(`submission eventName does not match canonical event ${event.eventId}`);
  }
  assertFlatMetadataIdentity(payload, resolution);

  const away = resolution.away ? validateEventParticipant(resolution.away, event) : null;
  const home = resolution.home ? validateEventParticipant(resolution.home, event) : null;
  const team = resolution.team ? validateEventParticipant(resolution.team, event) : null;
  const player = resolution.player ? validateEventParticipant(resolution.player, event) : null;

  if (away && home && canonicalParticipantKey(away) === canonicalParticipantKey(home)) {
    fail('away and home participants must be different');
  }

  const teamSport = TEAM_SPORTS.has(sportId.toUpperCase());
  if (teamSport && away && away.participantType !== 'team') fail('away participant must be a team');
  if (teamSport && home && home.participantType !== 'team') fail('home participant must be a team');
  if (team && team.participantType !== 'team') fail('selected team identity is not a team');
  if (player && player.participantType !== 'player') fail('selected player identity is not a player');

  if (teamSport) {
    if (away && hasCanonicalHomeAwayRole(away) && away.role !== 'away') {
      fail(`away participant ${away.participantId} does not have canonical away role`);
    }
    if (home && hasCanonicalHomeAwayRole(home) && home.role !== 'home') {
      fail(`home participant ${home.participantId} does not have canonical home role`);
    }
  }

  if (team && player) {
    const teamIds = new Set([team.participantId, team.canonicalId, team.teamId].filter((value): value is string => Boolean(value)));
    if (!player.teamId || !teamIds.has(player.teamId)) {
      fail(`player ${player.participantId} is not assigned to team ${team.participantId}`);
    }
  }
}

function hasCanonicalHomeAwayRole(participant: EventBrowseResult['participants'][number]) {
  return participant.role === 'away' || participant.role === 'home';
}

function assertFlatMetadataIdentity(
  payload: SubmissionPayload,
  resolution: Extract<SmartFormParticipantResolution, { resolution: 'canonical' }>,
) {
  const metadata = payload.metadata;
  assertMatchingValue(metadata?.['eventId'], resolution.eventId, 'eventId');
  assertMatchingValue(metadata?.['teamId'], resolution.team?.participantId, 'teamId');
  assertMatchingValue(metadata?.['playerId'], resolution.player?.participantId, 'playerId');
  assertMatchingValue(metadata?.['participantId'], resolution.player?.participantId, 'participantId');
  assertMatchingDisplay(metadata?.['team'], resolution.team?.displayName, 'team');
  assertMatchingDisplay(metadata?.['player'], resolution.player?.displayName, 'player');
}

function assertMatchingValue(flatValue: unknown, resolvedValue: unknown, field: string) {
  const flat = readOptionalString(flatValue);
  const resolved = readOptionalString(resolvedValue);
  if (flat && flat !== resolved) fail(`${field} does not match participantResolution`);
}

function assertMatchingDisplay(flatValue: unknown, resolvedValue: unknown, field: string) {
  const flat = readOptionalString(flatValue);
  const resolved = readOptionalString(resolvedValue);
  if (flat && (!resolved || normalize(flat) !== normalize(resolved))) {
    fail(`${field} display does not match participantResolution`);
  }
}

function validateEventParticipant(identity: CanonicalParticipantIdentity, event: EventBrowseResult) {
  const row = event.participants.find((participant) =>
    participant.participantId === identity.participantId ||
    participant.canonicalId === identity.participantId,
  );
  if (!row) fail(`participant ${identity.participantId} does not belong to event ${event.eventId}`);
  if (row.participantType !== identity.participantType) fail(`participant type mismatch for ${identity.participantId}`);
  if (normalize(row.displayName) !== normalize(identity.displayName)) fail(`participant ID/display mismatch for ${identity.participantId}`);
  if (identity.teamId && row.teamId !== identity.teamId) fail(`participant team relationship mismatch for ${identity.participantId}`);
  return row;
}

function canonicalParticipantKey(
  participant: EventBrowseResult['participants'][number],
): string {
  return participant.canonicalId ?? participant.participantId;
}

function validateDistinctSides(
  away: CanonicalParticipantIdentity | null | undefined,
  home: CanonicalParticipantIdentity | null | undefined,
) {
  if (away && home && away.participantId === home.participantId) fail('away and home participants must be different');
}

function readResolution(value: unknown): SmartFormParticipantResolution | null {
  if (!isRecord(value)) return null;
  return value['resolution'] === 'canonical' || value['resolution'] === 'manual'
    ? value as unknown as SmartFormParticipantResolution
    : null;
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRequiredString(value: unknown, field: string) {
  const result = readOptionalString(value);
  if (!result) fail(`${field} is required`);
  return result;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function matchesCanonicalEventName(submitted: string, canonical: string) {
  const stripGameNumber = (value: string) => normalize(value).replace(/\s*·\s*game\s+\d+$/u, '');
  return stripGameNumber(submitted) === stripGameNumber(canonical);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ApiError(422, 'SMART_FORM_RELATIONSHIP_INVALID', message);
}
