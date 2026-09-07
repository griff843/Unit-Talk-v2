import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { EventBrowseResult, ReferenceDataRepository } from '@unit-talk/db';
import type { SubmissionPayload } from '@unit-talk/contracts';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { validateSmartFormRelationships } from './smart-form-validation.js';

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

test('structured no-event fallback rejects a player whose team relationship cannot be verified', async () => {
  const invalid = payload();
  const resolution = invalid.metadata?.['participantResolution'] as Record<string, unknown>;
  resolution['eventId'] = null;
  resolution['player'] = {
    participantId: 'player-mlb-injection',
    displayName: 'Cross Sport Player',
    participantType: 'player',
    teamId: 'team-tcu',
  };
  const repository = referenceData();
  repository.searchTeams = async (_sportId, query) => [{
    participantId: query === 'TCU' ? 'team-tcu' : 'team-unc',
    displayName: query,
    sport: 'NCAAF',
  }];
  await assert.rejects(
    () => validateSmartFormRelationships(invalid, repository),
    /player selection requires a canonical event/,
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
// arbitrary slice reported no availability even though canonical players
// existed. Availability is a refusal input for Smart Form coverage, so that is
// a wrong answer rather than a slow one.
//
// The fixture below is built so the old implementation is provably wrong: 250
// MLB players sort ahead of the single NBA player, and the old code capped at
// limit * 5 = 100 rows. The NBA player is row 251 of the name match, so it was
// never in the batch and NBA reported unavailable.
// ---------------------------------------------------------------------------

interface StubPlayerRow {
  id: string;
  display_name: string;
}

function stubReferenceDataClient(players: StubPlayerRow[], assignments: Map<string, string>) {
  const pageRequests: Array<[number, number]> = [];
  const client = {
    from(table: string) {
      if (table === 'players') {
        return {
          select: () => ({
            ilike: (_column: string, pattern: string) => {
              const needle = pattern.replace(/%/gu, '').toLowerCase();
              return {
                // The old implementation called .limit(); the new one orders
                // and pages. Both are exposed so this fixture cannot silently
                // pass by the method simply being absent.
                limit: async (count: number) => ({
                  data: players
                    .filter((row) => row.display_name.toLowerCase().includes(needle))
                    .slice(0, count),
                  error: null,
                }),
                order: () => ({
                  range: async (from: number, to: number) => {
                    pageRequests.push([from, to]);
                    const matched = players
                      .filter((row) => row.display_name.toLowerCase().includes(needle))
                      .sort((left, right) =>
                        left.display_name.localeCompare(right.display_name),
                      );
                    return { data: matched.slice(from, to + 1), error: null };
                  },
                }),
              };
            },
          }),
        };
      }
      if (table === 'player_team_assignments') {
        return {
          select: () => ({
            in: (_column: string, ids: string[]) => ({
              is: async () => ({
                data: ids
                  .filter((id) => assignments.has(id))
                  .map((id) => ({
                    player_id: id,
                    team_id: `team-${assignments.get(id)}`,
                    league_id: `league-${assignments.get(id)}`,
                    effective_until: null,
                  })),
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'leagues') {
        return {
          select: () => ({
            in: async (_column: string, ids: string[]) => ({
              data: ids.map((id) => ({
                id,
                sport_id: id.replace(/^league-/u, ''),
              })),
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, pageRequests };
}

function buildCrossSportFixture() {
  const players: StubPlayerRow[] = [];
  const assignments = new Map<string, string>();
  // 250 MLB players whose names sort ahead of the NBA player.
  for (let index = 0; index < 250; index += 1) {
    const id = `mlb-${String(index).padStart(3, '0')}`;
    players.push({ id, display_name: `AAA Jordan Filler ${String(index).padStart(3, '0')}` });
    assignments.set(id, 'MLB');
  }
  const nbaId = 'nba-target';
  players.push({ id: nbaId, display_name: 'ZZZ Jordan Target' });
  assignments.set(nbaId, 'NBA');
  return { players, assignments, nbaId };
}

test('searchPlayers finds an NBA player that sorts beyond the former global cap', async () => {
  const { DatabaseReferenceDataRepository } = await import('@unit-talk/db');
  const { players, assignments, nbaId } = buildCrossSportFixture();
  const { client } = stubReferenceDataClient(players, assignments);

  const repository = new DatabaseReferenceDataRepository(
    { url: 'https://stub.invalid', serviceRoleKey: 'stub' } as never,
    client as never,
  );

  const results = await repository.searchPlayers('NBA', 'Jordan', 20);

  // The old implementation fetched limit*5 = 100 rows and filtered afterwards.
  // The NBA player is match number 251, so it returned [] and the Smart Form
  // reported playersAvailable:false for a sport that has a canonical player.
  assert.equal(results.length, 1);
  assert.equal(results[0]?.participantId, nbaId);
  assert.equal(results[0]?.sport, 'NBA');
  assert.equal(results[0]?.teamId, 'team-NBA');
});

test('searchPlayers still returns the requested sport and never leaks another', async () => {
  const { DatabaseReferenceDataRepository } = await import('@unit-talk/db');
  const { players, assignments } = buildCrossSportFixture();
  const { client } = stubReferenceDataClient(players, assignments);

  const repository = new DatabaseReferenceDataRepository(
    { url: 'https://stub.invalid', serviceRoleKey: 'stub' } as never,
    client as never,
  );

  const mlb = await repository.searchPlayers('MLB', 'Jordan', 20);
  assert.equal(mlb.length, 20);
  assert.ok(mlb.every((row) => row.sport === 'MLB'));
  // Positive control: the sport filter is doing work, not just passing
  // everything through. A sport with no players must still return nothing.
  const nhl = await repository.searchPlayers('NHL', 'Jordan', 20);
  assert.deepEqual(nhl, []);
});

test('searchPlayers stops paging once the limit is satisfied', async () => {
  const { DatabaseReferenceDataRepository } = await import('@unit-talk/db');
  const { players, assignments } = buildCrossSportFixture();
  const { client, pageRequests } = stubReferenceDataClient(players, assignments);

  const repository = new DatabaseReferenceDataRepository(
    { url: 'https://stub.invalid', serviceRoleKey: 'stub' } as never,
    client as never,
  );

  await repository.searchPlayers('MLB', 'Jordan', 5);

  // 251 matches fit in the first 500-row page, and the limit is met there, so
  // the common case must not have become a multi-round-trip search.
  assert.equal(pageRequests.length, 1);
  assert.deepEqual(pageRequests[0], [0, 499]);
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
  assert.deepEqual(outcome, { kind: 'canonical-event', eventId: event.eventId, distributionMode: 'track-only' });
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
  assert.deepEqual(outcome, { kind: 'manual-coverage-gap', distributionMode: 'track-only' });
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
  assert.deepEqual(outcome, { kind: 'structured-team-fallback', distributionMode: 'track-only' });
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
  assert.deepEqual(outcome, { kind: 'structured-team-fallback', distributionMode: 'delivery-eligible' });
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
      { kind: 'structured-team-fallback', distributionMode: 'track-only' },
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
