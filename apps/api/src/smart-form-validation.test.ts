import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { EventBrowseResult, ReferenceDataRepository } from '@unit-talk/db';
import type { SubmissionPayload } from '@unit-talk/contracts';
import { createInMemoryRepositoryBundle } from './persistence.js';
import {
  MANUAL_PLAYER_DISPLAY_NAME_MAX_LENGTH,
  MANUAL_PLAYER_MAX_SEARCHES,
  MANUAL_PLAYER_SEARCH_ROW_LIMIT,
  validateSmartFormRelationships,
} from './smart-form-validation.js';
import { manualPlayerProvenance } from '@unit-talk/contracts';
import { ApiError } from './errors.js';

const event: EventBrowseResult = {
  eventId: 'event-ncaaf-1',
  externalId: 'provider-event-1',
  eventName: 'TCU @ UNC',
  eventDate: '2026-08-30',
  startTime: '2026-08-30T23:00:00.000Z',
  status: 'scheduled',
  sportId: 'NCAAF',
  leagueId: 'ncaaf',
  participants: [
    { participantId: 'team-tcu', canonicalId: 'team-tcu', participantType: 'team', displayName: 'TCU', role: 'away', teamId: 'team-tcu', teamName: 'TCU' },
    { participantId: 'team-unc', canonicalId: 'team-unc', participantType: 'team', displayName: 'UNC', role: 'home', teamId: 'team-unc', teamName: 'UNC' },
    { participantId: 'player-tcu-1', canonicalId: 'player-tcu-1', participantType: 'player', displayName: 'TCU Quarterback', role: 'away', teamId: 'team-tcu', teamName: 'TCU' },
    { participantId: 'player-unc-1', canonicalId: 'player-unc-1', participantType: 'player', displayName: 'UNC Quarterback', role: 'home', teamId: 'team-unc', teamName: 'UNC' },
  ],
  offers: [],
};

function referenceData(canonicalEvent: EventBrowseResult = event): ReferenceDataRepository {
  const repositories = createInMemoryRepositoryBundle();
  repositories.referenceData.getEventBrowse = async (eventId) =>
    eventId === canonicalEvent.eventId ? canonicalEvent : null;
  return repositories.referenceData;
}

function payload(overrides: Record<string, unknown> = {}): SubmissionPayload {
  return {
    source: 'smart-form',
    market: 'moneyline',
    selection: 'TCU',
    eventName: event.eventName,
    odds: 120,
    stakeUnits: 1,
    confidence: 0.7,
    metadata: {
      sport: 'NCAAF',
      distributionMode: 'track-only',
      participantResolution: {
        resolution: 'canonical',
        sportId: 'NCAAF',
        eventId: event.eventId,
        eventName: event.eventName,
        away: { participantId: 'team-tcu', displayName: 'TCU', participantType: 'team' },
        home: { participantId: 'team-unc', displayName: 'UNC', participantType: 'team' },
        team: { participantId: 'team-tcu', displayName: 'TCU', participantType: 'team' },
      },
      ...overrides,
    },
  };
}

test('accepts a canonical event and participant relationship', async () => {
  await validateSmartFormRelationships(payload(), referenceData());
});

test('rejects cross-sport event injection', async () => {
  await assert.rejects(
    () => validateSmartFormRelationships(payload({ sport: 'MLB' }), referenceData()),
    /sport does not match metadata sport|belongs to NCAAF, not MLB/,
  );
});

test('rejects a participant outside the canonical event', async () => {
  const invalid = payload();
  const resolution = invalid.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['team'] = { participantId: 'team-georgia', displayName: 'Georgia', participantType: 'team' };
  await assert.rejects(() => validateSmartFormRelationships(invalid, referenceData()), /does not belong to event/);
});

test('rejects canonical ID paired with another participant display name', async () => {
  const invalid = payload();
  const resolution = invalid.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['team'] = { participantId: 'team-tcu', displayName: 'UNC', participantType: 'team' };
  await assert.rejects(() => validateSmartFormRelationships(invalid, referenceData()), /ID\/display mismatch/);
});

test('rejects a canonical player assigned to an incompatible team', async () => {
  const invalid = payload();
  const resolution = invalid.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['team'] = { participantId: 'team-tcu', displayName: 'TCU', participantType: 'team' };
  resolution['player'] = { participantId: 'player-unc-1', displayName: 'UNC Quarterback', participantType: 'player', teamId: 'team-unc' };
  await assert.rejects(() => validateSmartFormRelationships(invalid, referenceData()), /is not assigned to team/);
});

test('rejects the same canonical participant on both event sides', async () => {
  const invalid = payload();
  const resolution = invalid.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['home'] = { participantId: 'team-tcu', displayName: 'TCU', participantType: 'team' };
  await assert.rejects(() => validateSmartFormRelationships(invalid, referenceData()), /must be different/);
});

test('rejects duplicate event sides submitted through participantId and canonicalId aliases', async () => {
  const aliasEvent: EventBrowseResult = {
    ...event,
    participants: event.participants.map((participant) =>
      participant.canonicalId === 'team-tcu'
        ? { ...participant, participantId: 'provider-team-tcu', canonicalId: 'team-tcu' }
        : participant,
    ),
  };
  const invalid = payload();
  const resolution = invalid.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['away'] = {
    participantId: 'provider-team-tcu',
    displayName: 'TCU',
    participantType: 'team',
  };
  resolution['home'] = {
    participantId: 'team-tcu',
    displayName: 'TCU',
    participantType: 'team',
  };

  await assert.rejects(
    () => validateSmartFormRelationships(invalid, referenceData(aliasEvent)),
    /away and home participants must be different/,
  );
});

test('rejects a bypassed team-sport client that swaps canonical away and home roles', async () => {
  const invalid = payload();
  const resolution = invalid.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['away'] = {
    participantId: 'team-unc',
    displayName: 'UNC',
    participantType: 'team',
  };
  resolution['home'] = {
    participantId: 'team-tcu',
    displayName: 'TCU',
    participantType: 'team',
  };

  await assert.rejects(
    () => validateSmartFormRelationships(invalid, referenceData()),
    /does not have canonical away role/,
  );
});

test('accepts a valid team-sport side when that participant has no canonical home/away role', async () => {
  const partialRoleEvent: EventBrowseResult = {
    ...event,
    participants: event.participants.map((participant) =>
      participant.canonicalId === 'team-unc'
        ? { ...participant, role: 'participant' }
        : participant,
    ),
  };

  await validateSmartFormRelationships(payload(), referenceData(partialRoleEvent));
});

test('does not impose team-sport home/away roles on a canonical MMA participant', async () => {
  const mmaEvent: EventBrowseResult = {
    ...event,
    eventId: 'event-mma-1',
    eventName: 'Fighter A vs Fighter B',
    sportId: 'MMA',
    leagueId: 'ufc',
    participants: [
      {
        participantId: 'fighter-a',
        canonicalId: 'fighter-a',
        participantType: 'player',
        displayName: 'Fighter A',
        role: 'competitor',
        teamId: null,
        teamName: null,
      },
      {
        participantId: 'fighter-b',
        canonicalId: 'fighter-b',
        participantType: 'player',
        displayName: 'Fighter B',
        role: 'competitor',
        teamId: null,
        teamName: null,
      },
    ],
  };
  const mmaPayload = payload({
    sport: 'MMA',
    participantResolution: {
      resolution: 'canonical',
      sportId: 'MMA',
      eventId: mmaEvent.eventId,
      eventName: mmaEvent.eventName,
      away: {
        participantId: 'fighter-a',
        displayName: 'Fighter A',
        participantType: 'player',
      },
      home: {
        participantId: 'fighter-b',
        displayName: 'Fighter B',
        participantType: 'player',
      },
    },
  });
  mmaPayload.eventName = mmaEvent.eventName;

  await validateSmartFormRelationships(mmaPayload, referenceData(mmaEvent));
});

test('accepts explicit unresolved manual provenance', async () => {
  const manual = payload({
    sport: 'MMA',
    participantResolution: {
      resolution: 'manual',
      sportId: 'MMA',
      eventId: null,
      manualOverride: true,
      reason: 'canonical-coverage-gap',
      enteredEventName: 'Fighter A vs Fighter B',
      enteredParticipants: [
        { role: 'competitor', displayName: 'Fighter A', canonicalParticipantId: null },
        { role: 'competitor', displayName: 'Fighter B', canonicalParticipantId: null },
      ],
    },
  });
  manual.eventName = 'Fighter A vs Fighter B';
  await validateSmartFormRelationships(manual, referenceData());
});

test('rejects manual provenance that carries a canonical ID', async () => {
  const invalid = payload({
    sport: 'MMA',
    participantResolution: {
      resolution: 'manual',
      sportId: 'MMA',
      eventId: null,
      manualOverride: true,
      reason: 'canonical-coverage-gap',
      enteredEventName: 'Fighter A vs Fighter B',
      enteredParticipants: [
        { role: 'competitor', displayName: 'Fighter A', canonicalParticipantId: 'spoofed-id' },
      ],
    },
  });
  await assert.rejects(() => validateSmartFormRelationships(invalid, referenceData()), /canonicalParticipantId=null/);
});

test('rejects an invalid canonical ID silently downgraded to manual mode', async () => {
  const invalid = payload({
    sport: 'MMA',
    participantId: 'spoofed-canonical-id',
    participantResolution: {
      resolution: 'manual',
      sportId: 'MMA',
      eventId: null,
      manualOverride: true,
      reason: 'canonical-coverage-gap',
      enteredEventName: event.eventName,
      enteredParticipants: [],
    },
  });
  await assert.rejects(() => validateSmartFormRelationships(invalid, referenceData()), /cannot carry canonical participantId/);
});

test('rejects flat canonical IDs that disagree with typed participant resolution', async () => {
  const invalid = payload({ teamId: 'team-unc' });
  await assert.rejects(() => validateSmartFormRelationships(invalid, referenceData()), /teamId does not match participantResolution/);
});

test('accepts a decorated doubleheader display name for the same canonical event', async () => {
  const doubleheader = payload();
  doubleheader.eventName = 'TCU @ UNC · Game 2';
  const resolution = doubleheader.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['eventName'] = 'TCU @ UNC · Game 2';
  await validateSmartFormRelationships(doubleheader, referenceData());
});

test('structured no-event fallback rejects a selected team outside the two canonical sides', async () => {
  const invalid = payload();
  const resolution = invalid.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['eventId'] = null;
  resolution['team'] = { participantId: 'team-georgia', displayName: 'Georgia', participantType: 'team' };
  const repository = referenceData();
  repository.searchTeams = async (_sportId, query) => [{
    participantId: query === 'Georgia' ? 'team-georgia' : query === 'TCU' ? 'team-tcu' : 'team-unc',
    displayName: query,
    sport: 'NCAAF',
  }];
  await assert.rejects(
    () => validateSmartFormRelationships(invalid, repository),
    /is not part of the structured matchup/,
  );
});

test('accepts a Soccer structured fallback backed by canonical team search', async () => {
  const soccer = payload({
    sport: 'Soccer',
    participantResolution: {
      resolution: 'canonical',
      sportId: 'Soccer',
      eventId: null,
      eventName: 'Arsenal @ Chelsea',
      away: { participantId: 'team-arsenal', displayName: 'Arsenal', participantType: 'team' },
      home: { participantId: 'team-chelsea', displayName: 'Chelsea', participantType: 'team' },
      team: { participantId: 'team-arsenal', displayName: 'Arsenal', participantType: 'team' },
    },
  });
  soccer.eventName = 'Arsenal @ Chelsea';
  soccer.selection = 'Arsenal';
  const repository = referenceData();
  repository.searchTeams = async (sportId, query) => {
    assert.equal(sportId, 'Soccer');
    return [{
      participantId: query === 'Arsenal' ? 'team-arsenal' : 'team-chelsea',
      displayName: query,
      sport: 'Soccer',
    }];
  };

  await validateSmartFormRelationships(soccer, repository);
});

/**
 * UTV2-1856: the structured no-event fallback used to refuse EVERY player selection, on the
 * premise that team membership needed a canonical event to be verifiable. That premise held
 * only while `player_team_assignments` was the sole source of the relationship. It is no
 * longer the sole source, so the five tests below pin what is now verified instead: the
 * relationship is taken from reference data the server read itself, and the caller's own
 * `teamId` is compared against it rather than believed.
 */
function structuredNoEventRepository(options: {
  playerTeamId?: string | null;
  playerName?: string;
} = {}): ReferenceDataRepository {
  const repository = referenceData();
  repository.searchTeams = async (_sportId, query) => [{
    participantId: query === 'TCU' ? 'team-tcu' : 'team-unc',
    displayName: query,
    sport: 'NCAAF',
  } as never];
  repository.searchPlayers = async (_sportId, query) =>
    query === (options.playerName ?? 'Structured Player')
      ? [{
          participantId: 'player-structured',
          displayName: options.playerName ?? 'Structured Player',
          participantType: 'player',
          teamId: options.playerTeamId === undefined ? 'team-tcu' : options.playerTeamId,
        } as never]
      : [];
  return repository;
}

