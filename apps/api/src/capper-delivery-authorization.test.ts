/**
 * UTV2-1923 — human capper delivery authorization (W1).
 *
 * The allow-list is the first of the two keys that make member delivery
 * possible for a human capper's pick, so every way it could fail OPEN is
 * asserted here, not just the happy path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPPER_DELIVERY_ALLOWLIST_ENV,
  evaluateCapperDeliveryAuthorization,
  isHumanCapperDeliveryPostureEnabled,
  parseCapperDeliveryAllowlist,
} from './capper-delivery-authorization.js';
import { readHumanCapperDeliveryAuthorization } from '@unit-talk/contracts';

const POSTURE_ON = { UNIT_TALK_HUMAN_CAPPER_DELIVERY_ENABLED: 'true' };

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
