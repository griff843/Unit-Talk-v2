import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  transitionPickLifecycle,
  type RepositoryBundle,
} from '@unit-talk/db';
import { processSubmission } from './submission-service.js';
import { recordPickSettlement } from './settlement-service.js';

function hasSupabaseSmokeEnvironment() {
  try {
    const env = loadEnvironment();
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  } catch {
    return false;
  }
}

const skipReason = hasSupabaseSmokeEnvironment()
  ? false
  : 'SUPABASE_SERVICE_ROLE_KEY not configured - skipping live DB proof';

let repositories: RepositoryBundle;

before(() => {
  if (skipReason) return;
  const env = loadEnvironment();
  repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(env));
});

test('UTV2 runtime truth proof: smart-form playerId persists canonical participant linkage in live DB', { skip: skipReason }, async () => {
  const fixtureId = `utv2-303-player-link-${randomUUID()}`;
  const fixtureSuffix = fixtureId.slice(-8);
  const participant = await repositories.participants.upsertByExternalId({
    externalId: fixtureId,
    displayName: `UTV2 Proof Player ${fixtureSuffix}`,
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {
      proofFixtureId: fixtureId,
      proofIssue: 'UTV2-614',
    },
  });

  const created = await processSubmission(
    {
      source: 'smart-form',
      submittedBy: 'griff843',
      market: 'player_points_ou',
      selection: `${participant.display_name} Over 27.5`,
      line: 27.5,
      odds: -110,
      eventName: `UTV2 Proof Event ${fixtureSuffix}`,
      metadata: {
        playerId: participant.id,
        proofFixtureId: fixtureId,
        proofIssue: 'UTV2-614',
      },
    },
    repositories,
  );

  assert.equal(created.pickRecord.player_id, participant.id);
  assert.equal(created.pickRecord.participant_id, participant.id);
  assert.equal(
    (created.pick.metadata as Record<string, unknown>)['participantId'],
    participant.id,
  );

  const persisted = await repositories.picks.findPickById(created.pick.id);
  assert.ok(persisted, 'submitted pick should exist in live DB');
  assert.equal(persisted?.player_id, participant.id);
  assert.equal(persisted?.participant_id, participant.id);
});

test('UTV2 runtime truth proof: settlement persists explicit CLV diagnostics in live DB', { skip: skipReason }, async () => {
  const fixtureId = `utv2-303-clv-${randomUUID()}`;
  const fixtureSuffix = fixtureId.slice(-8);
  const participant = await repositories.participants.upsertByExternalId({
    externalId: fixtureId,
    displayName: `UTV2 CLV Proof Player ${fixtureSuffix}`,
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {
      proofFixtureId: fixtureId,
      proofIssue: 'UTV2-618',
    },
  });

  const created = await processSubmission(
    {
      source: 'smart-form',
      submittedBy: 'griff843',
      market: 'player_points_ou',
      selection: `${participant.display_name} Over 24.5`,
      line: 24.5,
      odds: -110,
      eventName: `UTV2 Proof Event ${fixtureSuffix}`,
      metadata: {
        playerId: participant.id,
        proofFixtureId: fixtureId,
        proofIssue: 'UTV2-618',
      },
    },
    repositories,
  );

  await transitionPickLifecycle(repositories.picks, created.pick.id, 'queued', 'proof queued');
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'posted', 'proof posted', 'poster');

  await recordPickSettlement(
    created.pick.id,
    {
      status: 'settled',
      result: 'win',
      source: 'operator',
      confidence: 'confirmed',
      evidenceRef: `proof://utv2-618/${fixtureId}`,
      settledBy: 'operator',
      notes: 'live DB proof for explicit CLV diagnostics',
    },
    repositories,
  );

  const settlements = await repositories.settlements.listByPick(created.pick.id);
  assert.equal(settlements.length > 0, true, 'settlement row should exist in live DB');

  const latest = settlements[settlements.length - 1]!;
  const payload = (latest.payload ?? {}) as Record<string, unknown>;
  const clvStatus = typeof payload['clvStatus'] === 'string' ? payload['clvStatus'] : null;
  const clvUnavailableReason =
    typeof payload['clvUnavailableReason'] === 'string' ? payload['clvUnavailableReason'] : null;

  assert.ok(clvStatus, 'settlement payload must include explicit clvStatus');
  if (payload['clv'] == null) {
    assert.equal(
      clvUnavailableReason,
      clvStatus,
      'missing CLV payloads must explain why via clvUnavailableReason',
    );
  }
});