function structuredNoEventPayload(player: Record<string, unknown> | null): SubmissionPayload {
  const built = payload();
  const resolution = built.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['eventId'] = null;
  resolution['eventName'] = null;
  built.eventName = 'TCU @ UNC';
  if (player) resolution['player'] = player;
  return built;
}

const structuredPlayer = {
  participantId: 'player-structured',
  displayName: 'Structured Player',
  participantType: 'player',
  teamId: 'team-tcu',
};

test('structured no-event fallback accepts a player whose team relationship reference data confirms', async () => {
  await validateSmartFormRelationships(
    structuredNoEventPayload({ ...structuredPlayer }),
    structuredNoEventRepository(),
  );
});

test('structured no-event fallback rejects a player whose team relationship cannot be verified', async () => {
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        structuredNoEventPayload({ ...structuredPlayer, teamId: null }),
        structuredNoEventRepository({ playerTeamId: null }),
      ),
    /has no verifiable team relationship without a canonical event; use explicit manual override/,
  );
});

test('structured no-event fallback rejects a player who is on neither side of the entered matchup', async () => {
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        structuredNoEventPayload({ ...structuredPlayer, teamId: 'team-elsewhere' }),
        structuredNoEventRepository({ playerTeamId: 'team-elsewhere' }),
      ),
    /is not on either side of the structured matchup/,
  );
});

test('structured no-event fallback does not believe a caller-supplied team relationship', async () => {
  // Reference data says the player is on team-unc; the caller claims team-tcu, which IS a
  // legitimate side of this matchup and IS the selected team, so every check except the
  // comparison against resolved truth would pass. This is the test that fails if the
  // caller's `teamId` is ever used as the source rather than the claim.
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        structuredNoEventPayload({ ...structuredPlayer, teamId: 'team-tcu' }),
        structuredNoEventRepository({ playerTeamId: 'team-unc' }),
      ),
    /is not assigned to team team-tcu/,
  );
});

test('structured no-event fallback rejects a player reference data does not know at all', async () => {
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        structuredNoEventPayload({
          participantId: 'player-mlb-injection',
          displayName: 'Cross Sport Player',
          participantType: 'player',
          teamId: 'team-tcu',
        }),
        structuredNoEventRepository(),
      ),
    /is not canonical for sport NCAAF/,
  );
});

test('non-team canonical identity without an event must use explicit manual provenance', async () => {
  const invalid = payload({
    sport: 'MMA',
    participantResolution: {
      resolution: 'canonical',
      sportId: 'MMA',
      eventId: null,
      away: { participantId: 'fighter-a', displayName: 'Fighter A', participantType: 'competitor' },
      home: { participantId: 'fighter-b', displayName: 'Fighter B', participantType: 'competitor' },
    },
  });
  invalid.eventName = 'Fighter A vs Fighter B';
  await assert.rejects(
    () => validateSmartFormRelationships(invalid, referenceData()),
    /not verifiable; use explicit manual override/,
  );
});

// ---------------------------------------------------------------------------
// UTV2-1672: the manual override must prove the coverage gap it claims.
//
// Without MANUAL_COVERAGE_GAP_PROOF_GUARD, `resolution: 'manual'` is a
// caller-declared opt-out of every canonical check in this module: the entered
// participants are never checked against reference data, so a submission can
// name a team that plainly exists canonically -- or name none at all -- and
// still be admitted. These are the bypasses the guard closes.
// ---------------------------------------------------------------------------

function manualPayload(participants: Array<Record<string, unknown>>, sport = 'NBA') {
  const manual = payload({
    sport,
    participantResolution: {
      resolution: 'manual',
      sportId: sport,
      eventId: null,
      manualOverride: true,
      reason: 'canonical-coverage-gap',
      enteredEventName: 'Entered Matchup',
      enteredParticipants: participants,
    },
  });
  manual.eventName = 'Entered Matchup';
  return manual;
}

/** Reference data in which "Lakers" is a real canonical NBA team. */
function referenceDataWithCanonicalTeams(): ReferenceDataRepository {
  const repositories = createInMemoryRepositoryBundle();
  repositories.referenceData.searchTeams = async (sportId: string, query: string) =>
    sportId.toUpperCase() === 'NBA' && /lakers/iu.test(query)
      ? [{ participantId: 'team-lakers', displayName: 'Los Angeles Lakers', participantType: 'team' } as never]
      : [];
  return repositories.referenceData;
}

test('manual override is refused when it names a participant that is canonically covered', async () => {
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload([
          { role: 'away', displayName: 'Los Angeles Lakers', canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ]),
        referenceDataWithCanonicalTeams(),
      ),
    /resolves to canonical participant Lakers/u,
  );
});

test('manual override is refused for an alias spelling of a canonically covered participant', async () => {
  // "L.A. LAKERS" differs from the canonical display name by punctuation, case
  // and spacing only. Strict normalization would miss it; the alias key does not.
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload([
          { role: 'away', displayName: 'L.A. LAKERS', canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ]),
        (() => {
          const repository = referenceDataWithCanonicalTeams();
          repository.searchTeams = async () =>
            [{ participantId: 'team-lakers', displayName: 'la lakers', participantType: 'team' }] as never;
          return repository;
        })(),
      ),
    /resolves to canonical participant Lakers/u,
  );
});

test('manual override is refused when it enters no participants at all', async () => {
  await assert.rejects(
    () => validateSmartFormRelationships(manualPayload([], 'MMA'), referenceData()),
    /at least one entered participant/u,
  );
});

test('manual override is refused when the same participant is entered on both sides', async () => {
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload(
          [
            { role: 'away', displayName: 'Fighter A', canonicalParticipantId: null },
            { role: 'home', displayName: 'fighter-a', canonicalParticipantId: null },
          ],
          'MMA',
        ),
        referenceData(),
      ),
    /must be distinct/u,
  );
});

test('a legacy smart-form submission carrying no Smart Form fields is not retrofitted with the contract', async () => {
  // `smart-form` predates this product as a generic submission source. Service
  // callers still use it as a plain label, and refusing those would be a
  // regression this lane never intended.
  const legacy: SubmissionPayload = {
    source: 'smart-form',
    market: 'nfl-spread',
    selection: 'legacy submission',
    odds: -110,
    stakeUnits: 1,
    confidence: 70,
    metadata: { proof_fixture_id: 'legacy-shape' },
  };
  await validateSmartFormRelationships(legacy, referenceData());
});

// ---------------------------------------------------------------------------
// UTV2-1672: the four ways an exact-equality coverage proof can be dodged.
//
// Adversarial review at the previous head demonstrated each of these against
// the shipped guard. They are regression tests, not hypotheticals.
// ---------------------------------------------------------------------------

/** Reference data seeded with the real in-memory catalog: NBA "Knicks" exists. */
function seededReferenceData(): ReferenceDataRepository {
  return createInMemoryRepositoryBundle().referenceData;
}

test('manual override is refused when a canonical name is spelled with a Cyrillic homoglyph', async () => {
  // U+0441 (Cyrillic "es") is visually identical to "c". Stripping it instead
  // of folding it produced "kniks", which matched nothing.
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload([
          { role: 'away', displayName: 'Kni\u0441ks', canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ]),
        seededReferenceData(),
      ),
    /resolves to canonical participant Knicks/u,
  );
});

test('manual override is refused when a canonical name is entered with a city prefix the catalog omits', async () => {
  // The catalog stores the bare nickname, so searching the full string returns
  // nothing and exact alias equality never fires.
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload([
          { role: 'away', displayName: 'New York Knicks', canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ]),
        seededReferenceData(),
      ),
    /resolves to canonical participant Knicks/u,
  );
});

test('manual override is refused when the catalog carries a city prefix the entry omits', async () => {
  // The opposite convention: the catalog is verbose, the caller is terse.
  const repository = seededReferenceData();
  // "Sonics" is deliberately absent from the static catalog, so the catalog
  // branch cannot short-circuit this and the search branch is what is proven.
  repository.searchTeams = async (_sportId, query) =>
    /sonics/iu.test(query)
      ? ([{ participantId: 'team-sea', displayName: 'Seattle Sonics', sport: 'NBA' }] as never)
      : [];
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload([
          { role: 'away', displayName: 'Sonics', canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ]),
        repository,
      ),
    /resolves to canonical participant team-sea/u,
  );
});

test('manual override is verified for non-team sports, whose only supported route is manual', async () => {
  // TEAM_SPORTS gates the team catalog only. Skipping the proof for every other
  // sport left the manual override unverified for exactly the sports the
  // canonical path refuses without an event.
  const repository = seededReferenceData();
  repository.searchPlayers = async (sportId, query) =>
    sportId === 'MMA' && /jones/iu.test(query)
      ? ([{ participantId: 'player-jones', displayName: 'Jon Jones', sport: 'MMA' }] as never)
      : [];
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload(
          [
            { role: 'away', displayName: 'Jon Jones', canonicalParticipantId: null },
            { role: 'home', displayName: 'Nobody Atall', canonicalParticipantId: null },
          ],
          'MMA',
        ),
        repository,
      ),
    /resolves to canonical participant player-jones/u,
  );
});

test('manual override is refused when only one side of a team-sport matchup is entered', async () => {
  // The canonical structured fallback requires both away and home; the manual
  // route must not be weaker than the path it substitutes for.
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload(
          [{ role: 'away', displayName: 'Nobody Atall', canonicalParticipantId: null }],
          'NBA',
        ),
        seededReferenceData(),
      ),
    /requires both sides of the entered matchup/u,
  );
});

test('a one-participant manual entry is admitted for an individual sport', async () => {
  // Golf outrights and futures on a single competitor are legitimate one-sided
  // markets, and there is no structured fallback for them to be weaker than.
  await validateSmartFormRelationships(
    manualPayload(
      [{ role: 'competitor', displayName: 'Nobody Atall', canonicalParticipantId: null }],
      'MMA',
    ),
    seededReferenceData(),
  );
});

test('manual participant names that still hold a non-Latin look-alike after folding are refused', async () => {
  // Confusable folding covers Cyrillic and Greek. Anything left over -- a
  // Cherokee "\u13e6", say -- is refused rather than silently treated as a name
  // no catalog holds.
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload([
          { role: 'away', displayName: 'New York \u13e6nicks', canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ]),
        seededReferenceData(),
      ),
    /must use Latin characters/u,
  );
});

test('a fullwidth look-alike folds to ASCII and is caught as canonical coverage', async () => {
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload([
          { role: 'away', displayName: 'New York \uff2bnicks', canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ]),
        seededReferenceData(),
      ),
    /resolves to canonical participant Knicks/u,
  );
});

test('zero-width characters in every word do not hide a canonical name', async () => {
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload([
          { role: 'away', displayName: 'Ne\u200bw Yor\u200bk Kni\u200bcks', canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ]),
        seededReferenceData(),
      ),
    /resolves to canonical participant Knicks/u,
  );
});

test('a name that merely extends a canonical one is not treated as covered', async () => {
  // "Alex Pereira Junior" is a different fighter from "Alex Pereira", and
  // "Manchester" is a different club from "Manchester United". Substring
  // containment refused both; token-suffix matching does not.
  const repository = seededReferenceData();
  repository.searchPlayers = async (_sportId, query) =>
    /pereira/iu.test(query)
      ? ([{ participantId: 'player-pereira', displayName: 'Alex Pereira', sport: 'MMA' }] as never)
      : [];
  await validateSmartFormRelationships(
    manualPayload(
      [
        { role: 'competitor', displayName: 'Alex Pereira Junior', canonicalParticipantId: null },
        { role: 'competitor', displayName: 'Nobody Atall', canonicalParticipantId: null },
      ],
      'MMA',
    ),
    repository,
  );
});

test('an unknown or wrong-case sport is refused rather than silently searching nothing', async () => {
  // Every reference-data lookup filters on sportId with case-sensitive
  // equality, so "nba" would return no rows and make the coverage proof vacuous.
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload(
          [
            { role: 'away', displayName: 'Nobody Atall', canonicalParticipantId: null },
            { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
          ],
          'nba',
        ),
        seededReferenceData(),
      ),
    /is not a canonical sport/u,
  );
});

test('a genuinely uncovered manual matchup is still admitted', async () => {
  // The guard must refuse fabricated gaps without refusing real ones.
  await validateSmartFormRelationships(
    manualPayload(
      [
        { role: 'competitor', displayName: 'Nobody Atall', canonicalParticipantId: null },
        { role: 'competitor', displayName: 'Someone Else Entirely', canonicalParticipantId: null },
      ],
      'MMA',
    ),
    seededReferenceData(),
  );
});

async function withGuardRemoved<T>(
  guardName: string,
  run: (mutant: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const sourcePath = fileURLToPath(new URL('./smart-form-validation.ts', import.meta.url));
  const suffix = `__mutant_${guardName}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const mutantPath = sourcePath.replace(/\.ts$/u, `${suffix}.ts`);
  const source = await readFile(sourcePath, 'utf8');
  const guardPattern = new RegExp(
    `[ ]*// UTV2-1672 ${guardName}_START[\\s\\S]*?// UTV2-1672 ${guardName}_END\\n`,
    'u',
  );
  const mutantSource = source.replace(guardPattern, '');
  assert.notEqual(mutantSource, source, `mutation control could not remove ${guardName}`);
  await writeFile(mutantPath, mutantSource, 'utf8');
  try {
    return await run(
      (await import(`${pathToFileURL(mutantPath).href}?mutation=${guardName}`)) as Record<string, unknown>,
    );
  } finally {
    await unlink(mutantPath).catch(() => undefined);
  }
}

