/**
 * UTV2-1923 — human capper delivery authorization (W1).
 *
 * The allow-list is the first of the two keys that make member delivery
 * possible for a human capper's pick, so every way it could fail OPEN is
 * asserted here, not just the happy path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { releaseHumanCapperDeliveryWithRunTracking } from './run-audit-service.js';

import {
  CAPPER_DELIVERY_ALLOWLIST_ENV,
  evaluateCapperDeliveryAuthorization,
  isHumanCapperDeliveryPostureEnabled,
  parseCapperDeliveryAllowlist,
  recordTrackOnlyRequest,
} from './capper-delivery-authorization.js';
import {
  isHumanCapperDeliveryAuthorized,
  readHumanCapperDeliveryAuthorization,
  isMemberVisibleDeliveryAudience,
  readCapperDiscordRouting,
} from '@unit-talk/contracts';

test('WORK-2026103005: audience is legacy-compatible and fails closed for private, malformed and disagreeing pins', () => {
  for (const audience of [undefined, 'members', 'staff-canary', 'unknown', null, 1, false, {}]) {
    const metadata = { deliveryAuthorization: { ...(audience === undefined ? {} : { audience }) } };
    assert.equal(isMemberVisibleDeliveryAudience(metadata), audience === undefined || audience === 'members');
  }
  assert.equal(isMemberVisibleDeliveryAudience({}), true);
  assert.equal(isMemberVisibleDeliveryAudience({ deliveryAuthorization: { audience: 'members' } }, [
    { deliveryDestination: { audience: 'staff-canary' } },
  ]), false);
  assert.equal(isMemberVisibleDeliveryAudience({}, [{ deliveryDestination: { audience: 'unknown' } }]), false);
  assert.equal(isMemberVisibleDeliveryAudience({}, [{ deliveryDestination: { audience: null } }]), false);
  assert.equal(isMemberVisibleDeliveryAudience({}, [{ deliveryDestination: { audience: 'members' } }]), true);
});

test('WORK-2026103005: canonical routing recognizes staff-canary and refuses every malformed audience', () => {
  for (const audience of [undefined, 'members', 'staff-canary', 'unknown', null, 42]) {
    const result = readCapperDiscordRouting({ discord: {
      guildId: '1284478946171293736', picksChannelId: '1384052464189440120',
      ...(audience === undefined ? {} : { audience }),
    } });
    if (audience === undefined || audience === 'members' || audience === 'staff-canary') {
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.routing.audience, audience ?? 'members');
    } else {
      assert.deepEqual(result, { ok: false, reason: 'audience-unrecognized' });
    }
  }
});

const POSTURE_ON = { UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED: 'true' };

test('WORK-2026103005: release pins staff audience on its own outbox, never the shared destination map', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const id = randomUUID();
  const authorization = evaluateCapperDeliveryAuthorization({ capperId: 'test-capper', isAuthenticatedCapper: true,
    env: { ...POSTURE_ON, UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: 'test-capper' } });
  assert.equal(authorization.decision, 'authorized');
  await repositories.picks.savePick({ id, submissionId: randomUUID(), market: 'moneyline', selection: 'test-pick',
    odds: 100, stakeUnits: 1, source: 'smart-form', approvalStatus: 'approved', promotionStatus: 'not_eligible',
    lifecycleState: 'validated', createdAt: '2026-10-30T12:00:00.000Z',
    metadata: { distributionMode: 'delivery-eligible', deliveryAuthorization: authorization } });
  const changes = { UNIT_TALK_ENABLED_TARGETS: 'official-picks', UNIT_TALK_APP_ENV: 'production',
    DISCORD_GUILD_ID: '100000000000000001', DISCORD_CAPPER_CHANNEL_ID: '100000000000000004' };
  const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, process.env[key]]));
  Object.assign(process.env, changes);
  try {
    const result = await releaseHumanCapperDeliveryWithRunTracking(id, 'operator:test', 'audience test',
      repositories.picks, repositories.outbox, repositories.runs, repositories.audit, 'submission', {
        findById: async () => ({ metadata: { discord: { guildId: changes.DISCORD_GUILD_ID,
          picksChannelId: '100000000000000002', audience: 'staff-canary' } } }),
      });
    assert.equal(result.enqueued, true);
    const rows = await repositories.outbox.listByPickId(id);
    assert.equal(rows.length, 1);
    assert.deepEqual((rows[0]!.payload as Record<string, unknown>)['deliveryDestination'], {
      version: 'capper-discord-routing/v1', capperId: 'test-capper', guildId: changes.DISCORD_GUILD_ID,
      channelId: '100000000000000002', source: 'cappers.metadata.discord.picksChannelId', audience: 'staff-canary',
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('parseCapperDeliveryAllowlist: every empty shape yields an empty list', () => {
  for (const raw of [undefined, null, '', '   ', ',', ' , , ']) {
    assert.deepEqual(
      parseCapperDeliveryAllowlist(raw as string | undefined),
      [],
      `"${String(raw)}" must parse to an empty allow-list`,
    );
  }
});

test('parseCapperDeliveryAllowlist: trims, lowercases and de-duplicates', () => {
  assert.deepEqual(
    parseCapperDeliveryAllowlist(' Griff843 , griff843,  another-capper '),
    ['griff843', 'another-capper'],
  );
});

test('posture is off unless the deployment says exactly "true"', () => {
  for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes']) {
    assert.equal(
      isHumanCapperDeliveryPostureEnabled({
        UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED: value,
      }),
      false,
      `"${String(value)}" must not enable the human delivery posture`,
    );
  }
  assert.equal(isHumanCapperDeliveryPostureEnabled(POSTURE_ON), true);
});

test('fail closed: an unset allow-list authorizes nobody, even with the posture on', () => {
  const decision = evaluateCapperDeliveryAuthorization({
    capperId: 'griff843',
    isAuthenticatedCapper: true,
    env: { ...POSTURE_ON },
  });
  assert.equal(decision.decision, 'refused');
  assert.equal(decision.reason, 'allowlist-unset');
});

test('fail closed: an empty allow-list authorizes nobody', () => {
  const decision = evaluateCapperDeliveryAuthorization({
    capperId: 'griff843',
    isAuthenticatedCapper: true,
    env: { ...POSTURE_ON, UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: '  ,  ' },
  });
  assert.equal(decision.decision, 'refused');
  assert.equal(decision.reason, 'allowlist-unset');
});

test('fail closed: the posture switch alone refuses a fully allow-listed capper', () => {
  // Both controls are required. An allow-list left behind in a config file
  // must not by itself open the path on a deployment that never asked for it.
  const decision = evaluateCapperDeliveryAuthorization({
    capperId: 'griff843',
    isAuthenticatedCapper: true,
    env: { UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: 'griff843' },
  });
  assert.equal(decision.decision, 'refused');
  assert.equal(decision.reason, 'human-delivery-posture-off');
});

test('fail closed: an allow-listed identity with no authenticated capper role is refused', () => {
  const decision = evaluateCapperDeliveryAuthorization({
    capperId: 'griff843',
    isAuthenticatedCapper: false,
    env: { ...POSTURE_ON, UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: 'griff843' },
  });
  assert.equal(decision.decision, 'refused');
  assert.equal(decision.reason, 'no-capper-identity');
});

test('fail closed: a capper who is not on a populated allow-list is refused', () => {
  const decision = evaluateCapperDeliveryAuthorization({
    capperId: 'someone-else',
    isAuthenticatedCapper: true,
    env: { ...POSTURE_ON, UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: 'griff843' },
  });
  assert.equal(decision.decision, 'refused');
  assert.equal(decision.reason, 'capper-not-allowlisted');
});

test('authorizes only an allow-listed, authenticated capper under an enabled posture', () => {
  const decision = evaluateCapperDeliveryAuthorization({
    capperId: 'Griff843',
    isAuthenticatedCapper: true,
    env: { ...POSTURE_ON, UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: 'griff843' },
    now: new Date('2026-09-17T00:00:00.000Z'),
  });
  assert.equal(decision.decision, 'authorized');
  assert.equal(decision.capperId, 'Griff843');
  assert.equal(decision.authority, 'server-allowlist');
  assert.equal(decision.allowlistSource, CAPPER_DELIVERY_ALLOWLIST_ENV);
  assert.equal(decision.decidedAt, '2026-09-17T00:00:00.000Z');
  assert.equal(decision.reason, undefined);
});

test('every decision, including refusals, is an auditable record', () => {
  // A refusal that recorded nothing would leave no evidence the question was
  // ever asked, which is the failure mode this record exists to prevent.
  for (const input of [
    { capperId: 'griff843', isAuthenticatedCapper: true, env: { ...POSTURE_ON } },
    { capperId: null, isAuthenticatedCapper: false, env: { ...POSTURE_ON } },
    {
      capperId: 'griff843',
      isAuthenticatedCapper: true,
      env: { ...POSTURE_ON, UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: 'griff843' },
    },
  ]) {
    const decision = evaluateCapperDeliveryAuthorization(input);
    assert.ok(
      readHumanCapperDeliveryAuthorization({ deliveryAuthorization: decision }),
      'every decision must round-trip through the contract reader',
    );
    assert.equal(typeof decision.decidedAt, 'string');
    assert.equal(decision.allowlistSource, CAPPER_DELIVERY_ALLOWLIST_ENV);
  }
});

test('the allow-list contents are never recorded — only the env var name is', () => {
  const decision = evaluateCapperDeliveryAuthorization({
    capperId: 'griff843',
    isAuthenticatedCapper: true,
    env: {
      ...POSTURE_ON,
      UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST: 'griff843,secret-capper-two',
    },
  });
  const serialized = JSON.stringify(decision);
  assert.ok(
    !serialized.includes('secret-capper-two'),
    'the authorization record must not carry the rest of the allow-list',
  );
});

test('a malformed authorization record never reads as permission', () => {
  // Anything that is not a complete, current-version, server-shaped record
  // must read as "no authorization", not as an authorization with defaults.
  const malformed: unknown[] = [
    null,
    'authorized',
    ['authorized'],
    {},
    { decision: 'authorized' },
    { version: 'human-capper-delivery/v1', decision: 'authorized' },
    {
      version: 'human-capper-delivery/v2',
      decision: 'authorized',
      authority: 'server-allowlist',
      decidedAt: '2026-09-17T00:00:00.000Z',
    },
    {
      version: 'human-capper-delivery/v1',
      decision: 'authorized',
      authority: 'client',
      decidedAt: '2026-09-17T00:00:00.000Z',
    },
    {
      version: 'human-capper-delivery/v1',
      decision: 'yes',
      authority: 'server-allowlist',
      decidedAt: '2026-09-17T00:00:00.000Z',
    },
  ];

  for (const value of malformed) {
    assert.equal(
      readHumanCapperDeliveryAuthorization({ deliveryAuthorization: value }),
      null,
      `${JSON.stringify(value)} must not read as an authorization record`,
    );
  }
});

test('recordTrackOnlyRequest: a Track Only request is a readable refusal that never authorizes', () => {
  const now = new Date('2026-09-28T02:13:06.495Z');
  const record = recordTrackOnlyRequest({ capperId: '  griff843  ', now });
  assert.deepEqual(record, {
    version: 'human-capper-delivery/v1',
    decision: 'refused',
    capperId: 'griff843',
    reason: 'track-only-requested',
    authority: 'server-allowlist',
    allowlistSource: CAPPER_DELIVERY_ALLOWLIST_ENV,
    decidedAt: now.toISOString(),
  });
  // It must survive the reader, or the pick would carry no record at all.
  const metadata = { deliveryAuthorization: record };
  assert.deepEqual(readHumanCapperDeliveryAuthorization(metadata), record);
  assert.equal(isHumanCapperDeliveryAuthorized(metadata), false);
});

test('recordTrackOnlyRequest: does not consult the allow-list, even when it would authorize', () => {
  const previous = { ...process.env };
  process.env['UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED'] = 'true';
  process.env[CAPPER_DELIVERY_ALLOWLIST_ENV] = 'griff843';
  try {
    assert.equal(
      evaluateCapperDeliveryAuthorization({ capperId: 'griff843', isAuthenticatedCapper: true }).decision,
      'authorized',
      'precondition: the allow-list would authorize this capper',
    );
    assert.equal(recordTrackOnlyRequest({ capperId: 'griff843' }).decision, 'refused');
  } finally {
    for (const key of ['UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED', CAPPER_DELIVERY_ALLOWLIST_ENV]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('recordTrackOnlyRequest: an absent or blank capper id is recorded as null', () => {
  for (const capperId of [undefined, null, '', '   ']) {
    assert.equal(recordTrackOnlyRequest({ capperId }).capperId, null);
  }
});
