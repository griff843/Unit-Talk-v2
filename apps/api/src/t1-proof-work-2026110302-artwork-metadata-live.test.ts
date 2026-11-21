/**
 * WORK-2026110302: staging-only proof that pick metadata persists the
 * server-derived `thumbnailVerified` flag and strips caller-supplied artwork.
 * No delivery adapter or target is used; fixture picks stay Track Only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  transitionPickLifecycle,
} from '@unit-talk/db';
import { processSubmission } from './submission-service.js';

const fixtureRun = process.env['CI_FIXTURE_RUN_ID'];
const environment = loadEnvironment();
const url = environment.SUPABASE_URL ?? '';
const key = environment.SUPABASE_SERVICE_ROLE_KEY ?? '';
const stagingHost = 'xskgrzbteyqdufktjrjx.supabase.co';
const skip = !fixtureRun ? 'requires staging-ci and CI_FIXTURE_RUN_ID; no local DB writes' : false;
const HEADSHOT = 'https://cdn.nba.com/headshots/nba/latest/1040x760/2544.png';

test('WORK0302 live staging: thumbnailVerified persists from the resolver and caller artwork is stripped', { skip }, async (t) => {
  // Validate target before constructing any privileged client. Credentialed CI never skips.
  assert.equal(process.env['CI'], 'true', 'writable proof runs through CI only');
  assert.ok(fixtureRun);
  assert.equal(new URL(url).protocol, 'https:');
  assert.equal(new URL(url).hostname, stagingHost);
  assert.ok(key, 'staging CI service credential required');
  const namespace = `work0302-${fixtureRun.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 32)}-${randomUUID()}`.toLowerCase();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(environment));
  const ownedIds = new Set<string>();

  async function byId(table: string, id: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`, { headers });
    assert.equal(response.ok, true, `${table} read failed (${response.status})`);
    const result = (await response.json()) as Record<string, unknown>[];
    assert.equal(result.length, 1, `${table} primary ID ${id}`);
    return result[0]!;
  }
  async function outbox(pickId: string) {
    const response = await fetch(`${url}/rest/v1/distribution_outbox?pick_id=eq.${pickId}&select=id`, { headers });
    assert.equal(response.ok, true);
    return (await response.json()) as unknown[];
  }
  function payload(label: string, metadata: Record<string, unknown>) {
    return {
      source: 'api' as const,
      market: 'player_points_ou',
      selection: `${namespace} ${label} Over 27.5`,
      line: 27.5,
      eventName: `${namespace} fixture`,
      odds: -110,
      stakeUnits: 1,
      submittedBy: namespace,
      metadata: { distributionMode: 'track-only', proof_issue: 'WORK-2026110302', proof_run: namespace, ...metadata },
    };
  }
  t.after(async () => {
    for (const id of ownedIds) {
      const pick = await byId('picks', id);
      if (pick['status'] !== 'voided') {
        await transitionPickLifecycle(repositories.picks, id, 'voided', `WORK0302 cleanup ${namespace}`, 'operator_override');
      }
      assert.equal((await byId('picks', id))['status'], 'voided');
      assert.deepEqual(await outbox(id), []);
    }
  });

  const participant = await repositories.participants.upsertByExternalId({
    externalId: `${namespace}-player`,
    displayName: `${namespace} Player`,
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: { headshot_url: HEADSHOT, proof_run: namespace },
  });
  // The persistence shape is under test here, not the external provider, so the
  // #1822 matcher is replaced by one that confirms exactly the stored URL.
  const confirm = { resolveHeadshot: async () => ({ url: HEADSHOT, reason: 'confirmed' as const }) };

  const verified = await processSubmission(
    payload('verified', { participantId: participant.id }),
    repositories, undefined, confirm,
  );
  ownedIds.add(verified.pick.id);
  const verifiedRow = await byId('picks', verified.pick.id);
  const verifiedMeta = verifiedRow['metadata'] as Record<string, unknown>;
  assert.equal(verifiedMeta['thumbnailUrl'], HEADSHOT);
  assert.equal(verifiedMeta['thumbnailVerified'], true);
  assert.deepEqual(await outbox(verified.pick.id), [], 'Track Only fixture never touches a delivery target');

  const forged = await processSubmission(
    payload('forged', { thumbnailUrl: 'https://example.com/someone-else.png', thumbnailVerified: true }),
    repositories, undefined, confirm,
  );
  ownedIds.add(forged.pick.id);
  const forgedMeta = (await byId('picks', forged.pick.id))['metadata'] as Record<string, unknown>;
  assert.equal('thumbnailUrl' in forgedMeta, false);
  assert.equal('thumbnailVerified' in forgedMeta, false);
  assert.deepEqual(await outbox(forged.pick.id), []);

  const unverified = await processSubmission(
    payload('unverified', { participantId: participant.id, thumbnailVerified: true }),
    repositories, undefined, { resolveHeadshot: async () => ({ url: null, reason: 'ambiguous' as const }) },
  );
  ownedIds.add(unverified.pick.id);
  const unverifiedMeta = (await byId('picks', unverified.pick.id))['metadata'] as Record<string, unknown>;
  assert.equal('thumbnailUrl' in unverifiedMeta, false);
  assert.equal('thumbnailVerified' in unverifiedMeta, false);

  t.diagnostic(JSON.stringify({ issue: 'WORK-2026110302', namespace, participant_id: participant.id,
    pick_ids: [...ownedIds], expected: { verified: true, forged: 'stripped', unverified: 'absent' } }));
});