test('mutation control: removing MANUAL_COVERAGE_GAP_PROOF_GUARD admits a fabricated coverage gap over a canonical team', async () => {
  const crafted = manualPayload([
    { role: 'away', displayName: 'Los Angeles Lakers', canonicalParticipantId: null },
    { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
  ]);

  // Baseline: the guard refuses.
  await assert.rejects(
    () => validateSmartFormRelationships(crafted, referenceDataWithCanonicalTeams()),
    /resolves to canonical participant/u,
  );

  // Mutant: with the marked block deleted, the same payload is admitted, and so
  // is a manual override that enters no participants at all.
  await withGuardRemoved('MANUAL_COVERAGE_GAP_PROOF_GUARD', async (mutant) => {
    const validate = mutant['validateSmartFormRelationships'] as typeof validateSmartFormRelationships;
    await validate(crafted, referenceDataWithCanonicalTeams());
    await validate(manualPayload([], 'MMA'), referenceData());
  });
});

test('mutation control: removing SMART_FORM_TRIGGER_SCOPE refuses legacy smart-form submissions', async () => {
  const legacy: SubmissionPayload = {
    source: 'smart-form',
    market: 'nfl-spread',
    selection: 'legacy submission',
    odds: -110,
    stakeUnits: 1,
    confidence: 70,
    metadata: { proof_fixture_id: 'legacy-shape' },
  };

  // Baseline: admitted.
  await validateSmartFormRelationships(legacy, referenceData());

  // Mutant: the scope narrowing is what keeps pre-existing service-role callers
  // working; without it they are refused with a 422.
  await withGuardRemoved('SMART_FORM_TRIGGER_SCOPE', async (mutant) => {
    const validate = mutant['validateSmartFormRelationships'] as typeof validateSmartFormRelationships;
    await assert.rejects(() => validate(legacy, referenceData()), /distributionMode must be/u);
  });
});

test('the coverage proof survives an empty search backend, because the catalog is what is populated', async () => {
  // `searchTeams` reads the `teams` table and `searchPlayers` joins current
  // assignments; both are empty in production. A search-only proof therefore
  // returns null for every name in every sport and the guard degrades to
  // accepting whatever it is told. The catalog reads `participants`, which is
  // populated, so this is the branch that actually carries the refusal.
  const repository = seededReferenceData();
  repository.searchTeams = async () => [];
  repository.searchPlayers = async () => [];
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload([
          { role: 'away', displayName: 'Knicks', canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ]),
        repository,
      ),
    /resolves to canonical participant Knicks/u,
  );
});

test('punctuation on a single-word name does not defeat retrieval', async () => {
  // The raw query "Knicks." is searched verbatim, and ILIKE '%knicks.%' matches
  // nothing, so without the alias-collapsed spelling in the query set the row
  // is never fetched and the name reads as an uncovered gap.
  const repository = seededReferenceData();
  const queries: string[] = [];
  repository.searchTeams = async (_sportId: string, query: string) => {
    queries.push(query);
    return /^sonics$/iu.test(query)
      ? ([{ participantId: 'team-sea', displayName: 'Sonics', sport: 'NBA' }] as never)
      : [];
  };
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPayload([
          { role: 'away', displayName: "Sonic's", canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ]),
        repository,
      ),
    /resolves to canonical participant team-sea/u,
  );
  assert.ok(queries.includes('sonics'), `alias-collapsed spelling was never searched: ${queries.join(', ')}`);
});

