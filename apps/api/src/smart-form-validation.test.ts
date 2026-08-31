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
    /resolves to canonical participant team-lakers/u,
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
        {
          ...referenceDataWithCanonicalTeams(),
          searchTeams: async () =>
            [{ participantId: 'team-lakers', displayName: 'la lakers', participantType: 'team' }] as never,
        } as ReferenceDataRepository,
      ),
    /resolves to canonical participant team-lakers/u,
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
