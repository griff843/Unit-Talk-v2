/**
 * WORK-2026103007 API half: real staging submission/release persistence.
 * No Discord adapter runs here. The worker half must label its adapter simulated.
 * Registered only in the guarded CI staging live-proof chain.
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
  type RepositoryBundle,
} from '@unit-talk/db';
import { handleSubmitPick } from './handlers/submit-pick.js';

const stagingHost = 'xskgrzbteyqdufktjrjx.supabase.co';
const environment = loadEnvironment();
const supabaseUrl = environment.SUPABASE_URL ?? '';
const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? '';
const fixtureRun = process.env['CI_FIXTURE_RUN_ID'];
const mustRun = Boolean(fixtureRun);
const configuredHost = new URL(supabaseUrl || 'http://localhost').hostname;
const skip = !mustRun && configuredHost !== stagingHost
  ? 'no approved staging target configured; CI staging receipt required'
  : false;
const namespace = (fixtureRun ?? 'local-unconfigured').replace(/[^A-Za-z0-9-]/g, '-').slice(0, 48);
const capperId = `work3007-${namespace}`.toLowerCase();
const guildId = '100000000000000001';
const channelId = '100000000000000002';
let repositories: RepositoryBundle;

function headers(): Record<string, string> {
  return { apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' };
}

async function readRows<T>(query: string): Promise<T[]> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${query}`, { headers: headers() });
  assert.equal(response.ok, true, `staging read failed (${response.status})`);
  return await response.json() as T[];
}

before(async () => {
  if (skip) return;
  // Check the actual URL before constructing any privileged repository/client.
  assert.equal(new URL(supabaseUrl).protocol, 'https:');
  assert.equal(configuredHost, stagingHost, 'refusing any target other than approved staging');
  assert.ok(environment.SUPABASE_SERVICE_ROLE_KEY, 'CI staging credential missing; never skip credentialed CI');
  assert.ok(fixtureRun, 'CI_FIXTURE_RUN_ID is required for cross-process fixture identity');
  repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(environment));
  const response = await fetch(`${supabaseUrl}/rest/v1/cappers`, {
    method: 'POST', headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ id: capperId, display_name: `WORK3007 ${namespace}`, active: true,
      metadata: { discord: { guildId, picksChannelId: channelId, discussionChannelId: '100000000000000003' } } }]),
  });
  assert.equal(response.ok, true, `staging fixture capper write failed (${response.status})`);
  const cappers = await readRows<{ id: string }>(`cappers?id=eq.${capperId}&select=id`);
  assert.deepEqual(cappers, [{ id: capperId }], 'seeded capper must persist under its exact identity');
});

function body(label: string, distributionMode: string) {
  // Idempotency excludes capper identity; isolate the bet fields from the
  // preceding Track Only suite, which shares CI_FIXTURE_RUN_ID.
  const away = `WORK3007 Northgate Foundry ${namespace}`;
  const home = `WORK3007 Southport Ironworks ${namespace}`;
  const eventName = `${away} at ${home} (${label})`;
  return { source: 'smart-form', market: 'NFL moneyline', selection: `${away} ML ${label}`,
    odds: -110, stakeUnits: 0.5, confidence: 0.7, eventName,
    metadata: { sport: 'NFL', capper: capperId, distributionMode,
      proof_issue: 'WORK-2026103007', proof_run: namespace, proof_role: label,
      participantResolution: { resolution: 'manual', sportId: 'NFL', eventId: null, manualOverride: true,
        reason: 'canonical-coverage-gap', enteredEventName: eventName,
        enteredParticipants: [
          { role: 'away', displayName: away, canonicalParticipantId: null },
          { role: 'home', displayName: home, canonicalParticipantId: null },
        ] },
    } };
}

async function submit(label: string, distributionMode: string, allowlist = capperId) {
  const overrides = { UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED: 'true',
    UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: allowlist, UNIT_TALK_ENABLED_TARGETS: 'official-picks',
    UNIT_TALK_APP_ENV: 'production', DISCORD_GUILD_ID: guildId, DISCORD_CAPPER_CHANNEL_ID: '100000000000000004' };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    return await handleSubmitPick({ body: body(label, distributionMode),
      auth: { role: 'capper', capperId, identity: capperId } }, repositories);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('WORK-2026103007 live staging: canonical authorization/release persists one outbox; Track Only and removed allowlist cannot enqueue', { skip }, async () => {
  const delivered = await submit('delivery', 'delivery-eligible');
  assert.equal(delivered.status, 201, JSON.stringify(delivered.body));
  assert.ok(delivered.body.ok);
  if (!delivered.body.ok) throw new Error('authorized staging submission failed');
  const pickId = delivered.body.data.pickId;
  const picks = await readRows<{ id: string; capper_id: string; status: string; metadata: Record<string, unknown> }>(
    `picks?id=eq.${pickId}&select=id,capper_id,status,metadata`);
  const diagnostic = JSON.stringify({ pickId, picks });
  assert.equal(picks.length, 1, diagnostic);
  assert.equal(picks[0]!.capper_id, capperId, diagnostic);
  assert.equal(picks[0]!.status, 'queued');
  assert.equal((picks[0]!.metadata['deliveryAuthorization'] as Record<string, unknown>)['decision'], 'authorized');
  const rows = await readRows<{ id: string; target: string; status: string; claimed_at: string | null; claimed_by: string | null; payload: Record<string, unknown> }>(
    `distribution_outbox?pick_id=eq.${pickId}&select=id,target,status,claimed_at,claimed_by,payload`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.target, 'discord:official-picks');
  assert.equal(rows[0]!.status, 'pending');
  assert.equal(rows[0]!.claimed_at, null);
  assert.equal(rows[0]!.claimed_by, null);
  const destination = rows[0]!.payload['deliveryDestination'] as Record<string, unknown>;
  assert.equal(destination['capperId'], capperId);
  assert.equal(destination['channelId'], channelId);
  assert.equal(destination['guildId'], guildId);
  const lifecycle = await readRows<{ to_state: string }>(`pick_lifecycle?pick_id=eq.${pickId}&select=to_state`);
  assert.ok(lifecycle.some((row) => row.to_state === 'validated'));
  assert.ok(lifecycle.some((row) => row.to_state === 'queued'));

  const tracked = await submit('track-only', 'track-only');
  assert.equal(tracked.status, 201, JSON.stringify(tracked.body));
  assert.ok(tracked.body.ok);
  if (!tracked.body.ok) throw new Error('Track Only staging submission failed');
  const trackedPicks = await readRows<{ id: string; capper_id: string | null; status: string; metadata: Record<string, unknown> }>(
    `picks?id=eq.${tracked.body.data.pickId}&select=id,capper_id,status,metadata`);
  const trackedDiagnostic = JSON.stringify({ pickId: tracked.body.data.pickId, picks: trackedPicks });
  assert.equal(trackedPicks.length, 1, trackedDiagnostic);
  assert.equal(trackedPicks[0]!.capper_id, capperId, trackedDiagnostic);
  assert.equal((await readRows(`distribution_outbox?pick_id=eq.${tracked.body.data.pickId}&select=id`)).length, 0);

  // Required configuration mutation: removing authorization makes the same
  // deliverable request fail, instead of producing step 2's outbox row.
  const removedAllowlist = await submit('removed-allowlist', 'delivery-eligible', '');
  assert.equal(removedAllowlist.status, 403);
  const capperPicks = await readRows<{ id: string }>(`picks?capper_id=eq.${capperId}&select=id`);
  assert.deepEqual(capperPicks.map((pick) => pick.id).sort(), [pickId, tracked.body.data.pickId].sort(),
    `rejected mutation must not persist another pick: ${JSON.stringify(capperPicks)}`);

  // Persist the primary ID for the separate worker process, on our own fixture.
  const handoff = await fetch(`${supabaseUrl}/rest/v1/cappers?id=eq.${capperId}`, {
    method: 'PATCH', headers: headers(), body: JSON.stringify({ metadata: {
      discord: { guildId, picksChannelId: channelId, discussionChannelId: '100000000000000003' },
      proofDeliveryPickId: pickId,
    } }),
  });
  assert.equal(handoff.ok, true, `fixture pick-ID handoff failed (${handoff.status})`);
});