test('Latin letters NFKD does not decompose are admitted rather than refused as non-Latin', async () => {
  // NFKD strips diacritics but leaves o-slash, sharp-s, ash, l-stroke and
  // dotless-i intact. Without an explicit expansion the non-ASCII refusal
  // rejects real top-flight Soccer clubs and the manual path is unusable.
  for (const name of ['Brøndby IF', 'Preußen Münster', 'Kasımpaşa', 'ŁKS Łódź']) {
    await validateSmartFormRelationships(
      manualPayload(
        [
          { role: 'away', displayName: name, canonicalParticipantId: null },
          { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
        ],
        'Soccer',
      ),
      seededReferenceData(),
    );
  }
});

test('mutation control: removing CANONICAL_SPORT_ID_GUARD makes the whole coverage proof vacuous', async () => {
  // Every reference-data lookup is case-sensitive, so a sportId the catalog
  // does not carry finds nothing in any sport. Without this guard that is
  // silent: "nba" searches an empty universe and every canonical name is
  // reported as an uncovered gap.
  const lowercased = manualPayload(
    [
      { role: 'away', displayName: 'Knicks', canonicalParticipantId: null },
      { role: 'home', displayName: 'Nobody United', canonicalParticipantId: null },
    ],
    'NBA',
  );
  const resolution = lowercased.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['sportId'] = 'nba';

  // Baseline: the unknown sport is refused before any lookup is attempted.
  await assert.rejects(
    () => validateSmartFormRelationships(lowercased, seededReferenceData()),
    /is not a canonical sport/u,
  );

  // Mutant: the same payload is admitted, and the coverage proof it carries is
  // worthless -- "Knicks" is canonical, and the guard below cannot see it.
  await withGuardRemoved('CANONICAL_SPORT_ID_GUARD', async (mutant) => {
    const validate = mutant['validateSmartFormRelationships'] as typeof validateSmartFormRelationships;
    await validate(lowercased, seededReferenceData());
  });
});

// ---------------------------------------------------------------------------
// UTV2-1672 review round 5, P2 (confirmed): DatabaseReferenceDataRepository
// .searchPlayers fetched an unordered global `limit * 5` batch of name matches
// and only then filtered by sport, so a sport whose players fell outside that
// arbitrary slice reported no availability even though players existed.
// Availability is a refusal input for Smart Form coverage, so that is a wrong
// answer rather than a slow one.
//
// UTV2-1854 keeps that property and changes how it is held. The read moved off
// the canonical `players` table -- empty under parked provider ingestion, so it
// answered `[]` for every query in every sport -- onto `participants`, which is
// the populated observation layer the catalog and availability probes already
// read. `participants.sport` is a column, so sport is now a predicate in the
// query itself and `limit` bounds sport-matching rows directly. There is no
// batch boundary for sport to fall outside of.
//
// That is a stronger guarantee than the paging loop provided, so these tests
// assert the *mechanism* as well as the result: removing `.eq('sport', ...)`
// must turn the first test red. Without that, the tests would record that the
// paging loop was deleted while proving nothing about what replaced it.
// ---------------------------------------------------------------------------

interface StubParticipantRow {
  id: string;
  display_name: string;
  sport: string;
  participant_type: 'team' | 'player';
  metadata: Record<string, unknown> | null;
  external_id?: string;
}

interface RecordedQuery {
  table: string;
  filters: Array<[string, unknown]>;
  limit: number | null;
}

/**
 * A recording stub for the two `participants` reads `searchPlayers` performs.
 * Every builder method is both chainable and awaitable, so a chain that ends
 * without `.limit()` still resolves -- a builder that only chained would hang
 * the team-resolution lookup, which ends on `.in(...)`.
 */
function stubParticipantsClient(rows: StubParticipantRow[]) {
  const queries: RecordedQuery[] = [];
  const client = {
    from(table: string) {
      if (table !== 'participants') {
        throw new Error(`unexpected table ${table}`);
      }
      const record: RecordedQuery = { table, filters: [], limit: null };
      queries.push(record);

      const resolve = () => {
        let matched = rows.filter((row) =>
          record.filters.every(([column, value]) => {
            if (column === 'ilike:display_name') {
              const needle = String(value).replace(/%/gu, '').toLowerCase();
              return row.display_name.toLowerCase().includes(needle);
            }
            if (column === 'in:external_id') {
              return (value as string[]).includes(row.external_id ?? '');
            }
            // UTV2-1854: the proof-fixture exclusion is a pushed-down predicate,
            // so the stub must evaluate it the way PostgREST would -- otherwise
            // these tests would silently stop covering the filtered read.
            if (column === 'is:metadata->>proofIssue' && value === null) {
              const metadata = row.metadata as Record<string, unknown> | null;
              const marker = metadata ? metadata['proofIssue'] : undefined;
              return marker === undefined || marker === null;
            }
            return (row as unknown as Record<string, unknown>)[column] === value;
          }),
        );
        matched = matched.sort((left, right) =>
          left.display_name.localeCompare(right.display_name),
        );
        if (record.limit !== null) {
          matched = matched.slice(0, record.limit);
        }
        return { data: matched, error: null };
      };

      const builder: Record<string, unknown> = {};
      const chain = (fn: (...args: never[]) => void) =>
        (...args: never[]) => {
          fn(...args);
          return builder;
        };
      Object.assign(builder, {
        select: chain(() => {}),
        eq: chain(((column: string, value: unknown) => {
          record.filters.push([column, value]);
        }) as never),
        ilike: chain(((column: string, pattern: string) => {
          record.filters.push([`ilike:${column}`, pattern]);
        }) as never),
        in: chain(((column: string, values: unknown) => {
          record.filters.push([`in:${column}`, values]);
        }) as never),
        is: chain(((column: string, value: unknown) => {
          record.filters.push([`is:${column}`, value]);
        }) as never),
        order: chain(() => {}),
        limit: chain(((count: number) => {
          record.limit = count;
        }) as never),
        then: (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve(resolve()).then(onFulfilled),
      });
      return builder;
    },
  };
  return { client, queries };
}

function buildCrossSportParticipants() {
  const rows: StubParticipantRow[] = [
    {
      id: 'team-nba-1',
      display_name: 'Knicks',
      sport: 'NBA',
      participant_type: 'team',
      metadata: null,
      external_id: 'NEW_YORK_KNICKS_NBA',
    },
  ];
  // 250 MLB players whose names sort ahead of the NBA player.
  for (let index = 0; index < 250; index += 1) {
    rows.push({
      id: `mlb-${String(index).padStart(3, '0')}`,
      display_name: `AAA Jordan Filler ${String(index).padStart(3, '0')}`,
      sport: 'MLB',
      participant_type: 'player',
      metadata: null,
    });
  }
  const nbaId = 'nba-target';
  rows.push({
    id: nbaId,
    display_name: 'ZZZ Jordan Target',
    sport: 'NBA',
    participant_type: 'player',
    metadata: { team_external_id: 'NEW_YORK_KNICKS_NBA' },
  });
  return { rows, nbaId };
}

function participantsRepository(rows: StubParticipantRow[]) {
  const { client, queries } = stubParticipantsClient(rows);
  return { client, queries };
}

test('searchPlayers finds a player that sorts beyond the former global cap', async () => {
  const { DatabaseReferenceDataRepository } = await import('@unit-talk/db');
  const { rows, nbaId } = buildCrossSportParticipants();
  const { client, queries } = participantsRepository(rows);

  const repository = new DatabaseReferenceDataRepository(
    { url: 'https://stub.invalid', serviceRoleKey: 'stub' } as never,
    client as never,
  );

  const results = await repository.searchPlayers('NBA', 'Jordan', 20);

  // The old implementation fetched limit*5 = 100 unordered rows and filtered by
  // sport afterwards. The NBA player is name-match number 251, so it returned []
  // and Smart Form reported playersAvailable:false for a sport that has players.
  assert.equal(results.length, 1);
  assert.equal(results[0]?.participantId, nbaId);
  assert.equal(results[0]?.sport, 'NBA');
  // Team identity is resolved through participants too, never through the empty
  // canonical `player_team_assignments` join.
  assert.equal(results[0]?.teamId, 'team-nba-1');

  // The mechanism, not just the outcome: sport is a predicate in the query. If
  // this assertion is removed, deleting `.eq('sport', sportId)` still returns
  // one row here by luck of the name filter, and the guarantee stops being pinned.
  const playerQuery = queries[0];
  assert.ok(playerQuery, 'no participants query was issued');
  assert.ok(
    playerQuery.filters.some(([column, value]) => column === 'sport' && value === 'NBA'),
    'searchPlayers did not scope the query by sport',
  );
  assert.ok(
    playerQuery.filters.some(
      ([column, value]) => column === 'participant_type' && value === 'player',
    ),
    'searchPlayers did not scope the query to player participants',
  );
});

test('searchPlayers still returns the requested sport and never leaks another', async () => {
  const { DatabaseReferenceDataRepository } = await import('@unit-talk/db');
  const { rows } = buildCrossSportParticipants();
  const { client } = participantsRepository(rows);

  const repository = new DatabaseReferenceDataRepository(
    { url: 'https://stub.invalid', serviceRoleKey: 'stub' } as never,
    client as never,
  );

  const mlb = await repository.searchPlayers('MLB', 'Jordan', 20);
  assert.equal(mlb.length, 20);
  assert.ok(mlb.every((row) => row.sport === 'MLB'));
  // A player with no team key gets a null team -- honest partial coverage, never
  // a guessed team.
  assert.ok(mlb.every((row) => row.teamId === null));

  // Positive control: the sport filter is doing work, not just passing
  // everything through. A sport with no players must still return nothing.
  const nhl = await repository.searchPlayers('NHL', 'Jordan', 20);
  assert.deepEqual(nhl, []);
});

test('searchPlayers reads participants once for the players and once for their teams', async () => {
  const { DatabaseReferenceDataRepository } = await import('@unit-talk/db');
  const { rows } = buildCrossSportParticipants();
  const { client, queries } = participantsRepository(rows);

  const repository = new DatabaseReferenceDataRepository(
    { url: 'https://stub.invalid', serviceRoleKey: 'stub' } as never,
    client as never,
  );

  // No player in this result carries a team key, so no team lookup is needed
  // and the common case must stay a single round trip. The deterministic paging
  // loop UTV2-1672 needed is gone; this asserts it did not come back.
  await repository.searchPlayers('MLB', 'Jordan', 5);
  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.limit, 5);

  // One player with a team key adds exactly one batched lookup, never one per row.
  const second = participantsRepository(rows);
  const repository2 = new DatabaseReferenceDataRepository(
    { url: 'https://stub.invalid', serviceRoleKey: 'stub' } as never,
    second.client as never,
  );
  await repository2.searchPlayers('NBA', 'Jordan', 20);
  assert.equal(second.queries.length, 2);
  assert.ok(
    second.queries[1]?.filters.some(([column]) => column === 'in:external_id'),
    'the team lookup was not batched by external id',
  );
});

// ---------------------------------------------------------------------------
// UTV2-1842: the validator now reports *which* path admitted the submission.
//
// submission-service.ts waives the event-existence gate for exactly two of
// these four outcomes. That waiver is only sound if each outcome is produced
// after — never instead of — the full server-side check for its path, so these
// tests pin the mapping. Every payload below is one the existing tests above
// already prove is validated; what is new is the value that comes back.
// ---------------------------------------------------------------------------

test('UTV2-1842: a canonical event resolution reports canonical-event with its event id', async () => {
  const outcome = await validateSmartFormRelationships(payload(), referenceData());
  assert.deepEqual(outcome, {
    kind: 'canonical-event',
    eventId: event.eventId,
    distributionMode: 'track-only',
    serverAuthorizedHumanDelivery: false,
  });
});

test('UTV2-1842: a validated manual coverage gap reports manual-coverage-gap', async () => {
  const manual = payload({
    sport: 'MMA',
    participantResolution: {
      resolution: 'manual',
      sportId: 'MMA',
      eventId: null,
      manualOverride: true,
      reason: 'canonical-coverage-gap',
      enteredEventName: 'Fighter A vs Fighter B',
      enteredParticipants: [
        { role: 'competitor', displayName: 'Fighter A', canonicalParticipantId: null },
        { role: 'competitor', displayName: 'Fighter B', canonicalParticipantId: null },
      ],
    },
  });
  manual.eventName = 'Fighter A vs Fighter B';

  const outcome = await validateSmartFormRelationships(manual, referenceData());
  assert.deepEqual(outcome, {
    kind: 'manual-coverage-gap',
    distributionMode: 'track-only',
    serverAuthorizedHumanDelivery: false,
  });
});

test('UTV2-1842: a search-backed structured team fallback reports structured-team-fallback', async () => {
  const soccer = payload({
    sport: 'Soccer',
    participantResolution: {
      resolution: 'canonical',
      sportId: 'Soccer',
      eventId: null,
      eventName: 'Arsenal @ Chelsea',
      away: { participantId: 'team-arsenal', displayName: 'Arsenal', participantType: 'team' },
      home: { participantId: 'team-chelsea', displayName: 'Chelsea', participantType: 'team' },
      team: { participantId: 'team-arsenal', displayName: 'Arsenal', participantType: 'team' },
    },
  });
  soccer.eventName = 'Arsenal @ Chelsea';
  soccer.selection = 'Arsenal';
  const repository = referenceData();
  repository.searchTeams = async (sportId, query) => {
    assert.equal(sportId, 'Soccer');
    return [{
      participantId: query === 'Arsenal' ? 'team-arsenal' : 'team-chelsea',
      displayName: query,
      sport: 'Soccer',
    }];
  };

  const outcome = await validateSmartFormRelationships(soccer, repository);
  assert.deepEqual(outcome, {
    kind: 'structured-team-fallback',
    distributionMode: 'track-only',
    serverAuthorizedHumanDelivery: false,
  });
});

test('UTV2-1842: an unvalidated legacy smart-form shape reports not-smart-form', async () => {
  // This shape is admitted by the carriesSmartFormFields escape without any
  // relationship validation at all. It must therefore report the outcome that
  // does NOT waive the event gate — see the matching test in
  // submission-service.test.ts.
  const legacy: SubmissionPayload = {
    source: 'smart-form',
    market: 'nfl-spread',
    selection: 'legacy submission',
    odds: -110,
    stakeUnits: 1,
    confidence: 70,
    metadata: { proof_fixture_id: 'legacy-shape' },
  };

  const outcome = await validateSmartFormRelationships(legacy, referenceData());
  assert.deepEqual(outcome, { kind: 'not-smart-form' });
});

test('UTV2-1842: a non-team sport with no event still fails rather than reporting a fallback', async () => {
  // The waiver must be unreachable for a sport the structured fallback cannot
  // verify. If this ever returns an outcome instead of throwing, a submission
  // with no canonical event and no manual override would skip the event gate.
  const mma = payload({
    sport: 'MMA',
    participantResolution: {
      resolution: 'canonical',
      sportId: 'MMA',
      eventId: null,
      eventName: 'Fighter A vs Fighter B',
      away: { participantId: 'fighter-a', displayName: 'Fighter A', participantType: 'player' },
      home: { participantId: 'fighter-b', displayName: 'Fighter B', participantType: 'player' },
    },
  });
  mma.eventName = 'Fighter A vs Fighter B';

  await assert.rejects(
    () => validateSmartFormRelationships(mma, referenceData()),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /explicit manual override/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// UTV2-1842 review corrections — the two findings on PR #1529.
//
// 1. The waiver was not restricted to Track Only. The outcome now carries the
//    submission's distributionMode so submission-service.ts can require it; the
//    tests that the waiver itself honours it live in submission-service.test.ts.
// 2. The structured fallback validated the away/home *identities* and never
//    bound the submitted matchup *name* to them, so a payload with genuine
//    DB-backed team IDs and an arbitrary eventName was reported fully
//    server-validated and — via the new waiver — persisted the fabricated name.
// ---------------------------------------------------------------------------

function structuredFallback(overrides: Record<string, unknown> = {}) {
  const soccer = payload({
    sport: 'Soccer',
    participantResolution: {
      resolution: 'canonical',
      sportId: 'Soccer',
      eventId: null,
      eventName: 'Arsenal @ Chelsea',
      away: { participantId: 'team-arsenal', displayName: 'Arsenal', participantType: 'team' },
      home: { participantId: 'team-chelsea', displayName: 'Chelsea', participantType: 'team' },
      team: { participantId: 'team-arsenal', displayName: 'Arsenal', participantType: 'team' },
    },
    eventName: 'Arsenal @ Chelsea',
    ...overrides,
  });
  soccer.eventName = 'Arsenal @ Chelsea';
  soccer.selection = 'Arsenal';
  const repository = referenceData();
  repository.searchTeams = async (sportId, query) => {
    assert.equal(sportId, 'Soccer');
    return [{
      participantId: query === 'Arsenal' ? 'team-arsenal' : 'team-chelsea',
      displayName: query,
      sport: 'Soccer',
    }];
  };
  return { soccer, repository };
}

test('UTV2-1842: the outcome reports delivery-eligible when the submission is delivery-eligible', async () => {
  // The waiver is decided from this value. If the validator ever hard-codes
  // 'track-only' here, or drops the field, a delivery-eligible operator
  // submission would be waived — which is finding 1 restored.
  const { soccer, repository } = structuredFallback({ distributionMode: 'delivery-eligible' });
  const outcome = await validateSmartFormRelationships(soccer, repository);
  assert.deepEqual(outcome, {
    kind: 'structured-team-fallback',
    distributionMode: 'delivery-eligible',
    // UTV2-1938: delivery-eligible without a server authorization record. Unchanged by the
    // waiver correction -- this caller still does not waive the event-existence gate.
    serverAuthorizedHumanDelivery: false,
  });
});

test('UTV2-1842: a fabricated structured matchup name is refused', async () => {
  // The exact case in the review: real away/home IDs, an invented event name.
  const { soccer, repository } = structuredFallback();
  soccer.eventName = 'Fake Finals';
  (soccer.metadata as Record<string, unknown>)['eventName'] = 'Fake Finals';
  ((soccer.metadata as Record<string, unknown>)['participantResolution'] as Record<string, unknown>)['eventName'] = 'Fake Finals';

  await assert.rejects(
    () => validateSmartFormRelationships(soccer, repository),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /does not name a matchup/);
      return true;
    },
  );
});

test('UTV2-1842: a structured matchup name naming the wrong teams is refused', async () => {
  // Well-formed as a matchup, so it survives the shape check, and wrong. This
  // is the assertion that goes red if the binding is weakened to "looks like
  // A @ B" without comparing the sides.
  const { soccer, repository } = structuredFallback();
  soccer.eventName = 'Arsenal @ Tottenham';
  (soccer.metadata as Record<string, unknown>)['eventName'] = 'Arsenal @ Tottenham';
  ((soccer.metadata as Record<string, unknown>)['participantResolution'] as Record<string, unknown>)['eventName'] = 'Arsenal @ Tottenham';

  await assert.rejects(
    () => validateSmartFormRelationships(soccer, repository),
    /does not match the verified structured matchup/,
  );
});

test('UTV2-1842: a structured matchup name with the sides reversed is refused', async () => {
  // Away and home are not interchangeable: the persisted name would assert the
  // wrong venue for a pick whose line depends on it.
  const { soccer, repository } = structuredFallback();
  soccer.eventName = 'Chelsea @ Arsenal';
  (soccer.metadata as Record<string, unknown>)['eventName'] = 'Chelsea @ Arsenal';
  ((soccer.metadata as Record<string, unknown>)['participantResolution'] as Record<string, unknown>)['eventName'] = 'Chelsea @ Arsenal';

  await assert.rejects(
    () => validateSmartFormRelationships(soccer, repository),
    /does not match the verified structured matchup/,
  );
});

test('UTV2-1842: each field carrying a matchup name is bound independently', async () => {
  // Binding only `payload.eventName` would leave two other fields as
  // fabrication surfaces. Each is checked against the verified sides rather
  // than against the others, so agreeing on a wrong name is not a way past it.
  for (const mutate of [
    (p: SubmissionPayload) => { p.eventName = 'Fake Finals'; },
    (p: SubmissionPayload) => { (p.metadata as Record<string, unknown>)['eventName'] = 'Fake Finals'; },
    (p: SubmissionPayload) => {
      ((p.metadata as Record<string, unknown>)['participantResolution'] as Record<string, unknown>)['eventName'] = 'Fake Finals';
    },
  ]) {
    const { soccer, repository } = structuredFallback();
    (soccer.metadata as Record<string, unknown>)['eventName'] = 'Arsenal @ Chelsea';
    mutate(soccer);
    await assert.rejects(
      () => validateSmartFormRelationships(soccer, repository),
      /does not name a matchup|does not match the verified structured matchup/,
    );
  }
});

test('UTV2-1842: the matchup name the Smart Form derives is accepted', async () => {
  // setDerivedMatchupName in BetForm.tsx writes exactly `${away} @ ${home}`
  // from the same canonical display names. A binding that refused this would
  // block the pilot rather than protect it, so the accept case is asserted
  // alongside the refusals — including the separator and doubleheader-suffix
  // variants the canonical path already tolerates.
  for (const name of [
    'Arsenal @ Chelsea',
    'Arsenal vs Chelsea',
    'Arsenal vs. Chelsea',
    'Arsenal at Chelsea',
    'arsenal @ chelsea',
    'Arsenal @ Chelsea · Game 2',
  ]) {
    const { soccer, repository } = structuredFallback();
    soccer.eventName = name;
    (soccer.metadata as Record<string, unknown>)['eventName'] = name;
    ((soccer.metadata as Record<string, unknown>)['participantResolution'] as Record<string, unknown>)['eventName'] = name;
    const outcome = await validateSmartFormRelationships(soccer, repository);
    assert.deepEqual(
      outcome,
      { kind: 'structured-team-fallback', distributionMode: 'track-only', serverAuthorizedHumanDelivery: false },
      `${name} must still be accepted`,
    );
  }
});

test('UTV2-1842: a manual coverage gap binds its flat metadata event name too', async () => {
  const manual = payload({
    sport: 'MMA',
    eventName: 'Fighter A vs Fighter B',
    participantResolution: {
      resolution: 'manual',
      sportId: 'MMA',
      eventId: null,
      manualOverride: true,
      reason: 'canonical-coverage-gap',
      enteredEventName: 'Fighter A vs Fighter B',
      enteredParticipants: [
        { role: 'competitor', displayName: 'Fighter A', canonicalParticipantId: null },
        { role: 'competitor', displayName: 'Fighter B', canonicalParticipantId: null },
      ],
    },
  });
  manual.eventName = 'Fighter A vs Fighter B';
  (manual.metadata as Record<string, unknown>)['eventName'] = 'Totally Different Card';

  await assert.rejects(
    () => validateSmartFormRelationships(manual, referenceData()),
    /does not match metadata eventName/,
  );
});

// ---------------------------------------------------------------------------
// UTV2-1853 -- server-side numeric guardrails
//
// SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md: "A value accepted by the form must be
// accepted by the API; a value rejected by the form must also be rejected by the API."
// Before this lane only the browser enforced the bounds, so a modified client, a replayed
// request, or a direct POST persisted values the contract forbids.
// ---------------------------------------------------------------------------

/** A payload whose *top-level* numeric fields can be overridden, unlike `payload()`. */
function numericPayload(overrides: Partial<SubmissionPayload> = {}): SubmissionPayload {
  return { ...payload(), ...overrides };
}

async function guardrailError(p: SubmissionPayload): Promise<{ status: number; code: string; message: string }> {
  try {
    await validateSmartFormRelationships(p, referenceData());
  } catch (error) {
    const e = error as { status?: number; code?: string; message?: string };
    return { status: e.status ?? 0, code: e.code ?? '', message: e.message ?? '' };
  }
  throw new Error('expected the submission to be refused, but it was accepted');
}

test('UTV2-1853: a contract-legal submission is still accepted (non-vacuity control)', async () => {
  // Without this the whole block could pass with a guard that refuses everything.
  const outcome = await validateSmartFormRelationships(
    numericPayload({ odds: -110, stakeUnits: 1.5, line: -3.5 }),
    referenceData(),
  );
  assert.equal(outcome.kind, 'canonical-event');
});

test('UTV2-1853: an absent odds or stakeUnits is accepted -- this guard bounds, it does not require', async () => {
  // `odds` and `stakeUnits` are optional in SubmissionPayload
  // (packages/contracts/src/submission.ts:21-22) and submit-pick.ts reads both through
  // readOptionalNumber. A bounds guard must not silently promote either to mandatory:
  // doing so is a field-presence contract change, and it refused three pre-existing
  // http-integration cases that post a legitimate odds-less Smart Form body.
  const noOdds = numericPayload({ stakeUnits: 1.5 });
  delete (noOdds as { odds?: number }).odds;
  assert.equal((await validateSmartFormRelationships(noOdds, referenceData())).kind, 'canonical-event');

  const noStake = numericPayload({ odds: -110 });
  delete (noStake as { stakeUnits?: number }).stakeUnits;
  assert.equal((await validateSmartFormRelationships(noStake, referenceData())).kind, 'canonical-event');
});

test('UTV2-1853: a non-finite odds or stakeUnits is still refused when it IS provided', async () => {
  // The complement of the test above: optional means "may be absent", never
  // "may be NaN". Without this pair, relaxing presence could be over-relaxed to
  // skipping validation entirely and every bounds test would still pass.
  const oddsErr = await guardrailError(numericPayload({ odds: Number.NaN }));
  assert.equal(oddsErr.code, 'SMART_FORM_GUARDRAIL_INVALID');
  assert.match(oddsErr.message, /odds must be a finite number when provided/);

  const stakeErr = await guardrailError(numericPayload({ stakeUnits: Number.NaN }));
  assert.equal(stakeErr.code, 'SMART_FORM_GUARDRAIL_INVALID');
  assert.match(stakeErr.message, /stakeUnits must be a finite number when provided/);
});

test('UTV2-1853: odds below the American minimum magnitude are refused', async () => {
  const err = await guardrailError(numericPayload({ odds: 7 }));
  assert.equal(err.status, 422);
  assert.equal(err.code, 'SMART_FORM_GUARDRAIL_INVALID');
  assert.match(err.message, /odds must be American format/);
});

test('UTV2-1853: odds above the American maximum magnitude are refused', async () => {
  const err = await guardrailError(numericPayload({ odds: -50001 }));
  assert.equal(err.code, 'SMART_FORM_GUARDRAIL_INVALID');
});

test('UTV2-1853: fractional odds are refused', async () => {
  const err = await guardrailError(numericPayload({ odds: 110.5 }));
  assert.match(err.message, /whole number/);
});

test('UTV2-1853: both American boundary values are accepted', async () => {
  for (const odds of [100, -100, 50000, -50000]) {
    const outcome = await validateSmartFormRelationships(numericPayload({ odds }), referenceData());
    assert.equal(outcome.kind, 'canonical-event', `odds ${odds} should be accepted`);
  }
});

test('UTV2-1853: a stake above the contract maximum is refused', async () => {
  // The shape a modified client produces: 500u at long odds.
  const err = await guardrailError(numericPayload({ stakeUnits: 500 }));
  assert.equal(err.code, 'SMART_FORM_GUARDRAIL_INVALID');
  assert.match(err.message, /stakeUnits must be between/);
});

test('UTV2-1853: a stake below the contract minimum is refused', async () => {
  const err = await guardrailError(numericPayload({ stakeUnits: 0.25 }));
  assert.match(err.message, /stakeUnits must be between/);
});

test('UTV2-1853: a stake off the 0.5 step is refused', async () => {
  const err = await guardrailError(numericPayload({ stakeUnits: 2.3 }));
  assert.match(err.message, /multiple of/);
});

test('UTV2-1853: every legal 0.5 step from 0.5 to 5.0 is accepted', async () => {
  for (let units = 0.5; units <= 5.0000001; units += 0.5) {
    const outcome = await validateSmartFormRelationships(
      numericPayload({ stakeUnits: Number(units.toFixed(1)) }),
      referenceData(),
    );
    assert.equal(outcome.kind, 'canonical-event', `stake ${units} should be accepted`);
  }
});

test('UTV2-1853: a line beyond the contract magnitude is refused', async () => {
  const err = await guardrailError(numericPayload({ line: 100000 }));
  assert.match(err.message, /line must be within/);
});

test('UTV2-1853: the line boundary is accepted and an absent line is not required', async () => {
  for (const line of [999.5, -999.5, undefined]) {
    const outcome = await validateSmartFormRelationships(
      numericPayload({ line }),
      referenceData(),
    );
    assert.equal(outcome.kind, 'canonical-event', `line ${String(line)} should be accepted`);
  }
});

test('UTV2-1853: conviction outside 1-10 is refused', async () => {
  const err = await guardrailError(payload({ capperConviction: 11 }));
  assert.equal(err.code, 'SMART_FORM_GUARDRAIL_INVALID');
  assert.match(err.message, /capperConviction must be between/);
});

test('UTV2-1853: the full 1-10 conviction range is accepted', async () => {
  for (let c = 1; c <= 10; c += 1) {
    const outcome = await validateSmartFormRelationships(
      payload({ capperConviction: c }),
      referenceData(),
    );
    assert.equal(outcome.kind, 'canonical-event', `conviction ${c} should be accepted`);
  }
});

test('UTV2-1853: the guard does not reach the legacy service-role smart-form label', async () => {
  // The UTV2-1672 trigger-scope guard runs first. A caller using `smart-form` as a plain
  // source label, carrying none of the Smart Form fields, must stay exempt -- otherwise
  // this lane silently retrofits the contract onto traffic it never governed.
  const legacy: SubmissionPayload = {
    source: 'smart-form',
    market: 'moneyline',
    selection: 'TCU',
    odds: 7,
    stakeUnits: 500,
  };
  const outcome = await validateSmartFormRelationships(legacy, referenceData());
  assert.equal(outcome.kind, 'not-smart-form');
});

test('UTV2-1853: the API bounds have not drifted from the client form schema', async () => {
  // packages never import from apps and apps never import from apps, so the bounds cannot
  // live in one shared module. This asserts the two copies still agree, the same way
  // UTV2-1688 bound the executor-result regexes to their workflow copy.
  const schemaPath = fileURLToPath(
    new URL('../../smart-form/lib/form-schema.ts', import.meta.url),
  );
  const schema = await readFile(schemaPath, 'utf8');

  const {
    SMART_FORM_ODDS_MIN_MAGNITUDE,
    SMART_FORM_ODDS_MAX_MAGNITUDE,
    SMART_FORM_UNITS_MIN,
    SMART_FORM_UNITS_MAX,
    SMART_FORM_CONVICTION_MIN,
    SMART_FORM_CONVICTION_MAX,
  } = await import('./smart-form-validation.js');

  assert.ok(schema.includes(String(SMART_FORM_ODDS_MIN_MAGNITUDE)), 'odds min drifted');
  assert.ok(schema.includes(String(SMART_FORM_ODDS_MAX_MAGNITUDE)), 'odds max drifted');
  assert.ok(schema.includes(`min(${SMART_FORM_UNITS_MIN}`), 'units min drifted');
  assert.ok(schema.includes(`max(${SMART_FORM_UNITS_MAX.toFixed(1)}`), 'units max drifted');
  assert.ok(schema.includes(`min(${SMART_FORM_CONVICTION_MIN}`), 'conviction min drifted');
  assert.ok(schema.includes(`max(${SMART_FORM_CONVICTION_MAX}`), 'conviction max drifted');
});

// UTV2-1938 SERVER_AUTHORIZED_HUMAN_DELIVERY_TESTS_START
// The outcome now carries a second fact besides the distribution mode: whether the SERVER
// wrote a delivery authorization for this submission. These tests fix where that fact comes
// from -- `isHumanCapperDeliveryAuthorized` over the pick metadata, and nothing else -- so a
// later change cannot quietly source it from a client-supplied field.

const authorizedDeliveryRecord = {
  version: 'human-capper-delivery/v1',
  decision: 'authorized',
  capperId: 'griff843',
  authority: 'server-allowlist',
  allowlistSource: 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST',
  decidedAt: '2026-09-18T00:00:00.000Z',
};

test('UTV2-1938: outcome reports no server authorization when metadata carries no record', async () => {
  const outcome = await validateSmartFormRelationships(payload(), referenceData());
  assert.equal(outcome.kind, 'canonical-event');
  assert.equal(
    (outcome as { serverAuthorizedHumanDelivery: boolean }).serverAuthorizedHumanDelivery,
    false,
  );
});

test('UTV2-1938: outcome reports server authorization when metadata carries an authorized record', async () => {
  const outcome = await validateSmartFormRelationships(
    payload({ distributionMode: 'delivery-eligible', deliveryAuthorization: authorizedDeliveryRecord }),
    referenceData(),
  );
  assert.equal(outcome.kind, 'canonical-event');
  assert.equal((outcome as { distributionMode: string }).distributionMode, 'delivery-eligible');
  assert.equal(
    (outcome as { serverAuthorizedHumanDelivery: boolean }).serverAuthorizedHumanDelivery,
    true,
  );
});

test('UTV2-1938: a refused authorization record does not read as authorization', async () => {
  const outcome = await validateSmartFormRelationships(
    payload({
      distributionMode: 'delivery-eligible',
      deliveryAuthorization: { ...authorizedDeliveryRecord, decision: 'refused', reason: 'capper_not_allowlisted' },
    }),
    referenceData(),
  );
  assert.equal(
    (outcome as { serverAuthorizedHumanDelivery: boolean }).serverAuthorizedHumanDelivery,
    false,
  );
});

test('UTV2-1938: a malformed authorization record does not read as authorization', async () => {
  // Exactly the shape a client would forge if `handlers/submit-pick.ts` ever stopped deleting
  // the field: `decision: 'authorized'` and nothing else that the reader requires.
  const outcome = await validateSmartFormRelationships(
    payload({ distributionMode: 'delivery-eligible', deliveryAuthorization: { decision: 'authorized' } }),
    referenceData(),
  );
  assert.equal(
    (outcome as { serverAuthorizedHumanDelivery: boolean }).serverAuthorizedHumanDelivery,
    false,
  );
});
// UTV2-1938 SERVER_AUTHORIZED_HUMAN_DELIVERY_TESTS_END

// ---------------------------------------------------------------------------
// WORK-2026110802: canonical teams + one manually entered player
//
// The operator's 2026-11-08 reproduction: Herro (threes) and Burries (rebounds) in Celtics @
// Bucks, and Dulcich (receptions) in Lions @ Dolphins, could not be saved because no contract
// admitted canonical teams beside an uncovered player. These pin the new rung: accepted only as
// Track Only, only after the server proves the gap itself, and never when the search failed.
// ---------------------------------------------------------------------------

type ManualPlayerShape = {
  sport: 'NBA' | 'NFL';
  away: { participantId: string; displayName: string };
  home: { participantId: string; displayName: string };
  team: { participantId: string; displayName: string };
  playerName: string;
  market: string;
  statType: string;
  line: number;
};

const celticsAtBucks = {
  away: { participantId: 'team-bos', displayName: 'Boston Celtics' },
  home: { participantId: 'team-mil', displayName: 'Milwaukee Bucks' },
};
const lionsAtDolphins = {
  away: { participantId: 'team-det', displayName: 'Detroit Lions' },
  home: { participantId: 'team-mia', displayName: 'Miami Dolphins' },
};

const herroShape: ManualPlayerShape = {
  sport: 'NBA',
  ...celticsAtBucks,
  team: celticsAtBucks.home,
  playerName: 'Tyler Herro',
  market: 'player.threes',
  statType: 'Threes',
  line: 2.5,
};
const burriesShape: ManualPlayerShape = {
  sport: 'NBA',
  ...celticsAtBucks,
  team: celticsAtBucks.away,
  playerName: 'Burries',
  market: 'player.rebounds',
  statType: 'Rebounds',
  line: 4.5,
};
const dulcichShape: ManualPlayerShape = {
  sport: 'NFL',
  ...lionsAtDolphins,
  team: lionsAtDolphins.away,
  playerName: 'Greg Dulcich',
  market: 'player.receptions',
  statType: 'Receptions',
  line: 3.5,
};

const teamIdentity = (side: { participantId: string; displayName: string }) => ({
  participantId: side.participantId,
  displayName: side.displayName,
  participantType: 'team',
});

function manualPlayerPayload(
  shape: ManualPlayerShape,
  overrides: {
    metadata?: Record<string, unknown>;
    resolution?: Record<string, unknown>;
    manualPlayer?: Record<string, unknown>;
  } = {},
): SubmissionPayload {
  const eventName = `${shape.away.displayName} @ ${shape.home.displayName}`;
  return {
    source: 'smart-form',
    market: shape.market,
    // Exactly what the form builds (form-utils buildSelectionString): player, stat, O/U, line.
    selection: `${shape.playerName} ${shape.statType} O ${shape.line}`,
    line: shape.line,
    eventName,
    odds: -110,
    stakeUnits: 1,
    confidence: 0.7,
    metadata: {
      sport: shape.sport,
      distributionMode: 'track-only',
      marketType: 'player-prop',
      statType: shape.statType,
      overUnder: 'over',
      player: shape.playerName,
      playerId: null,
      participantId: null,
      team: shape.team.displayName,
      teamId: shape.team.participantId,
      eventName,
      eventId: null,
      selectedOffer: null,
      playerProvenance: 'manual-coverage-gap',
      participantResolution: {
        resolution: 'canonical',
        sportId: shape.sport,
        eventId: null,
        eventName,
        away: teamIdentity(shape.away),
        home: teamIdentity(shape.home),
        team: teamIdentity(shape.team),
        player: null,
        manualPlayer: {
          displayName: shape.playerName,
          canonicalParticipantId: null,
          reason: 'canonical-coverage-gap',
          ...overrides.manualPlayer,
        },
        ...overrides.resolution,
      },
      ...overrides.metadata,
    },
  };
}

/**
 * The reference search's matching, `display_name ILIKE '%<query>%'`: `%` is any run, `_` any
 * one character, case-insensitive, NO accent folding (packages/db searchPlayers).
 */
function ilikeContains(displayName: string, query: string): boolean {
  const body = [...query]
    .map((character) =>
      character === '%' ? '.*' : character === '_' ? '.' : character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
    )
    .join('');
  return new RegExp(body, 'isu').test(displayName);
}

/**
 * Teams are canonical for both matchups. The NBA player catalog carries Jayson Tatum (the
 * production observation: Tatum is found) plus `extraPlayers`; the NFL player catalog is
 * empty, as in production. Searches behave like the real repository: ILIKE, sorted, limited.
 */
function manualPlayerRepository(
  options: {
    searchPlayers?: ReferenceDataRepository['searchPlayers'];
    extraPlayers?: Array<{ participantId: string; displayName: string }>;
  } = {},
): { repository: ReferenceDataRepository; playerQueries: string[] } {
  const repository = referenceData();
  const teams = [celticsAtBucks.away, celticsAtBucks.home, lionsAtDolphins.away, lionsAtDolphins.home];
  repository.searchTeams = async (_sportId, query) =>
    teams
      .filter((team) => team.displayName.toLowerCase().includes(query.toLowerCase()))
      .map((team) => ({ participantId: team.participantId, displayName: team.displayName }) as never);
  const players = [
    { participantId: 'player-tatum', displayName: 'Jayson Tatum', sport: 'NBA', teamId: 'team-bos' },
    ...(options.extraPlayers ?? []).map((player) => ({ ...player, sport: 'NBA', teamId: null })),
  ];
  const playerQueries: string[] = [];
  repository.searchPlayers =
    options.searchPlayers ??
    (async (sportId, query, limit = 20) => {
      playerQueries.push(query);
      return players
        .filter((player) => player.sport === sportId && ilikeContains(player.displayName, query))
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .slice(0, limit)
        .map((player) => ({ ...player, participantType: 'player' }) as never);
    });
  return { repository, playerQueries };
}

for (const [label, shape] of [
  ['Herro (NBA threes, Celtics @ Bucks)', herroShape],
  ['Burries (NBA rebounds, Celtics @ Bucks)', burriesShape],
  ['Dulcich (NFL receptions, Lions @ Dolphins, no player coverage at all)', dulcichShape],
] as const) {
  test(`WORK-2026110802: accepts canonical teams + manual player ${label} as Track Only`, async () => {
    const { repository, playerQueries } = manualPlayerRepository();
    const outcome = await validateSmartFormRelationships(manualPlayerPayload(shape), repository);
    assert.deepEqual(outcome, {
      kind: 'structured-team-fallback',
      distributionMode: 'track-only',
      serverAuthorizedHumanDelivery: false,
    });
    // Non-vacuity: the gap was proved by searching, not assumed.
    assert.ok(playerQueries.length > 0, 'the server must search players before accepting a manual player');
  });
}

test('WORK-2026110802: refuses a manual player whose name resolves to a canonical player, naming the match', async () => {
  for (const playerName of ['Jayson Tatum', 'Tatum', 'jayson  TATUM.']) {
    const { repository } = manualPlayerRepository();
    await assert.rejects(
      () => validateSmartFormRelationships(manualPlayerPayload({ ...herroShape, team: celticsAtBucks.away, playerName }), repository),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, 'SMART_FORM_RELATIONSHIP_INVALID');
        assert.match(error.message, /claims a coverage gap, but resolves to canonical player player-tatum \(Jayson Tatum\)/);
        return true;
      },
      `"${playerName}" must be refused as covered`,
    );
  }
});

