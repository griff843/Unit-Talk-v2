import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateBootstrapAuthorization,
  parseAuthorizations,
  partitionViolations,
  type BootstrapAuthorization,
} from './bootstrap-authorization.js';

const NOW = new Date('2026-08-05T00:00:00Z');

function grant(overrides: Partial<BootstrapAuthorization> = {}): BootstrapAuthorization {
  return {
    issue_id: 'UTV2-1619',
    lane_type: 'governance',
    authorized_by: 'griff843',
    authorized_at: '2026-08-05',
    expires_at: '2026-09-05',
    milestone: 'Milestone 1',
    reason: 'admission dependency',
    ...overrides,
  };
}

function file(...authorizations: BootstrapAuthorization[]): string {
  return JSON.stringify({ schema_version: 1, authorizations });
}

test('BA-1: a matching, unexpired governance grant authorizes the named lane', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant()),
    now: NOW,
  });
  assert.equal(result.authorized, true);
  assert.equal(result.authorized && result.authorization.issue_id, 'UTV2-1619');
});

test('BA-2: issue id matching is case-insensitive but exact otherwise', () => {
  const lower = evaluateBootstrapAuthorization({
    issueId: 'utv2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant()),
    now: NOW,
  });
  assert.equal(lower.authorized, true);
});

test('BA-3: a grant for one issue does not admit a different issue', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1620',
    laneType: 'governance',
    authorizationsRaw: file(grant()),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'no_authorization_for_issue');
});

test('BA-4: a grant does not admit a non-governance lane for the same issue', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'runtime',
    authorizationsRaw: file(grant()),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'lane_type_not_authorized');
});

test('BA-5: a grant that names a non-governance lane_type authorizes nothing', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'runtime',
    authorizationsRaw: file(grant({ lane_type: 'runtime' })),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'lane_type_not_governance');
});

test('BA-6: an expired grant is refused', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant({ expires_at: '2026-08-04' })),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'authorization_expired');
});

test('BA-7: an expiry exactly at now is expired (boundary fails closed)', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant({ expires_at: NOW.toISOString() })),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'authorization_expired');
});

test('BA-8: an unparseable expiry is treated as expired, not as no-expiry', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant({ expires_at: 'whenever' })),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'authorization_expired');
});

test('BA-9: a missing authorization file authorizes nothing', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: null,
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'no_authorization_file');
});

test('BA-10: malformed JSON authorizes nothing', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: '{ not json',
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'malformed_authorization_file');
});

test('BA-11: an entry missing a required field invalidates the whole file', () => {
  const raw = JSON.stringify({
    schema_version: 1,
    authorizations: [{ issue_id: 'UTV2-1619', lane_type: 'governance' }],
  });
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: raw,
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'malformed_authorization_file');
});

test('BA-12: two unexpired grants refuse everything rather than picking one', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant(), grant({ issue_id: 'UTV2-1620' })),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'multiple_active_authorizations');
});

test('BA-13: an expired grant alongside an active one does not trip the accumulation guard', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(grant(), grant({ issue_id: 'UTV2-1620', expires_at: '2026-01-01' })),
    now: NOW,
  });
  assert.equal(result.authorized, true);
});

test('BA-14: an empty authorizations array authorizes nothing', () => {
  const result = evaluateBootstrapAuthorization({
    issueId: 'UTV2-1619',
    laneType: 'governance',
    authorizationsRaw: file(),
    now: NOW,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.code, 'no_authorization_for_issue');
});

test('BA-15: parseAuthorizations rejects a non-array authorizations field', () => {
  assert.equal(parseAuthorizations('{"authorizations": {}}'), null);
  assert.equal(parseAuthorizations('[]'), null);
  assert.equal(parseAuthorizations('null'), null);
});

test('BA-16: only cap violations are suppressible; structural rules stay blocking', () => {
  const violations = [
    { code: 'total_cap_exceeded', message: 'total' },
    { code: 'claude_cap_exceeded', message: 'claude' },
    { code: 'governance_type_cap_exceeded', message: 'governance' },
    { code: 'codex_cap_exceeded', message: 'codex' },
    { code: 'forbidden_combination', message: 'forbidden' },
    { code: 'singleton_type_conflict', message: 'singleton' },
    { code: 'verification_target_conflict', message: 'target' },
    { code: 'delivery_ui_app_conflict', message: 'ui' },
    { code: 'hygiene_type_cap_exceeded', message: 'hygiene' },
  ];
  const { suppressible, blocking } = partitionViolations(violations);
  assert.deepEqual(
    suppressible.map((v) => v.code),
    ['total_cap_exceeded', 'claude_cap_exceeded', 'governance_type_cap_exceeded', 'codex_cap_exceeded'],
  );
  // hygiene stays blocking: a governance-only authorization must never admit a
  // lane past a cap that belongs to a type it does not cover.
  assert.deepEqual(
    blocking.map((v) => v.code),
    [
      'forbidden_combination',
      'singleton_type_conflict',
      'verification_target_conflict',
      'delivery_ui_app_conflict',
      'hygiene_type_cap_exceeded',
    ],
  );
});

test('BA-17: partitioning an empty violation list yields two empty lists', () => {
  const { suppressible, blocking } = partitionViolations([]);
  assert.deepEqual(suppressible, []);
  assert.deepEqual(blocking, []);
});