test('WORK-2026110802: a player search error is retryable and never recorded as a coverage gap', async () => {
  const { repository } = manualPlayerRepository({
    searchPlayers: async () => {
      throw new Error('connection reset');
    },
  });
  await assert.rejects(
    () => validateSmartFormRelationships(manualPlayerPayload(herroShape), repository),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'SMART_FORM_REFERENCE_SEARCH_UNAVAILABLE');
      assert.match(error.message, /never recorded as a coverage gap/);
      return true;
    },
  );
});

test('WORK-2026110802: a player search that times out is retryable and never recorded as a coverage gap', async () => {
  const { repository } = manualPlayerRepository({
    searchPlayers: () => new Promise(() => undefined),
  });
  await assert.rejects(
    () =>
      validateSmartFormRelationships(manualPlayerPayload(dulcichShape), repository, {
        manualPlayerSearchTimeoutMs: 20,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'SMART_FORM_REFERENCE_SEARCH_UNAVAILABLE');
      assert.match(error.message, /timed out/);
      return true;
    },
  );
});

test('WORK-2026110802: refuses delivery-eligible with a manual player, with or without a server delivery authorization', async () => {
  const authorized = {
    version: 'human-capper-delivery/v1',
    decision: 'authorized',
    capperId: 'griff843',
    authority: 'server-allowlist',
    allowlistSource: 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST',
    decidedAt: '2026-11-10T00:00:00.000Z',
  };
  for (const metadata of [
    { distributionMode: 'delivery-eligible' },
    { distributionMode: 'delivery-eligible', deliveryAuthorization: authorized },
  ]) {
    const { repository } = manualPlayerRepository();
    await assert.rejects(
      () => validateSmartFormRelationships(manualPlayerPayload(herroShape, { metadata }), repository),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, 'SMART_FORM_MANUAL_PLAYER_TRACK_ONLY_REQUIRED');
        assert.match(error.message, /accepted only as Track Only/);
        return true;
      },
    );
  }
});

test('WORK-2026110802: refuses a manual player beside a canonical player selection', async () => {
  const { repository } = manualPlayerRepository();
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPlayerPayload(herroShape, {
          resolution: {
            player: { participantId: 'player-tatum', displayName: 'Jayson Tatum', participantType: 'player', teamId: 'team-bos' },
          },
        }),
        repository,
      ),
    /manualPlayer and a canonical player selection are mutually exclusive/,
  );
});

test('WORK-2026110802: refuses a manual player beside a canonical event id', async () => {
  const { repository } = manualPlayerRepository();
  await assert.rejects(
    () => validateSmartFormRelationships(manualPlayerPayload(herroShape, { resolution: { eventId: 'event-nba-1' } }), repository),
    /manualPlayer cannot be combined with a canonical event/,
  );
});

test('WORK-2026110802: refuses a manual player in a sport with no structured team fallback', async () => {
  const { repository } = manualPlayerRepository();
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPlayerPayload(herroShape, { metadata: { sport: 'MMA' }, resolution: { sportId: 'MMA' } }),
        repository,
      ),
    /manualPlayer requires a team-sport structured fallback/,
  );
});

test('WORK-2026110802: refuses a manual player that carries a canonical participant id', async () => {
  const { repository } = manualPlayerRepository();
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPlayerPayload(herroShape, { manualPlayer: { canonicalParticipantId: 'player-tatum' } }),
        repository,
      ),
    /manualPlayer must have canonicalParticipantId=null/,
  );
});

test('WORK-2026110802: refuses a flat canonical playerId beside a manual player', async () => {
  for (const key of ['playerId', 'participantId']) {
    const { repository } = manualPlayerRepository();
    await assert.rejects(
      () => validateSmartFormRelationships(manualPlayerPayload(herroShape, { metadata: { [key]: 'player-herro' } }), repository),
      new RegExp(`${key} does not match participantResolution`),
    );
  }
});

test('WORK-2026110802: refuses a client playerProvenance claim without a manual player', async () => {
  const canonicalWithClaim = structuredNoEventPayload({ ...structuredPlayer });
  (canonicalWithClaim.metadata as Record<string, unknown>)['playerProvenance'] = 'manual-coverage-gap';
  await assert.rejects(
    () => validateSmartFormRelationships(canonicalWithClaim, structuredNoEventRepository()),
    /metadata.playerProvenance is only valid beside participantResolution.manualPlayer/,
  );
});

test('WORK-2026110802: refuses a manual player carrying a provider offer', async () => {
  const { repository } = manualPlayerRepository();
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPlayerPayload(herroShape, {
          metadata: { selectedOffer: { providerKey: 'sgo', providerMarketKey: 'x', providerParticipantId: 'y', snapshotAt: null } },
        }),
        repository,
      ),
    /manual player makes no provider-verified claim/,
  );
});

test('WORK-2026110802: refuses manualPlayer on the all-manual coverage-gap resolution', async () => {
  const { repository } = manualPlayerRepository();
  const built = manualPlayerPayload(herroShape);
  (built.metadata as Record<string, unknown>)['participantResolution'] = {
    resolution: 'manual',
    sportId: 'NBA',
    eventId: null,
    manualOverride: true,
    reason: 'canonical-coverage-gap',
    enteredEventName: built.eventName,
    enteredParticipants: [],
    manualPlayer: { displayName: 'Tyler Herro', canonicalParticipantId: null, reason: 'canonical-coverage-gap' },
  };
  await assert.rejects(
    () => validateSmartFormRelationships(built, repository),
    /manualPlayer is only valid on a structured team fallback/,
  );
});

test('WORK-2026110802: the teams beside a manual player are verified exactly as for any structured fallback', async () => {
  const { repository } = manualPlayerRepository();
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPlayerPayload(herroShape, {
          metadata: { team: 'Detroit Lions', teamId: 'team-det' },
          resolution: { team: teamIdentity(lionsAtDolphins.away) },
        }),
        repository,
      ),
    /is not canonical for sport NBA|is not part of the structured matchup/,
  );
});

// ── WORK-2026110802 PM changes (2026-11-11) ────────────────────────────────────

function assertCoveredRefusal(error: unknown, participantId = 'player-tatum') {
  assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
  assert.equal(error.code, 'SMART_FORM_RELATIONSHIP_INVALID');
  assert.match(error.message, new RegExp(`claims a coverage gap, but resolves to canonical player ${participantId}`));
  return true;
}

test('WORK-2026110802 F2: punctuation, alias-token and confusable spellings of a covered player are refused', async () => {
  // Each of these escaped the whitespace-only query split: the only queries built were the
  // unsplit word, which ILIKE matches against nothing, so Tatum read as a coverage gap.
  for (const playerName of [
    'Jayson.Tatum',
    'Jayson-Tatum',
    'Jayson,Tatum',
    'Jayson/Tatum',
    '  Jayson .-/ Tatum  ',
    'Jayson. Tatum,',
    'Tatum.', // last name only, trailing punctuation
    // Look-alike and invisible characters are no longer folded but refused outright (P3):
    // see "a manual player name with invisible or look-alike characters is refused".
  ]) {
    const { repository, playerQueries } = manualPlayerRepository();
    await assert.rejects(
      () =>
        validateSmartFormRelationships(
          manualPlayerPayload({ ...herroShape, team: celticsAtBucks.away, playerName }),
          repository,
        ),
      (error: unknown) => assertCoveredRefusal(error),
      `"${playerName}" must be refused as covered (queries: ${JSON.stringify(playerQueries)})`,
    );
  }
});

test('WORK-2026110802 F2: the full-name query runs first, so the match is found before any one-word query', async () => {
  const { repository, playerQueries } = manualPlayerRepository();
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPlayerPayload({ ...herroShape, team: celticsAtBucks.away, playerName: 'Jayson/Tatum' }),
        repository,
      ),
    (error: unknown) => assertCoveredRefusal(error),
  );
  // "jayson" keeps one literal letter as a pattern, so it is searched plain; "tatum" is
  // accent-tolerant.
  assert.deepEqual(playerQueries, ['jayson%t_t_m']);
});

/**
 * A catalog that behaves like the real repository: `ILIKE '%q%' ORDER BY display_name LIMIT n`.
 * More "Smithers" players than the row limit sort before the one true "Smith".
 */
function truncatingRepository(): { repository: ReferenceDataRepository; limits: number[] } {
  const { repository } = manualPlayerRepository();
  const players = [
    ...Array.from({ length: MANUAL_PLAYER_SEARCH_ROW_LIMIT + 20 }, (_, index) => ({
      participantId: `player-smithers-${index}`,
      displayName: `Aa${String(index).padStart(3, '0')} Smithers`,
    })),
    { participantId: 'player-zed-smith', displayName: 'Zed Smith' },
    ...Array.from({ length: 40 }, (_, index) => ({
      participantId: `player-tyler-${index}`,
      displayName: `Tyler Aa${String(index).padStart(3, '0')}`,
    })),
  ];
  const limits: number[] = [];
  repository.searchPlayers = async (_sportId, query, limit = 20) => {
    limits.push(limit);
    return players
      .filter((player) => ilikeContains(player.displayName, query))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .slice(0, limit)
      .map((player) => ({ ...player, sport: 'NBA', teamId: null }) as never);
  };
  return { repository, limits };
}

test('WORK-2026110802 F2: a true match past a common-token page is still found by the exact full-name query', async () => {
  const { repository } = truncatingRepository();
  await assert.rejects(
    () =>
      validateSmartFormRelationships(
        manualPlayerPayload({ ...herroShape, playerName: 'Zed.Smith' }),
        repository,
      ),
    (error: unknown) => assertCoveredRefusal(error, 'player-zed-smith'),
  );
});

test('WORK-2026110802 F2: a saturated decisive search fails closed instead of recording a gap', async () => {
  // "Smith" alone: every true match ends in "smith", the "smith" search returns a full page
  // of Smithers, and Zed Smith sits past the row limit. The gap is not proved.
  const { repository, limits } = truncatingRepository();
  await assert.rejects(
    () => validateSmartFormRelationships(manualPlayerPayload({ ...herroShape, playerName: 'Smith' }), repository),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 422);
      assert.equal(error.code, 'SMART_FORM_MANUAL_PLAYER_UNVERIFIABLE');
      return true;
    },
  );
  assert.ok(limits.every((limit) => limit === MANUAL_PLAYER_SEARCH_ROW_LIMIT));
});

test('WORK-2026110802 F2: a saturated first-name search does not block a genuinely uncovered player', async () => {
  // 40 Tylers exceed the form's 25-row page but not the gap proof's row limit, and none of
  // them is plausibly Tyler Herro.
  const { repository } = truncatingRepository();
  const outcome = await validateSmartFormRelationships(manualPlayerPayload(herroShape), repository);
  assert.equal(outcome.kind, 'structured-team-fallback');
});

test('WORK-2026110802 F3: the server stamps provenance and manual labels, overwriting the client values', async () => {
  for (const clientLabels of [
    { playerProvenance: 'provider', manualEntry: false, manualOverrideFields: [] },
    { playerProvenance: undefined, manualEntry: undefined, manualOverrideFields: undefined },
    { playerProvenance: 'manual-coverage-gap', manualEntry: false, manualOverrideFields: ['sportsbook', 'player', 'player'] },
    { playerProvenance: null, manualEntry: 'yes', manualOverrideFields: 'player' },
  ]) {
    const { repository } = manualPlayerRepository();
    const payload = manualPlayerPayload(herroShape, { metadata: clientLabels });
    await validateSmartFormRelationships(payload, repository);
    assert.equal(payload.metadata?.['playerProvenance'], manualPlayerProvenance);
    assert.equal(payload.metadata?.['manualEntry'], true);
    const fields = payload.metadata?.['manualOverrideFields'];
    assert.ok(Array.isArray(fields));
    assert.deepEqual(
      fields,
      Array.isArray(clientLabels.manualOverrideFields) && clientLabels.manualOverrideFields.includes('sportsbook')
        ? ['sportsbook', 'player']
        : ['player'],
    );
  }
});

test('WORK-2026110802 F3: a refused manual player is never stamped', async () => {
  const { repository } = manualPlayerRepository();
  const payload = manualPlayerPayload(
    { ...herroShape, team: celticsAtBucks.away, playerName: 'Jayson Tatum' },
    { metadata: { playerProvenance: undefined, manualEntry: false, manualOverrideFields: [] } },
  );
  await assert.rejects(() => validateSmartFormRelationships(payload, repository));
  assert.equal(payload.metadata?.['playerProvenance'], undefined);
  assert.equal(payload.metadata?.['manualEntry'], false);
});

test('WORK-2026110802 F4: manualPlayer is a strict allow-list of fields', async () => {
  for (const extra of [{ teamId: 'team-mil' }, { participantId: null }, { verified: true }]) {
    const { repository, playerQueries } = manualPlayerRepository();
    await assert.rejects(
      () => validateSmartFormRelationships(manualPlayerPayload(herroShape, { manualPlayer: extra }), repository),
      new RegExp(`manualPlayer carries unsupported field\\(s\\): ${Object.keys(extra)[0]}`),
    );
    assert.equal(playerQueries.length, 0, 'a malformed manualPlayer is refused before any search');
  }
});

test('WORK-2026110802 F4: manualPlayer.displayName is length-, word- and character-bounded', async () => {
  const atLimit = 'A'.repeat(MANUAL_PLAYER_DISPLAY_NAME_MAX_LENGTH);
  const accepted = manualPlayerRepository();
  const outcome = await validateSmartFormRelationships(
    manualPlayerPayload({ ...herroShape, playerName: atLimit }),
    accepted.repository,
  );
  assert.equal(outcome.kind, 'structured-team-fallback', 'a name exactly at the limit is accepted');

  for (const [playerName, pattern] of [
    [`${atLimit}B`, /at most 80 characters/],
    ['x'.repeat(10_000), /at most 80 characters/],
    ['Aa Bb Cc Dd Ee Ff Gg', /at most 6 words/],
    ['Tyler\nHerro', /unsupported characters/],
    ['Tyler\u0000Herro', /unsupported characters/],
    ['.-/,', /must name a player/],
  ] as const) {
    const { repository, playerQueries } = manualPlayerRepository();
    await assert.rejects(
      () => validateSmartFormRelationships(manualPlayerPayload({ ...herroShape, playerName }), repository),
      pattern,
    );
    assert.equal(playerQueries.length, 0, `"${playerName.slice(0, 20)}" is refused before any search`);
  }
});

test('WORK-2026110802 F4: the number of coverage searches is bounded for a worst-case admitted name', async () => {
  const { repository, playerQueries } = manualPlayerRepository();
  await validateSmartFormRelationships(
    // Six long tokens: every per-token and concatenation query is generated.
    manualPlayerPayload({ ...herroShape, playerName: 'Bartholo Cristobal Fernando Gonzalez Matthias Lorenzon' }),
    repository,
  );
  // At most 1 full-name + 6 x (plain + 3 accent-tolerant) + 6 x 4 concatenation probes = 49;
  // this name yields fewer only where two forms coincide.
  assert.ok(playerQueries.length >= 40, `${playerQueries.length}: ${JSON.stringify(playerQueries)}`);
  assert.ok(
    playerQueries.length <= MANUAL_PLAYER_MAX_SEARCHES,
    `${playerQueries.length} searches exceed the ${MANUAL_PLAYER_MAX_SEARCHES} cap: ${JSON.stringify(playerQueries)}`,
  );
});

test('WORK-2026110802 F4: exhausting the total search budget is retryable and never records a gap', async () => {
  // Every search answers -- slowly. No single search times out, but together they exceed the
  // budget, so the proof is unfinished and the gap is not recorded.
  const { repository } = manualPlayerRepository({
    searchPlayers: () => new Promise((resolve) => setTimeout(() => resolve([]), 25)),
  });
  await assert.rejects(
    () =>
      validateSmartFormRelationships(manualPlayerPayload(herroShape), repository, {
        manualPlayerSearchTimeoutMs: 1_000,
        manualPlayerSearchBudgetMs: 40,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'SMART_FORM_REFERENCE_SEARCH_UNAVAILABLE');
      assert.match(error.message, /budget of 40ms exhausted|timed out after/);
      return true;
    },
  );
});

test('WORK-2026110802 F4: a malformed search response is retryable and never records a gap', async () => {
  const { repository } = manualPlayerRepository({
    searchPlayers: async () => null as never,
  });
  await assert.rejects(
    () => validateSmartFormRelationships(manualPlayerPayload(herroShape), repository),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------
// WORK-2026110802 review round 2 (P1-A, P1-B, P1-C, P2-A, P3). Names seeded from the reviewer's
// probe.mts / probe2.mts.
// ---------------------------------------------------------------------------------------------

async function assertRefusedBeforeSearch(
  payload: SubmissionPayload,
  pattern: RegExp,
  options: { extraPlayers?: Array<{ participantId: string; displayName: string }> } = {},
) {
  const { repository, playerQueries } = manualPlayerRepository(options);
  await assert.rejects(
    () => validateSmartFormRelationships(payload, repository),
    (error: unknown) => {
      assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
      assert.equal(error.status, 422);
      assert.match(error.message, pattern);
      return true;
    },
    `${JSON.stringify(payload.selection)} / ${JSON.stringify(payload.metadata?.['player'])} must be refused`,
  );
  assert.equal(playerQueries.length, 0, 'refused before any coverage search');
}

const accentedCatalog = [
  { participantId: 'player-munoz', displayName: 'Andrés Muñoz' },
  { participantId: 'player-jokic', displayName: 'Nikola Jokić' },
  { participantId: 'player-stutzle', displayName: 'Tim Stützle' },
  { participantId: 'player-schroder', displayName: 'Dennis Schröder' },
  { participantId: 'player-slafkovsky', displayName: 'Juraj Slafkovský' },
  { participantId: 'player-gimenez', displayName: 'Andrés Giménez' },
  { participantId: 'player-ramirez', displayName: 'Agustín Ramírez' },
  { participantId: 'player-doncic', displayName: 'Luka Dončić' },
];

test('WORK-2026110802 P1-A: the ASCII spelling of an accented catalog player is refused as covered', async () => {
  for (const [playerName, participantId] of [
    ['Andres Munoz', 'player-munoz'],
    ['Munoz', 'player-munoz'],
    ['Nikola Jokic', 'player-jokic'],
    ['Jokic', 'player-jokic'],
    ['NikolaJokic', 'player-jokic'],
    ['Tim Stutzle', 'player-stutzle'],
    ['Dennis Schroder', 'player-schroder'],
    ['Juraj Slafkovsky', 'player-slafkovsky'],
    ['Andres Gimenez', 'player-gimenez'],
    ['Agustin Ramirez', 'player-ramirez'],
    ['Luka Doncic', 'player-doncic'],
  ] as const) {
    const { repository, playerQueries } = manualPlayerRepository({ extraPlayers: accentedCatalog });
    await assert.rejects(
      () => validateSmartFormRelationships(manualPlayerPayload({ ...herroShape, playerName }), repository),
      (error: unknown) => assertCoveredRefusal(error, participantId),
      `"${playerName}" must be refused as ${participantId} (queries: ${JSON.stringify(playerQueries)})`,
    );
  }
});

test('WORK-2026110802 P1-A: coverage queries carry only folded letters, digits and the two ILIKE wildcards', async () => {
  const { repository, playerQueries } = manualPlayerRepository({ extraPlayers: accentedCatalog });
  const outcome = await validateSmartFormRelationships(
    manualPlayerPayload({ ...herroShape, playerName: "Renée O'Neil-Smith Jr." }),
    repository,
  );
  assert.equal(outcome.kind, 'structured-team-fallback');
  assert.ok(playerQueries.length > 0);
  for (const query of playerQueries) assert.match(query, /^[a-z0-9_%]+$/u);
  // Accent tolerance is in the patterns: "renee" searches as "r_n__".
  assert.ok(playerQueries.includes('r_n__'), JSON.stringify(playerQueries));
  // A wildcard can never come from the entered name: it is a refused character.
  for (const playerName of ['Jayson%Tatum', 'Jay_son Tatum', 'Jayson\\Tatum', '%', '_']) {
    await assertRefusedBeforeSearch(manualPlayerPayload({ ...herroShape, playerName }), /unsupported characters/);
  }
});

test('WORK-2026110802 P1-A: an accent-tolerant search that saturates without a covering row fails closed', async () => {
  // "Munoz" is not in this catalog, but more rows than the row limit match "m_n_z", so a
  // covering row could sit past the page. The gap is not proved.
  const { repository } = manualPlayerRepository({
    extraPlayers: Array.from({ length: MANUAL_PLAYER_SEARCH_ROW_LIMIT }, (_, index) => ({
      participantId: `player-mendez-${index}`,
      displayName: `Aa${String(index).padStart(3, '0')} Manoz`,
    })),
  });
  await assert.rejects(
    () => validateSmartFormRelationships(manualPlayerPayload({ ...herroShape, playerName: 'Andres Munoz' }), repository),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'SMART_FORM_MANUAL_PLAYER_UNVERIFIABLE');
      return true;
    },
  );
});

test('WORK-2026110802 P1-A: a covering row deep in a common-surname page is found, not reported unverifiable', async () => {
  // 150 "Smithers" sort before "Zed Smith": past the form's 25 and past 100 rows, but inside
  // the gap proof's row limit, so the proof still sees the true match and names it.
  const { repository } = manualPlayerRepository({
    extraPlayers: [
      ...Array.from({ length: 150 }, (_, index) => ({
        participantId: `player-smithers-${index}`,
        displayName: `Aa${String(index).padStart(3, '0')} Smithers`,
      })),
      { participantId: 'player-zed-smith', displayName: 'Zed Smith' },
    ],
  });
  assert.ok(MANUAL_PLAYER_SEARCH_ROW_LIMIT > 151);
  await assert.rejects(
    () => validateSmartFormRelationships(manualPlayerPayload({ ...herroShape, playerName: 'Smith' }), repository),
    (error: unknown) => assertCoveredRefusal(error, 'player-zed-smith'),
  );
});

const nameVariantCatalog = [
  { participantId: 'player-jjj', displayName: 'Jaren Jackson Jr.' },
  { participantId: 'player-trent', displayName: 'Gary Trent' },
  { participantId: 'player-mcconnell', displayName: 'T.J. McConnell' },
  { participantId: 'player-oubre', displayName: 'Kelly Oubre Jr.' },
  { participantId: 'player-sga', displayName: 'Shai Gilgeous-Alexander' },
  { participantId: 'player-fox', displayName: "De'Aaron Fox" },
];

test('WORK-2026110802 P1-B: reordered, concatenated, decorated, initialed and suffixed spellings are refused as covered', async () => {
  for (const [playerName, participantId] of [
    ['Tatum, Jayson', 'player-tatum'],
    ['Tatum Jayson', 'player-tatum'],
    ['JaysonTatum', 'player-tatum'],
    ['TatumJayson', 'player-tatum'],
    ['Jayson Tatum BOS', 'player-tatum'],
    ['Jayson Tatum 0', 'player-tatum'],
    ['Jayson Tatum #0', 'player-tatum'],
    ['Jayson Tatum (BOS)', 'player-tatum'],
    ['Jayson "JT" Tatum', 'player-tatum'],
    ['J. Tatum', 'player-tatum'],
    ['J Tatum', 'player-tatum'],
    ['Jayson Tatum Jr.', 'player-tatum'],
    ['Jayson Tatum III', 'player-tatum'],
    ['Jaren Jackson', 'player-jjj'],
    ['Jaren Jackson Jr', 'player-jjj'],
    ['Jaren Jackson II', 'player-jjj'],
    ['Gary Trent Jr.', 'player-trent'],
    ['Gary Trent IV', 'player-trent'],
    ['TJ McConnell', 'player-mcconnell'],
    ['T J McConnell', 'player-mcconnell'],
    ['McConnell', 'player-mcconnell'],
    ['Kelly Oubre', 'player-oubre'],
    ['Gilgeous-Alexander', 'player-sga'],
    ['Shai Alexander', 'player-sga'],
    ['Shai Gilgeous-Alexander OKC', 'player-sga'],
    ['Alexander, Shai Gilgeous (OKC)', 'player-sga'],
    ['DeAaron Fox', 'player-fox'],
    ['De Aaron Fox', 'player-fox'],
    ['DeAaron', 'player-fox'],
    ['DeAaron Fox SAC', 'player-fox'],
    ['McConnell, JT', 'player-mcconnell'],
    ['Jayson', 'player-tatum'],
  ] as const) {
    const { repository, playerQueries } = manualPlayerRepository({ extraPlayers: nameVariantCatalog });
    await assert.rejects(
      () =>
        validateSmartFormRelationships(
          manualPlayerPayload({ ...herroShape, team: celticsAtBucks.away, playerName }),
          repository,
        ),
      (error: unknown) => assertCoveredRefusal(error, participantId),
      `"${playerName}" must be refused as ${participantId} (queries: ${JSON.stringify(playerQueries)})`,
    );
  }
});

test('WORK-2026110802 P1-B: a different player who only shares a surname or given name is still a gap', async () => {
  // Non-vacuity for the matcher: it is broad, not "refuse anything that shares a word".
  for (const playerName of ['Jaylen Tatum', 'Marcus Jackson', 'Jayson Williams', 'Gary Payton', 'Tyler Herro']) {
    const { repository, playerQueries } = manualPlayerRepository({ extraPlayers: nameVariantCatalog });
    const outcome = await validateSmartFormRelationships(manualPlayerPayload({ ...herroShape, playerName }), repository);
    assert.equal(outcome.kind, 'structured-team-fallback', `"${playerName}" is a genuine gap`);
    assert.ok(playerQueries.length > 0);
  }
});

test('WORK-2026110802 P1-C: a manual player is accepted only on a player-prop market', async () => {
  for (const [market, marketType] of [
    ['moneyline', 'moneyline'],
    ['total', 'total'],
    ['spread', undefined],
    ['player.threes', 'game-line'],
    ['player.threes', 'moneyline'],
  ] as const) {
    await assertRefusedBeforeSearch(
      manualPlayerPayload({ ...herroShape, market }, { metadata: { marketType } }),
      /accepted only on a player-prop market/,
    );
  }
});

test('WORK-2026110802 P1-C: the selection must be the manual player prop and name nobody else', async () => {
  for (const selection of [
    'Jayson Tatum Threes O 2.5',
    'Tyler Herro Threes O 2.5 Jayson Tatum',
    'Tyler Herro / Jayson Tatum Threes O 2.5',
    'Tatum Threes O 2.5',
    'Tyler Herro Threes U 2.5',
    'Tyler Herro Threes O 3.5',
    'Tyler Herro Points O 2.5',
    'Celtics ML',
  ]) {
    await assertRefusedBeforeSearch(
      { ...manualPlayerPayload(herroShape), selection },
      /selection must be the manual player's prop/,
    );
  }
});

test('WORK-2026110802 P1-C: flat metadata.player and statType cannot name another player', async () => {
  // A string mismatch is already refused by the flat-identity check; a non-string flat player
  // slipped past it (readOptionalString ignores it) and is refused by the binding.
  await assertRefusedBeforeSearch(
    manualPlayerPayload(herroShape, { metadata: { player: 'Jayson Tatum' } }),
    /player display does not match participantResolution|metadata.player must be the manual player/,
  );
  for (const player of [['Jayson Tatum'], { name: 'Jayson Tatum' }, 7]) {
    await assertRefusedBeforeSearch(
      manualPlayerPayload(herroShape, { metadata: { player } }),
      /metadata.player must be the manual player/,
    );
  }
  await assertRefusedBeforeSearch(
    {
      ...manualPlayerPayload(herroShape, { metadata: { statType: 'Jayson Tatum' } }),
      selection: 'Tyler Herro Jayson Tatum O 2.5',
    },
    /is not a NBA stat type/,
  );
  for (const statType of [7, 'x'.repeat(41), ['Threes']]) {
    await assertRefusedBeforeSearch(
      manualPlayerPayload(herroShape, { metadata: { statType } }),
      /must be a catalog stat type/,
    );
  }
});

test('WORK-2026110802 P1-C: the form-built selections still pass, in any case or spacing', async () => {
  for (const [selection, metadata] of [
    ['Tyler Herro Threes O 2.5', {}],
    ['tyler  HERRO threes o 2.5', {}],
    ['Tyler Herro Threes U 2.5', { overUnder: 'under' }],
    ['Tyler Herro Points + Rebounds O 2.5', { statType: 'Points + Rebounds' }],
    ['Tyler Herro O 2.5', { statType: undefined }],
    ['Tyler Herro Threes O 2.5', { player: undefined, marketType: undefined }],
  ] as const) {
    const { repository } = manualPlayerRepository();
    const outcome = await validateSmartFormRelationships(
      { ...manualPlayerPayload(herroShape, { metadata }), selection },
      repository,
    );
    assert.equal(outcome.kind, 'structured-team-fallback', selection);
  }
});

test('WORK-2026110802 P2-A: manual-player markers are refused on any non-Smart-Form submission', async () => {
  const marked: SubmissionPayload[] = [
    { source: 'api', market: 'player.points', selection: 'Jayson Tatum O 27.5', metadata: { playerProvenance: manualPlayerProvenance } },
    { source: 'discord-bot', market: 'player.points', selection: 'X', metadata: { playerProvenance: 'anything' } },
    {
      source: 'api',
      market: 'player.points',
      selection: 'Jayson Tatum O 27.5',
      metadata: { participantResolution: { manualPlayer: { displayName: 'Jayson Tatum' } } },
    },
    // The legacy `smart-form` label without Smart Form fields takes the not-smart-form path too.
    { source: 'smart-form', market: 'player.points', selection: 'Jayson Tatum O 27.5', metadata: { playerProvenance: manualPlayerProvenance } },
  ];
  for (const submission of marked) {
    await assert.rejects(
      () => validateSmartFormRelationships(submission, referenceData()),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 422);
        assert.match(error.message, /accepted only on a Smart Form submission/);
        return true;
      },
      JSON.stringify(submission),
    );
  }
  // Controls: the same traffic without the markers is untouched.
  for (const submission of [
    { source: 'api', market: 'player.points', selection: 'Jayson Tatum O 27.5', metadata: { player: 'Jayson Tatum' } },
    { source: 'api', market: 'player.points', selection: 'Jayson Tatum O 27.5' },
    { source: 'smart-form', market: 'player.points', selection: 'X', metadata: { playerProvenance: null } },
    { source: 'api', market: 'player.points', selection: 'X', metadata: { participantResolution: { manualPlayer: null } } },
  ] as SubmissionPayload[]) {
    assert.deepEqual(await validateSmartFormRelationships(submission, referenceData()), { kind: 'not-smart-form' });
  }
});

test('WORK-2026110802 P3: a manual player name with invisible or look-alike characters is refused', async () => {
  for (const [playerName, pattern] of [
    ['Jаyson Tatum', /unsupported characters/], // Cyrillic a
    ['Τatum', /unsupported characters/], // Greek capital tau
    ['Ｊayson Tatum', /unsupported characters/], // fullwidth J
    ['ﬁnley', /unsupported characters/], // fi ligature
    ['Jay​son Tatum', /unsupported characters/], // zero-width space
    ['Jayson⁠Tatum', /unsupported characters/], // word joiner
    ['Jayson‮Tatum', /unsupported characters/], // right-to-left override
    ['Tatum\u{e0061}', /unsupported characters/], // tag character
    ['Tatum҉', /unsupported characters/], // combining enclosing mark
    ['Jayson　Tatum', /unsupported characters/], // ideographic space
    ['Jayson Tatum', /unsupported characters/], // no-break space
    ['Jayson\tTatum', /unsupported characters/],
    ['Muñoz', /composed \(NFC\)/], // decomposed n + combining tilde
  ] as const) {
    await assertRefusedBeforeSearch(manualPlayerPayload({ ...herroShape, playerName }), pattern);
  }
});

test('WORK-2026110802 P3: an accepted manual player persists exactly the validated name', async () => {
  for (const playerName of ["Renée O’Neil-Smith Jr.", 'Zoë Ålund', "Ny'Quan Brown #7 (Rookie)", 'Iñaki Peña']) {
    const { repository } = manualPlayerRepository({ extraPlayers: accentedCatalog });
    const payload = manualPlayerPayload({ ...herroShape, playerName });
    const outcome = await validateSmartFormRelationships(payload, repository);
    assert.equal(outcome.kind, 'structured-team-fallback', playerName);
    const resolution = payload.metadata?.['participantResolution'] as Record<string, unknown>;
    const stored = (resolution['manualPlayer'] as Record<string, unknown>)['displayName'];
    assert.equal(stored, playerName);
    assert.equal(String(stored).normalize('NFC'), stored);
  }
});
